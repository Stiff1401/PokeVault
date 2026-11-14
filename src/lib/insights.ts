'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type CardRecord, type OwnedEntry, type SetCache, type TargetSet, type VaultData } from './db';
import { useSettings } from './settings';
import { computeSetProgress, getCard, getSet, hydrateSet, listSets, searchCards, type SetProgress } from './tcg-api';

/* ------------------------------------------------------------------ */
/* Tracked sets (pinned + most collected)                              */
/* ------------------------------------------------------------------ */

export interface TrackedSet extends SetProgress {
  pinned: boolean;
  /** Cached card records of this set, keyed by id. */
  cards: Map<string, CardRecord>;
}

/** Ids of the sets with the most owned cards. */
export function topCollectedSetIds(owned: OwnedEntry[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const { card } of owned) counts.set(card.setId, (counts.get(card.setId) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Loads set lists for the given ids, hydrates their cards in the background
 * (for exact completion cost) and returns live progress numbers.
 */
export function useTrackedSets(
  setIds: string[],
  vault: VaultData,
  targetSets: TargetSet[],
  options: { hydrate?: boolean } = {},
): { sets: TrackedSet[]; loading: boolean } {
  const { cardLang } = useSettings();
  const idsKey = Array.from(new Set(setIds)).sort().join(',');
  const [caches, setCaches] = useState<Map<string, SetCache>>(new Map());
  const [loading, setLoading] = useState(true);
  const hydrate = options.hydrate !== false;

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    setLoading(true);
    (async () => {
      const loaded = new Map<string, SetCache>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            loaded.set(id, await getSet(id, cardLang));
          } catch {
            /* offline and never cached – skip this set */
          }
        }),
      );
      if (cancelled) return;
      setCaches(loaded);
      setLoading(false);
      if (!hydrate) return;
      // Sequential on purpose: several hundred requests per set.
      for (const id of ids) {
        if (cancelled) return;
        await hydrateSet(id).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey, cardLang, hydrate]);

  const cachedCards = useLiveQuery(
    () => (idsKey ? db.cards.where('setId').anyOf(idsKey.split(',')).toArray() : Promise.resolve([] as CardRecord[])),
    [idsKey],
  );

  const sets = useMemo(() => {
    const bySet = new Map<string, Map<string, CardRecord>>();
    for (const card of cachedCards ?? []) {
      let map = bySet.get(card.setId);
      if (!map) bySet.set(card.setId, (map = new Map()));
      map.set(card.id, card);
    }
    const pinned = new Set(targetSets.map((s) => s.setId));
    const result: TrackedSet[] = [];
    for (const [id, cache] of caches) {
      const cards = bySet.get(id) ?? new Map<string, CardRecord>();
      result.push({ ...computeSetProgress(cache, vault.ownedCardIds, cards), pinned: pinned.has(id), cards });
    }
    return result;
  }, [caches, cachedCards, vault.ownedCardIds, targetSets]);

  return { sets, loading };
}

/** Newest sets of the catalogue (the TCGdex set list is ordered chronologically). */
export function useLatestSetIds(count: number): string[] {
  const { cardLang } = useSettings();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    listSets(cardLang)
      .then((sets) => {
        if (cancelled) return;
        // Skip digital-only TCG Pocket sets and tiny promo sets.
        const physical = sets.filter((s) => !/^(A\d|B\d|P-A)/.test(s.id) && s.totalCards >= 60);
        setIds(physical.slice(-count).map((s) => s.id));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cardLang, count]);
  return ids;
}

/* ------------------------------------------------------------------ */
/* Evolution gaps                                                      */
/* ------------------------------------------------------------------ */

/** "Glurak-ex" / "Glurak VMAX" -> "glurak" so name comparisons ignore suffixes. */
export function baseName(name: string): string {
  return name
    .replace(/[\s-]+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?X|◇|δ)$/u, '')
    .trim()
    .toLowerCase();
}

export interface EvolutionGap {
  /** The owned evolution whose pre-evolution is missing. */
  have: CardRecord;
  /** Name of the direct missing pre-evolution. */
  missingName: string;
  missingStage: 'Phase 1' | 'Basis';
  /** Cached cards that would close the gap (same set first). */
  candidates: CardRecord[];
  /** For Phase 2 cards: the basic Pokémon, when it is missing as well. */
  alsoMissingName: string | null;
}

export function findEvolutionGaps(owned: OwnedEntry[], cached: CardRecord[]): EvolutionGap[] {
  const ownedNames = new Set(owned.filter((o) => o.card.category === 'Pokémon').map((o) => baseName(o.card.name)));
  const cachedByName = new Map<string, CardRecord[]>();
  for (const card of cached) {
    if (card.category !== 'Pokémon') continue;
    const key = baseName(card.name);
    const list = cachedByName.get(key);
    if (list) list.push(card);
    else cachedByName.set(key, [card]);
  }

  const gaps = new Map<string, EvolutionGap>();
  for (const { card } of owned) {
    if (card.category !== 'Pokémon' || !card.evolveFrom) continue;
    const missingKey = baseName(card.evolveFrom);
    if (ownedNames.has(missingKey) || gaps.has(missingKey)) continue;

    const candidates = (cachedByName.get(missingKey) ?? [])
      .slice()
      .sort(
        (a, b) =>
          Number(b.setId === card.setId) - Number(a.setId === card.setId) ||
          (a.cardmarketTrendEur ?? Infinity) - (b.cardmarketTrendEur ?? Infinity),
      );
    let alsoMissingName: string | null = null;
    if (card.baseStage === 'Phase 2') {
      const basic = candidates.find((c) => c.evolveFrom)?.evolveFrom ?? null;
      if (basic && !ownedNames.has(baseName(basic))) alsoMissingName = basic;
    }
    gaps.set(missingKey, {
      have: card,
      missingName: card.evolveFrom,
      missingStage: card.baseStage === 'Phase 2' ? 'Phase 1' : 'Basis',
      candidates,
      alsoMissingName,
    });
  }
  return Array.from(gaps.values()).sort(
    (a, b) => (b.have.cardmarketTrendEur ?? 0) - (a.have.cardmarketTrendEur ?? 0),
  );
}

const gapLookups = new Map<string, Promise<CardRecord | null>>();

/**
 * Finds a concrete card for a missing pre-evolution via TCGdex (preferring the
 * set of the owned evolution) and stores it in the card cache.
 */
export function resolveGapCard(missingName: string, preferSetId: string): Promise<CardRecord | null> {
  const key = `${preferSetId}|${missingName}`;
  const running = gapLookups.get(key);
  if (running) return running;
  const job = (async () => {
    const found = await searchCards(missingName, 12);
    const exact = found.filter((c) => baseName(c.name) === baseName(missingName));
    const pick = exact.find((c) => c.setId === preferSetId) ?? exact[0] ?? null;
    return pick ? getCard(pick.id, { maxAgeMs: 7 * 24 * 60 * 60 * 1000 }) : null;
  })().catch(() => null);
  gapLookups.set(key, job);
  return job;
}

/* ------------------------------------------------------------------ */
/* Smart trade suggestions                                             */
/* ------------------------------------------------------------------ */

export interface TradeTarget {
  card: CardRecord;
  reason: 'set' | 'evolution';
}

export interface TradeSuggestion {
  target: CardRecord;
  reason: 'set' | 'evolution';
  give: { entry: OwnedEntry; quantity: number }[];
  giveValue: number;
  /** (giveValue - targetValue) / targetValue */
  deviation: number;
}

/**
 * Pairs duplicates from the trade binder with wanted cards inside a ±15 %
 * EUR tolerance – both 1-for-1 and 1-for-many bundles (up to 4 cards).
 */
export function buildTradeSuggestions(
  duplicates: OwnedEntry[],
  targets: TradeTarget[],
  tolerance = 0.15,
  limit = 12,
): TradeSuggestion[] {
  const stock = duplicates
    .filter((d) => d.item.tradeQuantity > 0 && (d.card.cardmarketTrendEur ?? 0) > 0)
    .sort((a, b) => (b.card.cardmarketTrendEur ?? 0) - (a.card.cardmarketTrendEur ?? 0));
  if (!stock.length) return [];

  const suggestions: TradeSuggestion[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const price = target.card.cardmarketTrendEur ?? 0;
    if (price <= 0 || seen.has(target.card.id)) continue;
    seen.add(target.card.id);
    const min = price * (1 - tolerance);
    const max = price * (1 + tolerance);

    // 1-for-1: the duplicate closest in value.
    let single: OwnedEntry | null = null;
    for (const entry of stock) {
      const value = entry.card.cardmarketTrendEur ?? 0;
      if (value < min || value > max || entry.card.id === target.card.id) continue;
      if (!single || Math.abs(value - price) < Math.abs((single.card.cardmarketTrendEur ?? 0) - price)) single = entry;
    }
    if (single) {
      const value = single.card.cardmarketTrendEur ?? 0;
      suggestions.push({
        target: target.card,
        reason: target.reason,
        give: [{ entry: single, quantity: 1 }],
        giveValue: value,
        deviation: (value - price) / price,
      });
      continue;
    }

    // 1-for-many: greedy bundle of cheaper duplicates.
    const bundle = new Map<string, { entry: OwnedEntry; quantity: number }>();
    let sum = 0;
    let count = 0;
    for (const entry of stock) {
      const value = entry.card.cardmarketTrendEur ?? 0;
      if (entry.card.id === target.card.id) continue;
      let available = entry.item.tradeQuantity;
      while (available > 0 && count < 4 && sum < min && sum + value <= max) {
        sum += value;
        count += 1;
        available -= 1;
        const slot = bundle.get(entry.item.id);
        if (slot) slot.quantity += 1;
        else bundle.set(entry.item.id, { entry, quantity: 1 });
      }
      if (sum >= min) break;
    }
    if (count >= 2 && sum >= min && sum <= max) {
      suggestions.push({
        target: target.card,
        reason: target.reason,
        give: Array.from(bundle.values()),
        giveValue: sum,
        deviation: (sum - price) / price,
      });
    }
  }

  return suggestions
    .sort(
      (a, b) =>
        Number(b.reason === 'evolution') - Number(a.reason === 'evolution') ||
        (b.target.cardmarketTrendEur ?? 0) - (a.target.cardmarketTrendEur ?? 0),
    )
    .slice(0, limit);
}

/** Missing cards of tracked sets + cached evolution-gap cards as trade targets. */
export function collectTradeTargets(sets: TrackedSet[], gaps: EvolutionGap[]): TradeTarget[] {
  const targets: TradeTarget[] = [];
  for (const gap of gaps) {
    const card = gap.candidates[0];
    if (card) targets.push({ card, reason: 'evolution' });
  }
  for (const set of sets) {
    for (const brief of set.missing) {
      const card = set.cards.get(brief.id);
      if (card) targets.push({ card, reason: 'set' });
    }
  }
  return targets;
}

/** All cached Pokémon cards – input for the evolution-gap scan. */
export function useCachedPokemon(): CardRecord[] {
  return useLiveQuery(() => db.cards.where('category').equals('Pokémon').toArray(), []) ?? [];
}
