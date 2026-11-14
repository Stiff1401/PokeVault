'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import CardDetailSheet from '@/components/CardDetailSheet';
import { SetDetailSheet, SetPickerSheet, SetProgressRow } from '@/components/SetViews';
import { CardImage, EmptyState, Icon, PageHeader, Price, Section, Spinner, toast } from '@/components/ui';
import { recordSnapshot, useSnapshots, useTargetSets, useVaultData } from '@/lib/db';
import { formatEur, useT } from '@/lib/i18n';
import {
  buildTradeSuggestions,
  collectTradeTargets,
  findEvolutionGaps,
  topCollectedSetIds,
  useCachedPokemon,
  useTrackedSets,
} from '@/lib/insights';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';
import { refreshOwnedPrices } from '@/lib/tcg-api';

type SetSort = 'release' | 'completion' | 'cost';

export default function DashboardPage() {
  const t = useT();
  const { uiLang } = useSettings();
  const vault = useVaultData();
  const targetSets = useTargetSets();
  const snapshots = useSnapshots();
  const cachedPokemon = useCachedPokemon();

  const [setSort, setSetSort] = useState<SetSort>('completion');
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /* Refresh stale prices once per visit. */
  useEffect(() => {
    if (!vault.ready) return;
    let cancelled = false;
    setRefreshing(true);
    refreshOwnedPrices()
      .catch(() => 0)
      .finally(() => !cancelled && setRefreshing(false));
    return () => {
      cancelled = true;
    };
  }, [vault.ready]);

  /* Daily portfolio snapshot for the delta KPI. */
  useEffect(() => {
    if (!vault.ready || refreshing || vault.owned.length === 0) return;
    const timer = setTimeout(() => void recordSnapshot(vault.totalEur, vault.tradeEur), 1500);
    return () => clearTimeout(timer);
  }, [vault.ready, refreshing, vault.totalEur, vault.tradeEur, vault.owned.length]);

  const today = new Date().toISOString().slice(0, 10);
  const previous = [...snapshots].reverse().find((s) => s.day < today) ?? null;
  const delta = previous ? vault.totalEur - previous.totalEur : null;

  const pinnedIds = useMemo(() => new Set(targetSets.map((s) => s.setId)), [targetSets]);
  const trackedIds = useMemo(
    () => Array.from(new Set([...targetSets.map((s) => s.setId), ...topCollectedSetIds(vault.owned, 4)])),
    [targetSets, vault.owned],
  );
  const { sets, loading: setsLoading } = useTrackedSets(trackedIds, vault, targetSets);

  const sortedSets = useMemo(() => {
    const list = [...sets];
    if (setSort === 'release') list.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    if (setSort === 'completion') list.sort((a, b) => b.percent - a.percent);
    if (setSort === 'cost') {
      list.sort(
        (a, b) =>
          (a.missing.length === 0 ? Infinity : a.remainingCostEur) - (b.missing.length === 0 ? Infinity : b.remainingCostEur),
      );
    }
    return list;
  }, [sets, setSort]);

  const gaps = useMemo(() => findEvolutionGaps(vault.owned, cachedPokemon), [vault.owned, cachedPokemon]);
  const suggestions = useMemo(() => {
    const duplicates = vault.owned.filter((o) => o.item.tradeQuantity > 0);
    return buildTradeSuggestions(duplicates, collectTradeTargets(sets, gaps), 0.15, 6);
  }, [vault.owned, sets, gaps]);

  const top5 = useMemo(() => {
    const best = new Map<string, (typeof vault.owned)[number]>();
    for (const entry of vault.owned) if (!best.has(entry.card.id)) best.set(entry.card.id, entry);
    return Array.from(best.values())
      .filter((e) => (e.card.cardmarketTrendEur ?? 0) > 0)
      .sort((a, b) => (b.card.cardmarketTrendEur ?? 0) - (a.card.cardmarketTrendEur ?? 0))
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.owned]);

  const totalCopies = vault.owned.reduce((sum, o) => sum + o.item.vaultQuantity + o.item.tradeQuantity, 0);
  const openSet = sets.find((s) => s.setId === openSetId) ?? null;

  const togglePin = async (setId: string) => {
    const set = sets.find((s) => s.setId === setId);
    if (!set) return;
    try {
      if (set.pinned) await getRepository().unpinSet(setId);
      else await getRepository().pinSet({ setId, setName: set.name, releaseDate: set.releaseDate, totalCards: set.totalCount });
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
        title={t('Übersicht', 'Dashboard')}
        subtitle={
          refreshing
            ? t('Preise werden aktualisiert …', 'Refreshing prices …')
            : t(`${vault.ownedCardIds.size} verschiedene Karten · ${totalCopies} Exemplare`, `${vault.ownedCardIds.size} unique cards · ${totalCopies} copies`)
        }
      />

      {/* KPIs */}
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="panel relative overflow-hidden p-5">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-volt-400/10 blur-2xl" aria-hidden="true" />
          <p className="eyebrow">{t('Gesamtwert Sammlung', 'Collection value')}</p>
          <p className="tabular mt-1 font-display text-4xl font-bold tracking-tight">{formatEur(vault.totalEur, uiLang)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {delta === null ? (
              t('Hauptordner · Cardmarket Trend', 'Main binder · Cardmarket trend')
            ) : (
              <>
                <span className={`tabular font-semibold ${delta >= 0 ? 'text-mint-400' : 'text-ember-400'}`}>
                  {delta >= 0 ? '▲ +' : '▼ '}
                  {formatEur(delta, uiLang)}
                </span>{' '}
                {t('seit letztem Stand', 'since last snapshot')}
              </>
            )}
          </p>
        </div>
        <Link href="/trade" className="panel block p-5 transition hover:border-volt-400/40">
          <p className="eyebrow">{t('Tauschmappe Wert', 'Trade binder value')}</p>
          <p className="tabular mt-1 font-display text-4xl font-bold tracking-tight">{formatEur(vault.tradeEur, uiLang)}</p>
          <p className="mt-1 text-xs text-slate-400">
            <span className="tabular font-semibold text-slate-200">{vault.duplicateCount}</span> {t('Doppelte zum Tauschen', 'duplicates to trade')}
          </p>
        </Link>
      </div>

      {vault.owned.length === 0 && (
        <div className="mb-7">
          <EmptyState
            icon="scan"
            title={t('Dein Vault ist noch leer', 'Your vault is still empty')}
            text={t('Scanne Karten einzeln mit der Kamera oder importiere ganze Albumseiten.', 'Scan cards one by one with the camera or import whole binder pages.')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/scan" className="btn-primary">
                  <Icon name="scan" className="h-4 w-4" /> {t('Karte scannen', 'Scan a card')}
                </Link>
                <Link href="/guide" className="btn-ghost">
                  {t('Anleitung ansehen', 'Read the guide')}
                </Link>
              </div>
            }
          />
        </div>
      )}

      {/* Top 5 */}
      {top5.length > 0 && (
        <Section title={t('Top 5 wertvollste Karten', 'Top 5 most valuable cards')}>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 md:mx-0 md:px-0">
            {top5.map((entry, index) => (
              <button key={entry.card.id} className="w-[124px] shrink-0 text-left" onClick={() => setDetailId(entry.card.id)}>
                <div className="relative">
                  <CardImage src={entry.card.imageUrl} name={entry.card.name} />
                  <span className="tabular absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-volt-400 text-xs font-bold text-ink-950 shadow">
                    {index + 1}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs font-semibold">{entry.card.name}</p>
                <Price value={entry.card.cardmarketTrendEur} className="text-sm font-bold text-volt-300" />
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* Sets */}
      <Section
        title={t('Sets: Fortschritt & Restkosten', 'Sets: progress & completion cost')}
        action={
          <button className="text-xs font-semibold text-volt-300" onClick={() => setPickerOpen(true)}>
            + {t('Ziel-Set', 'Target set')}
          </button>
        }
      >
        {sets.length > 1 && (
          <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
            {(
              [
                ['completion', t('Fortschritt %', 'Completion %')],
                ['cost', t('Geringste Restkosten', 'Lowest remaining cost')],
                ['release', t('Erscheinungsdatum', 'Release date')],
              ] as [SetSort, string][]
            ).map(([id, label]) => (
              <button key={id} className={`chip ${setSort === id ? 'chip-on' : ''}`} onClick={() => setSetSort(id)} aria-pressed={setSort === id}>
                {label}
              </button>
            ))}
          </div>
        )}
        {setsLoading && sets.length === 0 && trackedIds.length > 0 ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : sortedSets.length === 0 ? (
          <EmptyState
            icon="pin"
            title={t('Noch kein Set verfolgt', 'No set tracked yet')}
            text={t('Wähle ein Ziel-Set, um Fortschritt und Restkosten in EUR zu sehen.', 'Pick a target set to see progress and the remaining cost in EUR.')}
            action={
              <button className="btn-ghost" onClick={() => setPickerOpen(true)}>
                {t('Set auswählen', 'Choose a set')}
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {sortedSets.map((set) => (
              <SetProgressRow key={set.setId} set={set} onOpen={() => setOpenSetId(set.setId)} onTogglePin={() => void togglePin(set.setId)} />
            ))}
          </div>
        )}
      </Section>

      {/* Trade suggestions */}
      <Section
        title={t('Tausch-Vorschläge', 'Trade suggestions')}
        action={
          <Link href="/trade" className="text-xs font-semibold text-volt-300">
            {t('Zur Tauschmappe', 'Open trade binder')} →
          </Link>
        }
      >
        {suggestions.length === 0 ? (
          <p className="panel p-4 text-sm text-slate-400">
            {vault.duplicateCount === 0
              ? t(
                  'Lege Doppelte in die Tauschmappe – dann findet PokéVault passende Tauschziele im Wert von ±15 %.',
                  'Put duplicates into the trade binder – PokéVault will then find matching trade targets within ±15 % value.',
                )
              : t(
                  'Aktuell passt kein Doppelter wertmäßig (±15 %) zu einer fehlenden Karte deiner verfolgten Sets.',
                  'Right now no duplicate matches a missing card of your tracked sets within ±15 % value.',
                )}
          </p>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2">
            {suggestions.map((s) => (
              <div key={s.target.id} className="panel flex items-center gap-3 p-3">
                <div className="flex shrink-0 -space-x-6">
                  {s.give.slice(0, 3).map(({ entry }) => (
                    <div key={entry.item.id} className="w-12 rounded shadow-lg shadow-black/50">
                      <CardImage src={entry.card.imageUrl} name={entry.card.name} />
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate text-slate-400">
                    {t('Gib', 'Give')}{' '}
                    <span className="font-semibold text-slate-100">{s.give.map(({ entry, quantity }) => `${quantity > 1 ? `${quantity}× ` : ''}${entry.card.name}`).join(' + ')}</span>
                  </p>
                  <p className="truncate text-slate-400">
                    {t('für', 'for')} <span className="font-semibold text-slate-100">{s.target.name}</span>{' '}
                    <span className="text-slate-500">({s.reason === 'evolution' ? t('Evolutions-Lücke', 'evolution gap') : s.target.setName})</span>
                  </p>
                  <p className="tabular mt-0.5">
                    <Price value={s.giveValue} /> ⇄ <Price value={s.target.cardmarketTrendEur} className="text-volt-300" />{' '}
                    <span className={Math.abs(s.deviation) < 0.05 ? 'text-mint-400' : 'text-slate-500'}>
                      ({s.deviation >= 0 ? '+' : ''}
                      {(s.deviation * 100).toFixed(0)} %)
                    </span>
                  </p>
                </div>
                <button className="w-12 shrink-0" onClick={() => setDetailId(s.target.id)} aria-label={s.target.name}>
                  <CardImage src={s.target.imageUrl} name={s.target.name} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <SetDetailSheet set={openSet} onClose={() => setOpenSetId(null)} reservations={vault.reservations} />
      <SetPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} pinnedIds={pinnedIds} />
      <CardDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}
