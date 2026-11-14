'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { CONDITIONS, db, type CardRecord, type CollectionItem, type Condition, type Variant } from '@/lib/db';
import { categoryLabel, conditionLabel, formatDate, stageLabel, typeLabel, useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';
import { getCard } from '@/lib/tcg-api';
import { useVaultConfig } from '@/lib/vault';
import { CardImage, Icon, Price, Sheet, Spinner, toast } from './ui';

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / range) * 24).toFixed(1)}`)
    .join(' ');
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={rising ? '#3ddc97' : '#ff6b57'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-between gap-1 rounded-xl bg-ink-800 px-1.5 py-1">
      <button className="rounded-lg p-2 text-slate-300 hover:bg-white/10 disabled:opacity-30" onClick={onMinus} disabled={value <= 0} aria-label={`${label} −1`}>
        <Icon name="minus" className="h-4 w-4" />
      </button>
      <div className="text-center leading-tight">
        <p className="tabular text-base font-bold">{value}</p>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <button className="rounded-lg p-2 text-slate-300 hover:bg-white/10" onClick={onPlus} aria-label={`${label} +1`}>
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Detail view of a single card: metadata, price history, every owned stack
 * with quantity controls, and the gift-reservation toggle for viewers.
 */
export default function CardDetailSheet({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  const t = useT();
  const { uiLang } = useSettings();
  const config = useVaultConfig();
  const isViewer = config?.role === 'viewer';
  const [card, setCard] = useState<CardRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cardId) {
      setCard(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCard(cardId)
      .then((c) => !cancelled && setCard(c))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const rows = useLiveQuery(() => (cardId ? db.collection.where('cardId').equals(cardId).toArray() : []), [cardId]) ?? [];
  const history =
    useLiveQuery(() => (cardId ? db.priceHistory.where('cardId').equals(cardId).sortBy('recordedAt') : []), [cardId]) ?? [];

  const stacks = rows.filter((r) => r.vaultQuantity + r.tradeQuantity > 0);
  const reservedBy = rows.find((r) => r.reservedAsGiftBy)?.reservedAsGiftBy ?? null;
  const personalScan = rows.find((r) => r.customScanDataUrl)?.customScanDataUrl ?? null;

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  };

  const repo = () => getRepository();

  const facts: [string, string][] = card
    ? ([
        [t('Set', 'Set'), `${card.setName} (${card.setCode})`],
        [t('Nummer', 'Number'), card.cardNumber],
        [t('Kategorie', 'Category'), categoryLabel(card.category, uiLang)],
        [t('Stufe', 'Stage'), stageLabel(card.stage, uiLang)],
        [t('Typ', 'Type'), card.types.map((x) => typeLabel(x, uiLang)).join(', ')],
        [t('Entwickelt sich aus', 'Evolves from'), card.evolveFrom ?? ''],
        [t('Seltenheit', 'Rarity'), card.rarity ?? ''],
        [t('Pokédex', 'Pokédex'), card.dexId.map((n) => `#${n}`).join(', ')],
        [t('Set erschienen', 'Set released'), card.setReleaseDate ? formatDate(card.setReleaseDate, uiLang) : ''],
      ].filter(([, value]) => value) as [string, string][])
    : [];

  return (
    <Sheet open={Boolean(cardId)} onClose={onClose} title={card?.name ?? t('Karte', 'Card')}>
      {loading && !card && (
        <div className="flex justify-center py-10">
          <Spinner className="h-7 w-7" />
        </div>
      )}
      {!loading && !card && cardId && (
        <p className="py-6 text-center text-sm text-slate-400">{t('Kartendaten nicht verfügbar (offline?).', 'Card data unavailable (offline?).')}</p>
      )}
      {card && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="w-2/5 max-w-[190px] shrink-0">
              <CardImage src={card.imageUrl} name={card.name} quality="high" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Cardmarket Trend</p>
              <Price value={card.cardmarketTrendEur} className="block font-display text-3xl font-bold text-volt-300" />
              <p className="mt-0.5 text-xs text-slate-400">
                {t('ab', 'from')} <Price value={card.cardmarketLowEur} /> · {formatDate(card.lastPriceUpdate, uiLang)}
              </p>
              {history.length >= 2 && (
                <div className="mt-3">
                  <Sparkline values={history.map((h) => h.priceEur)} />
                  <p className="text-[10px] text-slate-500">
                    {t(`Preisverlauf · ${history.length} Messpunkte`, `Price history · ${history.length} data points`)}
                  </p>
                </div>
              )}
              {reservedBy && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-mint-400/10 px-2.5 py-1.5 text-xs font-semibold text-mint-400">
                  <Icon name="gift" className="h-4 w-4" />
                  {isViewer
                    ? t(`Als Geschenk vorgemerkt (${reservedBy})`, `Reserved as a gift (${reservedBy})`)
                    : t('Als Geschenk vorgemerkt – nicht selbst kaufen', 'Reserved as a gift – do not buy it yourself')}
                </p>
              )}
            </div>
          </div>

          {/* Owned stacks */}
          {stacks.length > 0 && (
            <div className="space-y-3">
              <p className="eyebrow">{t('Im Besitz', 'Owned')}</p>
              {stacks.map((row: CollectionItem) => (
                <div key={row.id} className="panel space-y-2.5 p-3">
                  {isViewer ? (
                    <p className="text-sm">
                      {row.variant} · {conditionLabel(row.condition, uiLang)} —{' '}
                      <span className="tabular font-semibold">
                        {t(`Hauptordner ${row.vaultQuantity} · Tauschmappe ${row.tradeQuantity}`, `Main ${row.vaultQuantity} · Trade ${row.tradeQuantity}`)}
                      </span>
                    </p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <select
                          className="field min-h-[38px] flex-1"
                          value={row.variant}
                          aria-label={t('Variante', 'Variant')}
                          onChange={(e) => void run(() => repo().updateItem(row.id, { variant: e.target.value as Variant }))}
                        >
                          {Array.from(new Set([...card.availableVariants, row.variant])).map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                        <select
                          className="field min-h-[38px] flex-1"
                          value={row.condition}
                          aria-label={t('Zustand', 'Condition')}
                          onChange={(e) => void run(() => repo().updateItem(row.id, { condition: e.target.value as Condition }))}
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c} value={c}>
                              {conditionLabel(c, uiLang)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Stepper
                          label={t('Hauptordner', 'Main')}
                          value={row.vaultQuantity}
                          onMinus={() => void run(() => repo().adjust(row.id, 'vault', -1))}
                          onPlus={() => void run(() => repo().adjust(row.id, 'vault', 1))}
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            className="rounded-lg bg-white/[0.06] p-1.5 text-slate-300 hover:bg-white/15 disabled:opacity-30"
                            disabled={row.vaultQuantity <= 0}
                            onClick={() => void run(() => repo().moveCopy(row.id, 'trade'))}
                            aria-label={t('Eine Kopie in die Tauschmappe', 'Move one copy to trade binder')}
                          >
                            <Icon name="arrowRight" className="h-4 w-4" />
                          </button>
                          <button
                            className="rounded-lg bg-white/[0.06] p-1.5 text-slate-300 hover:bg-white/15 disabled:opacity-30"
                            disabled={row.tradeQuantity <= 0}
                            onClick={() => void run(() => repo().moveCopy(row.id, 'vault'))}
                            aria-label={t('Eine Kopie in den Hauptordner', 'Move one copy to main binder')}
                          >
                            <Icon name="arrowLeft" className="h-4 w-4" />
                          </button>
                        </div>
                        <Stepper
                          label={t('Tauschmappe', 'Trade')}
                          value={row.tradeQuantity}
                          onMinus={() => void run(() => repo().adjust(row.id, 'trade', -1))}
                          onPlus={() => void run(() => repo().adjust(row.id, 'trade', 1))}
                        />
                        <button
                          className="rounded-lg p-2 text-ember-400 hover:bg-ember-500/15"
                          onClick={() => {
                            if (window.confirm(t('Diesen Stapel wirklich entfernen?', 'Really remove this stack?'))) void run(() => repo().removeItem(row.id));
                          }}
                          aria-label={t('Stapel entfernen', 'Remove stack')}
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500">{t(`Hinzugefügt am ${formatDate(row.acquiredAt, uiLang)}`, `Added on ${formatDate(row.acquiredAt, uiLang)}`)}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {isViewer ? (
            <button
              className={reservedBy ? 'btn-ghost w-full' : 'btn-primary w-full'}
              onClick={() =>
                void run(async () => {
                  await repo().setReservation(card.id, reservedBy ? null : config?.memberName || t('Familie', 'Family'));
                  toast(reservedBy ? t('Vormerkung entfernt', 'Reservation removed') : t('Als Geschenk vorgemerkt', 'Reserved as a gift'));
                })
              }
            >
              <Icon name="gift" className="h-4 w-4" />
              {reservedBy ? t('Vormerkung aufheben', 'Remove reservation') : t('Als Geschenk vormerken', 'Reserve as a gift')}
            </button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={() => void run(() => repo().addCopy({ cardId: card.id, binder: 'vault', variant: card.availableVariants[0] }))}>
                <Icon name="plus" className="h-4 w-4" /> {t('Hauptordner', 'Main binder')}
              </button>
              <button className="btn-ghost flex-1" onClick={() => void run(() => repo().addCopy({ cardId: card.id, binder: 'trade', variant: card.availableVariants[0] }))}>
                <Icon name="plus" className="h-4 w-4" /> {t('Tauschmappe', 'Trade binder')}
              </button>
            </div>
          )}
          {!isViewer && reservedBy && (
            <button className="w-full text-center text-xs text-slate-500 underline underline-offset-4" onClick={() => void run(() => repo().setReservation(card.id, null))}>
              {t('Geschenk-Vormerkung löschen', 'Clear gift reservation')}
            </button>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>

          {personalScan && (
            <div>
              <p className="eyebrow mb-2">{t('Eigener Scan', 'My scan')}</p>
              <div className="w-28">
                <CardImage src={personalScan} name={card.name} />
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
