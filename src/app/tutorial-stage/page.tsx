'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { TripodBulkDiagram } from '@/components/SvgTutorialDiagrams';
import { useT, type Translate } from '@/lib/i18n';

/**
 * Standalone 16:9 studio stage (1920 × 1080) with looping animations of the
 * four core workflows – made for screen-recording B-roll (e.g. for HeyGen).
 * Keys: ← / → switch scenes, H hides the UI chrome.
 */

const STAGE_W = 1920;
const STAGE_H = 1080;

const STAGE_CSS = `
@keyframes st-card-in { 0%, 8% { transform: translate(520px, 0) rotate(8deg); opacity: 0 } 22%, 78% { transform: translate(0, 0) rotate(0); opacity: 1 } 92%, 100% { transform: translate(0, -760px) rotate(-4deg); opacity: 0 } }
@keyframes st-chip-bad { 0%, 30% { opacity: 1 } 36%, 100% { opacity: 0 } }
@keyframes st-chip-ok { 0%, 30% { opacity: 0 } 36%, 86% { opacity: 1 } 92%, 100% { opacity: 0 } }
@keyframes st-hold { 0%, 38% { width: 0 } 62%, 100% { width: 100% } }
@keyframes st-flash { 0%, 62% { opacity: 0 } 65% { opacity: .9 } 74%, 100% { opacity: 0 } }
@keyframes st-toast { 0%, 66% { opacity: 0; transform: translateY(30px) } 72%, 90% { opacity: 1; transform: translateY(0) } 96%, 100% { opacity: 0; transform: translateY(0) } }
@keyframes st-beam { 0%, 12% { transform: rotate(-11deg) } 34%, 46% { transform: rotate(7deg) } 66%, 100% { transform: rotate(0deg) } }
@keyframes st-drop-a { 0%, 14% { opacity: 0; transform: translateY(-90px) } 22%, 100% { opacity: 1; transform: translateY(0) } }
@keyframes st-drop-b { 0%, 36% { opacity: 0; transform: translateY(-90px) } 44%, 100% { opacity: 1; transform: translateY(0) } }
@keyframes st-drop-c { 0%, 56% { opacity: 0; transform: translateY(-90px) } 64%, 100% { opacity: 1; transform: translateY(0) } }
@keyframes st-fair { 0%, 68% { opacity: 0; transform: scale(.8) } 76%, 100% { opacity: 1; transform: scale(1) } }
@keyframes st-bar { 0% { transform: scaleX(0) } 30%, 100% { transform: scaleX(1) } }
@keyframes st-gift { 0%, 55% { opacity: 0; transform: scale(.4) rotate(-20deg) } 66%, 100% { opacity: 1; transform: scale(1) rotate(0) } }
@keyframes st-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,214,10,.55) } 60% { box-shadow: 0 0 0 26px rgba(255,214,10,0) } }
.st-loop { animation-iteration-count: infinite; animation-timing-function: cubic-bezier(.3,.9,.3,1); }
`;

function StageCard({ w, tint = '#ffd60a', style }: { w: number; tint?: string; style?: React.CSSProperties }) {
  const h = (w * 88) / 63;
  return (
    <div style={{ width: w, height: h, borderRadius: w * 0.06, background: tint, position: 'relative', boxShadow: '0 30px 60px rgba(0,0,0,.45)', ...style }}>
      <div style={{ position: 'absolute', left: '8%', top: '6%', width: '84%', height: '9%', borderRadius: 6, background: 'rgba(10,12,18,.8)' }} />
      <div style={{ position: 'absolute', left: '8%', top: '19%', width: '84%', height: '38%', borderRadius: 10, background: 'rgba(10,12,18,.18)' }} />
      <div style={{ position: 'absolute', left: '8%', top: '63%', width: '60%', height: '4%', borderRadius: 4, background: 'rgba(10,12,18,.4)' }} />
      <div style={{ position: 'absolute', left: '8%', top: '71%', width: '45%', height: '4%', borderRadius: 4, background: 'rgba(10,12,18,.4)' }} />
      <div style={{ position: 'absolute', left: '8%', top: '90%', width: '30%', height: '4.500%', borderRadius: 4, background: 'rgba(10,12,18,.8)' }} />
    </div>
  );
}

/* ---------------- Scene 1: 1x1 scan with quality gate ---------------- */
function ScanScene({ t }: { t: Translate }) {
  const loop = { animationDuration: '6s' } as const;
  return (
    <div style={{ position: 'relative', width: 520, height: 940, borderRadius: 64, border: '10px solid #e2e8f0', background: '#05060a', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 40%, #2a3147, #0a0c12 75%)' }} />
      {/* quality chips */}
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 14, fontSize: 24, fontWeight: 700 }}>
        <div style={{ position: 'relative', width: 222, height: 52 }}>
          <span className="st-loop" style={{ ...loop, animationName: 'st-chip-bad', position: 'absolute', inset: 0, borderRadius: 26, background: '#ffd60a', color: '#0a0c12', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {t('Unscharf', 'Blurry')}
          </span>
          <span className="st-loop" style={{ ...loop, animationName: 'st-chip-ok', position: 'absolute', inset: 0, borderRadius: 26, background: '#3ddc97', color: '#0a0c12', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Focus: OK
          </span>
        </div>
        <div style={{ width: 222, height: 52, borderRadius: 26, background: '#3ddc97', color: '#0a0c12', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t('Licht: OK', 'Glare: OK')}</div>
      </div>
      {/* guide frame */}
      <div style={{ position: 'absolute', left: 80, top: 150, width: 360, height: 503, borderRadius: 24, border: '5px solid rgba(255,255,255,.85)', boxShadow: '0 0 0 2000px rgba(5,6,10,.55)' }}>
        <div className="st-loop" style={{ ...loop, animationName: 'st-card-in', position: 'absolute', left: 8, top: 8 }}>
          <StageCard w={334} />
        </div>
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, height: 12, borderRadius: 6, background: 'rgba(0,0,0,.5)', overflow: 'hidden' }}>
          <div className="st-loop" style={{ ...loop, animationName: 'st-hold', height: '100%', background: '#3ddc97', animationTimingFunction: 'linear' }} />
        </div>
      </div>
      <div className="st-loop" style={{ ...loop, animationName: 'st-flash', position: 'absolute', inset: 0, background: '#fff' }} />
      {/* result toast */}
      <div className="st-loop" style={{ ...loop, animationName: 'st-toast', position: 'absolute', left: 40, right: 40, bottom: 60, borderRadius: 30, background: '#ffd60a', color: '#0a0c12', fontSize: 34, fontWeight: 800, padding: '30px 34px', textAlign: 'center' }}>
        {t('+1 Hauptordner', '+1 main binder')}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 210, textAlign: 'center', color: '#94a3b8', fontSize: 24, fontWeight: 600 }}>Auto-Capture</div>
    </div>
  );
}

/* ---------------- Scene 3: live trade scale ---------------- */
function ScaleScene({ t }: { t: Translate }) {
  const loop = { animationDuration: '7s' } as const;
  const pan = (left: number): React.CSSProperties => ({ position: 'absolute', left, top: 96, width: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' });
  return (
    <div style={{ position: 'relative', width: 1040, height: 800 }}>
      <div style={{ position: 'absolute', left: 506, top: 180, width: 28, height: 520, borderRadius: 14, background: '#323a4f' }} />
      <div style={{ position: 'absolute', left: 370, top: 690, width: 300, height: 28, borderRadius: 14, background: '#323a4f' }} />
      <div className="st-loop" style={{ ...loop, animationName: 'st-beam', position: 'absolute', left: 0, top: 150, width: 1040, height: 60, transformOrigin: '520px 30px' }}>
        <div style={{ position: 'absolute', left: 60, right: 60, top: 20, height: 20, borderRadius: 10, background: '#ffd60a' }} />
        {/* left pan: I give */}
        <div style={pan(40)}>
          <div style={{ width: 4, height: 150, background: '#64748b' }} />
          <div style={{ width: 300, height: 26, borderRadius: '0 0 150px 150px', background: '#222838', border: '3px solid #64748b' }} />
          <div style={{ position: 'absolute', top: -120, display: 'flex', gap: 10 }}>
            <div className="st-loop" style={{ ...loop, animationName: 'st-drop-a' }}>
              <StageCard w={110} tint="#ff6b57" />
            </div>
            <div className="st-loop" style={{ ...loop, animationName: 'st-drop-c' }}>
              <StageCard w={110} tint="#7dd3fc" />
            </div>
          </div>
        </div>
        {/* right pan: I get */}
        <div style={pan(700)}>
          <div style={{ width: 4, height: 150, background: '#64748b' }} />
          <div style={{ width: 300, height: 26, borderRadius: '0 0 150px 150px', background: '#222838', border: '3px solid #64748b' }} />
          <div className="st-loop" style={{ ...loop, animationName: 'st-drop-b', position: 'absolute', top: -120 }}>
            <StageCard w={110} />
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 484, top: 144, width: 72, height: 72, borderRadius: 36, background: '#0a0c12', border: '10px solid #ffd60a' }} />
      <div style={{ position: 'absolute', left: 0, top: 560, width: 380, textAlign: 'center' }}>
        <p style={{ fontSize: 26, letterSpacing: 4, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{t('Ich gebe ab', 'I give')}</p>
        <p style={{ fontSize: 60, fontWeight: 800 }}>24,10 €</p>
      </div>
      <div style={{ position: 'absolute', right: 0, top: 560, width: 380, textAlign: 'center' }}>
        <p style={{ fontSize: 26, letterSpacing: 4, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{t('Ich bekomme', 'I get')}</p>
        <p style={{ fontSize: 60, fontWeight: 800 }}>25,40 €</p>
      </div>
      <div className="st-loop" style={{ ...loop, animationName: 'st-fair', position: 'absolute', left: 320, top: 30, width: 400, textAlign: 'center', borderRadius: 50, padding: '18px 0', background: 'rgba(61,220,151,.16)', color: '#3ddc97', fontSize: 40, fontWeight: 800 }}>
        {t('Fairer Tausch', 'Fair trade')}
      </div>
    </div>
  );
}

/* ---------------- Scene 4: gift radar ---------------- */
function GiftScene({ t }: { t: Translate }) {
  const rows: [string, number, string][] = [
    [t('Set A · neu erschienen', 'Set A · just released'), 96, '4 %'],
    [t('Set B', 'Set B'), 71, '29 %'],
    [t('Set C', 'Set C'), 38, '62 %'],
  ];
  return (
    <div style={{ width: 1040, display: 'flex', gap: 60, alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 26, letterSpacing: 4, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 26 }}>{t('Booster-Kaufberater', 'Booster advisor')}</p>
        {rows.map(([name, chance, done], index) => (
          <div key={name} style={{ marginBottom: 30, padding: '28px 32px', borderRadius: 28, background: '#10131c', border: index === 0 ? '3px solid #ffd60a' : '3px solid rgba(255,255,255,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 32, fontWeight: 700 }}>
              <span>
                <span style={{ color: '#ffd60a', marginRight: 14 }}>{index + 1}.</span>
                {name}
              </span>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>{done}</span>
            </div>
            <div style={{ marginTop: 18, height: 18, borderRadius: 9, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
              <div className="st-loop" style={{ animationName: 'st-bar', animationDuration: '6s', animationDelay: `${index * 0.35}s`, transformOrigin: 'left', width: `${chance}%`, height: '100%', borderRadius: 9, background: index === 0 ? '#ffd60a' : '#475569' }} />
            </div>
            <p style={{ marginTop: 12, fontSize: 24, color: '#94a3b8' }}>{t(`${chance} % Chance auf neue Karten`, `${chance} % chance of new cards`)}</p>
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', width: 300 }}>
        <StageCard w={300} tint="#c4b5fd" style={{ filter: 'grayscale(.5)', opacity: 0.8 }} />
        <div className="st-loop" style={{ animationName: 'st-gift', animationDuration: '6s', position: 'absolute', left: -40, top: -40, width: 140, height: 140, borderRadius: 70, background: '#3ddc97', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72 }}>
          🎁
        </div>
        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 28, fontWeight: 700, color: '#3ddc97' }}>{t('Als Geschenk vorgemerkt', 'Reserved as a gift')}</p>
      </div>
    </div>
  );
}

interface Scene {
  title: string;
  points: string[];
  visual: ReactNode;
}

export default function TutorialStagePage() {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [scale, setScale] = useState(1);

  const scenes: Scene[] = [
    {
      title: t('Scannen mit Live-Qualitätsprüfung', 'Scanning with a live quality gate'),
      points: [t('Karte in den Rahmen legen', 'Place the card in the frame'), t('Schärfe & Spiegelung werden live geprüft', 'Focus & glare are checked live'), t('Auto-Capture löst von selbst aus', 'Auto-capture fires on its own')],
      visual: <ScanScene t={t} />,
    },
    {
      title: t('Ganze Albumseiten importieren', 'Import whole binder pages'),
      points: [t('Ein Foto vom Stativ', 'One photo from a tripod'), t('Gitter auf 2×2 oder 3×3 Fächer ziehen', 'Drag the grid onto 2×2 or 3×3 pockets'), t('Alle Karten werden auf einmal erkannt', 'All cards are recognised at once')],
      visual: (
        <div style={{ width: 1040 }}>
          <TripodBulkDiagram />
        </div>
      ),
    },
    {
      title: t('Die Live Tausch-Waage', 'The live trade scale'),
      points: [t('Doppelte aus der Tauschmappe auflegen', 'Add duplicates from the trade binder'), t('Wunschkarten des Partners gegenüberstellen', "Compare them with your partner's cards"), t('Fairer Tausch in Euro – sofort sichtbar', 'A fair trade in euros – visible instantly')],
      visual: <ScaleScene t={t} />,
    },
    {
      title: t('Geschenk-Radar für die Familie', 'Gift radar for the family'),
      points: [t('Oma & Opa sehen die Wunschliste', 'Grandparents see the wishlist'), t('Der beste Booster steht ganz oben', 'The best booster is at the top'), t('Diskret als Geschenk vormerken', 'Reserve gifts discreetly')],
      visual: <GiftScene t={t} />,
    },
  ];

  useEffect(() => {
    document.body.classList.add('stage-mode');
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => {
      document.body.classList.remove('stage-mode');
      window.removeEventListener('resize', fit);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') setIndex((i) => (i + 1) % 4);
      if (event.key === 'ArrowLeft') setIndex((i) => (i + 3) % 4);
      if (event.key.toLowerCase() === 'h') setChrome((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scene = scenes[index];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <style>{STAGE_CSS}</style>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          background: 'radial-gradient(ellipse at 72% 40%, #1b2132 0%, #0a0c12 62%)',
          color: '#f1f5f9',
          fontFamily: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
        }}
      >
        {/* key forces the animations to restart when the scene changes */}
        <div key={index} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 110px', gap: 70 }}>
          <div style={{ width: 620, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 44 }}>
              <div className="st-loop" style={{ animationName: 'st-pulse', animationDuration: '2.4s', width: 76, height: 76, borderRadius: 24, background: '#ffd60a', color: '#0a0c12', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 800 }}>
                {index + 1}
              </div>
              <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: '#64748b', textTransform: 'uppercase' }}>PokéVault</span>
            </div>
            <h1 style={{ fontSize: 84, lineHeight: 1.04, fontWeight: 800, letterSpacing: -2 }}>{scene.title}</h1>
            <ul style={{ marginTop: 50, display: 'flex', flexDirection: 'column', gap: 22 }}>
              {scene.points.map((point) => (
                <li key={point} style={{ display: 'flex', gap: 20, alignItems: 'baseline', fontSize: 36, color: '#cbd5e1' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 8, background: '#ffd60a', flexShrink: 0, transform: 'translateY(-4px)' }} />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>{scene.visual}</div>
        </div>

        {chrome && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 34, fontSize: 24, color: '#64748b' }}>
            <Link href="/guide" style={{ color: '#94a3b8', textDecoration: 'underline' }}>
              {t('← Zurück zur Anleitung', '← Back to guide')}
            </Link>
            <div style={{ display: 'flex', gap: 14 }}>
              {scenes.map((s, i) => (
                <button
                  key={s.title}
                  onClick={() => setIndex(i)}
                  aria-label={s.title}
                  aria-current={i === index}
                  style={{ width: i === index ? 56 : 20, height: 20, borderRadius: 10, background: i === index ? '#ffd60a' : '#323a4f', transition: 'width .3s' }}
                />
              ))}
            </div>
            <span>{t('← → Szene wechseln · H blendet diese Leiste aus', '← → switch scene · H hides this bar')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
