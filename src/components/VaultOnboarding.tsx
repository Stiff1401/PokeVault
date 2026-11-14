'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { updateSettings, useSettings } from '@/lib/settings';
import { createTransport, registerRemoteVault } from '@/lib/storage-adapter';
import {
  appBaseUrl,
  configFromInvite,
  createVaultConfig,
  parseInvite,
  saveVaultConfig,
  type InvitePayload,
  type VaultConfig,
  type VaultDriver,
} from '@/lib/vault';
import { Icon, Spinner } from './ui';

type Step = 'choose' | 'create' | 'join';

const SELFHOST_BUILD = process.env.NEXT_PUBLIC_SELFHOST === '1';

/** Live QR scanner (jsQR on a canvas) used for invite codes. */
function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const { default: jsQR } = await import('jsqr');
        const tick = () => {
          const video = videoRef.current;
          if (stopped || !video) return;
          if (video.videoWidth) {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(image.data, image.width, image.height);
              if (code?.data) {
                onResult(code.data);
                return;
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError(t('Kamera nicht verfügbar. Bitte den Einladungslink einfügen.', 'Camera unavailable. Please paste the invite link.'));
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult, t]);

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
      {error ? (
        <p className="p-4 text-sm text-ember-400">{error}</p>
      ) : (
        <video ref={videoRef} className="aspect-square w-full object-cover" playsInline muted />
      )}
      <button type="button" className="btn-ghost w-full rounded-none border-0 border-t border-white/10" onClick={onClose}>
        {t('Scanner schließen', 'Close scanner')}
      </button>
    </div>
  );
}

export default function VaultOnboarding() {
  const t = useT();
  const { uiLang } = useSettings();
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // create
  const [name, setName] = useState('');
  const [driver, setDriver] = useState<VaultDriver>('local');
  const [endpoint, setEndpoint] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');

  // join
  const [inviteText, setInviteText] = useState('');
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [memberName, setMemberName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState('');
  const [manualPin, setManualPin] = useState('');
  const [manualDriver, setManualDriver] = useState<VaultDriver>('selfhosted');

  useEffect(() => {
    if (SELFHOST_BUILD) setEndpoint(appBaseUrl());
    const fromHash = parseInvite(window.location.hash);
    if (fromHash) {
      setInvite(fromHash);
      setInviteText(window.location.href);
      setStep('join');
    }
  }, []);

  const applyInviteText = useCallback((text: string) => {
    setInviteText(text);
    const parsed = parseInvite(text);
    setInvite(parsed);
    setError(null);
    return parsed;
  }, []);

  const finish = (config: VaultConfig) => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    saveVaultConfig(config);
  };

  const createVault = async () => {
    setError(null);
    if (driver === 'selfhosted' && !/^https?:\/\//.test(endpoint.trim())) {
      setError(t('Bitte die Server-URL angeben (https://…).', 'Please enter the server URL (https://…).'));
      return;
    }
    if (driver === 'supabase' && (!/^https?:\/\//.test(supabaseUrl.trim()) || supabaseKey.trim().length < 20)) {
      setError(t('Bitte Supabase-URL und Anon Key angeben.', 'Please enter the Supabase URL and anon key.'));
      return;
    }
    setBusy(true);
    try {
      const config = createVaultConfig({
        name: name || t('Mein PokéVault', 'My PokéVault'),
        driver,
        endpoint,
        supabaseUrl,
        supabaseAnonKey: supabaseKey,
      });
      if (driver !== 'local') await registerRemoteVault(config);
      finish(config);
    } catch (err) {
      setError(
        `${t('Sync-Backend nicht erreichbar oder nicht eingerichtet', 'Sync backend unreachable or not set up')}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setBusy(false);
    }
  };

  const joinVault = async () => {
    setError(null);
    let payload = invite;
    if (manual) {
      if (!manualId.trim() || !manualPin.trim()) {
        setError(t('Vault-ID und PIN werden benötigt.', 'Vault ID and PIN are required.'));
        return;
      }
      payload = {
        v: 1,
        i: manualId.trim(),
        n: '',
        r: 'viewer',
        d: manualDriver,
        p: manualPin.trim().toUpperCase(),
        e: endpoint.trim(),
        u: supabaseUrl.trim(),
        k: supabaseKey.trim(),
      };
    }
    if (!payload) {
      setError(t('Der Einladungslink ist ungültig.', 'The invite link is invalid.'));
      return;
    }
    setBusy(true);
    try {
      // The backend decides the role from the PIN – verify before saving.
      let config = configFromInvite(payload, memberName);
      const transport = await createTransport(config);
      const probe = await transport.pull(new Date().toISOString());
      config = { ...config, role: probe.role, name: probe.vaultName || config.name };
      if (probe.role === 'editor' && !payload.vp) config.viewerPin = '';
      finish(config);
    } catch (err) {
      setError(
        `${t('Beitritt fehlgeschlagen – PIN oder Adresse prüfen', 'Could not join – check PIN and address')}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setBusy(false);
    }
  };

  const backendFields = (current: VaultDriver) => (
    <>
      {current === 'selfhosted' && (
        <div>
          <label className="label" htmlFor="pv-endpoint">
            {t('Server-URL', 'Server URL')}
          </label>
          <input id="pv-endpoint" className="field" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://vault.example.com" inputMode="url" />
        </div>
      )}
      {current === 'supabase' && (
        <>
          <div>
            <label className="label" htmlFor="pv-sb-url">
              Supabase URL
            </label>
            <input id="pv-sb-url" className="field" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://xxxx.supabase.co" inputMode="url" />
          </div>
          <div>
            <label className="label" htmlFor="pv-sb-key">
              Supabase Anon Key
            </label>
            <input id="pv-sb-key" className="field" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} placeholder="eyJhbGciOi…" autoComplete="off" />
          </div>
        </>
      )}
    </>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-volt-400 text-ink-950">
            <Icon name="bolt" className="h-6 w-6" />
          </div>
          <span className="font-display text-xl font-bold">PokéVault</span>
        </div>
        <button className="chip" onClick={() => updateSettings({ uiLang: uiLang === 'de' ? 'en' : 'de' })}>
          {uiLang === 'de' ? 'English' : 'Deutsch'}
        </button>
      </div>

      {step === 'choose' && (
        <div className="animate-pop">
          <h1 className="font-display text-3xl font-bold leading-tight">{t('Deine Sammlung. Dein Gerät.', 'Your collection. Your device.')}</h1>
          <p className="mb-7 mt-2 text-sm text-slate-400">
            {t(
              'Scannen, sortieren, tauschen und Werte verfolgen – alles bleibt lokal in deinem Browser. Kein Konto nötig.',
              'Scan, sort, trade and track values – everything stays local in your browser. No account needed.',
            )}
          </p>
          <button className="panel mb-3 flex w-full items-center gap-4 p-5 text-left transition hover:border-volt-400/60" onClick={() => setStep('create')}>
            <span className="rounded-xl bg-volt-400/15 p-3 text-volt-300">
              <Icon name="plus" className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-semibold">{t('Neuen PokéVault starten', 'Start a new PokéVault')}</span>
              <span className="text-sm text-slate-400">{t('Für deine eigene Sammlung', 'For your own collection')}</span>
            </span>
          </button>
          <button className="panel flex w-full items-center gap-4 p-5 text-left transition hover:border-volt-400/60" onClick={() => setStep('join')}>
            <span className="rounded-xl bg-white/[0.06] p-3 text-slate-300">
              <Icon name="share" className="h-6 w-6" />
            </span>
            <span>
              <span className="block font-semibold">{t('Bestehendem Vault beitreten', 'Join an existing vault')}</span>
              <span className="text-sm text-slate-400">{t('Per Einladungslink, QR-Code oder PIN', 'Via invite link, QR code or PIN')}</span>
            </span>
          </button>
        </div>
      )}

      {step === 'create' && (
        <div className="animate-pop space-y-4">
          <button className="flex items-center gap-1 text-sm text-slate-400" onClick={() => setStep('choose')}>
            <Icon name="arrowLeft" className="h-4 w-4" /> {t('Zurück', 'Back')}
          </button>
          <h1 className="font-display text-2xl font-bold">{t('Neuen PokéVault starten', 'Start a new PokéVault')}</h1>
          <div>
            <label className="label" htmlFor="pv-name">
              {t('Name des Vaults', 'Vault name')}
            </label>
            <input id="pv-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('z. B. Jacks PokéVault', "e.g. Jack's PokéVault")} autoFocus />
          </div>
          <fieldset>
            <legend className="label">{t('Speicherort', 'Storage')}</legend>
            <div className="space-y-2">
              {(
                [
                  ['local', t('Nur auf diesem Gerät', 'This device only'), t('Kein Server, keine Kosten. Backup per Export.', 'No server, no cost. Backup via export.')],
                  ['selfhosted', t('Eigener Server (Docker)', 'Self-hosted server (Docker)'), t('Sync für die Familie über deinen PokéVault-Server.', 'Family sync through your own PokéVault server.')],
                  ['supabase', 'Supabase', t('Sync über ein kostenloses Supabase-Projekt.', 'Sync through a free Supabase project.')],
                ] as [VaultDriver, string, string][]
              ).map(([id, title, text]) => (
                <label key={id} className={`panel flex cursor-pointer items-start gap-3 p-3.5 ${driver === id ? 'border-volt-400/70' : ''}`}>
                  <input type="radio" name="driver" className="mt-1 accent-volt-400" checked={driver === id} onChange={() => setDriver(id)} />
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="text-xs text-slate-400">{text}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {backendFields(driver)}
          {error && <p className="rounded-xl bg-ember-500/10 p-3 text-sm text-ember-400">{error}</p>}
          <button className="btn-primary w-full" onClick={createVault} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
            {t('Vault anlegen', 'Create vault')}
          </button>
        </div>
      )}

      {step === 'join' && (
        <div className="animate-pop space-y-4">
          <button className="flex items-center gap-1 text-sm text-slate-400" onClick={() => setStep('choose')}>
            <Icon name="arrowLeft" className="h-4 w-4" /> {t('Zurück', 'Back')}
          </button>
          <h1 className="font-display text-2xl font-bold">{t('Bestehendem Vault beitreten', 'Join an existing vault')}</h1>

          {scanning && (
            <QrScanner
              onClose={() => setScanning(false)}
              onResult={(text) => {
                setScanning(false);
                if (!applyInviteText(text)) setError(t('Dieser QR-Code ist keine PokéVault-Einladung.', 'This QR code is not a PokéVault invite.'));
              }}
            />
          )}

          {!manual && (
            <>
              <div>
                <label className="label" htmlFor="pv-invite">
                  {t('Einladungslink', 'Invite link')}
                </label>
                <textarea
                  id="pv-invite"
                  className="field min-h-[88px] py-2.5"
                  value={inviteText}
                  onChange={(e) => applyInviteText(e.target.value)}
                  placeholder="https://…/#join=…"
                />
              </div>
              {!scanning && (
                <button className="btn-ghost w-full" onClick={() => setScanning(true)}>
                  <Icon name="camera" className="h-4 w-4" /> {t('QR-Code scannen', 'Scan QR code')}
                </button>
              )}
              {invite && (
                <div className="panel p-4 text-sm">
                  <p className="font-semibold">{invite.n || 'PokéVault'}</p>
                  <p className="text-slate-400">
                    {invite.r === 'editor'
                      ? t('Rolle: Mit-Bearbeiter (voller Zugriff)', 'Role: co-editor (full access)')
                      : t('Rolle: Geschenke & Wunschliste (nur lesen)', 'Role: gifts & wishlist (read-only)')}
                  </p>
                </div>
              )}
            </>
          )}

          {manual && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="pv-mid">
                    Vault-ID
                  </label>
                  <input id="pv-mid" className="field" value={manualId} onChange={(e) => setManualId(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className="label" htmlFor="pv-mpin">
                    PIN
                  </label>
                  <input id="pv-mpin" className="field uppercase" value={manualPin} onChange={(e) => setManualPin(e.target.value)} autoComplete="off" />
                </div>
              </div>
              <div className="flex gap-2">
                {(['selfhosted', 'supabase'] as VaultDriver[]).map((id) => (
                  <button key={id} type="button" className={`chip flex-1 justify-center ${manualDriver === id ? 'chip-on' : ''}`} onClick={() => setManualDriver(id)}>
                    {id === 'selfhosted' ? t('Eigener Server', 'Self-hosted') : 'Supabase'}
                  </button>
                ))}
              </div>
              {backendFields(manualDriver)}
            </>
          )}

          <div>
            <label className="label" htmlFor="pv-member">
              {t('Dein Name (für Geschenk-Vormerkungen)', 'Your name (for gift reservations)')}
            </label>
            <input id="pv-member" className="field" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder={t('z. B. Opa', 'e.g. Grandpa')} />
          </div>

          <button className="text-sm text-slate-400 underline underline-offset-4" onClick={() => setManual((m) => !m)}>
            {manual ? t('Lieber Einladungslink verwenden', 'Use an invite link instead') : t('Stattdessen Vault-ID + PIN eingeben', 'Enter vault ID + PIN instead')}
          </button>

          {error && <p className="rounded-xl bg-ember-500/10 p-3 text-sm text-ember-400">{error}</p>}
          <button className="btn-primary w-full" onClick={joinVault} disabled={busy || (!manual && !invite)}>
            {busy ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
            {t('Beitreten', 'Join')}
          </button>
        </div>
      )}
    </main>
  );
}
