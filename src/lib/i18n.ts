'use client';

import { useCallback } from 'react';
import { getSettings, useSettings, type UiLang } from './settings';

/**
 * Tiny inline i18n: every string is written once as a German/English pair
 * right where it is used – `t('Sammlung', 'Collection')`. No key files to
 * keep in sync, and missing translations are impossible by construction.
 */
export type Translate = (de: string, en: string) => string;

export function useT(): Translate {
  const { uiLang } = useSettings();
  return useCallback((de: string, en: string) => (uiLang === 'en' ? en : de), [uiLang]);
}

export function tNow(de: string, en: string): string {
  return getSettings().uiLang === 'en' ? en : de;
}

export function formatEur(value: number | null | undefined, lang: UiLang = getSettings().uiLang): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string, lang: UiLang = getSettings().uiLang): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'medium' }).format(d);
}

/* Canonical values are stored in German (see data model); these maps
   translate them for the English interface. */
const STAGE_EN: Record<string, string> = {
  Basis: 'Basic',
  'Phase 1': 'Stage 1',
  'Phase 2': 'Stage 2',
  Item: 'Item',
  Unterstützer: 'Supporter',
  Stadion: 'Stadium',
  Ausrüstung: 'Tool',
  'Basis-Energie': 'Basic Energy',
  'Spezial-Energie': 'Special Energy',
};

const TYPE_EN: Record<string, string> = {
  Feuer: 'Fire',
  Wasser: 'Water',
  Pflanze: 'Grass',
  Elektro: 'Lightning',
  Psycho: 'Psychic',
  Kampf: 'Fighting',
  Finsternis: 'Darkness',
  Metall: 'Metal',
  Drache: 'Dragon',
  Farblos: 'Colorless',
  Fee: 'Fairy',
};

const CATEGORY_EN: Record<string, string> = { Pokémon: 'Pokémon', Trainer: 'Trainer', Energie: 'Energy' };

const CONDITION_DE: Record<string, string> = {
  Mint: 'Mint',
  'Near Mint': 'Near Mint',
  Excellent: 'Excellent',
  Good: 'Gut',
  Played: 'Bespielt',
};

export function stageLabel(stage: string, lang: UiLang): string {
  return lang === 'en' ? (STAGE_EN[stage] ?? stage) : stage;
}
export function typeLabel(type: string, lang: UiLang): string {
  return lang === 'en' ? (TYPE_EN[type] ?? type) : type;
}
export function categoryLabel(category: string, lang: UiLang): string {
  return lang === 'en' ? (CATEGORY_EN[category] ?? category) : category;
}
export function conditionLabel(condition: string, lang: UiLang): string {
  return lang === 'en' ? condition : (CONDITION_DE[condition] ?? condition);
}
