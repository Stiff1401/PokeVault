'use client';

import type { Variant } from './db';
import { CARD_ASPECT, CARD_REGIONS, regionToPixels, type Region } from './image-quality';
import { getSettings, VISION_DEFAULTS, type Settings } from './settings';
import { findCandidates, parseCollectorNumber, type MatchCandidate } from './tcg-api';
import {
  cardImageBase,
  cardWindows,
  loadVisualIndex,
  refineHits,
  searchThumbnails,
  type Box,
  type IndexCard,
  type VisualHit,
  type VisualIndex,
  type WindowMode,
} from './visual-index';

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

/** Single-shot extraction result – identical shape for OCR and vision APIs. */
export interface CardExtraction {
  isReadable: boolean;
  missingFields: string[];
  name: string | null;
  setCode: string | null;
  cardNumber: string | null;
  language: string | null;
  variant: Variant | null;
  /** 0..1 */
  confidence: number;
}

export interface RecognitionResult {
  /** 1 = local engine (no API key), 2 = BYOK vision API. */
  tier: 1 | 2;
  /** `visual`: artwork index + number reading, `ocr`: text only, `vision`: external API. */
  method: 'visual' | 'ocr' | 'vision';
  /** Where in the analysed image the card was found (normalised), when known. */
  box: Box | null;
  /** Stage durations of the local engine, for diagnostics. */
  timings?: { searchMs: number; refineMs: number; numberMs: number };
  extraction: CardExtraction;
  candidates: MatchCandidate[];
  /** Set when tier 2 failed and the engine fell back to local OCR. */
  fallbackReason?: string;
}

/** Width of the normalised card canvas all tiers work on. */
export const CARD_CANVAS_WIDTH = 756;
export const CARD_CANVAS_HEIGHT = Math.round(CARD_CANVAS_WIDTH / CARD_ASPECT);

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                      */
/* ------------------------------------------------------------------ */

export type DrawableSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** Copies a source rectangle into a fresh card-sized canvas. */
export function captureCardCanvas(
  source: DrawableSource,
  rect: { x: number; y: number; w: number; h: number },
  width = CARD_CANVAS_WIDTH,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width / CARD_ASPECT);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Crops a card region, upscales it and stretches the contrast for OCR. */
export function cropRegionForOcr(card: HTMLCanvasElement, region: Region, scale = 2.5): HTMLCanvasElement {
  const px = regionToPixels(region, card.width, card.height);
  const out = document.createElement('canvas');
  out.width = Math.round(px.w * scale);
  out.height = Math.round(px.h * scale);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return out;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(card, px.x, px.y, px.w, px.h, 0, 0, out.width, out.height);

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  for (let p = 0; p < data.length; p += 4) {
    const gray = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    data[p] = gray;
    histogram[gray]++;
  }
  // 2 % / 98 % percentile stretch keeps holo backgrounds from flattening the text.
  const total = data.length / 4;
  let low = 0;
  let high = 255;
  for (let acc = 0; low < 255 && acc + histogram[low] < total * 0.02; low++) acc += histogram[low];
  for (let acc = 0; high > 0 && acc + histogram[high] < total * 0.02; high--) acc += histogram[high];
  const range = Math.max(1, high - low);
  for (let p = 0; p < data.length; p += 4) {
    const value = Math.max(0, Math.min(255, ((data[p] - low) * 255) / range));
    data[p] = data[p + 1] = data[p + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Compressed JPEG data URL, e.g. for `customScanDataUrl`. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, maxWidth = 360, quality = 0.72): string {
  const ratio = Math.min(1, maxWidth / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * ratio);
  out.height = Math.round(canvas.height * ratio);
  out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', quality);
}

/* ------------------------------------------------------------------ */
/* Tier 1 – local offline OCR (tesseract.js)                            */
/* ------------------------------------------------------------------ */

type TesseractWorker = import('tesseract.js').Worker;

let workerPromise: Promise<TesseractWorker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker(['deu', 'eng']);
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Warms up the OCR engine (downloads WASM + language data on first use). */
export function preloadOcr(): Promise<void> {
  return getWorker().then(() => undefined);
}

const STAGE_WORDS =
  /^(basis|basic|phase\s*[12il]|stage\s*[12il]|rang\s*[12il]|niveau\s*[12il]|vmax|vstar|trainer|item|unterst[uü]tzer|supporter|stadion|stadium|energie|energy)\b[\s:.-]*/i;

/** Removes stage labels, HP values and OCR debris around a card name. */
export function cleanTitle(raw: string): string {
  let text = raw.replace(/[\r\n]+/g, ' ').replace(/[|_~^°"“”„‘’`´*<>{}\[\]\\]/g, ' ');
  text = text.replace(/\b(KP|HP|PV|PS)\s*\d{2,3}\b.*$/i, '').replace(/\b\d{2,3}\s*(KP|HP|PV|PS)\b.*$/i, '');
  text = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) text = text.replace(STAGE_WORDS, '').trim();
  text = text.replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[^A-Za-zÀ-ÿ0-9.'!?♀♂-]+$/, '');
  return text.trim();
}

async function ocrExtract(card: HTMLCanvasElement): Promise<CardExtraction> {
  const run = async (): Promise<CardExtraction> => {
    const worker = await getWorker();
    const { PSM } = await import('tesseract.js');

    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '' });
    // Two looks at the title: the tight crop reads most names cleanly, the wide
    // one catches names that start further left. The matcher uses both.
    const title = await worker.recognize(cropRegionForOcr(card, CARD_REGIONS.title, 3.5));
    const titleWide = await worker.recognize(cropRegionForOcr(card, CARD_REGIONS.titleWide, 2.5));
    const strip = await worker.recognize(cropRegionForOcr(card, CARD_REGIONS.number, 4));

    const tight = cleanTitle(title.data.text);
    const wide = cleanTitle(titleWide.data.text);
    const name = [tight, wide.toLowerCase() === tight.toLowerCase() ? '' : wide].filter(Boolean).join(' ');
    const number = parseCollectorNumber(strip.data.text);
    const setCodeMatch = strip.data.text.match(/\b([A-Z]{3,4})\b/);
    const hasName = name.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3;
    const hasNumber = number.local !== null && number.official !== null;

    const missingFields: string[] = [];
    if (!hasName) missingFields.push('name');
    if (!hasNumber) missingFields.push('cardNumber');
    const confidence =
      ((hasName ? title.data.confidence : 0) * 0.5 + (hasNumber ? strip.data.confidence : 0) * 0.5) / 100;

    return {
      isReadable: hasName || hasNumber,
      missingFields,
      name: hasName ? name : null,
      setCode: setCodeMatch ? setCodeMatch[1] : null,
      cardNumber: number.raw || null,
      language: null,
      variant: null,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  };
  // One worker, strictly sequential jobs (parameters are worker-global).
  const job = ocrQueue.then(run, run);
  ocrQueue = job.catch(() => undefined);
  return job;
}

/* ------------------------------------------------------------------ */
/* Tier 2 – bring-your-own vision API                                   */
/* ------------------------------------------------------------------ */

const VISION_PROMPT = `You are reading a single Pokémon Trading Card Game card from a photo.
Return ONLY a JSON object with exactly these keys:
{"isReadable": boolean, "missingFields": string[], "name": string|null, "setCode": string|null, "cardNumber": string|null, "language": string|null, "variant": "Normal"|"Reverse Holo"|"Holo"|"First Edition"|null, "confidence": number}
Rules:
- "name": the card name exactly as printed (keep suffixes such as "-ex", "V", "VMAX", "VSTAR").
- "cardNumber": the collector number printed at the bottom, formatted like "199/165".
- "setCode": the 3-4 letter set abbreviation printed next to the collector number, if visible.
- "language": ISO 639-1 code of the card text (e.g. "de", "en").
- "confidence": 0..1 for the overall reading.
- If the image is blurry, cut off or covered by glare, set "isReadable" to false and list the unreadable keys in "missingFields".`;

function parseExtraction(text: string): CardExtraction {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Vision API returned no JSON object');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Record<keyof CardExtraction, unknown>>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const variants: Variant[] = ['Normal', 'Reverse Holo', 'Holo', 'First Edition'];
  const variant = variants.find((v) => v === raw.variant) ?? null;
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.5;
  return {
    isReadable: raw.isReadable !== false,
    missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : [],
    name: str(raw.name),
    setCode: str(raw.setCode),
    cardNumber: str(raw.cardNumber),
    language: str(raw.language),
    variant,
    confidence: Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence)),
  };
}

async function visionExtract(card: HTMLCanvasElement, settings: Settings): Promise<CardExtraction> {
  const dataUrl = canvasToDataUrl(card, 1024, 0.85);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const defaults = VISION_DEFAULTS[settings.visionProvider];
  const baseUrl = (settings.visionBaseUrl || defaults.baseUrl).replace(/\/+$/, '');
  const model = settings.visionModel || defaults.model;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    if (settings.visionProvider === 'gemini') {
      if (!settings.visionApiKey) throw new Error('Gemini API key missing');
      const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.visionApiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return parseExtraction(text);
    }

    // OpenAI-compatible chat completions (OpenAI, Ollama, LM Studio, OpenRouter …)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.visionApiKey) headers.Authorization = `Bearer ${settings.visionApiKey}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Vision API HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseExtraction(body.choices?.[0]?.message?.content ?? '');
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ */
/* Tier 1a – visual recognition + high-resolution number reading        */
/* ------------------------------------------------------------------ */

interface NumberReading {
  /** `XXX/YYY` readings that exist in the catalogue, best voted first. */
  numbers: { local: number; official: number; votes: number }[];
  /** Set abbreviations found next to the number, e.g. `MEW`. */
  codes: string[];
  /** Stand-alone three-digit numbers (energy cards print `MEE 015` without a slash). */
  singles: number[];
  raw: string;
}

/** Share of the image height that holds the collector number line. */
const NUMBER_BAND: Record<WindowMode, [number, number]> = { pocket: [0.86, 0.98], card: [0.9, 0.995] };
/** The number is tiny print: Tesseract reads it far better when enlarged (measured on real binder photos). */
const NUMBER_PASS_WIDTHS = [3350, 5000];

function stretchContrast(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const histogram = new Uint32Array(256);
  for (let p = 0; p < data.length; p += 4) {
    const gray = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    data[p] = gray;
    histogram[gray]++;
  }
  const total = data.length / 4;
  let low = 0;
  let high = 255;
  for (let acc = 0; low < 255 && acc + histogram[low] < total * 0.02; low++) acc += histogram[low];
  for (let acc = 0; high > 0 && acc + histogram[high] < total * 0.02; high--) acc += histogram[high];
  const range = Math.max(1, high - low);
  for (let p = 0; p < data.length; p += 4) {
    const value = Math.max(0, Math.min(255, ((data[p] - low) * 255) / range));
    data[p] = data[p + 1] = data[p + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
}

function parseNumberText(text: string, index: VisualIndex, into: { votes: Map<string, number>; codes: Map<string, number>; singles: Map<number, number> }): void {
  const clean = text.replace(/[oO]/g, '0');
  for (const match of clean.matchAll(/(\d{1,3})\s*\/\s*(\d{2,3})(?!\d)/g)) {
    const key = `${Number(match[1])}/${Number(match[2])}`;
    if (index.byNumber.has(key)) into.votes.set(key, (into.votes.get(key) ?? 0) + 1);
  }
  for (const token of text.match(/\b[A-Z0-9]{3}\b/g) ?? []) {
    if (index.byCode.has(token)) into.codes.set(token, (into.codes.get(token) ?? 0) + 1);
  }
  for (const match of clean.matchAll(/\b(\d{3})\b(?!\s*\/)/g)) {
    const value = Number(match[1]);
    into.singles.set(value, (into.singles.get(value) ?? 0) + 1);
  }
}

/**
 * Reads the collector number line at two magnifications and lets the passes
 * vote. `isEnough` can stop after the first pass when the reading already
 * agrees with the artwork match.
 */
async function readCollectorNumber(
  image: HTMLCanvasElement,
  mode: WindowMode,
  index: VisualIndex,
  isEnough: (reading: NumberReading) => boolean,
): Promise<NumberReading> {
  const [y0, y1] = NUMBER_BAND[mode];
  const top = Math.round(y0 * image.height);
  const bandHeight = Math.max(1, Math.round((y1 - y0) * image.height));
  const tally = { votes: new Map<string, number>(), codes: new Map<string, number>(), singles: new Map<number, number>() };
  let raw = '';

  const snapshot = (): NumberReading => ({
    numbers: [...tally.votes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, votes]) => ({ local: Number(key.split('/')[0]), official: Number(key.split('/')[1]), votes })),
    codes: [...tally.codes.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code),
    singles: [...tally.singles.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value),
    raw: raw.trim(),
  });

  let previousScale = 0;
  for (const targetWidth of NUMBER_PASS_WIDTHS) {
    // Never enlarge more than four times – beyond that only blur is added.
    const scale = Math.min(4, targetWidth / image.width);
    if (Math.abs(scale - previousScale) < 0.15) continue;
    previousScale = scale;
    const band = document.createElement('canvas');
    band.width = Math.round(image.width * scale);
    band.height = Math.round(bandHeight * scale);
    const ctx = band.getContext('2d', { willReadFrequently: true });
    if (!ctx) break;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, top, image.width, bandHeight, 0, 0, band.width, band.height);
    stretchContrast(ctx, band.width, band.height);

    const run = async (): Promise<string> => {
      const worker = await getWorker();
      const { PSM } = await import('tesseract.js');
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
      return (await worker.recognize(band)).data.text;
    };
    const job = ocrQueue.then(run, run);
    ocrQueue = job.catch(() => undefined);
    const text = await job.catch(() => '');
    raw += ` ${text.replace(/\s+/g, ' ')}`;
    parseNumberText(text, index, tally);
    if (isEnough(snapshot())) break;
  }
  return snapshot();
}

/** Cards of the catalogue that carry one of the read numbers. */
function cardsForReading(index: VisualIndex, reading: NumberReading): IndexCard[] {
  for (const number of reading.numbers) {
    const list = index.byNumber.get(`${number.local}/${number.official}`);
    if (list?.length) return list;
  }
  // Energy style: set code plus a three-digit number without a slash.
  for (const code of reading.codes) {
    for (const setId of index.byCode.get(code) ?? []) {
      const hits = index.cards.filter((card) => card.setId === setId && reading.singles.includes(card.local));
      if (hits.length === 1) return hits;
    }
  }
  return [];
}

const sameName = (a: IndexCard, b: IndexCard): boolean => a.name.toLowerCase() === b.name.toLowerCase();

/** How many thumbnail matches get the fine comparison against the real artwork. */
const VISUAL_SHORTLIST = 24;
/** Fine-comparison score from which an artwork match counts on its own. */
const VISUAL_STRONG = 0.62;
const VISUAL_PLAUSIBLE = 0.5;

function toCandidate(index: VisualIndex, card: IndexCard, score: number): MatchCandidate {
  return {
    id: card.id,
    name: card.name,
    localId: card.localId,
    image: cardImageBase(index, card),
    setId: card.setId,
    setName: index.sets.get(card.setId)?.name ?? card.setId,
    score: Math.max(0, Math.min(1, score)),
  };
}

/**
 * Artwork match + collector number, combined:
 *  - both agree            -> near certain
 *  - number names a reprint of the matched artwork -> the reprint wins
 *  - only one of the two   -> offered with a lower score for review
 */
async function visualRecognize(image: HTMLCanvasElement, mode: WindowMode, index: VisualIndex): Promise<RecognitionResult> {
  const started = performance.now();
  const windows = cardWindows(image, index, mode);
  const shortlist = searchThumbnails(index, windows, VISUAL_SHORTLIST);
  const searched = performance.now();
  const hits = await refineHits(index, windows, shortlist);
  const refined = performance.now();
  const scoreOf = (hit: VisualHit): number => hit.fine ?? hit.coarse * 0.8;
  const top = hits[0] ?? null;
  const rival = top ? hits.find((hit) => !sameName(hit.card, top.card)) : undefined;
  const margin = top && rival ? scoreOf(top) - scoreOf(rival) : 0.2;

  const reading = await readCollectorNumber(image, mode, index, (current) => {
    if (!top) return false;
    return cardsForReading(index, current).some((card) => sameName(card, top.card));
  });
  const fits = cardsForReading(index, reading);
  // Cards named by the number get the artwork comparison too, even when the thumbnail search missed them.
  const missing = fits.filter((card) => card.row >= 0 && !hits.some((hit) => hit.card.id === card.id)).slice(0, 6);
  if (missing.length) {
    hits.push(...(await refineHits(index, windows, missing.map((card) => ({ card, coarse: 0, fine: null, box: null })))).filter((hit) => hit.fine !== null));
  }

  const ranked: MatchCandidate[] = [];
  const push = (card: IndexCard, score: number) => {
    if (!ranked.some((c) => c.id === card.id)) ranked.push(toCandidate(index, card, score));
  };

  // Energy sets without catalogue artwork (e.g. `MEE`, `SVE`): their thin three-digit
  // numbers are rarely readable, but the set code is, and the artwork of any
  // other energy card of the same type reveals the type.
  let energyOptions: IndexCard[] = [];
  if (!fits.length && top) {
    const artlessSets = reading.codes.flatMap((code) => index.byCode.get(code) ?? []).filter((id) => !index.sets.get(id)?.imageBase);
    const words = top.card.name.split(/[\s-]+/);
    const isEnergy = words.some((word) => /^(energie|energy|énergie|energia|energía)$/i.test(word));
    const type = words.find((word) => !/^(basis|basic|base|energie|energy|énergie|energia|energía|de)$/i.test(word));
    if (artlessSets.length && isEnergy && type) {
      energyOptions = index.cards
        .filter((card) => artlessSets.includes(card.setId) && card.name.split(/[\s-]+/).includes(type))
        .sort((a, b) => a.local - b.local);
    }
  }

  // Best-looking card among those the number allows (several sets can share `63/111`).
  const fitHit = hits
    .filter((hit) => fits.some((card) => card.id === hit.card.id))
    .sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  // A misread digit names a neighbouring card: if another artwork matches clearly better, the number is not trusted.
  const outvoted = Boolean(fitHit && top && !sameName(fitHit.card, top.card) && scoreOf(top) - scoreOf(fitHit) >= 0.1);
  if (fitHit && outvoted && top) {
    // Artwork and number contradict each other – neither is certain, the user decides.
    push(top.card, 0.55);
    push(fitHit.card, 0.5);
  } else if (fitHit && scoreOf(fitHit) >= VISUAL_PLAUSIBLE - 0.08) {
    // Artwork and number point to the same card.
    push(fitHit.card, 0.97);
  } else if (top && scoreOf(top) >= VISUAL_PLAUSIBLE && fits.some((card) => sameName(card, top.card))) {
    // Same artwork name, but the number says it is another print (reprint, promo).
    push(fits.find((card) => sameName(card, top.card)) as IndexCard, 0.93);
  } else if (energyOptions.length) {
    // Set from the printed code, energy type from the artwork – the exact number needs a look.
    energyOptions.forEach((card, i) => push(card, i === 0 ? 0.6 : 0.5));
  } else if (top && scoreOf(top) >= VISUAL_STRONG && margin >= 0.05) {
    push(top.card, 0.8);
    if (fits.length === 1) push(fits[0], 0.5);
  } else if (fits.length === 1) {
    // No convincing artwork (dark foil, card without catalogue image): trust the unique number.
    push(fits[0], top && scoreOf(top) >= VISUAL_PLAUSIBLE ? 0.6 : 0.72);
    if (top) push(top.card, scoreOf(top) * 0.8);
  } else if (top) {
    push(top.card, scoreOf(top) >= VISUAL_PLAUSIBLE ? 0.55 : 0.3);
  }
  for (const hit of hits.slice(0, 8)) push(hit.card, scoreOf(hit) * 0.6);
  for (const card of fits.slice(0, 4)) push(card, 0.35);

  const best = ranked[0] ?? null;
  const number = reading.numbers[0];
  const box = hits.find((hit) => hit.card.id === best?.id)?.box ?? top?.box ?? null;
  return {
    tier: 1,
    method: 'visual',
    box,
    timings: { searchMs: Math.round(searched - started), refineMs: Math.round(refined - searched), numberMs: Math.round(performance.now() - refined) },
    extraction: {
      isReadable: Boolean(best),
      missingFields: number ? [] : ['cardNumber'],
      name: best?.name ?? null,
      setCode: reading.codes[0] ?? null,
      cardNumber: number ? `${number.local}/${number.official}` : null,
      language: index.lang,
      variant: null,
      confidence: best?.score ?? 0,
    },
    candidates: ranked.slice(0, 12),
  };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

function emptyExtraction(): CardExtraction {
  return {
    isReadable: false,
    missingFields: ['name', 'cardNumber'],
    name: null,
    setCode: null,
    cardNumber: null,
    language: null,
    variant: null,
    confidence: 0,
  };
}

/** Centre 63:88 crop, used when a pocket image has to go through the card-shaped tiers. */
function centreCard(image: HTMLCanvasElement): HTMLCanvasElement {
  let w = image.width * 0.94;
  let h = w / CARD_ASPECT;
  if (h > image.height) {
    h = image.height;
    w = h * CARD_ASPECT;
  }
  return captureCardCanvas(image, { x: (image.width - w) / 2, y: (image.height - h) / 2, w, h });
}

/**
 * Recognises one card. `mode` says whether the canvas is the card itself
 * (scanner frame) or a binder pocket with the card somewhere inside.
 *
 * Local engine: artwork comparison against the visual index plus a
 * high-resolution reading of the collector number. Without an index for the
 * card language it falls back to plain OCR of name and number. The optional
 * vision API replaces both and falls back to the local engine on errors.
 */
export async function recognizeCard(image: HTMLCanvasElement, mode: WindowMode = 'card'): Promise<RecognitionResult> {
  const settings = getSettings();
  let fallbackReason: string | undefined;

  if (settings.engine === 'vision') {
    try {
      const card = mode === 'pocket' ? centreCard(image) : image;
      const extraction = await visionExtract(card, settings);
      const candidates = extraction.isReadable
        ? await findCandidates({ name: extraction.name, cardNumber: extraction.cardNumber, setCode: extraction.setCode }, 12)
        : [];
      return { tier: 2, method: 'vision', box: null, extraction, candidates };
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
    }
  }

  const index = await loadVisualIndex(settings.cardLang);
  if (index) {
    try {
      return { ...(await visualRecognize(image, mode, index)), fallbackReason };
    } catch (err) {
      fallbackReason = fallbackReason ?? (err instanceof Error ? err.message : String(err));
    }
  }

  let extraction: CardExtraction;
  try {
    extraction = await ocrExtract(mode === 'pocket' ? centreCard(image) : image);
  } catch (err) {
    fallbackReason = fallbackReason ?? (err instanceof Error ? err.message : String(err));
    extraction = emptyExtraction();
  }
  const candidates = extraction.isReadable
    ? await findCandidates({ name: extraction.name, cardNumber: extraction.cardNumber, setCode: extraction.setCode }, 12)
    : [];
  return { tier: 1, method: 'ocr', box: null, extraction, candidates, fallbackReason };
}

/** Warms up the local engine: visual index and OCR worker. */
export async function preloadRecognition(): Promise<void> {
  await Promise.all([loadVisualIndex(getSettings().cardLang), getWorker().catch(() => undefined)]);
}

/** Tests the configured vision endpoint with a tiny synthetic image. */
export async function testVisionConnection(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 252;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f4e9a8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Testkarte', 20, 38);
    ctx.font = '14px sans-serif';
    ctx.fillText('001/165', 16, 338);
  }
  const extraction = await visionExtract(canvas, getSettings());
  return `${extraction.name ?? '?'} · ${extraction.cardNumber ?? '?'}`;
}

/* ------------------------------------------------------------------ */
/* Tier 3 – batch binder slicer                                         */
/* ------------------------------------------------------------------ */

export interface BinderGrid {
  rows: 2 | 3;
  cols: 2 | 3;
  /** Outer bounds of the pocket area, normalised to the photo (0..1). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Gap between pockets as a fraction of the pocket area width/height. */
  gapX: number;
  gapY: number;
}

export function defaultGrid(size: 2 | 3): BinderGrid {
  return { rows: size, cols: size, left: 0.01, top: 0.01, right: 0.99, bottom: 0.99, gapX: 0.01, gapY: 0.01 };
}

/** Pixel rectangles of all pockets, row by row. */
export function gridCells(grid: BinderGrid, width: number, height: number): { x: number; y: number; w: number; h: number }[] {
  const areaW = (grid.right - grid.left) * width;
  const areaH = (grid.bottom - grid.top) * height;
  const gapX = grid.gapX * areaW;
  const gapY = grid.gapY * areaH;
  const cellW = (areaW - gapX * (grid.cols - 1)) / grid.cols;
  const cellH = (areaH - gapY * (grid.rows - 1)) / grid.rows;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      cells.push({
        x: grid.left * width + c * (cellW + gapX),
        y: grid.top * height + r * (cellH + gapY),
        w: cellW,
        h: cellH,
      });
    }
  }
  return cells;
}

/** Longest edge of a pocket canvas. Keeps the full photo resolution for typical cameras. */
export const POCKET_MAX_WIDTH = 1800;

/**
 * Cuts a binder page photo into one canvas per pocket – at the original
 * resolution, because the collector number is only a few pixels high.
 * Recognise the results with `recognizeCard(canvas, 'pocket')`.
 */
export function sliceBinderPage(image: HTMLImageElement | HTMLCanvasElement | ImageBitmap, grid: BinderGrid): HTMLCanvasElement[] {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  return gridCells(grid, width, height).map((cell) => {
    const x = Math.max(0, Math.round(cell.x));
    const y = Math.max(0, Math.round(cell.y));
    const w = Math.min(width - x, Math.round(cell.w));
    const h = Math.min(height - y, Math.round(cell.h));
    const scale = Math.min(1, POCKET_MAX_WIDTH / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  });
}

/** Crops the rectangle where the card was found (or the whole pocket) for previews. */
export function cropBox(image: HTMLCanvasElement, box: Box | null): HTMLCanvasElement {
  if (!box) return image;
  const x = Math.max(0, Math.round(box[0] * image.width));
  const y = Math.max(0, Math.round(box[1] * image.height));
  return captureCardCanvas(image, { x, y, w: Math.min(image.width - x, box[2] * image.width), h: Math.min(image.height - y, box[3] * image.height) }, 360);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be loaded'));
    img.src = src;
  });
}

/**
 * Self-hosted mode: lets the server cut the original file with `sharp`
 * (no browser canvas size limits). Returns one canvas per pocket.
 */
export async function sliceBinderPageOnServer(
  file: File,
  grid: BinderGrid,
  endpoint: string,
  auth: { vaultId: string; token: string },
): Promise<HTMLCanvasElement[]> {
  const form = new FormData();
  form.append('image', file);
  form.append('grid', JSON.stringify(grid));
  form.append('width', String(POCKET_MAX_WIDTH));
  const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/slice/`, {
    method: 'POST',
    body: form,
    headers: { 'x-vault-id': auth.vaultId, 'x-vault-token': auth.token },
  });
  if (!res.ok) throw new Error(`Slice API HTTP ${res.status}`);
  const body = (await res.json()) as { slices: string[] };
  const canvases: HTMLCanvasElement[] = [];
  for (const dataUrl of body.slices) {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    canvases.push(canvas);
  }
  return canvases;
}
