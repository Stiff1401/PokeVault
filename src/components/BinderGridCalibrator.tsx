'use client';

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '@/lib/i18n';
import { gridCells, type BinderGrid } from '@/lib/recognition';

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'move';

const MIN_SIZE = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Interactive 2x2 / 3x3 grid overlay on top of a binder page photo.
 * Drag the corner handles onto the outer pocket corners; the sliders adjust
 * the gaps between pockets. All values are normalised, so the grid can be
 * applied to the full-resolution original afterwards.
 */
export default function BinderGridCalibrator({
  imageUrl,
  grid,
  onChange,
}: {
  imageUrl: string;
  grid: BinderGrid;
  onChange: (grid: BinderGrid) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; startX: number; startY: number; origin: BinderGrid } | null>(null);

  const toNormalised = (event: ReactPointerEvent): { x: number; y: number } => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  };

  const start = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNormalised(event);
    drag.current = { handle, startX: point.x, startY: point.y, origin: grid };
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const point = toNormalised(event);
    const next = { ...state.origin };
    if (state.handle === 'move') {
      const width = state.origin.right - state.origin.left;
      const height = state.origin.bottom - state.origin.top;
      next.left = clamp(state.origin.left + point.x - state.startX, 0, 1 - width);
      next.top = clamp(state.origin.top + point.y - state.startY, 0, 1 - height);
      next.right = next.left + width;
      next.bottom = next.top + height;
    } else {
      if (state.handle === 'tl' || state.handle === 'bl') next.left = clamp(point.x, 0, state.origin.right - MIN_SIZE);
      if (state.handle === 'tr' || state.handle === 'br') next.right = clamp(point.x, state.origin.left + MIN_SIZE, 1);
      if (state.handle === 'tl' || state.handle === 'tr') next.top = clamp(point.y, 0, state.origin.bottom - MIN_SIZE);
      if (state.handle === 'bl' || state.handle === 'br') next.bottom = clamp(point.y, state.origin.top + MIN_SIZE, 1);
    }
    onChange(next);
  };

  const end = () => {
    drag.current = null;
  };

  // Cells in percent of the photo (computed on a 1x1 canvas).
  const cells = gridCells(grid, 1, 1);
  const handles: { id: Handle; x: number; y: number; cursor: string }[] = [
    { id: 'tl', x: grid.left, y: grid.top, cursor: 'nwse-resize' },
    { id: 'tr', x: grid.right, y: grid.top, cursor: 'nesw-resize' },
    { id: 'bl', x: grid.left, y: grid.bottom, cursor: 'nesw-resize' },
    { id: 'br', x: grid.right, y: grid.bottom, cursor: 'nwse-resize' },
  ];

  return (
    <div>
      <div ref={boxRef} className="relative mx-auto w-full max-w-xl touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={t('Foto der Albumseite', 'Binder page photo')} className="block w-full" draggable={false} />

        {/* Pocket area – drag to move */}
        <div
          className="absolute cursor-move border border-white/40"
          style={{
            left: `${grid.left * 100}%`,
            top: `${grid.top * 100}%`,
            width: `${(grid.right - grid.left) * 100}%`,
            height: `${(grid.bottom - grid.top) * 100}%`,
          }}
          onPointerDown={start('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />

        {cells.map((cell, index) => (
          <div
            key={index}
            className="pointer-events-none absolute rounded-md border-2 border-volt-400 bg-volt-400/10"
            style={{ left: `${cell.x * 100}%`, top: `${cell.y * 100}%`, width: `${cell.w * 100}%`, height: `${cell.h * 100}%` }}
          >
            <span className="tabular absolute left-1 top-1 rounded bg-volt-400 px-1.5 text-[11px] font-bold text-ink-950">{index + 1}</span>
          </div>
        ))}

        {handles.map((handle) => (
          <button
            key={handle.id}
            type="button"
            aria-label={t('Ecke ziehen', 'Drag corner')}
            className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none"
            style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%`, cursor: handle.cursor }}
            onPointerDown={start(handle.id)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink-950 bg-volt-400 shadow-lg" />
          </button>
        ))}
      </div>

      <div className="mx-auto mt-3 grid max-w-xl grid-cols-2 gap-4">
        <label className="text-xs text-slate-400">
          {t('Abstand horizontal', 'Horizontal gap')}
          <input
            type="range"
            min={0}
            max={0.12}
            step={0.002}
            value={grid.gapX}
            onChange={(e) => onChange({ ...grid, gapX: Number(e.target.value) })}
            className="mt-1 w-full accent-volt-400"
          />
        </label>
        <label className="text-xs text-slate-400">
          {t('Abstand vertikal', 'Vertical gap')}
          <input
            type="range"
            min={0}
            max={0.12}
            step={0.002}
            value={grid.gapY}
            onChange={(e) => onChange({ ...grid, gapY: Number(e.target.value) })}
            className="mt-1 w-full accent-volt-400"
          />
        </label>
      </div>
    </div>
  );
}
