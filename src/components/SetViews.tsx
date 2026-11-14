'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CardRecord } from '@/lib/db';
import type { TrackedSet } from '@/lib/insights';
import { formatDate, useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';
import { getSet, listSets, type SetSummary } from '@/lib/tcg-api';
import CardDetailSheet from './CardDetailSheet';
import { Badge, CardTile, Chip, Icon, Price, ProgressBar, Sheet, Spinner, Tabs, toast } from './ui';

/* ------------------------------------------------------------------ */
/* Progress row                                                        */
/* ------------------------------------------------------------------ */

export function SetProgressRow({
  set,
  onOpen,
  onTogglePin,
  rank,
  hint,
  showCost = true,
}: {
  set: TrackedSet;
  onOpen: () => void;
  onTogglePin?: () => void;
  rank?: number;
  hint?: string;
  /** Hide the completion cost for sets whose card prices are not loaded. */
  showCost?: boolean;
}) {
  const t = useT();
  const { uiLang } = useSettings();
  return (
    <div className="panel flex items-stretch">
      <button className="min-w-0 flex-1 p-4 text-left" onClick={onOpen}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate font-semibold">
            {rank !== undefined && <span className="tabular mr-2 text-volt-300">{rank}.</span>}
            {set.name}
          </p>
          <p className="tabular shrink-0 text-sm font-semibold">
            {set.ownedCount}
            <span className="text-slate-500"> / {set.totalCount}</span>
          </p>
        </div>
        <div className="my-2">
          <ProgressBar percent={set.percent} tone={set.percent >= 100 ? 'mint' : 'volt'} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span className="truncate">
            {set.releaseDate ? formatDate(set.releaseDate, uiLang) : '–'} · <span className="tabular">{set.percent.toFixed(0)} %</span>
            {hint ? ` · ${hint}` : ''}
          </span>
          <span className="shrink-0">
            {set.missing.length === 0 ? (
              <span className="font-semibold text-mint-400">{t('Komplett', 'Complete')}</span>
            ) : !showCost ? null : set.costComplete ? (
              <>
                {t('Restkosten', 'Remaining cost')} <Price value={set.remainingCostEur} className="font-semibold text-slate-100" />
              </>
            ) : (
              <span className="tabular inline-flex items-center gap-1.5">
                <Spinner className="h-3 w-3" />
                {t('Restkosten', 'Remaining')} ≥ <Price value={set.remainingCostEur} /> ({set.pricedMissing}/{set.missing.length})
              </span>
            )}
          </span>
        </div>
      </button>
      {onTogglePin && (
        <button
          className={`flex w-12 shrink-0 items-center justify-center border-l border-white/[0.06] ${set.pinned ? 'text-volt-400' : 'text-slate-600 hover:text-slate-300'}`}
          onClick={onTogglePin}
          aria-pressed={set.pinned}
          aria-label={set.pinned ? t('Set nicht mehr verfolgen', 'Stop tracking set') : t('Set verfolgen', 'Track set')}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill={set.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l2.5 5.5 6 .7-4.5 4.1 1.3 5.9L12 16.2 6.7 19.2 8 13.300 3.500 9.200l6-.7L12 3Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Vorhanden vs. Fehlend" split view                                   */
/* ------------------------------------------------------------------ */

type SplitFilter = 'all' | 'Basis' | 'Phase 1' | 'Phase 2' | 'Trainer' | 'Energie';

function matchesSplit(card: CardRecord | undefined, filter: SplitFilter): boolean {
  if (filter === 'all') return true;
  if (!card) return false;
  if (filter === 'Trainer' || filter === 'Energie') return card.category === filter;
  return card.category === 'Pokémon' && (card.stage === filter || card.baseStage === filter);
}

export function SetDetailSheet({
  set,
  onClose,
  reservations,
}: {
  set: TrackedSet | null;
  onClose: () => void;
  reservations?: Map<string, string>;
}) {
  const t = useT();
  const [tab, setTab] = useState<'missing' | 'owned'>('missing');
  const [filter, setFilter] = useState<SplitFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (set) {
      setTab('missing');
      setFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set?.setId]);

  const split = useMemo(() => {
    if (!set) return { missing: [], owned: [] };
    const missingIds = new Set(set.missing.map((m) => m.id));
    const toTile = (brief: { id: string; name: string; localId: string; image: string }) => {
      const record = set.cards.get(brief.id);
      return {
        record,
        tile: record ?? { id: brief.id, name: brief.name, imageUrl: brief.image, cardNumber: brief.localId },
      };
    };
    const all = Array.from(set.cards.values());
    const briefs = set.missing;
    // Owned cards come from the hydrated cache; fall back to nothing until loaded.
    const owned = all.filter((c) => !missingIds.has(c.id)).map((c) => ({ record: c as CardRecord | undefined, tile: c }));
    return { missing: briefs.map(toTile), owned };
  }, [set]);

  const list = (tab === 'missing' ? split.missing : split.owned).filter((x) => matchesSplit(x.record, filter));
  const filters: [SplitFilter, string][] = [
    ['all', t('Alle', 'All')],
    ['Basis', t('Basis', 'Basic')],
    ['Phase 1', t('Phase 1', 'Stage 1')],
    ['Phase 2', t('Phase 2', 'Stage 2')],
    ['Trainer', 'Trainer'],
    ['Energie', t('Energie', 'Energy')],
  ];

  return (
    <>
      <Sheet open={Boolean(set)} onClose={onClose} title={set?.name ?? ''} wide>
        {set && (
          <>
            <div className="mb-4">
              <ProgressBar percent={set.percent} tone={set.percent >= 100 ? 'mint' : 'volt'} />
              <p className="mt-2 text-sm text-slate-400">
                <span className="tabular font-semibold text-slate-100">
                  {set.ownedCount} / {set.totalCount}
                </span>{' '}
                · {t('Restkosten', 'Remaining cost')}{' '}
                {set.costComplete ? (
                  <Price value={set.remainingCostEur} className="font-semibold text-volt-300" />
                ) : (
                  <span className="tabular">
                    ≥ <Price value={set.remainingCostEur} /> ({t('lädt', 'loading')} {set.pricedMissing}/{set.missing.length})
                  </span>
                )}
              </p>
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'missing', label: t('Fehlend', 'Missing'), badge: set.missing.length },
                { id: 'owned', label: t('Vorhanden', 'Owned'), badge: set.ownedCount },
              ]}
            />
            <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
              {filters.map(([id, label]) => (
                <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </Chip>
              ))}
            </div>
            {list.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                {filter !== 'all' && !set.costComplete
                  ? t('Kartendaten werden noch geladen …', 'Card data is still loading …')
                  : t('Keine Karten in dieser Ansicht.', 'No cards in this view.')}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 md:grid-cols-6">
                {list.map(({ tile }) => (
                  <CardTile
                    key={tile.id}
                    card={tile}
                    dim={tab === 'missing'}
                    onClick={() => setDetailId(tile.id)}
                    badges={reservations?.has(tile.id) ? <Badge tone="mint">🎁</Badge> : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
      <CardDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Set picker (pin a set as completion target)                          */
/* ------------------------------------------------------------------ */

export function SetPickerSheet({ open, onClose, pinnedIds }: { open: boolean; onClose: () => void; pinnedIds: Set<string> }) {
  const t = useT();
  const { cardLang } = useSettings();
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSets(cardLang)
      .then((list) => !cancelled && setSets(list.slice().reverse()))
      .catch(() => !cancelled && setSets([]));
    return () => {
      cancelled = true;
    };
  }, [open, cardLang]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (sets ?? []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle)).slice(0, 80);
  }, [sets, query]);

  const toggle = async (summary: SetSummary) => {
    setBusyId(summary.id);
    try {
      if (pinnedIds.has(summary.id)) {
        await getRepository().unpinSet(summary.id);
      } else {
        const detail = await getSet(summary.id, cardLang);
        await getRepository().pinSet({
          setId: detail.setId,
          setName: detail.name,
          releaseDate: detail.releaseDate,
          totalCards: detail.totalCards,
        });
        toast(t(`${detail.name} wird verfolgt`, `Tracking ${detail.name}`));
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Ziel-Sets verfolgen', 'Track target sets')}>
      <input className="field mb-3" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Set suchen …', 'Search sets …')} autoFocus />
      {!sets && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
      {sets && sets.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{t('Set-Liste nicht verfügbar (offline?).', 'Set list unavailable (offline?).')}</p>}
      <ul className="space-y-1.5">
        {visible.map((s) => {
          const pinned = pinnedIds.has(s.id);
          return (
            <li key={s.id}>
              <button
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                  pinned ? 'border-volt-400/60 bg-volt-400/10' : 'border-white/[0.06] bg-ink-800 hover:border-white/20'
                }`}
                onClick={() => void toggle(s)}
                disabled={busyId === s.id}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{s.name}</span>
                  <span className="tabular text-xs text-slate-500">
                    {s.id} · {s.totalCards} {t('Karten', 'cards')}
                  </span>
                </span>
                {busyId === s.id ? <Spinner className="h-4 w-4" /> : pinned ? <Icon name="check" className="h-5 w-5 text-volt-300" /> : <Icon name="plus" className="h-5 w-5 text-slate-500" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
