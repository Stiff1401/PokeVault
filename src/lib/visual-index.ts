'use client';

/**
 * Visual card recognition: compares a photographed card with small thumbnails
 * of every card in the catalogue (`public/image-index/<lang>.bin`, built by
 * `npm run build:index`). Works through sleeves and on foil cards where OCR
 * fails, needs no API key and – apart from the optional fine comparison –
 * no network.
 */

export interface IndexSet {
  id: string;
  name: string;
  /** Printed set abbreviation, e.g. `MEW`. */
  code: string;
  official: number;
  releaseDate: string;
  /** `https://assets.tcgdex.net/<lang>/<serie>/<set>` or empty when the set has no artwork. */
  imageBase: string;
}

export interface IndexCard {
  id: string;
  localId: string;
  name: string;
  setId: string;
  /** Numeric part of the collector number. */
  local: number;
  /** Row in the thumbnail matrix, or -1 when the card has no artwork. */
  row: number;
}

export interface VisualIndex {
  lang: string;
  thumbW: number;
  thumbH: number;
  count: number;
  sets: Map<string, IndexSet>;
  cards: IndexCard[];
  byId: Map<string, IndexCard>;
  /** `${local}/${official}` -> cards. */
  byNumber: Map<string, IndexCard[]>;
  /** set code -> set ids. */
  byCode: Map<string, string[]>;
  /** count × (thumbW·thumbH·3) zero-mean, unit-length vectors. */
  vectors: Float32Array;
}

interface RawIndexFile {
  version: number;
  lang: string;
  thumb: { width: number; height: number; count: number };
  sets: { id: string; name: string; code: string; official: number; releaseDate: string; imageBase?: string }[];
  cards: [string, string, string][];
}

/** Resolution of the fine comparison (must be a multiple of the thumbnail size). */
export const FINE_W = 36;
export const FINE_H = 48;
const FINE_DIM = FINE_W * FINE_H * 3;

const cache = new Map<string, Promise<VisualIndex | null>>();

function normalise(source: ArrayLike<number>): Float32Array {
  const out = new Float32Array(source.length);
  let mean = 0;
  for (let i = 0; i < source.length; i++) mean += source[i];
  mean /= source.length;
  let norm = 0;
  for (let i = 0; i < source.length; i++) {
    out[i] = source[i] - mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function setIdOf(cardId: string): string {
  const cut = cardId.lastIndexOf('-');
  return cut > 0 ? cardId.slice(0, cut) : cardId;
}

async function fetchIndex(lang: string): Promise<VisualIndex | null> {
  const base = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/image-index/${lang}`;
  const [metaRes, binRes] = await Promise.all([fetch(`${base}.json`), fetch(`${base}.bin`)]);
  if (!metaRes.ok || !binRes.ok) return null;
  const meta = (await metaRes.json()) as RawIndexFile;
  const bytes = new Uint8Array(await binRes.arrayBuffer());
  const dim = meta.thumb.width * meta.thumb.height * 3;
  if (meta.version !== 1 || bytes.length !== meta.thumb.count * dim) return null;
  if (FINE_W % meta.thumb.width !== 0 || FINE_H % meta.thumb.height !== 0) return null;

  const vectors = new Float32Array(bytes.length);
  for (let row = 0; row < meta.thumb.count; row++) vectors.set(normalise(bytes.subarray(row * dim, (row + 1) * dim)), row * dim);

  const sets = new Map<string, IndexSet>(meta.sets.map((s) => [s.id, { ...s, imageBase: s.imageBase ?? '' }]));
  const cards: IndexCard[] = meta.cards.map(([id, localId, name], i) => ({
    id,
    localId,
    name,
    setId: setIdOf(id),
    local: Number((localId.match(/\d+/) ?? ['-1'])[0]),
    row: i < meta.thumb.count ? i : -1,
  }));
  const byNumber = new Map<string, IndexCard[]>();
  for (const card of cards) {
    const official = sets.get(card.setId)?.official;
    if (!official || card.local < 0) continue;
    const key = `${card.local}/${official}`;
    const list = byNumber.get(key);
    if (list) list.push(card);
    else byNumber.set(key, [card]);
  }
  const byCode = new Map<string, string[]>();
  for (const set of sets.values()) {
    if (!set.code) continue;
    byCode.set(set.code, [...(byCode.get(set.code) ?? []), set.id]);
  }
  return {
    lang,
    thumbW: meta.thumb.width,
    thumbH: meta.thumb.height,
    count: meta.thumb.count,
    sets,
    cards,
    byId: new Map(cards.map((c) => [c.id, c])),
    byNumber,
    byCode,
    vectors,
  };
}

/** Loads (once) the index for a card language; `null` when none was built for it. */
export function loadVisualIndex(lang: string): Promise<VisualIndex | null> {
  let pending = cache.get(lang);
  if (!pending) {
    pending = fetchIndex(lang).catch(() => null);
    cache.set(lang, pending);
  }
  return pending;
}

/* ------------------------------------------------------------------ */
/* Query side                                                          */
/* ------------------------------------------------------------------ */

/** Normalised rectangle inside the analysed image. */
export type Box = [x: number, y: number, w: number, h: number];

export interface CardWindow {
  fine: Float32Array;
  coarse: Float32Array;
  box: Box;
}

/** `pocket`: the image is a binder pocket with the card somewhere inside. `card`: the image is the card itself. */
export type WindowMode = 'pocket' | 'card';

/** Halves a canvas repeatedly so large photos shrink without aliasing. */
export function shrinkCanvas(source: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  let current = source;
  while (current.width > targetWidth * 2) {
    const half = document.createElement('canvas');
    half.width = Math.ceil(current.width / 2);
    half.height = Math.ceil(current.height / 2);
    const ctx = half.getContext('2d');
    if (!ctx) break;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }
  const out = document.createElement('canvas');
  out.width = targetWidth;
  out.height = Math.max(1, Math.round((targetWidth * source.height) / source.width));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, out.width, out.height);
  }
  return out;
}

function poolWindow(fine: Float32Array, w: number, h: number): Float32Array {
  const bx = FINE_W / w;
  const by = FINE_H / h;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let yy = 0; yy < by; yy++) for (let xx = 0; xx < bx; xx++) sum += fine[((y * by + yy) * FINE_W + x * bx + xx) * 3 + k];
        out[(y * w + x) * 3 + k] = sum;
      }
    }
  }
  return normalise(out);
}

/**
 * Samples every plausible 63:88 card rectangle of the image. A card sits
 * shifted in its pocket, so position and size are searched instead of assumed.
 */
export function cardWindows(image: HTMLCanvasElement, index: VisualIndex, mode: WindowMode): CardWindow[] {
  const small = shrinkCanvas(image, 168);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const W = small.width;
  const H = small.height;
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const scales = mode === 'pocket' ? [0.84, 0.88, 0.92, 0.96] : [0.9, 0.95, 1];
  const maxDx = mode === 'pocket' ? 0.06 : 0.04;
  const maxDy = mode === 'pocket' ? 0.07 : 0.04;
  const windows: CardWindow[] = [];

  for (const scale of scales) {
    const w = scale * W;
    const h = (w * 88) / 63;
    if (h > H * 1.02) continue;
    for (let dx = -maxDx; dx <= maxDx + 0.001; dx += 0.02) {
      for (let dy = -maxDy; dy <= maxDy + 0.001; dy += 0.02) {
        const x0 = (W - w) / 2 + dx * W;
        const y0 = (H - h) / 2 + dy * H;
        if (x0 < -2 || y0 < -2 || x0 + w > W + 2 || y0 + h > H + 2) continue;
        const pixels = new Float32Array(FINE_DIM);
        for (let y = 0; y < FINE_H; y++) {
          for (let x = 0; x < FINE_W; x++) {
            const sx = Math.min(W - 1, Math.max(0, Math.round(x0 + ((x + 0.5) * w) / FINE_W)));
            const sy = Math.min(H - 1, Math.max(0, Math.round(y0 + ((y + 0.5) * h) / FINE_H)));
            const si = (sy * W + sx) * 4;
            const di = (y * FINE_W + x) * 3;
            pixels[di] = rgba[si];
            pixels[di + 1] = rgba[si + 1];
            pixels[di + 2] = rgba[si + 2];
          }
        }
        windows.push({ fine: normalise(pixels), coarse: poolWindow(pixels, index.thumbW, index.thumbH), box: [x0 / W, y0 / H, w / W, h / H] });
      }
    }
  }
  return windows;
}

export interface VisualHit {
  card: IndexCard;
  /** Correlation with the thumbnail (−1..1). */
  coarse: number;
  /** Correlation with the full low-resolution artwork, when it could be loaded. */
  fine: number | null;
  box: Box | null;
}

/** Ranks the whole catalogue by thumbnail similarity and returns the best `limit` cards. */
export function searchThumbnails(index: VisualIndex, windows: CardWindow[], limit: number): VisualHit[] {
  const dim = index.thumbW * index.thumbH * 3;
  const best = new Float32Array(index.count).fill(-1);
  const vectors = index.vectors;
  // Every third window is enough for the ranking; the fine pass uses all of them.
  for (let wi = 0; wi < windows.length; wi += 3) {
    const query = windows[wi].coarse;
    for (let row = 0; row < index.count; row++) {
      let sum = 0;
      const offset = row * dim;
      for (let k = 0; k < dim; k++) sum += query[k] * vectors[offset + k];
      if (sum > best[row]) best[row] = sum;
    }
  }
  const rows = Array.from({ length: index.count }, (_, i) => i)
    .sort((a, b) => best[b] - best[a])
    .slice(0, limit);
  return rows.map((row) => ({ card: index.cards[row], coarse: best[row], fine: null, box: null }));
}

export function cardImageBase(index: VisualIndex, card: IndexCard): string {
  const base = index.sets.get(card.setId)?.imageBase;
  return base && card.row >= 0 ? `${base}/${card.localId}` : '';
}

const fineCache = new Map<string, Promise<Float32Array | null>>();

function fineFeature(url: string): Promise<Float32Array | null> {
  let pending = fineCache.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${url}/low.webp`);
      if (!res.ok) return null;
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = document.createElement('canvas');
      canvas.width = FINE_W;
      canvas.height = FINE_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, FINE_W, FINE_H);
      bitmap.close();
      const rgba = ctx.getImageData(0, 0, FINE_W, FINE_H).data;
      const rgb = new Float32Array(FINE_DIM);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      return normalise(rgb);
    })().catch(() => null);
    fineCache.set(url, pending);
    if (fineCache.size > 600) fineCache.delete(fineCache.keys().next().value as string);
  }
  return pending;
}

/**
 * Re-scores candidates against their real low-resolution artwork (loaded from
 * TCGdex) and records where in the image the card was found. Offline, or for
 * cards without artwork, `fine` stays `null`.
 */
export async function refineHits(index: VisualIndex, windows: CardWindow[], hits: VisualHit[]): Promise<VisualHit[]> {
  const refined = await Promise.all(
    hits.map(async (hit) => {
      const url = cardImageBase(index, hit.card);
      const feature = url ? await fineFeature(url) : null;
      if (!feature) return hit;
      let best = -1;
      let box: Box | null = null;
      for (const window of windows) {
        let sum = 0;
        const fine = window.fine;
        for (let k = 0; k < FINE_DIM; k++) sum += fine[k] * feature[k];
        if (sum > best) {
          best = sum;
          box = window.box;
        }
      }
      return { ...hit, fine: best, box };
    }),
  );
  return refined.sort((a, b) => (b.fine ?? b.coarse - 1) - (a.fine ?? a.coarse - 1));
}
