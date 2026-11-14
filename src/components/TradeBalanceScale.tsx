'use client';

import { useMemo, useState } from 'react';
import type { CardRecord, OwnedEntry } from '@/lib/db';
import { formatEur, useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';
import { getCard } from '@/lib/tcg-api';
import { CardImage, CardSearch, Icon, Price, Sheet, toast } from './ui';

/** Trades inside this relative difference count as fair. */
const FAIR_TOLERANCE = 0.15;

interface ReceiveLine {
  card: CardRecord;
  quantity: number;
}

function QuantityButtons({ value, max, onChange, name }: { value: number; max?: number; onChange: (next: number) => void; name: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button className="rounded-lg bg-white/[0.06] p-1.5 hover:bg-white/15" onClick={() => onChange(value - 1)} aria-label={`${name} −1`}>
        <Icon name="minus" className="h-3.5 w-3.5" />
      </button>
      <span className="tabular w-5 text-center text-sm font-bold">{value}</span>
      <button
        className="rounded-lg bg-white/[0.06] p-1.5 hover:bg-white/15 disabled:opacity-30"
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={`${name} +1`}
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Live two-column trade calculator for in-person trade events.
 * Left: cards from the own trade binder. Right: cards offered by the partner.
 */
export default function TradeBalanceScale({ tradeEntries, wishlist }: { tradeEntries: OwnedEntry[]; wishlist: CardRecord[] }) {
  const t = useT();
  const { uiLang } = useSettings();
  const [give, setGive] = useState<Map<string, number>>(new Map());
  const [receive, setReceive] = useState<ReceiveLine[]>([]);
  const [pickGive, setPickGive] = useState(false);
  const [pickReceive, setPickReceive] = useState(false);
  const [busy, setBusy] = useState(false);

  const entryById = useMemo(() => new Map(tradeEntries.map((e) => [e.item.id, e])), [tradeEntries]);

  // Drop selections whose stock vanished (e.g. through sync).
  const giveLines = useMemo(
    () =>
      Array.from(give.entries())
        .map(([itemId, quantity]) => ({ entry: entryById.get(itemId), quantity }))
        .filter((l): l is { entry: OwnedEntry; quantity: number } => Boolean(l.entry) && l.quantity > 0)
        .map((l) => ({ ...l, quantity: Math.min(l.quantity, l.entry.item.tradeQuantity) })),
    [give, entryById],
  );

  const giveSum = giveLines.reduce((sum, l) => sum + (l.entry.card.cardmarketTrendEur ?? 0) * l.quantity, 0);
  const receiveSum = receive.reduce((sum, l) => sum + (l.card.cardmarketTrendEur ?? 0) * l.quantity, 0);
  const difference = receiveSum - giveSum;
  const reference = Math.max(giveSum, receiveSum);
  const hasBoth = giveLines.length > 0 && receive.length > 0;
  const fair = hasBoth && (reference === 0 || Math.abs(difference) / reference <= FAIR_TOLERANCE);
  // Beam tilts towards the heavier side, max. 12°.
  const tilt = reference > 0 ? Math.max(-12, Math.min(12, (difference / reference) * 24)) : 0;

  const setGiveQuantity = (itemId: string, quantity: number) => {
    setGive((current) => {
      const next = new Map(current);
      if (quantity <= 0) next.delete(itemId);
      else next.set(itemId, quantity);
      return next;
    });
  };

  const addReceive = (card: CardRecord) => {
    setReceive((current) => {
      const existing = current.find((l) => l.card.id === card.id);
      if (existing) return current.map((l) => (l.card.id === card.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...current, { card, quantity: 1 }];
    });
  };

  const setReceiveQuantity = (cardId: string, quantity: number) => {
    setReceive((current) => (quantity <= 0 ? current.filter((l) => l.card.id !== cardId) : current.map((l) => (l.card.id === cardId ? { ...l, quantity } : l))));
  };

  const confirm = async () => {
    if (!hasBoth) return;
    setBusy(true);
    try {
      await getRepository().applyTrade(
        giveLines.map((l) => ({ itemId: l.entry.item.id, quantity: l.quantity })),
        receive.map((l) => ({ cardId: l.card.id, quantity: l.quantity })),
      );
      toast(t('Tausch verbucht – Bestände aktualisiert', 'Trade booked – quantities updated'));
      setGive(new Map());
      setReceive([]);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const availableWishlist = wishlist.filter((w) => !receive.some((r) => r.card.id === w.id)).slice(0, 12);

  return (
    <div>
      {/* Scale */}
      <div className="panel mb-4 p-4">
        <svg viewBox="0 0 320 120" className="mx-auto block h-28 w-full max-w-sm" role="img" aria-label={t('Tausch-Waage', 'Trade scale')}>
          <rect x="156" y="34" width="8" height="70" rx="4" fill="#323a4f" />
          <rect x="120" y="102" width="80" height="8" rx="4" fill="#323a4f" />
          <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '160px 34px', transition: 'transform .45s cubic-bezier(.3,1.4,.5,1)' }}>
            <rect x="40" y="31" width="240" height="6" rx="3" fill={fair ? '#3ddc97' : '#ffd60a'} />
            <line x1="52" y1="36" x2="52" y2="62" stroke="#64748b" strokeWidth="2" />
            <line x1="268" y1="36" x2="268" y2="62" stroke="#64748b" strokeWidth="2" />
            <path d="M22 62h60a30 14 0 0 1-60 0Z" fill="#222838" stroke="#64748b" strokeWidth="1.5" />
            <path d="M238 62h60a30 14 0 0 1-60 0Z" fill="#222838" stroke="#64748b" strokeWidth="1.5" />
          </g>
          <circle cx="160" cy="34" r="7" fill="#0a0c12" stroke={fair ? '#3ddc97' : '#ffd60a'} strokeWidth="3" />
        </svg>
        <div className="grid grid-cols-3 items-end text-center">
          <div>
            <p className="eyebrow">{t('Ich gebe ab', 'I give')}</p>
            <p className="tabular font-display text-xl font-bold">{formatEur(giveSum, uiLang)}</p>
          </div>
          <div>
            {!hasBoth ? (
              <p className="text-xs text-slate-500">{t('Beide Seiten füllen', 'Fill both sides')}</p>
            ) : fair ? (
              <p className="rounded-full bg-mint-400/15 px-2 py-1 text-xs font-bold text-mint-400">{t('Fairer Tausch', 'Fair trade')}</p>
            ) : (
              <p className="rounded-full bg-volt-400/15 px-2 py-1 text-xs font-bold text-volt-300">
                {difference > 0 ? t('Vorteil für dich', 'In your favour') : t('Vorteil Partner', "In partner's favour")}
              </p>
            )}
            <p className={`tabular mt-1 text-sm font-semibold ${difference >= 0 ? 'text-mint-400' : 'text-ember-400'}`}>
              {difference >= 0 ? '+' : '−'}
              {formatEur(Math.abs(difference), uiLang)}
            </p>
          </div>
          <div>
            <p className="eyebrow">{t('Ich bekomme', 'I get')}</p>
            <p className="tabular font-display text-xl font-bold">{formatEur(receiveSum, uiLang)}</p>
          </div>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="space-y-2">
            {giveLines.map(({ entry, quantity }) => (
              <div key={entry.item.id} className="panel flex items-center gap-2 p-2">
                <div className="w-9 shrink-0">
                  <CardImage src={entry.card.imageUrl} name={entry.card.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{entry.card.name}</p>
                  <Price value={entry.card.cardmarketTrendEur} className="text-[11px] text-slate-400" />
                </div>
                <QuantityButtons value={quantity} max={entry.item.tradeQuantity} name={entry.card.name} onChange={(next) => setGiveQuantity(entry.item.id, next)} />
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 w-full" onClick={() => setPickGive(true)} disabled={tradeEntries.length === 0}>
            <Icon name="plus" className="h-4 w-4" /> {t('Aus Tauschmappe', 'From trade binder')}
          </button>
          {tradeEntries.length === 0 && <p className="mt-2 text-center text-[11px] text-slate-500">{t('Deine Tauschmappe ist leer.', 'Your trade binder is empty.')}</p>}
        </div>

        <div className="min-w-0">
          <div className="space-y-2">
            {receive.map((line) => (
              <div key={line.card.id} className="panel flex items-center gap-2 p-2">
                <div className="w-9 shrink-0">
                  <CardImage src={line.card.imageUrl} name={line.card.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{line.card.name}</p>
                  <Price value={line.card.cardmarketTrendEur} className="text-[11px] text-slate-400" />
                </div>
                <QuantityButtons value={line.quantity} name={line.card.name} onChange={(next) => setReceiveQuantity(line.card.id, next)} />
              </div>
            ))}
          </div>
          <button className="btn-ghost mt-2 w-full" onClick={() => setPickReceive(true)}>
            <Icon name="search" className="h-4 w-4" /> {t('Karte suchen', 'Find card')}
          </button>
        </div>
      </div>

      <button className="btn-primary mt-5 w-full" disabled={!hasBoth || busy} onClick={() => void confirm()}>
        <Icon name="check" className="h-4 w-4" /> {t('Tausch bestätigen & verbuchen', 'Confirm & book trade')}
      </button>
      {hasBoth && (
        <button
          className="mt-2 w-full text-center text-xs text-slate-500 underline underline-offset-4"
          onClick={() => {
            setGive(new Map());
            setReceive([]);
          }}
        >
          {t('Waage leeren', 'Clear scale')}
        </button>
      )}

      <Sheet open={pickGive} onClose={() => setPickGive(false)} title={t('Aus der Tauschmappe abgeben', 'Give from trade binder')}>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {tradeEntries.map((entry) => {
            const selected = give.get(entry.item.id) ?? 0;
            return (
              <button
                key={entry.item.id}
                className="relative min-w-0 text-left disabled:opacity-40"
                disabled={selected >= entry.item.tradeQuantity}
                onClick={() => setGiveQuantity(entry.item.id, selected + 1)}
              >
                <CardImage src={entry.card.imageUrl} name={entry.card.name} />
                <span className="tabular absolute left-1 top-1 rounded bg-ink-950/85 px-1 text-[10px] font-bold">
                  {selected}/{entry.item.tradeQuantity}
                </span>
                <p className="mt-1 truncate text-[11px] font-semibold">{entry.card.name}</p>
                <Price value={entry.card.cardmarketTrendEur} className="text-[10px] text-volt-300" />
              </button>
            );
          })}
        </div>
        <button className="btn-primary mt-4 w-full" onClick={() => setPickGive(false)}>
          {t('Fertig', 'Done')}
        </button>
      </Sheet>

      <Sheet open={pickReceive} onClose={() => setPickReceive(false)} title={t('Karte vom Tauschpartner', 'Card from trade partner')}>
        {availableWishlist.length > 0 && (
          <div className="mb-5">
            <p className="eyebrow mb-2">{t('Von deiner Wunschliste', 'From your wishlist')}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {availableWishlist.map((card) => (
                <button
                  key={card.id}
                  className="min-w-0 text-left"
                  onClick={() => {
                    addReceive(card);
                    setPickReceive(false);
                  }}
                >
                  <CardImage src={card.imageUrl} name={card.name} />
                  <p className="mt-1 truncate text-[11px] font-semibold">{card.name}</p>
                  <Price value={card.cardmarketTrendEur} className="text-[10px] text-volt-300" />
                </button>
              ))}
            </div>
          </div>
        )}
        <CardSearch
          autoFocus
          onPick={async (candidate) => {
            const card = await getCard(candidate.id);
            if (!card) {
              toast(t('Karte konnte nicht geladen werden.', 'Card could not be loaded.'), 'warn');
              return;
            }
            addReceive(card);
            setPickReceive(false);
          }}
        />
      </Sheet>
    </div>
  );
}
