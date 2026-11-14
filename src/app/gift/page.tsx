'use client';

import { useEffect, useMemo, useState } from 'react';
import CardDetailSheet from '@/components/CardDetailSheet';
import { SetDetailSheet, SetProgressRow } from '@/components/SetViews';
import { Badge, CardGrid, CardTile, Chip, EmptyState, Icon, PageHeader, Section, Spinner, toast } from '@/components/ui';
import { useTargetSets, useVaultData, type CardRecord } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { findEvolutionGaps, resolveGapCard, topCollectedSetIds, useCachedPokemon, useLatestSetIds, useTrackedSets } from '@/lib/insights';
import { getRepository } from '@/lib/storage-adapter';
import { saveVaultConfig, useVaultConfig } from '@/lib/vault';

type Budget = 'all' | 'low' | 'mid' | 'high';

const BUDGETS: Record<Budget, [number, number]> = {
  all: [0, Infinity],
  low: [0, 5],
  mid: [5, 20],
  high: [20, Infinity],
};

export default function GiftPage() {
  const t = useT();
  const config = useVaultConfig();
  const isViewer = config?.role === 'viewer';
  const vault = useVaultData();
  const targetSets = useTargetSets();
  const cachedPokemon = useCachedPokemon();
  const latestIds = useLatestSetIds(4);

  const [budget, setBudget] = useState<Budget>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  /* Sets the child actively collects: exact numbers incl. prices. */
  const collectedIds = useMemo(
    () => Array.from(new Set([...targetSets.map((s) => s.setId), ...topCollectedSetIds(vault.owned, 4)])),
    [targetSets, vault.owned],
  );
  const collected = useTrackedSets(collectedIds, vault, targetSets);
  /* Newest sets on the shelves: progress only, no price hydration. */
  const shelfIds = useMemo(() => latestIds.filter((id) => !collectedIds.includes(id)), [latestIds, collectedIds]);
  const shelf = useTrackedSets(shelfIds, vault, targetSets, { hydrate: false });

  const boosterRanking = useMemo(
    () =>
      [...collected.sets, ...shelf.sets]
        .filter((s) => s.totalCount > 0 && s.missing.length > 0)
        .sort((a, b) => a.percent - b.percent || b.releaseDate.localeCompare(a.releaseDate))
        .slice(0, 8),
    [collected.sets, shelf.sets],
  );

  const gaps = useMemo(() => findEvolutionGaps(vault.owned, cachedPokemon), [vault.owned, cachedPokemon]);
  const unresolvedKey = gaps
    .filter((g) => g.candidates.length === 0)
    .slice(0, 8)
    .map((g) => `${g.have.setId}|${g.missingName}`)
    .join(';');
  useEffect(() => {
    if (!unresolvedKey) return;
    let cancelled = false;
    (async () => {
      for (const pair of unresolvedKey.split(';')) {
        if (cancelled) return;
        const [setId, name] = pair.split('|');
        await resolveGapCard(name, setId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unresolvedKey]);

  const wishlist = useMemo(() => {
    const [min, max] = BUDGETS[budget];
    const seen = new Set<string>();
    const cards: { card: CardRecord; evolution: boolean }[] = [];
    const push = (card: CardRecord | undefined, evolution: boolean) => {
      if (!card || seen.has(card.id) || vault.ownedCardIds.has(card.id)) return;
      const price = card.cardmarketTrendEur ?? 0;
      if (budget !== 'all' && (price < min || price >= max)) return;
      seen.add(card.id);
      cards.push({ card, evolution });
    };
    gaps.forEach((g) => push(g.candidates[0], true));
    for (const set of collected.sets) {
      if (!set.pinned && targetSets.length > 0) continue; // pinned wishlists take priority
      set.missing.forEach((m) => push(set.cards.get(m.id), false));
    }
    return cards
      .sort(
        (a, b) =>
          Number(vault.reservations.has(b.card.id)) - Number(vault.reservations.has(a.card.id)) ||
          Number(b.evolution) - Number(a.evolution) ||
          (b.card.cardmarketTrendEur ?? 0) - (a.card.cardmarketTrendEur ?? 0),
      )
      .slice(0, 90);
  }, [gaps, collected.sets, budget, vault.ownedCardIds, vault.reservations, targetSets.length]);

  const allSets = [...collected.sets, ...shelf.sets];
  const openSet = allSets.find((s) => s.setId === openSetId) ?? null;
  const reservedCount = vault.reservations.size;

  const toggleReservation = async (card: CardRecord) => {
    const reserved = vault.reservations.has(card.id);
    try {
      await getRepository().setReservation(card.id, reserved ? null : config?.memberName || t('Familie', 'Family'));
      toast(reserved ? t('Vormerkung entfernt', 'Reservation removed') : t(`${card.name} als Geschenk vorgemerkt`, `${card.name} reserved as a gift`));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  };

  if (!vault.ready) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('Geschenk-Radar', 'Gift radar')}
        subtitle={
          isViewer
            ? t(`Was sich ${config?.name ?? 'der Vault'} noch wünscht`, `What ${config?.name ?? 'the vault'} still wishes for`)
            : t('So sieht die Familie deine Wunschliste', 'This is how your family sees your wishlist')
        }
      />

      {isViewer && !config?.memberName && (
        <form
          className="panel mb-6 flex flex-wrap items-end gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (config && nameDraft.trim()) saveVaultConfig({ ...config, memberName: nameDraft.trim() });
          }}
        >
          <div className="min-w-[160px] flex-1">
            <label className="label" htmlFor="gift-name">
              {t('Wie heißt du? (für Vormerkungen)', 'What is your name? (for reservations)')}
            </label>
            <input id="gift-name" className="field" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder={t('z. B. Opa', 'e.g. Grandpa')} />
          </div>
          <button className="btn-primary" type="submit">
            {t('Speichern', 'Save')}
          </button>
        </form>
      )}

      {!isViewer && reservedCount > 0 && (
        <p className="mb-6 flex items-center gap-2 rounded-xl bg-mint-400/10 px-4 py-3 text-sm text-mint-400">
          <Icon name="gift" className="h-5 w-5 shrink-0" />
          {t(
            `${reservedCount} Karte(n) sind als Geschenk vorgemerkt – diese besser nicht selbst kaufen oder ertauschen.`,
            `${reservedCount} card(s) are reserved as gifts – better not buy or trade for them yourself.`,
          )}
        </p>
      )}

      <Section title={t('Booster-Pack-Kaufberater', 'Booster pack advisor')}>
        <p className="mb-3 text-sm text-slate-400">
          {t(
            'Je weniger ein Set vervollständigt ist, desto höher die Chance auf neue Karten ohne Doppelte. Ganz oben steht der beste Booster-Kauf.',
            'The less complete a set is, the higher the chance of pulling new cards without duplicates. The best booster to buy is at the top.',
          )}
        </p>
        {collected.loading && boosterRanking.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : boosterRanking.length === 0 ? (
          <EmptyState icon="gift" title={t('Noch keine Set-Daten', 'No set data yet')} text={t('Sobald Karten gescannt oder Ziel-Sets angepinnt sind, erscheint hier die Empfehlung.', 'Recommendations appear once cards are scanned or target sets are pinned.')} />
        ) : (
          <div className="space-y-2.5">
            {boosterRanking.map((set, index) => (
              <SetProgressRow
                key={set.setId}
                set={set}
                rank={index + 1}
                hint={t(`${(100 - set.percent).toFixed(0)} % Chance auf Neues je Karte`, `${(100 - set.percent).toFixed(0)} % chance of a new card per pull`)}
                showCost={collectedIds.includes(set.setId)}
                onOpen={() => setOpenSetId(set.setId)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title={t('Fehlende Karten & Evolutions-Wunschliste', 'Missing cards & evolution wishlist')}>
        <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
          {(
            [
              ['all', t('Alle Preise', 'All prices')],
              ['low', t('bis 5 €', 'up to €5')],
              ['mid', '5 – 20 €'],
              ['high', t('über 20 €', 'over €20')],
            ] as [Budget, string][]
          ).map(([id, label]) => (
            <Chip key={id} active={budget === id} onClick={() => setBudget(id)}>
              {label}
            </Chip>
          ))}
        </div>
        {wishlist.length === 0 ? (
          <EmptyState
            icon="pin"
            title={t('Keine Wunschkarten in dieser Auswahl', 'No wishlist cards in this selection')}
            text={
              targetSets.length === 0
                ? t('Wunschkarten entstehen aus angepinnten Ziel-Sets und unvollständigen Entwicklungsreihen.', 'Wishlist cards come from pinned target sets and incomplete evolution lines.')
                : t('Kartenpreise werden noch geladen oder der Preisfilter ist zu eng.', 'Card prices are still loading or the price filter is too narrow.')
            }
          />
        ) : (
          <CardGrid>
            {wishlist.map(({ card, evolution }) => {
              const reservedBy = vault.reservations.get(card.id);
              return (
                <CardTile
                  key={card.id}
                  card={card}
                  onClick={() => setDetailId(card.id)}
                  badges={
                    <>
                      {evolution && <Badge tone="volt">Evo</Badge>}
                      {reservedBy && <Badge tone="mint">🎁{isViewer ? ` ${reservedBy}` : ''}</Badge>}
                    </>
                  }
                  footer={
                    isViewer ? (
                      <button
                        className={`mt-1.5 min-h-[32px] w-full rounded-lg text-[10px] font-semibold ${
                          reservedBy ? 'bg-mint-400/15 text-mint-400' : 'bg-white/[0.06] text-slate-200 hover:bg-white/10'
                        }`}
                        onClick={() => void toggleReservation(card)}
                      >
                        {reservedBy ? t('Vorgemerkt ✓', 'Reserved ✓') : t('Vormerken', 'Reserve')}
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </CardGrid>
        )}
      </Section>

      <CardDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
      <SetDetailSheet set={openSet} onClose={() => setOpenSetId(null)} reservations={vault.reservations} />
    </>
  );
}
