'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import CardDetailSheet from '@/components/CardDetailSheet';
import { SetDetailSheet, SetPickerSheet, SetProgressRow } from '@/components/SetViews';
import TradeBalanceScale from '@/components/TradeBalanceScale';
import { CardImage, EmptyState, Icon, PageHeader, Price, Section, Tabs, toast } from '@/components/ui';
import { useTargetSets, useVaultData, type CardRecord } from '@/lib/db';
import { conditionLabel, stageLabel, useT } from '@/lib/i18n';
import { findEvolutionGaps, resolveGapCard, useCachedPokemon, useTrackedSets } from '@/lib/insights';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';

type TabId = 'binder' | 'targets' | 'scale';

export default function TradePage() {
  const t = useT();
  const { uiLang } = useSettings();
  const vault = useVaultData();
  const targetSets = useTargetSets();
  const cachedPokemon = useCachedPokemon();

  const [tab, setTab] = useState<TabId>('binder');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const tradeEntries = useMemo(
    () =>
      vault.owned
        .filter((o) => o.item.tradeQuantity > 0)
        .sort((a, b) => (b.card.cardmarketTrendEur ?? 0) - (a.card.cardmarketTrendEur ?? 0)),
    [vault.owned],
  );

  const pinnedIds = useMemo(() => new Set(targetSets.map((s) => s.setId)), [targetSets]);
  const { sets } = useTrackedSets(
    targetSets.map((s) => s.setId),
    vault,
    targetSets,
    { hydrate: tab !== 'binder' },
  );

  const gaps = useMemo(() => findEvolutionGaps(vault.owned, cachedPokemon), [vault.owned, cachedPokemon]);

  /* Look up concrete cards for the first gaps that have no cached candidate yet. */
  const unresolvedKey = gaps
    .filter((g) => g.candidates.length === 0)
    .slice(0, 12)
    .map((g) => `${g.have.setId}|${g.missingName}`)
    .join(';');
  useEffect(() => {
    if (tab !== 'targets' || !unresolvedKey) return;
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
  }, [tab, unresolvedKey]);

  const wishlist = useMemo(() => {
    const cards: CardRecord[] = [];
    const seen = new Set<string>();
    const push = (card: CardRecord | undefined) => {
      if (!card || seen.has(card.id)) return;
      seen.add(card.id);
      cards.push(card);
    };
    gaps.forEach((g) => push(g.candidates[0]));
    for (const set of sets) {
      set.missing
        .map((m) => set.cards.get(m.id))
        .filter((c): c is CardRecord => Boolean(c))
        .sort((a, b) => (b.cardmarketTrendEur ?? 0) - (a.cardmarketTrendEur ?? 0))
        .slice(0, 8)
        .forEach(push);
    }
    return cards;
  }, [gaps, sets]);

  const openSet = sets.find((s) => s.setId === openSetId) ?? null;

  const move = async (itemId: string) => {
    try {
      await getRepository().moveCopy(itemId, 'vault');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  };

  return (
    <>
      <PageHeader title={t('Tausch', 'Trade')} subtitle={t('Doppelte, Tauschziele und die Live-Waage für Tauschtreffen', 'Duplicates, targets and the live scale for trade meetups')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'binder', label: t('Meine Tauschmappe', 'My trade binder'), badge: vault.duplicateCount || undefined },
          { id: 'targets', label: t('Ziele & Lücken', 'Targets & gaps'), badge: gaps.length || undefined },
          { id: 'scale', label: t('Tausch-Waage', 'Trade scale') },
        ]}
      />

      {tab === 'binder' &&
        (tradeEntries.length === 0 ? (
          <EmptyState
            icon="trade"
            title={t('Die Tauschmappe ist leer', 'The trade binder is empty')}
            text={t(
              'Verschiebe Doppelte in der Sammlung mit „T →" in die Tauschmappe – oder scanne sie direkt dorthin.',
              'Move duplicates with "T →" in the collection – or scan them straight into the trade binder.',
            )}
            action={
              <Link href="/collection" className="btn-ghost">
                {t('Zur Sammlung', 'Open collection')}
              </Link>
            }
          />
        ) : (
          <>
            <div className="panel mb-4 flex items-center justify-between p-4">
              <div>
                <p className="eyebrow">{t('Wert der Tauschmappe', 'Trade binder value')}</p>
                <Price value={vault.tradeEur} className="font-display text-2xl font-bold" />
              </div>
              <p className="tabular text-sm text-slate-400">
                {vault.duplicateCount} {t('Karten', 'cards')}
              </p>
            </div>
            <ul className="space-y-2">
              {tradeEntries.map(({ item, card }) => (
                <li key={item.id} className="panel flex items-center gap-3 p-2.5">
                  <button className="w-12 shrink-0" onClick={() => setDetailId(card.id)} aria-label={card.name}>
                    <CardImage src={card.imageUrl} name={card.name} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{card.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {card.setName} · {card.cardNumber}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {item.variant} · {conditionLabel(item.condition, uiLang)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Price value={card.cardmarketTrendEur} className="block text-sm font-bold text-volt-300" />
                    <p className="tabular text-xs text-slate-400">×{item.tradeQuantity}</p>
                  </div>
                  <button
                    className="shrink-0 rounded-lg bg-white/[0.06] p-2 text-slate-300 hover:bg-white/15"
                    onClick={() => void move(item.id)}
                    aria-label={t(`${card.name}: eine Kopie zurück in den Hauptordner`, `${card.name}: move one copy back to main binder`)}
                  >
                    <Icon name="arrowLeft" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}

      {tab === 'targets' && (
        <>
          <Section title={t('Evolutions-Lücken', 'Evolution gaps')}>
            {gaps.length === 0 ? (
              <p className="panel p-4 text-sm text-slate-400">
                {t('Keine unvollständigen Entwicklungsreihen gefunden.', 'No incomplete evolution lines found.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {gaps.slice(0, 40).map((gap) => {
                  const candidate = gap.candidates[0];
                  return (
                    <li key={gap.missingName} className="panel flex items-center gap-3 p-3">
                      <button className="w-12 shrink-0" onClick={() => setDetailId(gap.have.id)} aria-label={gap.have.name}>
                        <CardImage src={gap.have.imageUrl} name={gap.have.name} />
                      </button>
                      <p className="min-w-0 flex-1 text-sm text-slate-300">
                        {t('Du besitzt', 'You own')} {stageLabel(gap.have.baseStage, uiLang)}{' '}
                        <span className="font-semibold text-white">„{gap.have.name}"</span>, {t('dir fehlt', 'you are missing')}{' '}
                        {stageLabel(gap.missingStage, uiLang)} <span className="font-semibold text-volt-300">„{gap.missingName}"</span>
                        {gap.alsoMissingName && (
                          <>
                            {' '}
                            {t('oder', 'or')} {stageLabel('Basis', uiLang)} <span className="font-semibold text-volt-300">„{gap.alsoMissingName}"</span>
                          </>
                        )}
                        .
                      </p>
                      {candidate ? (
                        <button className="w-12 shrink-0 text-center" onClick={() => setDetailId(candidate.id)} aria-label={candidate.name}>
                          <div className="opacity-60 grayscale">
                            <CardImage src={candidate.imageUrl} name={candidate.name} />
                          </div>
                          <Price value={candidate.cardmarketTrendEur} className="text-[10px] font-semibold text-volt-300" />
                        </button>
                      ) : (
                        <span className="w-12 shrink-0 text-center text-[10px] text-slate-600">…</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title={t('Set-Wunschlisten', 'Set wishlists')}
            action={
              <button className="text-xs font-semibold text-volt-300" onClick={() => setPickerOpen(true)}>
                + {t('Ziel-Set', 'Target set')}
              </button>
            }
          >
            {sets.length === 0 ? (
              <EmptyState
                icon="pin"
                title={t('Kein Ziel-Set angepinnt', 'No target set pinned')}
                text={t('Angepinnte Sets zeigen hier ihre fehlenden Karten als Tauschziele.', 'Pinned sets list their missing cards here as trade targets.')}
                action={
                  <button className="btn-ghost" onClick={() => setPickerOpen(true)}>
                    {t('Set auswählen', 'Choose a set')}
                  </button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {sets.map((set) => (
                  <SetProgressRow key={set.setId} set={set} onOpen={() => setOpenSetId(set.setId)} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {tab === 'scale' && <TradeBalanceScale tradeEntries={tradeEntries} wishlist={wishlist} />}

      <CardDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />
      <SetDetailSheet set={openSet} onClose={() => setOpenSetId(null)} reservations={vault.reservations} />
      <SetPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} pinnedIds={pinnedIds} />
    </>
  );
}
