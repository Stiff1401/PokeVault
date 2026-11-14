'use client';

import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Category = 'Pokémon' | 'Trainer' | 'Energie';
export type Variant = 'Normal' | 'Reverse Holo' | 'Holo' | 'First Edition';
export type Condition = 'Mint' | 'Near Mint' | 'Excellent' | 'Good' | 'Played';

export const VARIANTS: Variant[] = ['Normal', 'Reverse Holo', 'Holo', 'First Edition'];
export const CONDITIONS: Condition[] = ['Mint', 'Near Mint', 'Excellent', 'Good', 'Played'];

/** Cached TCGdex metadata & Cardmarket EUR prices. */
export interface CardRecord {
  id: string;
  name: string;
  setId: string;
  setName: string;
  setCode: string;
  /** e.g. `199/165` */
  cardNumber: string;
  language: string;
  imageUrl: string;
  category: Category;
  stage: string;
  /** Raw evolution stage (`Basis` | `Phase 1` | `Phase 2`) even when `stage` shows ex/V/VMAX/VSTAR. */
  baseStage: string;
  types: string[];
  evolveFrom: string | null;
  dexId: number[];
  rarity: string | null;
  cardmarketTrendEur: number | null;
  cardmarketLowEur: number | null;
  lastPriceUpdate: string;
  /** Release date of the set (ISO date) – denormalised for sorting. */
  setReleaseDate: string;
  /** Which print variants exist for this card according to TCGdex. */
  availableVariants: Variant[];
}

/** Owned copies, split between main binder and trade binder. */
export interface CollectionItem {
  id: string;
  cardId: string;
  variant: Variant;
  condition: Condition;
  vaultQuantity: number;
  tradeQuantity: number;
  reservedAsGiftBy: string | null;
  customScanDataUrl: string | null;
  acquiredAt: string;
  /** Last local modification – drives last-write-wins sync. */
  updatedAt: string;
}

export interface TargetSet {
  setId: string;
  setName: string;
  releaseDate: string;
  totalCards: number;
  addedAt: string;
  updatedAt: string;
}

export interface PriceHistory {
  id: string;
  cardId: string;
  priceEur: number;
  recordedAt: string;
}

export interface SetCardBrief {
  id: string;
  localId: string;
  name: string;
  image: string;
}

/** Cached set detail (card list) per language. */
export interface SetCache {
  key: string; // `${lang}:${setId}`
  setId: string;
  lang: string;
  name: string;
  code: string;
  releaseDate: string;
  totalCards: number;
  officialCards: number;
  cards: SetCardBrief[];
  fetchedAt: string;
}

/** Deletion marker so removals propagate through sync. */
export interface Tombstone {
  key: string; // `${kind}:${id}`
  kind: 'collection' | 'targetSets';
  id: string;
  updatedAt: string;
}

/** Daily portfolio value snapshot ("PriceSnapshot") for the dashboard delta. */
export interface PortfolioSnapshot {
  day: string; // yyyy-mm-dd
  totalEur: number;
  tradeEur: number;
  recordedAt: string;
}

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

export class PokeVaultDB extends Dexie {
  cards!: Table<CardRecord, string>;
  collection!: Table<CollectionItem, string>;
  targetSets!: Table<TargetSet, string>;
  priceHistory!: Table<PriceHistory, string>;
  setCache!: Table<SetCache, string>;
  tombstones!: Table<Tombstone, string>;
  snapshots!: Table<PortfolioSnapshot, string>;

  constructor() {
    super('pokevault');
    this.version(1).stores({
      cards: 'id, setId, name, category, stage, evolveFrom',
      collection: 'id, cardId, updatedAt',
      targetSets: 'setId, updatedAt',
      priceHistory: 'id, cardId, recordedAt',
      setCache: 'key, setId',
      tombstones: 'key, updatedAt',
      snapshots: 'day',
    });
  }
}

export const db = new PokeVaultDB();

export const nowIso = (): string => new Date().toISOString();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Removes every local table – used when leaving a vault. */
export async function wipeLocalVaultData(): Promise<void> {
  await db.transaction('rw', [db.collection, db.targetSets, db.tombstones, db.snapshots, db.priceHistory], async () => {
    await Promise.all([
      db.collection.clear(),
      db.targetSets.clear(),
      db.tombstones.clear(),
      db.snapshots.clear(),
      db.priceHistory.clear(),
    ]);
  });
}

/* ------------------------------------------------------------------ */
/* Derived helpers & hooks                                             */
/* ------------------------------------------------------------------ */

export interface OwnedEntry {
  item: CollectionItem;
  card: CardRecord;
}

export interface VaultData {
  ready: boolean;
  /** Every collection row, including 0/0 gift-reservation placeholders. */
  items: CollectionItem[];
  /** Cached cards referenced by the collection. */
  cardsById: Map<string, CardRecord>;
  /** Rows with at least one physical copy, joined with card data. */
  owned: OwnedEntry[];
  /** cardId -> total copies in the main binder. */
  vaultQtyByCard: Map<string, number>;
  /** cardId -> total copies in the trade binder. */
  tradeQtyByCard: Map<string, number>;
  /** cardIds with at least one physical copy (either binder). */
  ownedCardIds: Set<string>;
  /** cardId -> name of the relative who reserved it as a gift. */
  reservations: Map<string, string>;
  totalEur: number;
  tradeEur: number;
  duplicateCount: number;
}

export function buildVaultData(items: CollectionItem[], cards: CardRecord[]): Omit<VaultData, 'ready'> {
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const vaultQtyByCard = new Map<string, number>();
  const tradeQtyByCard = new Map<string, number>();
  const ownedCardIds = new Set<string>();
  const reservations = new Map<string, string>();
  const owned: OwnedEntry[] = [];
  let totalEur = 0;
  let tradeEur = 0;
  let duplicateCount = 0;

  for (const item of items) {
    if (item.reservedAsGiftBy) reservations.set(item.cardId, item.reservedAsGiftBy);
    const copies = item.vaultQuantity + item.tradeQuantity;
    if (copies <= 0) continue;
    ownedCardIds.add(item.cardId);
    vaultQtyByCard.set(item.cardId, (vaultQtyByCard.get(item.cardId) ?? 0) + item.vaultQuantity);
    tradeQtyByCard.set(item.cardId, (tradeQtyByCard.get(item.cardId) ?? 0) + item.tradeQuantity);
    duplicateCount += item.tradeQuantity;
    const card = cardsById.get(item.cardId);
    if (!card) continue;
    owned.push({ item, card });
    const price = card.cardmarketTrendEur ?? 0;
    totalEur += item.vaultQuantity * price;
    tradeEur += item.tradeQuantity * price;
  }

  return {
    items,
    cardsById,
    owned,
    vaultQtyByCard,
    tradeQtyByCard,
    ownedCardIds,
    reservations,
    totalEur,
    tradeEur,
    duplicateCount,
  };
}

/** Live view of the whole vault, re-rendering on every IndexedDB change. */
export function useVaultData(): VaultData {
  const raw = useLiveQuery(async () => {
    const items = await db.collection.toArray();
    const ids = Array.from(new Set(items.map((i) => i.cardId)));
    const cards = (await db.cards.bulkGet(ids)).filter((c): c is CardRecord => Boolean(c));
    return { items, cards };
  }, []);

  return useMemo(() => {
    if (!raw) return { ready: false, ...buildVaultData([], []) };
    return { ready: true, ...buildVaultData(raw.items, raw.cards) };
  }, [raw]);
}

export function useTargetSets(): TargetSet[] {
  return useLiveQuery(() => db.targetSets.toArray(), []) ?? [];
}

/** All cached cards of a set (whatever has been hydrated so far). */
export function useCachedSetCards(setId: string | null): CardRecord[] {
  return useLiveQuery(() => (setId ? db.cards.where('setId').equals(setId).toArray() : []), [setId]) ?? [];
}

export function useSnapshots(): PortfolioSnapshot[] {
  return useLiveQuery(() => db.snapshots.orderBy('day').toArray(), []) ?? [];
}

/** Stores today's portfolio value so the dashboard can show a delta. */
export async function recordSnapshot(totalEur: number, tradeEur: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.snapshots.put({
    day,
    totalEur: Math.round(totalEur * 100) / 100,
    tradeEur: Math.round(tradeEur * 100) / 100,
    recordedAt: nowIso(),
  });
}
