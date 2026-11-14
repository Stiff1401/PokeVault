'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import CameraScanner from '@/components/CameraScanner';
import { CardImage, CardSearch, Icon, Price, Sheet, Spinner, toast } from '@/components/ui';
import { useVaultData, type CardRecord, type Variant } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { canvasToDataUrl, recognizeCard, type RecognitionResult } from '@/lib/recognition';
import { useSettings } from '@/lib/settings';
import { getRepository, type Binder } from '@/lib/storage-adapter';
import { getCard, type MatchCandidate } from '@/lib/tcg-api';

type Phase = 'idle' | 'recognizing' | 'result' | 'nomatch';

/** Above this match score the hands-free mode commits without a tap. */
const AUTO_COMMIT_SCORE = 0.8;
const AUTO_COMMIT_DELAY_MS = 2600;

export default function ScanPage() {
  const t = useT();
  const settings = useSettings();
  const vault = useVaultData();

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [card, setCard] = useState<CardRecord | null>(null);
  const [variant, setVariant] = useState<Variant>('Normal');
  const [keepScan, setKeepScan] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [session, setSession] = useState<{ card: CardRecord; binder: Binder }[]>([]);
  const captured = useRef<HTMLCanvasElement | null>(null);
  const job = useRef(0);

  const vaultQty = card ? (vault.vaultQtyByCard.get(card.id) ?? 0) : 0;
  const tradeQty = card ? (vault.tradeQtyByCard.get(card.id) ?? 0) : 0;
  const isDuplicate = vaultQty >= 1;
  const primaryBinder: Binder = isDuplicate ? 'trade' : 'vault';

  const reset = useCallback(() => {
    job.current += 1;
    setPhase('idle');
    setResult(null);
    setCard(null);
    setCountdown(null);
    captured.current = null;
  }, []);

  const selectCandidate = useCallback(async (candidate: MatchCandidate, preferred?: Variant | null) => {
    const record = await getCard(candidate.id);
    if (!record) {
      toast(t('Karte konnte nicht geladen werden.', 'Card could not be loaded.'), 'warn');
      return null;
    }
    setCard(record);
    setVariant(preferred && record.availableVariants.includes(preferred) ? preferred : record.availableVariants[0]);
    setPhase('result');
    return record;
  }, [t]);

  const onCapture = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const id = ++job.current;
      captured.current = canvas;
      setPhase('recognizing');
      setCard(null);
      setCountdown(null);
      try {
        const recognition = await recognizeCard(canvas);
        if (id !== job.current) return;
        setResult(recognition);
        const best = recognition.candidates[0];
        if (!best) {
          setPhase('nomatch');
          return;
        }
        const record = await selectCandidate(best, recognition.extraction.variant);
        if (id !== job.current || !record) return;
        if (settings.autoCapture && best.score >= AUTO_COMMIT_SCORE) setCountdown(AUTO_COMMIT_DELAY_MS);
      } catch {
        if (id === job.current) setPhase('nomatch');
      }
    },
    [selectCandidate, settings.autoCapture],
  );

  const commit = useCallback(
    async (binder: Binder) => {
      if (!card) return;
      setCountdown(null);
      try {
        await getRepository().addCopy({
          cardId: card.id,
          binder,
          variant,
          customScanDataUrl: keepScan && captured.current ? canvasToDataUrl(captured.current) : null,
        });
        setSession((list) => [{ card, binder }, ...list].slice(0, 30));
        toast(
          binder === 'trade'
            ? t(`${card.name} → Tauschmappe`, `${card.name} → trade binder`)
            : t(`${card.name} → Hauptordner`, `${card.name} → main binder`),
        );
        reset();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'warn');
      }
    },
    [card, variant, keepScan, reset, t],
  );

  /* Hands-free auto-commit countdown. */
  useEffect(() => {
    if (countdown === null || phase !== 'result') return;
    if (countdown <= 0) {
      void commit(primaryBinder);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 100)), 100);
    return () => clearTimeout(timer);
  }, [countdown, phase, commit, primaryBinder]);

  const paused = phase !== 'idle' || searchOpen;

  return (
    <div className="fixed inset-x-0 bottom-[58px] top-0 md:bottom-0 md:left-60">
      <CameraScanner onCapture={onCapture} paused={paused} />

      {/* Session counter */}
      {session.length > 0 && phase === 'idle' && (
        <Link
          href="/collection"
          className="absolute right-3 top-14 flex items-center gap-2 rounded-full bg-black/60 py-1 pl-1 pr-3 text-xs font-semibold text-white backdrop-blur"
        >
          <span className="h-9 w-[26px] overflow-hidden rounded">
            <CardImage src={session[0].card.imageUrl} name={session[0].card.name} />
          </span>
          {session.length} {t('gescannt', 'scanned')}
        </Link>
      )}

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-3">
        {phase === 'idle' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-black/65 px-4 py-3 backdrop-blur">
            <p className="text-xs text-slate-200">
              {settings.engine === 'vision'
                ? t('Vision-API aktiv – Karte in den Rahmen legen.', 'Vision API active – place the card in the frame.')
                : t('Lokale Erkennung aktiv – Motiv und Sammlernummer zählen.', 'Local recognition active – artwork and collector number count.')}
            </p>
            <button className="btn-ghost shrink-0 bg-white/10 px-3" onClick={() => setSearchOpen(true)}>
              <Icon name="search" className="h-4 w-4" /> {t('Suchen', 'Search')}
            </button>
          </div>
        )}

        {phase === 'recognizing' && (
          <div className="flex items-center gap-3 rounded-2xl bg-ink-900/95 px-4 py-4 backdrop-blur">
            <Spinner />
            <div>
              <p className="text-sm font-semibold">{t('Erkenne Karte …', 'Recognising card …')}</p>
              <p className="text-xs text-slate-400">
                {settings.engine === 'vision'
                  ? t('Vision-API liest die Karte', 'Vision API is reading the card')
                  : t('Beim ersten Mal werden Bild-Index und Texterkennung geladen (ca. 35 MB)', 'Image index and text recognition load on first use (approx. 35 MB)')}
              </p>
            </div>
          </div>
        )}

        {phase === 'nomatch' && (
          <div className="animate-pop rounded-2xl bg-ink-900/95 p-4 backdrop-blur">
            <p className="text-sm font-semibold">{t('Karte nicht erkannt', 'Card not recognised')}</p>
            <p className="mt-1 text-xs text-slate-400">
              {result?.extraction.name || result?.extraction.cardNumber
                ? t(
                    `Gelesen: „${result.extraction.name ?? '–'}" · ${result.extraction.cardNumber ?? '–'}. Kein passender Treffer in TCGdex.`,
                    `Read: "${result.extraction.name ?? '–'}" · ${result.extraction.cardNumber ?? '–'}. No matching card in TCGdex.`,
                  )
                : t('Name und Sammlernummer waren nicht lesbar. Mehr Licht, weniger Spiegelung.', 'Name and collector number were unreadable. More light, less glare.')}
            </p>
            {result?.fallbackReason && <p className="mt-1 text-[11px] text-ember-400">{result.fallbackReason}</p>}
            <div className="mt-3 flex gap-2">
              <button className="btn-primary flex-1" onClick={reset}>
                {t('Erneut scannen', 'Scan again')}
              </button>
              <button className="btn-ghost flex-1" onClick={() => setSearchOpen(true)}>
                <Icon name="search" className="h-4 w-4" /> {t('Manuell suchen', 'Search manually')}
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && card && (
          <div className="animate-pop rounded-2xl bg-ink-900/95 p-4 backdrop-blur">
            <div className="flex gap-3">
              <div className="w-20 shrink-0">
                <CardImage src={card.imageUrl} name={card.name} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold">{card.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {card.setName} · {card.cardNumber}
                    </p>
                  </div>
                  <button onClick={reset} className="rounded-full p-1.5 text-slate-400 hover:bg-white/10" aria-label={t('Verwerfen', 'Discard')}>
                    <Icon name="close" />
                  </button>
                </div>
                <Price value={card.cardmarketTrendEur} className="text-lg font-bold text-volt-300" />
                {isDuplicate && (
                  <p className="mt-0.5 text-xs font-semibold text-mint-400">
                    {t(`Bereits im Hauptordner (x${vaultQty})`, `Already in main binder (x${vaultQty})`)}
                    {tradeQty > 0 && <span className="text-slate-400"> · {t(`Tauschmappe x${tradeQty}`, `trade binder x${tradeQty}`)}</span>}
                  </p>
                )}
                {card.availableVariants.length > 1 && (
                  <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                    {card.availableVariants.map((v) => (
                      <button
                        key={v}
                        className={`chip min-h-[28px] px-2.5 text-[11px] ${variant === v ? 'chip-on' : ''}`}
                        onClick={() => {
                          setVariant(v);
                          setCountdown(null);
                        }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button className="btn-primary relative flex-[1.4] overflow-hidden" onClick={() => void commit(primaryBinder)}>
                {countdown !== null && (
                  <span
                    className="absolute inset-y-0 left-0 bg-black/15"
                    style={{ width: `${100 - (countdown / AUTO_COMMIT_DELAY_MS) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon name="plus" className="h-4 w-4" />
                  {isDuplicate ? t('+1 in Tauschmappe', '+1 to trade binder') : t('+1 Hauptordner', '+1 main binder')}
                </span>
              </button>
              <button className="btn-ghost flex-1" onClick={() => void commit(isDuplicate ? 'vault' : 'trade')}>
                {isDuplicate ? t('+1 Hauptordner', '+1 main binder') : t('+1 Tauschmappe', '+1 trade binder')}
              </button>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-slate-400">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-volt-400" checked={keepScan} onChange={(e) => setKeepScan(e.target.checked)} />
                {t('Eigenen Scan speichern', 'Keep my scan')}
              </label>
              {countdown !== null ? (
                <button className="font-semibold text-volt-300" onClick={() => setCountdown(null)}>
                  {t('Automatik stoppen', 'Stop auto-add')}
                </button>
              ) : (
                <button className="font-semibold text-slate-200 underline underline-offset-4" onClick={() => setSearchOpen(true)}>
                  {t('Falsche Karte?', 'Wrong card?')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title={t('Karte auswählen', 'Pick a card')}>
        {result && result.candidates.length > 1 && (
          <div className="mb-5">
            <p className="eyebrow mb-2">{t('Weitere Treffer', 'Other matches')}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {result.candidates.map((c) => (
                <button
                  key={c.id}
                  className="min-w-0 text-left"
                  onClick={() => {
                    setSearchOpen(false);
                    setCountdown(null);
                    void selectCandidate(c, result.extraction.variant);
                  }}
                >
                  <CardImage src={c.image} name={c.name} />
                  <p className="mt-1 truncate text-[11px] font-semibold">{c.name}</p>
                  <p className="truncate text-[10px] text-slate-500">
                    {c.setName} · {Math.round(c.score * 100)} %
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
        <CardSearch
          autoFocus
          onPick={(c) => {
            setSearchOpen(false);
            setCountdown(null);
            void selectCandidate(c);
          }}
        />
      </Sheet>
    </div>
  );
}
