'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CardRecord } from '@/lib/db';
import { formatEur, useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { cardImage, searchCards, type MatchCandidate } from '@/lib/tcg-api';

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const ICON_PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  cards: 'M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.500 18V6A1.5 1.5 0 0 1 7 4.5ZM9 8.500h6M9 12h6',
  scan: 'M4 8V5.500A1.5 1.5 0 0 1 5.500 4H8M16 4h2.500A1.5 1.5 0 0 1 20 5.500V8M20 16v2.500a1.5 1.5 0 0 1-1.500 1.500H16M8 20H5.500A1.5 1.5 0 0 1 4 18.500V16M8 12h8',
  trade: 'M4 8h13l-3-3M20 16H7l3 3',
  gift: 'M4 11h16v9H4zM3 7.500h18V11H3zM12 7.500V20M12 7.500C10 7.500 8 6.500 8 5s2-1.500 4 2.500c2-4 4-4 4-2.500s-2 2.500-4 2.500Z',
  import: 'M12 4v10m0 0-4-4m4 4 4-4M4.500 16v3.500h15V16',
  guide: 'M5 5.500A1.500 1.500 0 0 1 6.500 4H19v14H6.500A1.500 1.500 0 0 0 5 19.500v-14ZM5 19.500A1.500 1.500 0 0 0 6.500 21H19M9 8.500h6',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19 12a7 7 0 0 0-.100-1.200l2-1.500-2-3.400-2.300.900a7 7 0 0 0-2-1.200L14.200 3h-4.400l-.400 2.600a7 7 0 0 0-2 1.200l-2.300-.900-2 3.400 2 1.500a7 7 0 0 0 0 2.400l-2 1.500 2 3.400 2.300-.900a7 7 0 0 0 2 1.200l.400 2.600h4.400l.400-2.600a7 7 0 0 0 2-1.200l2.300.900 2-3.400-2-1.500c.070-.400.100-.800.100-1.200Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16.500 16.500 20 20',
  check: 'M5 12.500 10 17.500 19 7',
  trash: 'M5 7h14M9.500 7V4.500h5V7M7 7l.800 12.500h8.400L17 7',
  pin: 'M12 3l2.500 5.500 6 .700-4.500 4.100 1.300 5.900L12 16.200 6.700 19.200 8 13.300 3.500 9.200l6-.700L12 3Z',
  arrowRight: 'M5 12h14m0 0-5-5m5 5-5 5',
  arrowLeft: 'M19 12H5m0 0 5-5m-5 5 5 5',
  sync: 'M4 12a8 8 0 0 1 13.700-5.600L20 8.500M20 4v4.500h-4.500M20 12a8 8 0 0 1-13.700 5.600L4 15.500M4 20v-4.500h4.500',
  share: 'M12 15V4m0 0L8 8m4-4 4 4M5 13v6.500h14V13',
  print: 'M7 9V4h10v5M7 17H4.500V9h15v8H17M7 14h10v6H7z',
  camera: 'M4 8.500A1.500 1.500 0 0 1 5.500 7H8l1.500-2.500h5L16 7h2.500A1.500 1.500 0 0 1 20 8.500v9A1.500 1.500 0 0 1 18.500 19h-13A1.500 1.500 0 0 1 4 17.500v-9ZM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  bolt: 'M13 3 5 13.500h6L10 21l8-10.500h-6L13 3Z',
  scale: 'M12 4v16M7 20h10M5 8h14M5 8l-2.500 6a3 3 0 0 0 5 0L5 8Zm14 0-2.500 6a3 3 0 0 0 5 0L19 8Z',
  eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12ZM12 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5Z',
  upload: 'M12 16V5m0 0L8 9m4-4 4 4M4.500 16v3.500h15V16',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M4.500 16v3.500h15V16',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v5.500M12 7.500v.500',
};

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof ICON_PATHS | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name] ?? ICON_PATHS.info} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn';
}

let toasts: Toast[] = [];
let toastId = 0;
const toastListeners = new Set<() => void>();

export function toast(text: string, tone: 'ok' | 'warn' = 'ok'): void {
  const id = ++toastId;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  }, 3200);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-8" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={`animate-pop pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium shadow-xl ${
            t.tone === 'ok' ? 'bg-mint-400 text-ink-950' : 'bg-ember-500 text-white'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon = 'cards', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-white/[0.05] p-3 text-slate-400">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-400">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ percent, tone = 'volt' }: { percent: number; tone?: 'volt' | 'mint' }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${tone === 'mint' ? 'bg-mint-400' : 'bg-volt-400'}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-ink-900 p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`min-h-[40px] flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition ${
            value === tab.id ? 'bg-volt-400 text-ink-950' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          {tab.label}
          {tab.badge ? <span className="tabular ml-1.5 opacity-70">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`chip ${active ? 'chip-on' : ''}`}>
      {children}
    </button>
  );
}

/** Bottom sheet on mobile, centred dialog on desktop. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className={`animate-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-white/10 bg-ink-900 md:rounded-3xl ${wide ? 'md:max-w-4xl' : 'md:max-w-lg'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <h2 className="min-w-0 truncate font-display text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="safe-bottom overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card visuals                                                        */
/* ------------------------------------------------------------------ */

export function CardImage({ src, name, quality = 'low', className = '' }: { src: string | null | undefined; name: string; quality?: 'low' | 'high'; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = src?.startsWith('data:') ? src : cardImage(src, quality);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div className={`flex aspect-card w-full items-center justify-center rounded-[4.5%] border border-white/10 bg-gradient-to-br from-ink-700 to-ink-800 p-2 text-center ${className}`}>
        <span className="line-clamp-3 text-[11px] font-medium text-slate-400">{name}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`aspect-card w-full rounded-[4.5%] bg-ink-800 object-cover ${className}`}
    />
  );
}

export function Price({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  const { uiLang } = useSettings();
  return <span className={`tabular ${className}`}>{formatEur(value, uiLang)}</span>;
}

export interface CardTileProps {
  card: Pick<CardRecord, 'id' | 'name' | 'imageUrl'> & Partial<CardRecord>;
  onClick?: () => void;
  /** Top-left badges, e.g. quantities. */
  badges?: ReactNode;
  footer?: ReactNode;
  dim?: boolean;
  showPrice?: boolean;
}

export function CardTile({ card, onClick, badges, footer, dim, showPrice = true }: CardTileProps) {
  const body = (
    <>
      <div className={`relative ${dim ? 'opacity-45 grayscale' : ''}`}>
        <CardImage src={card.imageUrl} name={card.name} />
        {badges && <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">{badges}</div>}
      </div>
      <div className="mt-1.5 min-w-0 px-0.5 text-left">
        <p className="truncate text-xs font-semibold">{card.name}</p>
        <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
          <span className="truncate">{card.cardNumber ?? ''}</span>
          {showPrice && <Price value={card.cardmarketTrendEur} className="shrink-0 font-semibold text-volt-300" />}
        </div>
      </div>
    </>
  );
  return (
    <div className="min-w-0">
      {onClick ? (
        <button type="button" onClick={onClick} className="block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-volt-400">
          {body}
        </button>
      ) : (
        body
      )}
      {footer}
    </div>
  );
}

export function Badge({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'volt' | 'mint' | 'ember' }) {
  const tones = {
    dark: 'bg-ink-950/85 text-white',
    volt: 'bg-volt-400 text-ink-950',
    mint: 'bg-mint-400 text-ink-950',
    ember: 'bg-ember-500 text-white',
  };
  return <span className={`tabular rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow ${tones[tone]}`}>{children}</span>;
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* TCGdex card search                                                  */
/* ------------------------------------------------------------------ */

export function CardSearch({
  onPick,
  placeholder,
  autoFocus,
}: {
  onPick: (candidate: MatchCandidate) => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);

  // A double tap must not add the same card twice.
  const pick = async (candidate: MatchCandidate) => {
    if (picking) return;
    setPicking(true);
    try {
      await onPick(candidate);
    } finally {
      setPicking(false);
    }
  };

  useEffect(() => {
    const text = query.trim();
    setFailed(false);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      searchCards(text)
        .then((found) => !cancelled && setResults(found))
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => !cancelled && setBusy(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          className="field pl-9"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? t('Kartenname oder Nummer (z. B. 199/165)', 'Card name or number (e.g. 199/165)')}
          inputMode="search"
        />
      </div>
      {busy && <p className="mt-2 text-xs text-slate-500">{t('Suche in TCGdex …', 'Searching TCGdex …')}</p>}
      {!busy && failed && (
        <p className="mt-2 text-xs text-ember-400" role="alert">
          {t('TCGdex ist gerade nicht erreichbar – bitte erneut versuchen.', 'TCGdex is not reachable right now – please try again.')}
        </p>
      )}
      {!busy && !failed && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">{t('Keine Treffer.', 'No matches.')}</p>
      )}
      {results.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {results.map((c) => (
            <button key={c.id} type="button" onClick={() => void pick(c)} disabled={picking} className="min-w-0 rounded-lg text-left hover:opacity-80 disabled:opacity-50">
              <CardImage src={c.image} name={c.name} />
              <p className="mt-1 truncate text-[11px] font-semibold">{c.name}</p>
              <p className="truncate text-[10px] text-slate-500">
                {c.setName} · {c.localId}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-volt-400 ${className}`} role="status" aria-label="Loading" />;
}
