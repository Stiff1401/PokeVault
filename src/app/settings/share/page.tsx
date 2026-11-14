'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, Icon, PageHeader, toast } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { buildInvite, inviteUrl, useVaultConfig, type VaultConfig, type VaultRole } from '@/lib/vault';

function InviteCard({ config, role }: { config: VaultConfig; role: VaultRole }) {
  const t = useT();
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const pin = role === 'editor' ? config.pin : config.viewerPin;
  const url = pin ? inviteUrl(buildInvite(config, role)) : '';

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 560, color: { dark: '#0a0c12', light: '#ffffff' } }))
      .then((dataUrl) => !cancelled && setQr(dataUrl))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('Einladungslink kopiert', 'Invite link copied'));
    } catch {
      toast(t('Kopieren nicht möglich – Link bitte manuell markieren.', 'Copy failed – please select the link manually.'), 'warn');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: config.name, text: t(`Einladung zu ${config.name}`, `Invitation to ${config.name}`), url });
    } catch {
      /* user closed the share sheet */
    }
  };

  const isEditor = role === 'editor';

  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className={`rounded-xl p-2.5 ${isEditor ? 'bg-volt-400/15 text-volt-300' : 'bg-mint-400/15 text-mint-400'}`}>
          <Icon name={isEditor ? 'cards' : 'gift'} />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold">{isEditor ? t('Mit-Bearbeiter', 'Co-editor') : t('Geschenke & Wunschliste', 'Gifts & wishlist')}</h2>
          <p className="text-sm text-slate-400">
            {isEditor
              ? t('Voller Lese- und Schreibzugriff: Booster scannen, Bestände ändern, tauschen. Für Co-Eltern oder Partner.', 'Full read/write access: scan boosters, change quantities, trade. For co-parents or partners.')
              : t('Nur lesen: Wunschliste, Booster-Berater und diskrete Geschenk-Vormerkung. Für Großeltern und Verwandte.', 'Read-only: wishlist, booster advisor and discreet gift reservations. For grandparents and relatives.')}
          </p>
        </div>
      </div>

      {!pin ? (
        <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-400">
          {t('Dieses Gerät kennt die PIN für diese Rolle nicht. Bitte die Einladung vom Gerät erstellen, das den Vault angelegt hat.', 'This device does not know the PIN for this role. Please create the invite on the device that created the vault.')}
        </p>
      ) : (
        <>
          <div className="mx-auto mb-4 w-full max-w-[240px] overflow-hidden rounded-2xl bg-white p-2">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={t('QR-Code der Einladung', 'Invite QR code')} className="block w-full" />
            ) : (
              <div className="aspect-square w-full animate-pulse rounded-xl bg-slate-200" />
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => void copy()}>
              {t('Link kopieren', 'Copy link')}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button className="btn-ghost flex-1" onClick={() => void share()}>
                <Icon name="share" className="h-4 w-4" /> {t('Teilen', 'Share')}
              </button>
            )}
          </div>

          <button className="mt-4 text-xs text-slate-400 underline underline-offset-4" onClick={() => setRevealed((r) => !r)} aria-expanded={revealed}>
            {revealed ? t('Vault-ID & PIN verbergen', 'Hide vault ID & PIN') : t('Vault-ID & PIN für manuellen Beitritt anzeigen', 'Show vault ID & PIN for manual joining')}
          </button>
          {revealed && (
            <dl className="mt-3 space-y-2 rounded-xl bg-ink-800 p-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">Vault-ID</dt>
                <dd className="select-all break-all font-mono text-xs">{config.vaultId}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">PIN</dt>
                <dd className="select-all font-mono tracking-widest">{pin}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{config.driver === 'supabase' ? 'Supabase URL' : t('Server-URL', 'Server URL')}</dt>
                <dd className="select-all break-all font-mono text-xs">{config.driver === 'supabase' ? config.supabaseUrl : config.endpoint}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </section>
  );
}

export default function SharePage() {
  const t = useT();
  const config = useVaultConfig();
  if (!config) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400">
        <Icon name="arrowLeft" className="h-4 w-4" /> {t('Einstellungen', 'Settings')}
      </Link>
      <PageHeader title={t('Vault teilen', 'Share vault')} subtitle={t('Einladung per Link oder QR-Code – die Rolle steckt in der Einladung', 'Invite via link or QR code – the role is part of the invite')} />

      {config.driver === 'local' ? (
        <EmptyState
          icon="sync"
          title={t('Dieser Vault lebt nur auf diesem Gerät', 'This vault lives on this device only')}
          text={t(
            'Zum Teilen braucht der Vault einen Sync-Speicher: einen eigenen PokéVault-Server oder ein kostenloses Supabase-Projekt. Das richtest du in den Einstellungen unter „Familien-Sync aktivieren" ein.',
            'Sharing needs a sync store: your own PokéVault server or a free Supabase project. Set it up in the settings under "Enable family sync".',
          )}
          action={
            <Link href="/settings" className="btn-primary">
              {t('Zu den Einstellungen', 'Open settings')}
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <InviteCard config={config} role="editor" />
            <InviteCard config={config} role="viewer" />
          </div>
          <p className="mt-5 flex gap-2 text-xs leading-relaxed text-slate-500">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
            {t(
              'Jeder mit dem Link erhält den jeweiligen Zugriff. Teile Einladungen nur mit Menschen, denen du vertraust – am besten direkt per QR-Code.',
              'Anyone with the link gets the respective access. Only share invites with people you trust – ideally straight via QR code.',
            )}
          </p>
        </>
      )}
    </div>
  );
}
