'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n';

/**
 * Inline animated SVG illustrations for the guide and the tutorial stage.
 * Pure SVG + SMIL: no images, no libraries, crisp at any size.
 */

const INK = '#0a0c12';
const PANEL = '#171b27';
const LINE = '#64748b';
const VOLT = '#ffd60a';
const MINT = '#3ddc97';
const TAPE = '#e9dfb7';

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 480 300" className="block h-auto w-full rounded-2xl bg-ink-800" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

function Caption({ x, y, children, anchor = 'start', color = '#cbd5e1' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; color?: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={color} fontSize="13" fontWeight="600" fontFamily="system-ui, sans-serif">
      {children}
    </text>
  );
}

/** A stylised trading card (63:88). */
function MiniCard({ x, y, w = 63, tint = VOLT }: { x: number; y: number; w?: number; tint?: string }) {
  const h = (w * 88) / 63;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={w * 0.06} fill={tint} />
      <rect x={w * 0.08} y={h * 0.06} width={w * 0.84} height={h * 0.09} rx={2} fill={INK} opacity="0.8" />
      <rect x={w * 0.08} y={h * 0.19} width={w * 0.84} height={h * 0.38} rx={3} fill={INK} opacity="0.18" />
      <rect x={w * 0.08} y={h * 0.63} width={w * 0.6} height={h * 0.04} rx={2} fill={INK} opacity="0.4" />
      <rect x={w * 0.08} y={h * 0.71} width={w * 0.45} height={h * 0.04} rx={2} fill={INK} opacity="0.4" />
      <rect x={w * 0.08} y={h * 0.9} width={w * 0.3} height={h * 0.045} rx={2} fill={INK} opacity="0.8" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · Masking tape jig                                                */
/* ------------------------------------------------------------------ */

export function TapeJigDiagram() {
  const t = useT();
  return (
    <Frame label={t('Klebeband-Schablone für Auto-Capture', 'Masking tape jig for auto-capture')}>
      {/* table */}
      <rect width="480" height="300" fill="#1c2130" />
      <g opacity="0.25" stroke={LINE} strokeWidth="1">
        <line x1="0" y1="75" x2="480" y2="75" />
        <line x1="0" y1="150" x2="480" y2="150" />
        <line x1="0" y1="225" x2="480" y2="225" />
      </g>

      {/* tape corner: left strip + bottom strip */}
      <rect x="150" y="62" width="16" height="176" rx="2" fill={TAPE} />
      <rect x="150" y="222" width="150" height="16" rx="2" fill={TAPE} />
      <Caption x={142} y={56} anchor="end" color={TAPE}>
        {t('Klebeband', 'Masking tape')}
      </Caption>

      {/* cards sliding into the corner one after another */}
      <g>
        <animateTransform attributeName="transform" type="translate" dur="4.8s" repeatCount="indefinite" keyTimes="0;0.18;0.62;0.8;1" values="260 0;0 0;0 0;0 -260;0 -260" calcMode="spline" keySplines=".3 0 .2 1;0 0 1 1;.6 0 .8 .6;0 0 1 1" />
        <MiniCard x={168} y={64} w={112} />
      </g>

      {/* phone viewfinder above the jig */}
      <rect x="138" y="34" width="174" height="232" rx="18" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeDasharray="10 7" opacity="0.7" />
      <Caption x={225} y={24} anchor="middle">
        {t('Smartphone fest darüber (Stativ / Glas)', 'Phone fixed above (stand / glass)')}
      </Caption>

      {/* auto-capture flash + check */}
      <rect x="168" y="64" width="112" height="156" rx="7" fill="none" stroke={MINT} strokeWidth="4" opacity="0">
        <animate attributeName="opacity" dur="4.8s" repeatCount="indefinite" keyTimes="0;0.3;0.36;0.6;0.64;1" values="0;0;1;1;0;0" />
      </rect>
      <g opacity="0">
        <animate attributeName="opacity" dur="4.8s" repeatCount="indefinite" keyTimes="0;0.38;0.44;0.6;0.64;1" values="0;0;1;1;0;0" />
        <circle cx="372" cy="142" r="30" fill={MINT} />
        <path d="M358 142l10 10 18-22" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <Caption x={372} y={196} anchor="middle" color={MINT}>
          Auto-Capture
        </Caption>
      </g>

      <Caption x={24} y={150} color="#94a3b8">
        {t('1 · anlegen', '1 · slide in')}
      </Caption>
      <Caption x={24} y={172} color="#94a3b8">
        {t('2 · warten', '2 · wait')}
      </Caption>
      <Caption x={24} y={194} color="#94a3b8">
        {t('3 · nächste', '3 · next')}
      </Caption>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Window daylight & tilt angle                                    */
/* ------------------------------------------------------------------ */

export function DaylightAngleDiagram() {
  const t = useT();
  return (
    <Frame label={t('Reflexionsfreies Scannen mit Fensterlicht und 10–15° Neigung', 'Glare-free scanning with window light and a 10–15° tilt')}>
      <rect width="480" height="300" fill="#141926" />
      {/* window */}
      <rect x="18" y="36" width="54" height="150" rx="4" fill="#cfe8ff" opacity="0.9" />
      <line x1="45" y1="36" x2="45" y2="186" stroke="#141926" strokeWidth="3" />
      <line x1="18" y1="111" x2="72" y2="111" stroke="#141926" strokeWidth="3" />
      <Caption x={45} y={206} anchor="middle" color="#cfe8ff">
        {t('Fenster', 'Window')}
      </Caption>

      {/* table */}
      <rect x="0" y="248" width="480" height="52" fill="#1f2535" />

      {/* soft daylight rays */}
      <g stroke="#cfe8ff" strokeWidth="2.5" strokeDasharray="6 9" opacity="0.75" fill="none">
        <path d="M76 90 L250 214">
          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
        <path d="M76 120 L290 206">
          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
        <path d="M76 150 L330 198">
          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
      </g>
      {/* reflections leave to the right – away from the lens */}
      <g stroke={VOLT} strokeWidth="2.5" strokeDasharray="6 9" opacity="0.8" fill="none">
        <path d="M250 214 L440 150">
          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
        <path d="M330 198 L460 172">
          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
      </g>
      <Caption x={452} y={140} anchor="end" color={VOLT}>
        {t('Spiegelung geht vorbei', 'Glare misses the lens')}
      </Caption>

      {/* tilted binder page (12°), pivot at its right edge */}
      <g transform="rotate(-12 380 246)">
        <rect x="200" y="236" width="180" height="10" rx="3" fill="#e2e8f0" />
        <rect x="210" y="231" width="46" height="6" rx="2" fill={VOLT} />
        <rect x="266" y="231" width="46" height="6" rx="2" fill={VOLT} />
        <rect x="322" y="231" width="46" height="6" rx="2" fill={VOLT} />
      </g>
      {/* wedge under the left edge */}
      <path d="M196 248 L232 248 L196 214 Z" fill="#475569" />
      {/* angle arc */}
      <path d="M300 246 A80 80 0 0 0 302 229" fill="none" stroke={MINT} strokeWidth="3" />
      <Caption x={250} y={278} anchor="middle" color={MINT}>
        10–15°
      </Caption>

      {/* camera straight above the page */}
      <g>
        <rect x="262" y="34" width="56" height="34" rx="6" fill="#e2e8f0" />
        <rect x="280" y="68" width="20" height="14" rx="3" fill="#94a3b8" />
        <line x1="290" y1="84" x2="290" y2="208" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 6" />
        <Caption x={330} y={56}>
          {t('Kamera senkrecht', 'Camera straight down')}
        </Caption>
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Tripod bulk import (3x3 slicing)                                 */
/* ------------------------------------------------------------------ */

export function TripodBulkDiagram() {
  const t = useT();
  const cells = Array.from({ length: 9 }, (_, i) => ({ col: i % 3, row: Math.floor(i / 3), i }));
  return (
    <Frame label={t('Stativ-Bulk-Import einer 3×3-Albumseite', 'Tripod bulk import of a 3×3 binder page')}>
      <rect width="480" height="300" fill="#141926" />

      {/* tripod + camera */}
      <g stroke="#94a3b8" strokeWidth="5" strokeLinecap="round">
        <line x1="92" y1="78" x2="40" y2="270" />
        <line x1="92" y1="78" x2="150" y2="270" />
        <line x1="92" y1="78" x2="96" y2="270" />
      </g>
      <rect x="62" y="40" width="64" height="42" rx="7" fill="#e2e8f0" />
      <circle cx="94" cy="61" r="12" fill={INK} />
      <circle cx="94" cy="61" r="5" fill="#475569" />
      <Caption x={94} y={28} anchor="middle">
        {t('Stativ, hohe Auflösung', 'Tripod, high resolution')}
      </Caption>

      {/* binder page */}
      <rect x="212" y="26" width="226" height="250" rx="10" fill={PANEL} stroke={LINE} strokeWidth="2" />
      {cells.map(({ col, row, i }) => {
        const x = 226 + col * 68;
        const y = 38 + row * 78;
        const begin = `${i * 0.45}s`;
        return (
          <g key={i}>
            <rect x={x} y={y} width="62" height="72" rx="4" fill={VOLT} opacity="0.22" />
            <rect x={x} y={y} width="62" height="72" rx="4" fill="none" stroke={VOLT} strokeWidth="3" opacity="0">
              <animate attributeName="opacity" values="0;1;1;0.35" keyTimes="0;0.1;0.6;1" dur="5.4s" begin={begin} repeatCount="indefinite" />
            </rect>
            <text x={x + 31} y={y + 43} textAnchor="middle" fontSize="20" fontWeight="700" fill={VOLT} opacity="0" fontFamily="system-ui, sans-serif">
              {i + 1}
              <animate attributeName="opacity" values="0;1;1;0.35" keyTimes="0;0.1;0.6;1" dur="5.4s" begin={begin} repeatCount="indefinite" />
            </text>
          </g>
        );
      })}

      {/* field of view */}
      <path d="M126 62 L212 26 M126 62 L212 276" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="5 7" opacity="0.5" fill="none" />
      <Caption x={325} y={294} anchor="middle" color="#94a3b8">
        {t('1 Foto → 9 Karten', '1 photo → 9 cards')}
      </Caption>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Duplicate auto-route                                            */
/* ------------------------------------------------------------------ */

export function AutoRouteDiagram() {
  const t = useT();
  return (
    <Frame label={t('Doppelte Karten wandern automatisch in die Tauschmappe', 'Duplicates are routed to the trade binder automatically')}>
      <rect width="480" height="300" fill="#141926" />

      {/* destinations */}
      <rect x="318" y="34" width="140" height="96" rx="12" fill={PANEL} stroke={MINT} strokeWidth="2" />
      <Caption x={388} y={62} anchor="middle" color={MINT}>
        {t('Hauptordner', 'Main binder')}
      </Caption>
      <Caption x={388} y={84} anchor="middle" color="#94a3b8">
        {t('neu → +1', 'new → +1')}
      </Caption>
      <rect x="318" y="170" width="140" height="96" rx="12" fill={PANEL} stroke={VOLT} strokeWidth="2" />
      <Caption x={388} y={198} anchor="middle" color={VOLT}>
        {t('Tauschmappe', 'Trade binder')}
      </Caption>
      <Caption x={388} y={220} anchor="middle" color="#94a3b8">
        {t('doppelt → +1', 'duplicate → +1')}
      </Caption>

      {/* scanner */}
      <rect x="22" y="92" width="92" height="116" rx="12" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeDasharray="9 6" />
      <Caption x={68} y={232} anchor="middle">
        {t('Scan', 'Scan')}
      </Caption>

      {/* routes */}
      <path d="M118 150 C200 150 220 82 314 82" fill="none" stroke={MINT} strokeWidth="2" strokeDasharray="5 7" opacity="0.6" />
      <path d="M118 150 C200 150 220 218 314 218" fill="none" stroke={VOLT} strokeWidth="2" strokeDasharray="5 7" opacity="0.6" />

      {/* first card: new → main binder */}
      <g opacity="0">
        <animate attributeName="opacity" dur="6s" repeatCount="indefinite" keyTimes="0;0.02;0.42;0.46;1" values="0;1;1;0;0" />
        <animateMotion dur="6s" repeatCount="indefinite" keyTimes="0;0.14;0.42;1" keyPoints="0;0;1;1" calcMode="linear" path="M44 110 C150 110 200 46 330 46" />
        <MiniCard x={0} y={0} w={44} tint={MINT} />
      </g>
      {/* second copy: duplicate → trade binder */}
      <g opacity="0">
        <animate attributeName="opacity" dur="6s" repeatCount="indefinite" keyTimes="0;0.5;0.52;0.92;0.96;1" values="0;0;1;1;0;0" />
        <animateMotion dur="6s" repeatCount="indefinite" keyTimes="0;0.64;0.92;1" keyPoints="0;0;1;1" calcMode="linear" path="M44 110 C150 110 200 186 330 186" />
        <MiniCard x={0} y={0} w={44} tint={VOLT} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Printable A4 calibration mat                                         */
/* ------------------------------------------------------------------ */

/** Corner registration mark (L-shape + crosshair), sizes in millimetres. */
function RegistrationMark({ x, y, flipX, flipY }: { x: number; y: number; flipX?: boolean; flipY?: boolean }) {
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${sx} ${sy})`} stroke="#000" fill="none">
      <path d="M0 9 L0 0 L9 0" strokeWidth="1.2" />
      <circle cx="0" cy="0" r="2.2" strokeWidth="0.4" />
      <path d="M-3.5 0 H3.5 M0 -3.5 V3.5" strokeWidth="0.3" />
    </g>
  );
}

/**
 * A4 mat (210 × 297 mm) with true-to-scale 63 × 88 mm card outlines.
 * Print at 100 % ("actual size"), not "fit to page".
 */
export function CalibrationMat({ layout, title, hint }: { layout: '1x1' | '2x2'; title: string; hint: string }) {
  const CARD_W = 63;
  const CARD_H = 88;
  const gap = 8;
  const cols = layout === '2x2' ? 2 : 1;
  const rows = layout === '2x2' ? 2 : 1;
  const areaW = cols * CARD_W + (cols - 1) * gap;
  const areaH = rows * CARD_H + (rows - 1) * gap;
  const originX = (210 - areaW) / 2;
  const originY = (297 - areaH) / 2;
  const margin = 9;

  return (
    <svg viewBox="0 0 210 297" width="210mm" height="297mm" xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff', maxWidth: '100%', height: 'auto' }}>
      <rect width="210" height="297" fill="#fff" />
      <text x="105" y="22" textAnchor="middle" fontSize="6" fontWeight="700" fill="#000" fontFamily="Arial, sans-serif">
        {title}
      </text>
      <text x="105" y="29" textAnchor="middle" fontSize="3.2" fill="#444" fontFamily="Arial, sans-serif">
        {hint}
      </text>

      {Array.from({ length: rows * cols }, (_, i) => {
        const x = originX + (i % cols) * (CARD_W + gap);
        const y = originY + Math.floor(i / cols) * (CARD_H + gap);
        return (
          <g key={i}>
            <rect x={x} y={y} width={CARD_W} height={CARD_H} rx="3" fill="none" stroke="#000" strokeWidth="0.5" strokeDasharray="2 1.5" />
            {/* target zones: name on top, collector number bottom-left */}
            <rect x={x + CARD_W * 0.05} y={y + CARD_H * 0.035} width={CARD_W * 0.74} height={CARD_H * 0.085} fill="none" stroke="#999" strokeWidth="0.25" />
            <rect x={x + CARD_W * 0.03} y={y + CARD_H * 0.9} width={CARD_W * 0.5} height={CARD_H * 0.08} fill="none" stroke="#999" strokeWidth="0.25" />
            <text x={x + CARD_W / 2} y={y + CARD_H / 2} textAnchor="middle" fontSize="3.4" fill="#999" fontFamily="Arial, sans-serif">
              63 × 88 mm
            </text>
          </g>
        );
      })}

      <RegistrationMark x={originX - margin} y={originY - margin} />
      <RegistrationMark x={originX + areaW + margin} y={originY - margin} flipX />
      <RegistrationMark x={originX - margin} y={originY + areaH + margin} flipY />
      <RegistrationMark x={originX + areaW + margin} y={originY + areaH + margin} flipX flipY />

      {/* 50 mm ruler to verify the print scale */}
      <g transform="translate(80 272)" stroke="#000" strokeWidth="0.3">
        <line x1="0" y1="0" x2="50" y2="0" />
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1={i * 10} y1="-2" x2={i * 10} y2="2" />
        ))}
        <text x="25" y="7" textAnchor="middle" fontSize="3" stroke="none" fill="#000" fontFamily="Arial, sans-serif">
          50 mm
        </text>
      </g>
    </svg>
  );
}
