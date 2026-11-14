'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { analyzeCardFrame, CARD_ASPECT, CARD_REGIONS, elementRectToVideoRect, type FrameQuality } from '@/lib/image-quality';
import { captureCardCanvas, loadImage } from '@/lib/recognition';
import { updateSettings, useSettings } from '@/lib/settings';
import { Icon } from './ui';

const ANALYSIS_INTERVAL_MS = 300;
const AUTO_CAPTURE_HOLD_MS = 800;
const REARM_TIMEOUT_MS = 5000;

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraScannerProps {
  /** Receives a card-sized canvas (63:88) of the captured frame. */
  onCapture: (card: HTMLCanvasElement) => void;
  /** Pauses analysis and auto-capture, e.g. while a result is being confirmed. */
  paused?: boolean;
}

function feedback(sound: boolean): void {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* not supported */
  }
  if (!sound) return;
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio blocked */
  }
}

export default function CameraScanner({ onCapture, paused = false }: CameraScannerProps) {
  const t = useT();
  const settings = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvas = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [frame, setFrame] = useState<FrameRect | null>(null);
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);

  // Mutable loop state – kept in refs so the interval never goes stale.
  const okSince = useRef<number | null>(null);
  const armed = useRef(true);
  const disarmedAt = useRef(0);
  const sawBadFrame = useRef(false);
  const latest = useRef({ paused, settings, frame, onCapture });
  latest.current = { paused, settings, frame, onCapture };

  /* ---- camera ---- */
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('unsupported');
        return;
      }
      try {
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // Not in the TS lib yet; ignored by browsers that do not support it.
            advanced: [{ focusMode: 'continuous' }],
          },
        } as unknown as MediaStreamConstraints;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch (err) {
        setCameraError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /* ---- 63:88 guide frame, centred in the viewfinder ---- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      // Leave room for the status chips (top) and the result panel (bottom).
      const maxH = ch * 0.62;
      const maxW = cw * 0.8;
      const w = Math.min(maxW, maxH * CARD_ASPECT);
      const h = w / CARD_ASPECT;
      setFrame({ x: (cw - w) / 2, y: Math.max(64, (ch * 0.86 - h) / 2), w, h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const { frame: rect, settings: current, onCapture: emit } = latest.current;
    if (!video || !rect || !video.videoWidth) return;
    const source = elementRectToVideoRect(video, rect);
    const card = captureCardCanvas(video, source);
    feedback(current.soundFeedback);
    armed.current = false;
    disarmedAt.current = Date.now();
    sawBadFrame.current = false;
    okSince.current = null;
    setHoldProgress(0);
    emit(card);
  }, []);

  /* ---- 300 ms quality gate + auto-capture ---- */
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const { paused: isPaused, settings: current, frame: rect } = latest.current;
      if (!video || !rect || !video.videoWidth || isPaused || document.hidden) {
        okSince.current = null;
        setHoldProgress(0);
        return;
      }
      const canvas = (analysisCanvas.current ??= document.createElement('canvas'));
      canvas.width = 378;
      canvas.height = Math.round(378 / CARD_ASPECT);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const source = elementRectToVideoRect(video, rect);
      ctx.drawImage(video, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);
      const result = analyzeCardFrame(canvas, { sharpness: current.sharpnessThreshold, glare: current.glareThreshold });
      setQuality(result);

      // Re-arm once the previous card left the frame (or after a timeout).
      if (!armed.current) {
        if (!result.ok) sawBadFrame.current = true;
        if (sawBadFrame.current || Date.now() - disarmedAt.current > REARM_TIMEOUT_MS) armed.current = true;
      }

      if (!result.ok || !current.autoCapture || !armed.current) {
        okSince.current = null;
        setHoldProgress(0);
        return;
      }
      const now = Date.now();
      if (okSince.current === null) okSince.current = now;
      const held = now - okSince.current;
      setHoldProgress(Math.min(1, held / AUTO_CAPTURE_HOLD_MS));
      if (held >= AUTO_CAPTURE_HOLD_MS) capture();
    }, ANALYSIS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ready, capture]);

  /* ---- fallback: photo from the gallery / native camera app ---- */
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      let w = iw;
      let h = w / CARD_ASPECT;
      if (h > ih) {
        h = ih;
        w = h * CARD_ASPECT;
      }
      onCapture(captureCardCanvas(img, { x: (iw - w) / 2, y: (ih - h) / 2, w, h }));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const zone = (region: { x: number; y: number; w: number; h: number }, ok: boolean | undefined, label: string) => (
    <div
      className={`absolute rounded-md border-2 border-dashed transition-colors ${
        ok === undefined ? 'border-white/50' : ok ? 'border-mint-400' : 'border-volt-400'
      }`}
      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
    >
      <span className="absolute -top-4 left-0 whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-white/80">{label}</span>
    </div>
  );

  const statusChip = (ok: boolean | undefined, okText: string, badText: string) => (
    <span
      className={`rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur ${
        ok === undefined ? 'bg-black/50 text-white/70' : ok ? 'bg-mint-400/90 text-ink-950' : 'bg-volt-400/95 text-ink-950'
      }`}
    >
      {ok === undefined ? '…' : ok ? okText : badText}
    </span>
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted autoPlay />

      {cameraError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-ink-950 px-8 text-center">
          <Icon name="camera" className="h-10 w-10 text-slate-500" />
          <p className="text-sm text-slate-300">
            {cameraError === 'denied'
              ? t(
                  'Kamerazugriff wurde abgelehnt. Erlaube die Kamera in den Browser-Einstellungen oder wähle ein Foto.',
                  'Camera access was denied. Allow the camera in your browser settings or pick a photo.',
                )
              : t(
                  'Keine Kamera verfügbar (HTTPS erforderlich). Du kannst stattdessen ein Foto wählen.',
                  'No camera available (HTTPS required). You can pick a photo instead.',
                )}
          </p>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" className="h-4 w-4" /> {t('Foto wählen', 'Choose photo')}
          </button>
        </div>
      )}

      {frame && !cameraError && (
        <>
          {/* Guide frame – the huge shadow dims everything outside the card. */}
          <div
            className={`absolute rounded-[14px] border-2 transition-colors ${quality?.ok ? 'border-mint-400' : 'border-white/80'}`}
            style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, boxShadow: '0 0 0 9999px rgba(5,6,10,0.62)' }}
          >
            {zone(CARD_REGIONS.title, quality ? quality.glareOk : undefined, t('Kartenname', 'Card name'))}
            {zone(CARD_REGIONS.number, quality ? quality.focusOk : undefined, t('Nummer XXX/YYY', 'Number XXX/YYY'))}
            {settings.autoCapture && holdProgress > 0 && (
              <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-black/50">
                <div className="h-full rounded-full bg-mint-400 transition-[width] duration-300" style={{ width: `${holdProgress * 100}%` }} />
              </div>
            )}
          </div>

          {/* Live quality gate */}
          <div className="absolute inset-x-0 top-3 flex justify-center gap-2 px-3">
            {statusChip(quality?.focusOk, 'Focus: OK', t('Unscharf – ruhiger halten', 'Blurry – hold steady'))}
            {statusChip(quality?.glareOk, t('Licht: OK', 'Glare: OK'), t('Spiegelung – Karte leicht kippen', 'Glare – tilt the card slightly'))}
          </div>

          {/* Controls */}
          <div className="absolute inset-x-0 flex items-center justify-center gap-5" style={{ top: frame.y + frame.h + 14 }}>
            <button
              className={`rounded-full px-3.5 py-2 text-xs font-semibold backdrop-blur ${
                settings.autoCapture ? 'bg-mint-400 text-ink-950' : 'bg-black/60 text-white'
              }`}
              onClick={() => updateSettings({ autoCapture: !settings.autoCapture })}
              aria-pressed={settings.autoCapture}
            >
              {settings.autoCapture ? t('Auto-Capture an', 'Auto-capture on') : t('Auto-Capture aus', 'Auto-capture off')}
            </button>
            <button
              onClick={capture}
              disabled={paused}
              aria-label={t('Jetzt aufnehmen', 'Capture now')}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 backdrop-blur transition active:scale-95 disabled:opacity-40"
            >
              <span className="h-11 w-11 rounded-full bg-white" />
            </button>
            <button className="rounded-full bg-black/60 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur" onClick={() => fileRef.current?.click()}>
              {t('Foto', 'Photo')}
            </button>
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
