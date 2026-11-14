'use client';

import {
  db,
  newId,
  nowIso,
  type CardRecord,
  type Category,
  type SetCache,
  type SetCardBrief,
  type Variant,
} from './db';
import { getSettings } from './settings';

const API_ROOT = 'https://api.tcgdex.net/v2';
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SET_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Raw TCGdex shapes (only the fields PokéVault reads)                  */
/* ------------------------------------------------------------------ */

interface RawPricing {
  cardmarket?: {
    trend?: number | null;
    low?: number | null;
    avg?: number | null;
    'trend-holo'?: number | null;
    'low-holo'?: number | null;
  } | null;
}

interface RawCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  rarity?: string;
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } };
  variants?: { normal?: boolean; reverse?: boolean; holo?: boolean; firstEdition?: boolean };
  dexId?: number[];
  types?: string[];
  evolveFrom?: string;
  stage?: string;
  suffix?: string;
  trainerType?: string;
  energyType?: string;
  pricing?: RawPricing | null;
}

interface RawSet {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  cardCount?: { official?: number; total?: number };
  abbreviation?: { official?: string };
  tcgOnline?: string;
  cards?: { id: string; localId: string; name: string; image?: string }[];
}

export interface SetSummary {
  id: string;
  name: string;
  logo: string;
  symbol: string;
  officialCards: number;
  totalCards: number;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const inflight = new Map<string, Promise<unknown>>();

export class TcgApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'TcgApiError';
  }
}

async function request<T>(path: string, lang: string): Promise<T> {
  const url = `${API_ROOT}/${lang}/${path}`;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const run = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.status === 404) throw new TcgApiError(`Not found: ${path}`, 404);
        if (res.status === 429 || res.status >= 500) {
          lastError = new TcgApiError(`TCGdex ${res.status}`, res.status);
        } else if (!res.ok) {
          throw new TcgApiError(`TCGdex ${res.status}`, res.status);
        } else {
          return (await res.json()) as T;
        }
      } catch (err) {
        if (err instanceof TcgApiError && err.status < 500 && err.status !== 429) throw err;
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
    }
    throw lastError instanceof Error ? lastError : new Error('TCGdex request failed');
  })();

  inflight.set(url, run);
  try {
    return await run;
  } finally {
    inflight.delete(url);
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ */
/* Normalisation – canonical values are German (see data model)         */
/* ------------------------------------------------------------------ */

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function normalizeCategory(raw: string | undefined): Category {
  const value = fold(raw ?? '');
  if (value.startsWith('pok')) return 'Pokémon';
  if (value.startsWith('energ')) return 'Energie';
  return 'Trainer';
}

const TYPE_TO_GERMAN: Record<string, string> = {
  grass: 'Pflanze',
  fire: 'Feuer',
  water: 'Wasser',
  lightning: 'Elektro',
  psychic: 'Psycho',
  fighting: 'Kampf',
  darkness: 'Finsternis',
  metal: 'Metall',
  dragon: 'Drache',
  colorless: 'Farblos',
  fairy: 'Fee',
  plante: 'Pflanze',
  feu: 'Feuer',
  eau: 'Wasser',
  electrique: 'Elektro',
  psy: 'Psycho',
  combat: 'Kampf',
  obscurite: 'Finsternis',
  incolore: 'Farblos',
  fee: 'Fee',
  planta: 'Pflanze',
  fuego: 'Feuer',
  agua: 'Wasser',
  rayo: 'Elektro',
  psiquico: 'Psycho',
  lucha: 'Kampf',
  oscura: 'Finsternis',
  metalica: 'Metall',
  incolora: 'Farblos',
  erba: 'Pflanze',
  fuoco: 'Feuer',
  acqua: 'Wasser',
  lampo: 'Elektro',
  lotta: 'Kampf',
  oscurita: 'Finsternis',
  metallo: 'Metall',
  drago: 'Drache',
};

function normalizeType(raw: string): string {
  return TYPE_TO_GERMAN[fold(raw)] ?? raw;
}

function normalizeBaseStage(raw: string | undefined): string {
  const value = fold(raw ?? '');
  if (!value) return '';
  if (/2/.test(value)) return 'Phase 2';
  if (/1/.test(value)) return 'Phase 1';
  if (/^(basis|basic|base|basico|de base)/.test(value)) return 'Basis';
  return raw ?? '';
}

function normalizeStage(card: RawCard, category: Category, baseStage: string): string {
  if (category === 'Trainer') {
    const type = fold(card.trainerType ?? '');
    if (/unterst|support|sosten|apoy|apoio/.test(type)) return 'Unterstützer';
    if (/stadi|stade|estadi/.test(type)) return 'Stadion';
    if (/ausrust|werkzeug|tool|outil|herramienta|attrezzo|ferramenta/.test(type)) return 'Ausrüstung';
    return 'Item';
  }
  if (category === 'Energie') {
    return /spe[zc]ial|special/.test(fold(card.energyType ?? '')) ? 'Spezial-Energie' : 'Basis-Energie';
  }
  const name = card.name.trim();
  const suffix = (card.suffix ?? '').trim();
  if (/VMAX$/.test(name) || /^VMAX$/i.test(card.stage ?? '')) return 'VMAX';
  if (/VSTAR$/.test(name) || /^VSTAR$/i.test(card.stage ?? '')) return 'VSTAR';
  if (/[\s-]V$/.test(name) || suffix === 'V') return 'V';
  if (/[\s-]ex$/i.test(name) || /^ex$/i.test(suffix)) return 'ex';
  return baseStage || 'Basis';
}

function pickPrice(...values: (number | null | undefined)[]): number | null {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
}

function variantsOf(card: RawCard): Variant[] {
  const v = card.variants ?? {};
  const list: Variant[] = [];
  if (v.normal) list.push('Normal');
  if (v.reverse) list.push('Reverse Holo');
  if (v.holo) list.push('Holo');
  if (v.firstEdition) list.push('First Edition');
  return list.length ? list : ['Normal'];
}

export function setIdOfCard(cardId: string): string {
  const cut = cardId.lastIndexOf('-');
  return cut > 0 ? cardId.slice(0, cut) : cardId;
}

/** `high` for detail views, `low` for grids. Empty string when TCGdex has no scan. */
export function cardImage(url: string | undefined | null, quality: 'low' | 'high' = 'low'): string {
  if (!url) return '';
  if (/\.(webp|png|jpg)$/.test(url)) return url.replace(/\/(low|high)\.(webp|png|jpg)$/, `/${quality}.webp`);
  return `${url}/${quality}.webp`;
}

function toRecord(raw: RawCard, set: SetCache | null, lang: string): CardRecord {
  const category = normalizeCategory(raw.category);
  const baseStage = category === 'Pokémon' ? normalizeBaseStage(raw.stage) || 'Basis' : '';
  const official = set?.officialCards ?? raw.set.cardCount?.official ?? raw.set.cardCount?.total ?? 0;
  const cm = raw.pricing?.cardmarket;
  return {
    id: raw.id,
    name: raw.name,
    setId: raw.set.id,
    setName: raw.set.name,
    setCode: set?.code || raw.set.id.toUpperCase(),
    cardNumber: official ? `${raw.localId}/${String(official).padStart(3, '0')}` : raw.localId,
    language: lang,
    imageUrl: raw.image ? `${raw.image}/high.webp` : '',
    category,
    stage: normalizeStage(raw, category, baseStage),
    baseStage,
    types: (raw.types ?? []).map(normalizeType),
    evolveFrom: raw.evolveFrom ?? null,
    dexId: raw.dexId ?? [],
    rarity: raw.rarity ?? null,
    cardmarketTrendEur: pickPrice(cm?.trend, cm?.['trend-holo'], cm?.avg),
    cardmarketLowEur: pickPrice(cm?.low, cm?.['low-holo']),
    lastPriceUpdate: nowIso(),
    setReleaseDate: set?.releaseDate ?? '',
    availableVariants: variantsOf(raw),
  };
}

/* ------------------------------------------------------------------ */
/* Sets                                                                */
/* ------------------------------------------------------------------ */

let setListMemo: { lang: string; at: number; sets: SetSummary[] } | null = null;

export async function listSets(lang: string = getSettings().cardLang): Promise<SetSummary[]> {
  if (setListMemo && setListMemo.lang === lang && Date.now() - setListMemo.at < SET_LIST_TTL_MS) {
    return setListMemo.sets;
  }
  const storageKey = `pv.sets.${lang}`;
  try {
    const cached = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as {
      at: number;
      sets: SetSummary[];
    } | null;
    if (cached && Date.now() - cached.at < SET_LIST_TTL_MS) {
      setListMemo = { lang, ...cached };
      return cached.sets;
    }
  } catch {
    /* fall through to network */
  }
  const raw = await request<RawSet[]>('sets', lang);
  const sets: SetSummary[] = raw.map((s) => ({
    id: s.id,
    name: s.name,
    logo: s.logo ? `${s.logo}.webp` : '',
    symbol: s.symbol ? `${s.symbol}.webp` : '',
    officialCards: s.cardCount?.official ?? s.cardCount?.total ?? 0,
    totalCards: s.cardCount?.total ?? 0,
  }));
  setListMemo = { lang, at: Date.now(), sets };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ at: setListMemo.at, sets }));
  } catch {
    /* quota – memory cache is enough */
  }
  return sets;
}

/** Set detail incl. the full card list (`GET /v2/{lang}/sets/{setId}`), cached for a week. */
export async function getSet(setId: string, lang: string = getSettings().cardLang): Promise<SetCache> {
  const key = `${lang}:${setId}`;
  const cached = await db.setCache.get(key);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CATALOG_TTL_MS) return cached;
  try {
    const raw = await request<RawSet>(`sets/${encodeURIComponent(setId)}`, lang);
    const cards: SetCardBrief[] = (raw.cards ?? []).map((c) => ({
      id: c.id,
      localId: c.localId,
      name: c.name,
      image: c.image ?? '',
    }));
    const record: SetCache = {
      key,
      setId: raw.id,
      lang,
      name: raw.name,
      code: raw.abbreviation?.official ?? raw.tcgOnline ?? raw.id.toUpperCase(),
      releaseDate: raw.releaseDate ?? '',
      totalCards: cards.length || raw.cardCount?.total || 0,
      officialCards: raw.cardCount?.official ?? cards.length,
      cards,
      fetchedAt: nowIso(),
    };
    await db.setCache.put(record);
    return record;
  } catch (err) {
    if (cached) return cached; // offline: stale data beats no data
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Cards & prices                                                      */
/* ------------------------------------------------------------------ */

const cardFetches = new Map<string, Promise<CardRecord>>();

/** One network load per card at a time, so parallel callers do not write duplicate price history. */
function fetchCardRecord(id: string, lang: string, previous?: CardRecord): Promise<CardRecord> {
  const key = `${lang}:${id}`;
  const running = cardFetches.get(key);
  if (running) return running;
  const job = loadCardRecord(id, lang, previous).finally(() => cardFetches.delete(key));
  cardFetches.set(key, job);
  return job;
}

async function loadCardRecord(id: string, lang: string, previous?: CardRecord): Promise<CardRecord> {
  const raw = await request<RawCard>(`cards/${encodeURIComponent(id)}`, lang);
  let set: SetCache | null = null;
  try {
    set = await getSet(raw.set.id, lang);
  } catch {
    set = null;
  }
  const record = toRecord(raw, set, lang);
  await db.cards.put(record);

  const price = record.cardmarketTrendEur;
  if (price !== null && (!previous || previous.cardmarketTrendEur !== price)) {
    await db.priceHistory.add({ id: newId(), cardId: record.id, priceEur: price, recordedAt: record.lastPriceUpdate });
  }
  return record;
}

function isFresh(card: CardRecord, lang: string, maxAgeMs: number): boolean {
  if (card.language !== lang) return false;
  if (card.baseStage === undefined || card.availableVariants === undefined) return false;
  return Date.now() - new Date(card.lastPriceUpdate).getTime() < maxAgeMs;
}

export interface GetCardOptions {
  /** Maximum age of the cached record incl. its price. Defaults to 24 h. */
  maxAgeMs?: number;
  force?: boolean;
}

/** Returns the card from the IndexedDB cache or loads it from TCGdex. */
export async function getCard(id: string, options: GetCardOptions = {}): Promise<CardRecord | null> {
  const lang = getSettings().cardLang;
  const cached = await db.cards.get(id);
  if (cached && !options.force && isFresh(cached, lang, options.maxAgeMs ?? PRICE_TTL_MS)) return cached;
  try {
    return await fetchCardRecord(id, lang, cached);
  } catch (err) {
    if (cached) return cached;
    if (err instanceof TcgApiError && err.status === 404 && lang !== 'en') {
      // Card not printed in this language – fall back to the English record.
      try {
        return await fetchCardRecord(id, 'en', cached);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Makes sure all given cards are cached; resolves with the records that could be loaded. */
export async function ensureCards(
  ids: string[],
  options: GetCardOptions & { onProgress?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<CardRecord[]> {
  const unique = Array.from(new Set(ids));
  let done = 0;
  const loaded = await mapLimit(unique, options.concurrency ?? 6, async (id) => {
    const card = await getCard(id, options);
    done += 1;
    options.onProgress?.(done, unique.length);
    return card;
  });
  return loaded.filter((c): c is CardRecord => Boolean(c));
}

/** Refreshes prices of all owned cards older than 24 h. Returns the number of refreshed cards. */
export async function refreshOwnedPrices(onProgress?: (done: number, total: number) => void): Promise<number> {
  const items = await db.collection.toArray();
  const ids = Array.from(new Set(items.map((i) => i.cardId)));
  const lang = getSettings().cardLang;
  const cards = await db.cards.bulkGet(ids);
  const stale = ids.filter((id, index) => {
    const card = cards[index];
    return !card || !isFresh(card, lang, PRICE_TTL_MS);
  });
  if (!stale.length) return 0;
  await ensureCards(stale, { onProgress });
  return stale.length;
}

/* ------------------------------------------------------------------ */
/* Set hydration & completion                                          */
/* ------------------------------------------------------------------ */

const hydrationJobs = new Map<string, Promise<void>>();

/**
 * Loads every card of a set into the cache (needed for exact "Restkosten").
 * Runs at most once per set at a time; non-owned cards are refreshed weekly.
 */
export function hydrateSet(setId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const lang = getSettings().cardLang;
  const jobKey = `${lang}:${setId}`;
  const running = hydrationJobs.get(jobKey);
  if (running) return running;
  const job = (async () => {
    const set = await getSet(setId, lang);
    await ensureCards(
      set.cards.map((c) => c.id),
      { maxAgeMs: CATALOG_TTL_MS, onProgress, concurrency: 8 },
    );
  })().finally(() => hydrationJobs.delete(jobKey));
  hydrationJobs.set(jobKey, job);
  return job;
}

export interface SetProgress {
  setId: string;
  name: string;
  releaseDate: string;
  totalCount: number;
  ownedCount: number;
  percent: number;
  missing: SetCardBrief[];
  /** How many of the missing cards already have cached price data. */
  pricedMissing: number;
  /** Sum of Cardmarket trend prices of all missing cards with a known price. */
  remainingCostEur: number;
  /** True once every missing card has been loaded, i.e. the cost is exact. */
  costComplete: boolean;
}

export function computeSetProgress(
  set: SetCache,
  ownedCardIds: Set<string>,
  cachedCards: Map<string, CardRecord>,
): SetProgress {
  const missing = set.cards.filter((c) => !ownedCardIds.has(c.id));
  let pricedMissing = 0;
  let remainingCostEur = 0;
  for (const brief of missing) {
    const card = cachedCards.get(brief.id);
    if (!card) continue;
    pricedMissing += 1;
    remainingCostEur += card.cardmarketTrendEur ?? 0;
  }
  const totalCount = set.cards.length;
  const ownedCount = totalCount - missing.length;
  return {
    setId: set.setId,
    name: set.name,
    releaseDate: set.releaseDate,
    totalCount,
    ownedCount,
    percent: totalCount ? (ownedCount / totalCount) * 100 : 0,
    missing,
    pricedMissing,
    remainingCostEur: Math.round(remainingCostEur * 100) / 100,
    costComplete: pricedMissing === missing.length,
  };
}

/* ------------------------------------------------------------------ */
/* Search & fuzzy matching                                             */
/* ------------------------------------------------------------------ */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function normName(text: string): string {
  return fold(text).replace(/[^a-z0-9]/g, '');
}

export function similarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export interface ParsedNumber {
  local: number | null;
  official: number | null;
  raw: string;
}

/** Extracts `199/165` style collector numbers from noisy OCR text. */
export function parseCollectorNumber(text: string | undefined | null): ParsedNumber {
  const cleaned = (text ?? '').replace(/[oO]/g, '0').replace(/[lI|]/g, '1');
  const pair = cleaned.match(/(\d{1,3})\s*[/\\]\s*(\d{1,3})/);
  if (pair) return { local: Number(pair[1]), official: Number(pair[2]), raw: `${pair[1]}/${pair[2]}` };
  const single = (text ?? '').match(/\b(\d{1,3})\b/);
  if (single) return { local: Number(single[1]), official: null, raw: single[1] };
  return { local: null, official: null, raw: '' };
}

export interface MatchQuery {
  name?: string | null;
  cardNumber?: string | null;
  setCode?: string | null;
}

export interface MatchCandidate {
  id: string;
  name: string;
  localId: string;
  image: string;
  setId: string;
  setName: string;
  /** 0..1 */
  score: number;
}

interface RawBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

/** Counts failed search requests so an outage is not reported as "no matches". */
let searchFailures = 0;

async function searchRaw(params: Record<string, string>, lang: string): Promise<RawBrief[]> {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  try {
    return await request<RawBrief[]>(`cards?${query}`, lang);
  } catch {
    searchFailures += 1;
    return [];
  }
}

function localIdNumber(localId: string): number | null {
  const match = localId.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Splits noisy OCR text into the full string, its words and adjacent word pairs. */
function nameVariants(name: string): string[] {
  const words = name.split(/[^A-Za-zÀ-ÿ0-9'’-]+/).filter((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3);
  const variants = new Set<string>([name, ...words]);
  for (let i = 0; i + 1 < words.length; i++) variants.add(`${words[i]} ${words[i + 1]}`);
  return Array.from(variants);
}

const NAME_SUFFIX = /[\s-]+(ex|EX|GX|V|VMAX|VSTAR)$/;

/** Best similarity of any OCR fragment to a card name (with and without ex/V suffix). */
function nameMatchScore(variants: string[], cardName: string): number {
  const stripped = cardName.replace(NAME_SUFFIX, '');
  let best = 0;
  for (const variant of variants) {
    best = Math.max(best, similarity(variant, cardName), similarity(variant, stripped));
    if (best === 1) break;
  }
  return best;
}

/**
 * Fuzzy-matches OCR/vision output against TCGdex. Works with only a name,
 * only a collector number, or both – the more fields, the higher the score.
 * OCR titles usually carry debris ("= Glumanda 2 C"), so every word of the
 * text is tried on its own as well.
 */
export async function findCandidates(query: MatchQuery, limit = 6): Promise<MatchCandidate[]> {
  const lang = getSettings().cardLang;
  const name = (query.name ?? '').replace(/\s+/g, ' ').trim();
  const number = parseCollectorNumber(query.cardNumber);
  const hasName = normName(name).length >= 3;
  if (!hasName && number.local === null) return [];

  const sets = await listSets(lang).catch(() => [] as SetSummary[]);
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const pool = new Map<string, RawBrief>();
  const add = (list: RawBrief[]) => list.forEach((c) => pool.set(c.id, c));
  const localParam = number.local !== null ? String(number.local) : null;
  const variants = hasName ? nameVariants(name) : [];
  const goodNameHit = () => [...pool.values()].some((c) => nameMatchScore(variants, c.name) > 0.6);

  const failuresBefore = searchFailures;
  const searches: Promise<void>[] = [];
  if (hasName && localParam) searches.push(searchRaw({ name: `like:${name}`, localId: localParam }, lang).then(add));
  if (localParam) searches.push(searchRaw({ localId: localParam }, lang).then(add));
  if (hasName) searches.push(searchRaw({ name: `like:${name}` }, lang).then(add));
  await Promise.all(searches);

  // The full text found nothing convincing: try its longest words one by one.
  if (hasName && !goodNameHit()) {
    const words = variants
      .filter((v) => v !== name && !v.includes(' ') && v.length >= 4)
      .sort((x, y) => y.length - x.length)
      .slice(0, 3);
    await Promise.all(words.map((word) => searchRaw({ name: `like:${word}` }, lang).then(add)));
  }

  // OCR often garbles a few characters – retry with shrinking name prefixes.
  if (hasName && !goodNameHit()) {
    const firstWord = variants.filter((v) => !v.includes(' ')).sort((x, y) => y.length - x.length)[0] ?? name;
    for (const length of [6, 5, 4, 3]) {
      if (firstWord.length <= length) continue;
      const found = await searchRaw({ name: `like:${firstWord.slice(0, length)}` }, lang);
      add(found);
      if (found.length) break;
    }
  }

  if (pool.size === 0 && searchFailures > failuresBefore) {
    throw new TcgApiError('TCGdex is not reachable', 503);
  }

  const wantedSet = fold(query.setCode ?? '');
  const scored: (MatchCandidate & { exactNumber: boolean; nameScore: number })[] = [];
  for (const brief of pool.values()) {
    const setId = setIdOfCard(brief.id);
    const set = setsById.get(setId);
    const nameScore = hasName ? nameMatchScore(variants, brief.name) : 0;
    const localMatch = number.local !== null && localIdNumber(brief.localId) === number.local ? 1 : 0;
    const officialMatch = number.official !== null && set?.officialCards === number.official ? 1 : 0;

    let score: number;
    if (hasName && number.local !== null) {
      score = 0.5 * nameScore + 0.25 * localMatch + (number.official !== null ? 0.25 * officialMatch : 0.25 * localMatch);
    } else if (hasName) {
      score = nameScore * 0.85;
    } else {
      score = number.official !== null ? 0.45 * localMatch + 0.4 * officialMatch : 0.4 * localMatch;
    }
    if (wantedSet && (fold(setId) === wantedSet || fold(set?.name ?? '') === wantedSet)) score += 0.1;
    if (number.local !== null && !localMatch && !hasName) continue;
    scored.push({
      id: brief.id,
      name: brief.name,
      localId: brief.localId,
      image: brief.image ?? '',
      setId,
      setName: set?.name ?? setId,
      score: Math.min(1, score),
      exactNumber: Boolean(localMatch && officialMatch),
      nameScore,
    });
  }

  // "004/165" that fits exactly one card is strong evidence even when the name was unreadable.
  const exact = scored.filter((c) => c.exactNumber);
  if (exact.length === 1) exact[0].score = Math.max(exact[0].score, 0.78 + 0.22 * exact[0].nameScore);

  scored.sort((x, y) => y.score - x.score || y.id.localeCompare(x.id));
  return scored.slice(0, limit).map(({ exactNumber: _exact, nameScore: _name, ...candidate }) => candidate);
}

/** Free-text search for manual lookups (name or collector number). */
export async function searchCards(text: string, limit = 24): Promise<MatchCandidate[]> {
  const value = text.trim();
  if (value.length < 2) return [];
  const looksLikeNumber = /^\d{1,3}(\s*\/\s*\d{1,3})?$/.test(value);
  return findCandidates(looksLikeNumber ? { cardNumber: value } : { name: value }, limit);
}
