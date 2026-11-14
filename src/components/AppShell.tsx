'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { getRepository, useSyncStatus } from '@/lib/storage-adapter';
import { useVaultConfig, type VaultConfig } from '@/lib/vault';
import { Icon, Spinner, Toaster } from './ui';
import VaultOnboarding from './VaultOnboarding';

interface NavItem {
  href: string;
  icon: string;
  label: string;
  /** Shown in the mobile bottom bar (max. five). */
  primary: boolean;
  editorOnly?: boolean;
}

function useNavItems(config: VaultConfig | null): NavItem[] {
  const t = useT();
  const items: NavItem[] = [
    { href: '/', icon: 'home', label: t('Übersicht', 'Dashboard'), primary: true, editorOnly: true },
    { href: '/collection', icon: 'cards', label: t('Sammlung', 'Collection'), primary: true },
    { href: '/scan', icon: 'scan', label: t('Scannen', 'Scan'), primary: true, editorOnly: true },
    { href: '/trade', icon: 'trade', label: t('Tausch', 'Trade'), primary: true, editorOnly: true },
    { href: '/gift', icon: 'gift', label: t('Geschenke', 'Gifts'), primary: true },
    { href: '/import', icon: 'import', label: t('Import', 'Import'), primary: false, editorOnly: true },
    { href: '/guide', icon: 'guide', label: t('Anleitung', 'Guide'), primary: false },
    { href: '/settings', icon: 'settings', label: t('Einstellungen', 'Settings'), primary: false },
  ];
  return config?.role === 'viewer' ? items.filter((i) => !i.editorOnly) : items;
}

function isActive(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

function SyncBadge() {
  const t = useT();
  const status = useSyncStatus();
  if (status.state === 'local') {
    return <span className="chip min-h-[28px] px-2.5 text-[11px]">{t('Lokal', 'Local')}</span>;
  }
  const label =
    status.state === 'syncing' ? t('Sync …', 'Syncing …') : status.state === 'error' ? t('Offline', 'Offline') : t('Synchron', 'Synced');
  return (
    <button
      className={`chip min-h-[28px] gap-1.5 px-2.5 text-[11px] ${status.state === 'error' ? 'border-ember-500/50 text-ember-400' : 'text-mint-400'}`}
      title={status.error ?? undefined}
      onClick={() => void getRepository().sync().catch(() => undefined)}
    >
      {status.state === 'syncing' ? <Spinner className="h-3 w-3" /> : <Icon name="sync" className="h-3 w-3" />}
      {label}
    </button>
  );
}

/** Registers the service worker and keeps remote vaults in sync. */
function useAppServices(config: VaultConfig | null) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => undefined);
  }, []);

  const signature = config ? `${config.vaultId}|${config.driver}|${config.role}` : '';
  useEffect(() => {
    if (!signature) return;
    const repo = getRepository();
    if (!repo.remote) return;
    const run = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void repo.sync().catch(() => undefined);
    };
    run();
    const interval = setInterval(run, 30000);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [signature]);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const config = useVaultConfig();
  const { uiLang } = useSettings();
  const nav = useNavItems(config);
  const t = useT();
  useAppServices(mounted ? config : null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  const isStage = isActive(pathname, '/tutorial-stage');
  const viewerOnForbiddenPage =
    config?.role === 'viewer' && ['/', '/scan', '/trade', '/import', '/settings/share'].some((p) => isActive(pathname, p));

  // Gift viewers land directly on the gift radar.
  useEffect(() => {
    if (mounted && viewerOnForbiddenPage) router.replace('/gift');
  }, [mounted, viewerOnForbiddenPage, router]);

  if (isStage) return <>{children}</>;

  if (!mounted) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!config) {
    return (
      <>
        <VaultOnboarding />
        <Toaster />
      </>
    );
  }

  const fullBleed = isActive(pathname, '/scan');

  return (
    <div className="min-h-dvh md:pl-60 print:!pl-0">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/[0.06] bg-ink-900 px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-volt-400 text-ink-950">
            <Icon name="bolt" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold">{config.name}</p>
            <p className="text-[11px] text-slate-500">
              {config.role === 'viewer' ? t('Geschenk-Ansicht', 'Gift viewer') : 'PokéVault'}
            </p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                  active ? 'bg-volt-400/10 text-volt-300' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-2">
          <SyncBadge />
        </div>
      </aside>

      {/* Mobile top bar */}
      {!fullBleed && (
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-ink-950/90 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-volt-400 text-ink-950">
              <Icon name="bolt" className="h-4 w-4" />
            </div>
            <span className="truncate font-display text-sm font-bold">{config.name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <SyncBadge />
            {nav
              .filter((i) => !i.primary)
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={`rounded-full p-2 ${isActive(pathname, item.href) ? 'text-volt-300' : 'text-slate-400'}`}
                >
                  <Icon name={item.icon} />
                </Link>
              ))}
          </div>
        </header>
      )}

      <main className={fullBleed ? '' : 'mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8 print:!max-w-none print:!p-0'}>
        {viewerOnForbiddenPage ? null : children}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-ink-900/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {nav
            .filter((i) => i.primary)
            .map((item) => {
              const active = isActive(pathname, item.href);
              const isScan = item.href === '/scan';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                    active ? 'text-volt-300' : 'text-slate-500'
                  }`}
                >
                  {isScan ? (
                    <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-volt-400 text-ink-950 shadow-lg shadow-volt-400/20">
                      <Icon name="scan" className="h-6 w-6" />
                    </span>
                  ) : (
                    <Icon name={item.icon} />
                  )}
                  {item.label}
                </Link>
              );
            })}
        </div>
      </nav>
      <Toaster />
    </div>
  );
}
