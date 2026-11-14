'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AutoRouteDiagram, CalibrationMat, DaylightAngleDiagram, TapeJigDiagram, TripodBulkDiagram } from '@/components/SvgTutorialDiagrams';
import { Icon, PageHeader, Section } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { useRole } from '@/lib/vault';

/** Turns a YouTube/Vimeo/MP4 URL into something embeddable. */
function resolveVideo(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  const value = url.trim();
  if (!value) return null;
  const youtube = value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${youtube[1]}` };
  const vimeo = value.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(value)) return { kind: 'video', src: value };
  return null;
}

function Step({ number, title, children, diagram }: { number: number; title: string; children: ReactNode; diagram: ReactNode }) {
  return (
    <article className="panel overflow-hidden md:grid md:grid-cols-2">
      <div className="p-3">{diagram}</div>
      <div className="p-5 pt-2 md:pt-5">
        <p className="eyebrow mb-1 text-volt-400">
          {number < 10 ? `0${number}` : number}
        </p>
        <h3 className="font-display text-lg font-bold">{title}</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">{children}</div>
      </div>
    </article>
  );
}

export default function GuidePage() {
  const t = useT();
  const settings = useSettings();
  const role = useRole();
  const [mat, setMat] = useState<'1x1' | '2x2'>('1x1');
  const video = resolveVideo(settings.guideVideoUrl);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  return (
    <>
      <div className="no-print">
        <PageHeader title={t('Anleitung', 'Guide')} subtitle={t('In drei Schritten zu sauberen Scans – ganz ohne Spezial-Equipment', 'Three steps to clean scans – no special equipment needed')} />

        <Section title={t('Video-Tutorial', 'Video tutorial')}>
          <div className="panel overflow-hidden">
            {video?.kind === 'iframe' && (
              <iframe
                src={video.src}
                title={t('PokéVault Video-Tutorial', 'PokéVault video tutorial')}
                className="aspect-video w-full"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            )}
            {video?.kind === 'video' && <video src={video.src} className="aspect-video w-full bg-black" controls playsInline preload="metadata" />}
            {!video && (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-ink-800 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.07] text-slate-300">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.500z" />
                  </svg>
                </div>
                <p className="max-w-md text-sm text-slate-400">
                  {t(
                    'Hier erscheint dein Tutorial-Video. Trage in den Einstellungen einen YouTube-/Vimeo-Link ein oder lege eine Datei unter',
                    'Your tutorial video appears here. Enter a YouTube/Vimeo link in the settings or place a file at',
                  )}{' '}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs text-slate-200">{basePath}/tutorial.mp4</code>{' '}
                  {t('ab und trage diesen Pfad ein.', 'and enter that path.')}
                </p>
                <Link href="/settings" className="btn-ghost">
                  <Icon name="settings" className="h-4 w-4" /> {t('Video-Link eintragen', 'Set video link')}
                </Link>
              </div>
            )}
          </div>
        </Section>

        <Section title={t('Schritt für Schritt', 'Step by step')}>
          <div className="space-y-4">
            <Step number={1} title={t('Die Klebeband-Schablone', 'The masking tape jig')} diagram={<TapeJigDiagram />}>
              <p>
                {t(
                  'Klebe zwei Streifen Malerkrepp als Ecke auf den Tisch – einen links, einen unten. Jede Karte liegt damit automatisch an derselben Stelle.',
                  'Stick two strips of masking tape on the table as a corner – one on the left, one at the bottom. Every card then lands in exactly the same spot.',
                )}
              </p>
              <p>
                {t(
                  'Fixiere das Smartphone darüber (Handystativ, Bücherstapel mit Glasplatte) so, dass der Kartenrahmen der App die Ecke füllt. Schalte Auto-Capture ein: Karte anlegen, kurz warten, Ton abwarten, nächste Karte.',
                  'Fix the phone above it (phone stand, a stack of books with a glass pane) so the app frame fills the corner. Switch on auto-capture: slide the card in, wait for the beep, next card.',
                )}
              </p>
              <p className="text-slate-400">
                {t('Tipp: Die druckbare Schablone unten ersetzt das Ausmessen.', 'Tip: the printable mat below saves you the measuring.')}
              </p>
            </Step>

            <Step number={2} title={t('Reflexionsfreies Album-Scannen (2×2 & 3×3)', 'Glare-free binder scanning (2×2 & 3×3)')} diagram={<DaylightAngleDiagram />}>
              <p>
                {t(
                  'Folienhüllen spiegeln. Nutze indirektes Tageslicht von einem Fenster seitlich – keine Deckenlampe, kein Blitz.',
                  'Sleeves reflect light. Use indirect daylight from a window at the side – no ceiling lamp, no flash.',
                )}
              </p>
              <p>
                {t(
                  'Kippe die Albumseite um 10–15° zum Fenster hin (z. B. mit einem Buch unter der fensternahen Kante). Die Spiegelung wandert dann an der Kamera vorbei. Die Anzeige „Licht: OK" in der App bestätigt es.',
                  'Tilt the binder page 10–15° towards the window (for example with a book under the edge near the window). The reflection then misses the camera. The "Glare: OK" indicator in the app confirms it.',
                )}
              </p>
            </Step>

            <Step number={3} title={t('Stativ-Bulk-Import', 'Tripod bulk import')} diagram={<TripodBulkDiagram />}>
              <p>
                {t(
                  'Für große Sammlungen: Kamera oder Smartphone auf ein Stativ, senkrecht nach unten, höchste Auflösung. Fotografiere Seite für Seite – eine 3×3-Seite braucht etwa 12 Megapixel, damit die Sammlernummern lesbar bleiben.',
                  'For large collections: put a camera or phone on a tripod, pointing straight down, at the highest resolution. Shoot page after page – a 3×3 page needs roughly 12 megapixels to keep the collector numbers readable.',
                )}
              </p>
              <p>
                {t(
                  'Lade die Fotos unter Import hoch, ziehe das Gitter auf die Fächer und lass PokéVault alle Karten auf einmal erkennen.',
                  'Upload the photos under Import, drag the grid onto the pockets and let PokéVault recognise all cards at once.',
                )}
              </p>
              {role === 'editor' && (
                <Link href="/import" className="btn-ghost mt-1">
                  <Icon name="import" className="h-4 w-4" /> {t('Zum Bulk-Import', 'Open bulk import')}
                </Link>
              )}
            </Step>

            <Step number={4} title={t('Doppelte landen automatisch richtig', 'Duplicates route themselves')} diagram={<AutoRouteDiagram />}>
              <p>
                {t(
                  'Scannst du eine Karte, die schon im Hauptordner liegt, schlägt PokéVault „+1 in Tauschmappe" vor. So entsteht die Tauschmappe nebenbei – inklusive Wert in Euro.',
                  'When you scan a card that is already in the main binder, PokéVault suggests "+1 to trade binder". Your trade binder builds itself along the way – including its value in euros.',
                )}
              </p>
            </Step>
          </div>
        </Section>

        <Section title={t('Druckbare A4-Schablone', 'Printable A4 calibration mat')}>
          <div className="panel p-5">
            <p className="mb-4 text-sm text-slate-300">
              {t(
                'Kartenumrisse in Originalgröße (63 × 88 mm) mit Passmarken. Wichtig: im Druckdialog „Tatsächliche Größe / 100 %" wählen. Das 50-mm-Lineal auf dem Ausdruck zeigt, ob der Maßstab stimmt.',
                'Card outlines at original size (63 × 88 mm) with registration marks. Important: choose "Actual size / 100 %" in the print dialog. The 50 mm ruler on the print shows whether the scale is right.',
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl bg-ink-800 p-1">
                {(['1x1', '2x2'] as const).map((id) => (
                  <button key={id} className={`min-h-[38px] rounded-lg px-4 text-sm font-semibold ${mat === id ? 'bg-volt-400 text-ink-950' : 'text-slate-400'}`} onClick={() => setMat(id)} aria-pressed={mat === id}>
                    {id === '1x1' ? t('1 Karte', '1 card') : t('2×2 Karten', '2×2 cards')}
                  </button>
                ))}
              </div>
              <button className="btn-primary" onClick={() => window.print()}>
                <Icon name="print" className="h-4 w-4" /> {t('Schablone drucken', 'Print mat')}
              </button>
            </div>
            <div className="mt-4 w-40 overflow-hidden rounded-lg border border-white/10">
              <CalibrationMat layout={mat} title="PokéVault" hint="" />
            </div>
          </div>
        </Section>

        <p className="text-xs text-slate-500">
          {t('Für Video-Produktion gibt es eine animierte 16:9-Bühne:', 'For video production there is an animated 16:9 stage:')}{' '}
          <Link href="/tutorial-stage" className="font-semibold text-slate-300 underline underline-offset-4">
            /tutorial-stage
          </Link>
        </p>
      </div>

      {/* Only this block reaches the printer. */}
      <div className="print-only">
        <style>{'@page { size: A4; margin: 0; }'}</style>
        <CalibrationMat
          layout={mat}
          title={t('PokéVault Scan-Schablone', 'PokéVault scan mat')}
          hint={t('Mit 100 % drucken · Karte in den Umriss legen · Smartphone senkrecht darüber', 'Print at 100 % · place the card inside the outline · phone straight above')}
        />
      </div>
    </>
  );
}
