'use client';

import { useSyncExternalStore } from 'react';

export type UiLang = 'de' | 'en';
export type RecognitionEngine = 'ocr' | 'vision';
export type VisionProvider = 'gemini' | 'openai' | 'ollama';

export interface Settings {
  /** Language of the interface. */
  uiLang: UiLang;
  /** Language used for TCGdex card data (names, sets, stages). */
  cardLang: string;
  engine: RecognitionEngine;
  visionProvider: VisionProvider;
  /** BYOK key – stored only in this browser's localStorage. */
  visionApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
  autoCapture: boolean;
  /** Minimum Laplacian variance for "Focus: OK". */
  sharpnessThreshold: number;
  /** Maximum share (0..1) of clipped white pixels for "Licht: OK". */
  glareThreshold: number;
  /** YouTube/Vimeo/MP4 URL shown in the guide's video slot. */
  guideVideoUrl: string;
  /** Use the self-hosted `sharp` endpoint for binder slicing when available. */
  serverSlicing: boolean;
  soundFeedback: boolean;
}

export const CARD_LANGUAGES: { code: string; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

export const VISION_DEFAULTS: Record<VisionProvider, { baseUrl: string; model: string }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llava' },
};

export const DEFAULT_SETTINGS: Settings = {
  uiLang: 'de',
  cardLang: 'de',
  engine: 'ocr',
  visionProvider: 'gemini',
  visionApiKey: '',
  visionBaseUrl: VISION_DEFAULTS.gemini.baseUrl,
  visionModel: VISION_DEFAULTS.gemini.model,
  autoCapture: true,
  sharpnessThreshold: 55,
  glareThreshold: 0.03,
  guideVideoUrl: '',
  serverSlicing: false,
  soundFeedback: true,
};

const KEY = 'pv.settings';
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    cache = DEFAULT_SETTINGS;
  }
  return cache;
}

export function getSettings(): Settings {
  return read();
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...read(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
  listeners.forEach((l) => l());
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
}
