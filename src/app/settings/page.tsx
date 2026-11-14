'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Icon, PageHeader, Spinner, toast } from '@/components/ui';
import { downloadTextFile, exportBackupJson } from '@/lib/csv';
import { wipeLocalVaultData } from '@/lib/db';
import { formatDate, useT } from '@/lib/i18n';
import { testVisionConnection } from '@/lib/recognition';
import { CARD_LANGUAGES, DEFAULT_SETTINGS, updateSettings, useSettings, VISION_DEFAULTS, type VisionProvider } from '@/lib/settings';
import { clearSyncState, getRepository, registerRemoteVault, useSyncStatus } from '@/lib/storage-adapter';
import { appBaseUrl, saveVaultConfig, useVaultConfig, type VaultDriver } from '@/lib/vault';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="eyebrow mb-2.5">{title}</h2>
      <div className="panel divide-y divide-white/[0.06]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, stacked }: { label: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={`p-4 ${stacked ? '' : 'flex items-center justify-between gap-4'}`}>
      <div className={stacked ? 'mb-2.5' : 'min-w-0'}>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className={stacked ? '' : 'shrink-0'}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${checked ? 'bg-volt-400' : 'bg-white/15'}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

const SELFHOST_BUILD = process.env.NEXT_PUBLIC_SELFHOST === '1';

export default function SettingsPage() {
  const t = useT();
  const settings = useSettings();
  const config = useVaultConfig();
  const sync = useSyncStatus();
  const isEditor = config?.role === 'editor';

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // connect a local vault to a sync backend
  const [connectDriver, setConnectDriver] = useState<VaultDriver>('local');
  const [endpoint, setEndpoint] = useState(SELFHOST_BUILD && typeof window !== 'undefined' ? appBaseUrl() : '');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [connecting, setConnecting] = useState(false);

  const setProvider = (provider: VisionProvider) => {
    updateSettings({ visionProvider: provider, visionBaseUrl: VISION_DEFAULTS[provider].baseUrl, visionModel: VISION_DEFAULTS[provider].model });
    setTestResult(null);
  };

  const testVision = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, text: await testVisionConnection() });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await getRepository().sync();
      toast(t(`Synchronisiert: ${result.pushed} gesendet, ${result.pulled} empfangen`, `Synced: ${result.pushed} sent, ${result.pulled} received`));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      setSyncing(false);
    }
  };

  const connect = async () => {
    if (!config || connectDriver === 'local') return;
    setConnecting(true);
    try {
      const next = {
        ...config,
        driver: connectDriver,
        endpoint: endpoint.trim().replace(/\/+$/, ''),
        supabaseUrl: supabaseUrl.trim().replace(/\/+$/, ''),
        supabaseAnonKey: supabaseKey.trim(),
      };
      await registerRemoteVault(next);
      clearSyncState(next.vaultId);
      saveVaultConfig(next);
      await getRepository().sync();
      toast(t('Sync eingerichtet – alle Karten wurden hochgeladen.', 'Sync is set up – all cards were uploaded.'));
    } catch (err) {
      toast(`${t('Verbindung fehlgeschlagen', 'Connection failed')}: ${err instanceof Error ? err.message : String(err)}`, 'warn');
    } finally {
      setConnecting(false);
    }
  };

  const leaveVault = async () => {
    if (!config) return;
    const question =
      config.driver === 'local'
        ? t(
            'Wirklich zurücksetzen? Alle Karten dieses Vaults werden von diesem Gerät gelöscht. Ohne Backup sind sie verloren.',
            'Really reset? All cards of this vault will be deleted from this device. Without a backup they are lost.',
          )
        : t(
            'Vault auf diesem Gerät verlassen? Die Daten bleiben auf dem Sync-Server erhalten, lokal werden sie gelöscht.',
            'Leave the vault on this device? The data stays on the sync server and is deleted locally.',
          );
    if (!window.confirm(question)) return;
    await wipeLocalVaultData();
    clearSyncState(config.vaultId);
    saveVaultConfig(null);
  };

  if (!config) return null;

  const driverLabel =
    config.driver === 'local' ? t('Nur dieses Gerät (IndexedDB)', 'This device only (IndexedDB)') : config.driver === 'selfhosted' ? t('Eigener Server', 'Self-hosted server') : 'Supabase';

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('Einstellungen', 'Settings')} subtitle={config.name} />

      <Group title={t('Sprache', 'Language')}>
        <Row label={t('Oberfläche', 'Interface')}>
          <div className="flex rounded-xl bg-ink-800 p-1">
            {(['de', 'en'] as const).map((lang) => (
              <button key={lang} className={`min-h-[36px] rounded-lg px-4 text-sm font-semibold ${settings.uiLang === lang ? 'bg-volt-400 text-ink-950' : 'text-slate-400'}`} onClick={() => updateSettings({ uiLang: lang })} aria-pressed={settings.uiLang === lang}>
                {lang === 'de' ? 'Deutsch' : 'English'}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t('Kartensprache', 'Card language')} hint={t('Sprache der Kartennamen und Sets aus TCGdex. Karten werden beim nächsten Öffnen neu geladen.', 'Language of card names and sets from TCGdex. Cards reload the next time they are opened.')}>
          <select className="field w-auto" value={settings.cardLang} onChange={(e) => updateSettings({ cardLang: e.target.value })} aria-label={t('Kartensprache', 'Card language')}>
            {CARD_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      {isEditor && (
        <Group title={t('Erkennung', 'Recognition engine')}>
          <div className="space-y-2 p-4">
            {(
              [
                ['ocr', t('Lokale Erkennung', 'Local recognition'), t('Standard. Kostenlos, ohne API-Key. Vergleicht das Kartenmotiv mit dem Bild-Index und liest die Sammlernummer direkt im Browser.', 'Default. Free, no API key. Compares the artwork with the image index and reads the collector number right in the browser.')],
                ['vision', t('Eigene Vision-API (BYOK)', 'Bring your own vision API'), t('Schneller und treffsicherer bei schwierigem Licht. Nutzt deinen eigenen Schlüssel – z. B. das kostenlose Gemini-Kontingent.', 'Faster and more accurate in difficult light. Uses your own key – e.g. the free Gemini tier.')],
              ] as const
            ).map(([id, title, text]) => (
              <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${settings.engine === id ? 'border-volt-400/70 bg-volt-400/[0.06]' : 'border-white/[0.08]'}`}>
                <input type="radio" name="engine" className="mt-1 accent-volt-400" checked={settings.engine === id} onChange={() => updateSettings({ engine: id })} />
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="text-xs text-slate-400">{text}</span>
                </span>
              </label>
            ))}
          </div>

          {settings.engine === 'vision' && (
            <div className="space-y-3 p-4">
              <div className="flex gap-2">
                {(['gemini', 'openai', 'ollama'] as VisionProvider[]).map((p) => (
                  <button key={p} className={`chip flex-1 justify-center ${settings.visionProvider === p ? 'chip-on' : ''}`} onClick={() => setProvider(p)} aria-pressed={settings.visionProvider === p}>
                    {p === 'gemini' ? 'Google Gemini' : p === 'openai' ? t('OpenAI-kompatibel', 'OpenAI-compatible') : 'Ollama'}
                  </button>
                ))}
              </div>
              {settings.visionProvider !== 'ollama' && (
                <div>
                  <label className="label" htmlFor="s-key">
                    API-Key
                  </label>
                  <input id="s-key" type="password" className="field" value={settings.visionApiKey} onChange={(e) => updateSettings({ visionApiKey: e.target.value.trim() })} autoComplete="off" spellCheck={false} />
                  <p className="mt-1 text-[11px] text-slate-500">
                    {t('Der Schlüssel bleibt im localStorage dieses Browsers und wird nur direkt an den gewählten Anbieter gesendet.', "The key stays in this browser's localStorage and is only sent directly to the chosen provider.")}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="s-model">
                    {t('Modell', 'Model')}
                  </label>
                  <input id="s-model" className="field" value={settings.visionModel} onChange={(e) => updateSettings({ visionModel: e.target.value.trim() })} spellCheck={false} />
                </div>
                <div>
                  <label className="label" htmlFor="s-base">
                    {t('Basis-URL', 'Base URL')}
                  </label>
                  <input id="s-base" className="field" value={settings.visionBaseUrl} onChange={(e) => updateSettings({ visionBaseUrl: e.target.value.trim() })} spellCheck={false} inputMode="url" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-ghost" onClick={() => void testVision()} disabled={testing}>
                  {testing ? <Spinner className="h-4 w-4" /> : <Icon name="bolt" className="h-4 w-4" />} {t('Verbindung testen', 'Test connection')}
                </button>
                {testResult && (
                  <p className={`text-xs ${testResult.ok ? 'text-mint-400' : 'text-ember-400'}`} role="status">
                    {testResult.ok ? `✓ ${t('Antwort', 'Response')}: ${testResult.text}` : `✕ ${testResult.text}`}
                  </p>
                )}
              </div>
            </div>
          )}
        </Group>
      )}

      {isEditor && (
        <Group title={t('Scanner', 'Scanner')}>
          <Row label="Auto-Capture" hint={t('Löst nach 0,8 s mit scharfem, spiegelfreiem Bild automatisch aus.', 'Fires automatically after 0.8 s of a sharp, glare-free image.')}>
            <Toggle checked={settings.autoCapture} onChange={(v) => updateSettings({ autoCapture: v })} label="Auto-Capture" />
          </Row>
          <Row label={t('Ton & Vibration', 'Sound & vibration')}>
            <Toggle checked={settings.soundFeedback} onChange={(v) => updateSettings({ soundFeedback: v })} label={t('Ton & Vibration', 'Sound & vibration')} />
          </Row>
          <Row
            stacked
            label={t(`Schärfe-Schwelle: ${settings.sharpnessThreshold}`, `Sharpness threshold: ${settings.sharpnessThreshold}`)}
            hint={t('Niedriger = löst leichter aus. Senken, wenn „Unscharf" trotz scharfem Bild bleibt (ältere Kameras).', 'Lower = fires more easily. Reduce it if "Blurry" stays on although the image is sharp (older cameras).')}
          >
            <input type="range" min={10} max={200} step={5} value={settings.sharpnessThreshold} onChange={(e) => updateSettings({ sharpnessThreshold: Number(e.target.value) })} className="w-full accent-volt-400" aria-label={t('Schärfe-Schwelle', 'Sharpness threshold')} />
          </Row>
          <Row
            stacked
            label={t(`Spiegelungs-Toleranz: ${(settings.glareThreshold * 100).toFixed(1)} %`, `Glare tolerance: ${(settings.glareThreshold * 100).toFixed(1)} %`)}
            hint={t('Maximaler Anteil überbelichteter Pixel im Kartenrahmen.', 'Maximum share of blown-out pixels inside the card frame.')}
          >
            <input type="range" min={0.005} max={0.15} step={0.005} value={settings.glareThreshold} onChange={(e) => updateSettings({ glareThreshold: Number(e.target.value) })} className="w-full accent-volt-400" aria-label={t('Spiegelungs-Toleranz', 'Glare tolerance')} />
          </Row>
          <Row label={t('Standardwerte', 'Defaults')}>
            <button className="text-xs font-semibold text-volt-300" onClick={() => updateSettings({ sharpnessThreshold: DEFAULT_SETTINGS.sharpnessThreshold, glareThreshold: DEFAULT_SETTINGS.glareThreshold })}>
              {t('Zurücksetzen', 'Reset')}
            </button>
          </Row>
        </Group>
      )}

      <Group title={t('Sync & Backup', 'Sync & backup')}>
        <Row label={t('Speicherort', 'Storage')} hint={driverLabel}>
          {config.driver !== 'local' && (
            <button className="btn-ghost" onClick={() => void syncNow()} disabled={syncing}>
              {syncing ? <Spinner className="h-4 w-4" /> : <Icon name="sync" className="h-4 w-4" />} {t('Jetzt synchronisieren', 'Sync now')}
            </button>
          )}
        </Row>
        {config.driver !== 'local' && (
          <Row
            label={t('Status', 'Status')}
            hint={
              sync.state === 'error'
                ? `${t('Fehler', 'Error')}: ${sync.error ?? ''}`
                : sync.lastSyncAt
                  ? t(`Zuletzt synchronisiert: ${new Date(sync.lastSyncAt).toLocaleTimeString()}`, `Last synced: ${new Date(sync.lastSyncAt).toLocaleTimeString()}`)
                  : t('Noch nicht synchronisiert', 'Not synced yet')
            }
          >
            <span className={`text-xs font-semibold ${sync.state === 'error' ? 'text-ember-400' : 'text-mint-400'}`}>{sync.state === 'error' ? 'Offline' : 'OK'}</span>
          </Row>
        )}
        {isEditor && config.driver !== 'local' && (
          <Row label={t('Familie einladen', 'Invite family')} hint={t('Einladungslinks & QR-Codes für Mit-Bearbeiter und Geschenk-Ansicht', 'Invite links & QR codes for co-editors and gift viewers')}>
            <Link href="/settings/share" className="btn-primary">
              <Icon name="share" className="h-4 w-4" /> {t('Teilen', 'Share')}
            </Link>
          </Row>
        )}
        {isEditor && config.driver === 'selfhosted' && (
          <Row label={t('Server-Slicing (sharp)', 'Server slicing (sharp)')} hint={t('Albumseiten in voller Auflösung auf dem eigenen Server schneiden.', 'Slice binder pages at full resolution on your own server.')}>
            <Toggle checked={settings.serverSlicing} onChange={(v) => updateSettings({ serverSlicing: v })} label={t('Server-Slicing', 'Server slicing')} />
          </Row>
        )}
        {isEditor && (
          <Row label={t('Backup', 'Backup')} hint={t('Vollständiges JSON-Backup herunterladen. CSV und Wiederherstellung findest du unter Import.', 'Download a full JSON backup. CSV and restore live under Import.')}>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={async () => downloadTextFile(`pokevault-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackupJson(), 'application/json')}>
                <Icon name="download" className="h-4 w-4" /> JSON
              </button>
              <Link href="/import" className="btn-ghost">
                {t('Import', 'Import')}
              </Link>
            </div>
          </Row>
        )}

        {isEditor && config.driver === 'local' && (
          <div className="space-y-3 p-4">
            <p className="text-sm font-semibold">{t('Familien-Sync aktivieren', 'Enable family sync')}</p>
            <p className="text-xs text-slate-400">
              {t(
                'Verbinde diesen Vault mit einem eigenen PokéVault-Server oder einem kostenlosen Supabase-Projekt, um ihn mit anderen Geräten zu teilen. Deine Karten bleiben erhalten.',
                'Connect this vault to your own PokéVault server or a free Supabase project to share it with other devices. Your cards are kept.',
              )}
            </p>
            <div className="flex gap-2">
              {(['selfhosted', 'supabase'] as VaultDriver[]).map((d) => (
                <button key={d} className={`chip flex-1 justify-center ${connectDriver === d ? 'chip-on' : ''}`} onClick={() => setConnectDriver(connectDriver === d ? 'local' : d)} aria-pressed={connectDriver === d}>
                  {d === 'selfhosted' ? t('Eigener Server', 'Self-hosted') : 'Supabase'}
                </button>
              ))}
            </div>
            {connectDriver === 'selfhosted' && (
              <input className="field" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://vault.example.com" aria-label={t('Server-URL', 'Server URL')} inputMode="url" />
            )}
            {connectDriver === 'supabase' && (
              <>
                <input className="field" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} placeholder="https://xxxx.supabase.co" aria-label="Supabase URL" inputMode="url" />
                <input className="field" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} placeholder="Supabase Anon Key" aria-label="Supabase Anon Key" autoComplete="off" />
              </>
            )}
            {connectDriver !== 'local' && (
              <button className="btn-primary w-full" onClick={() => void connect()} disabled={connecting}>
                {connecting ? <Spinner className="h-4 w-4" /> : <Icon name="sync" className="h-4 w-4" />} {t('Verbinden & hochladen', 'Connect & upload')}
              </button>
            )}
          </div>
        )}
      </Group>

      <Group title={t('Anleitung', 'Guide')}>
        <Row stacked label={t('Tutorial-Video', 'Tutorial video')} hint={t('YouTube-/Vimeo-Link oder Pfad zu einer MP4-Datei (z. B. /tutorial.mp4).', 'YouTube/Vimeo link or path to an MP4 file (e.g. /tutorial.mp4).')}>
          <input className="field" value={settings.guideVideoUrl} onChange={(e) => updateSettings({ guideVideoUrl: e.target.value })} placeholder="https://youtu.be/…" aria-label={t('Tutorial-Video', 'Tutorial video')} inputMode="url" />
        </Row>
      </Group>

      <Group title={t('Vault', 'Vault')}>
        <Row label={config.name} hint={`${config.role === 'editor' ? t('Rolle: Bearbeiter', 'Role: editor') : t('Rolle: Geschenk-Ansicht', 'Role: gift viewer')} · ${t('angelegt am', 'created on')} ${formatDate(config.createdAt, settings.uiLang)}`}>
          <button className="btn-danger" onClick={() => void leaveVault()}>
            <Icon name="trash" className="h-4 w-4" /> {config.driver === 'local' ? t('Zurücksetzen', 'Reset') : t('Verlassen', 'Leave')}
          </button>
        </Row>
      </Group>

      <p className="px-1 text-xs leading-relaxed text-slate-500">
        PokéVault v1.0 · {t('Kartendaten und Preise', 'Card data and prices')}: TCGdex (Cardmarket Trend).{' '}
        {t(
          'PokéVault ist ein inoffizielles Fan-Projekt und steht in keiner Verbindung zu Nintendo, The Pokémon Company, Creatures oder GAME FREAK.',
          'PokéVault is an unofficial fan project and is not affiliated with Nintendo, The Pokémon Company, Creatures or GAME FREAK.',
        )}
      </p>
    </div>
  );
}
