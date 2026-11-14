'use client';

import {
  CONDITIONS,
  VARIANTS,
  db,
  newId,
  nowIso,
  type CollectionItem,
  type Condition,
  type PortfolioSnapshot,
  type PriceHistory,
  type TargetSet,
  type Variant,
} from './db';
import { getRepository } from './storage-adapter';
import { ensureCards } from './tcg-api';
import { getVaultConfig } from './vault';

/* ------------------------------------------------------------------ */
/* CSV primitives (RFC 4180)                                           */
/* ------------------------------------------------------------------ */

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/** Parses CSV text; auto-detects `,` vs `;` (German Excel) as delimiter. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const CSV_HEADER = [
  'cardId',
  'name',
  'setId',
  'setName',
  'cardNumber',
  'language',
  'category',
  'stage',
  'rarity',
  'variant',
  'condition',
  'vaultQuantity',
  'tradeQuantity',
  'reservedAsGiftBy',
  'acquiredAt',
  'cardmarketTrendEur',
];

export async function exportCollectionCsv(): Promise<string> {
  const items = await db.collection.toArray();
  const cards = await db.cards.bulkGet(items.map((i) => i.cardId));
  const rows = items.map((item, index) => {
    const card = cards[index];
    return [
      item.cardId,
      card?.name ?? '',
      card?.setId ?? '',
      card?.setName ?? '',
      card?.cardNumber ?? '',
      card?.language ?? '',
      card?.category ?? '',
      card?.stage ?? '',
      card?.rarity ?? '',
      item.variant,
      item.condition,
      item.vaultQuantity,
      item.tradeQuantity,
      item.reservedAsGiftBy ?? '',
      item.acquiredAt,
      card?.cardmarketTrendEur ?? '',
    ];
  });
  return toCsv(CSV_HEADER, rows);
}

export interface VaultBackup {
  format: 'pokevault-backup';
  version: 1;
  exportedAt: string;
  vaultName: string;
  collection: CollectionItem[];
  targetSets: TargetSet[];
  priceHistory: PriceHistory[];
  snapshots: PortfolioSnapshot[];
}

export async function exportBackupJson(): Promise<string> {
  const [collection, targetSets, priceHistory, snapshots] = await Promise.all([
    db.collection.toArray(),
    db.targetSets.toArray(),
    db.priceHistory.toArray(),
    db.snapshots.toArray(),
  ]);
  const backup: VaultBackup = {
    format: 'pokevault-backup',
    version: 1,
    exportedAt: nowIso(),
    vaultName: getVaultConfig()?.name ?? 'PokéVault',
    collection,
    targetSets,
    priceHistory,
    snapshots,
  };
  return JSON.stringify(backup, null, 2);
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  // BOM so Excel opens UTF-8 CSV files with umlauts correctly.
  const blob = new Blob(mime.includes('csv') ? ['﻿', content] : [content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export interface ImportReport {
  imported: number;
  skipped: number;
  errors: string[];
}

function asVariant(value: string): Variant {
  const wanted = value.trim().toLowerCase();
  if (/reverse/.test(wanted)) return 'Reverse Holo';
  if (/first|1st|erstausgabe/.test(wanted)) return 'First Edition';
  return VARIANTS.find((v) => v.toLowerCase() === wanted) ?? 'Normal';
}

function asCondition(value: string): Condition {
  const wanted = value.trim().toLowerCase();
  if (wanted === 'nm') return 'Near Mint';
  if (wanted === 'ex') return 'Excellent';
  if (wanted === 'gd') return 'Good';
  if (wanted === 'pl') return 'Played';
  return CONDITIONS.find((c) => c.toLowerCase() === wanted) ?? 'Near Mint';
}

function asQuantity(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Math.floor(Number(value.replace(',', '.')));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Imports a collection CSV. Required column: `cardId` (TCGdex id such as
 * `sv03.5-199`). Rows are merged by cardId + variant + condition and replace
 * the quantities of an existing matching stack.
 */
export async function importCollectionCsv(text: string): Promise<ImportReport> {
  const rows = parseCsv(text);
  const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
  if (rows.length < 2) {
    report.errors.push('CSV contains no data rows.');
    return report;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idCol = col('cardId');
  if (idCol < 0) {
    report.errors.push('Missing required column "cardId".');
    return report;
  }

  const existing = await db.collection.toArray();
  const byKey = new Map(existing.map((i) => [`${i.cardId}|${i.variant}|${i.condition}`, i]));
  const merged = new Map<string, CollectionItem>();
  const now = nowIso();

  rows.slice(1).forEach((row, index) => {
    const cell = (name: string): string | undefined => {
      const i = col(name);
      return i >= 0 ? row[i] : undefined;
    };
    const cardId = (row[idCol] ?? '').trim();
    if (!cardId) {
      report.skipped++;
      report.errors.push(`Row ${index + 2}: empty cardId.`);
      return;
    }
    const variant = asVariant(cell('variant') ?? '');
    const condition = asCondition(cell('condition') ?? '');
    const key = `${cardId}|${variant}|${condition}`;
    const previous = merged.get(key) ?? byKey.get(key);
    const vaultQuantity = asQuantity(cell('vaultQuantity') ?? cell('quantity'), 1);
    const tradeQuantity = asQuantity(cell('tradeQuantity'), 0);
    const acquired = cell('acquiredAt')?.trim();
    merged.set(key, {
      id: previous?.id ?? newId(),
      cardId,
      variant,
      condition,
      vaultQuantity,
      tradeQuantity,
      reservedAsGiftBy: cell('reservedAsGiftBy')?.trim() || previous?.reservedAsGiftBy || null,
      customScanDataUrl: previous?.customScanDataUrl ?? null,
      acquiredAt: acquired && !Number.isNaN(new Date(acquired).getTime()) ? new Date(acquired).toISOString() : (previous?.acquiredAt ?? now),
      updatedAt: now,
    });
  });

  // Verify the ids against TCGdex so typos do not create ghost rows.
  const ids = Array.from(new Set(Array.from(merged.values(), (i) => i.cardId)));
  const known = new Set((await ensureCards(ids)).map((c) => c.id));
  const valid = Array.from(merged.values()).filter((item) => {
    if (known.has(item.cardId)) return true;
    report.skipped++;
    report.errors.push(`Unknown card id "${item.cardId}".`);
    return false;
  });

  report.imported = await getRepository().importData(valid, []);
  return report;
}

/** Restores a JSON backup (merge by id – existing rows with the same id are replaced). */
export async function importBackupJson(text: string): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, skipped: 0, errors: [] };
  let backup: Partial<VaultBackup>;
  try {
    backup = JSON.parse(text) as Partial<VaultBackup>;
  } catch {
    report.errors.push('File is not valid JSON.');
    return report;
  }
  if (backup.format !== 'pokevault-backup' || !Array.isArray(backup.collection)) {
    report.errors.push('File is not a PokéVault backup.');
    return report;
  }
  const now = nowIso();
  const items: CollectionItem[] = [];
  for (const raw of backup.collection) {
    if (!raw || typeof raw.cardId !== 'string' || !raw.cardId) {
      report.skipped++;
      continue;
    }
    items.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      cardId: raw.cardId,
      variant: asVariant(String(raw.variant ?? '')),
      condition: asCondition(String(raw.condition ?? '')),
      vaultQuantity: asQuantity(String(raw.vaultQuantity ?? ''), 1),
      tradeQuantity: asQuantity(String(raw.tradeQuantity ?? ''), 0),
      reservedAsGiftBy: raw.reservedAsGiftBy ?? null,
      customScanDataUrl: raw.customScanDataUrl ?? null,
      acquiredAt: raw.acquiredAt ?? now,
      updatedAt: now,
    });
  }
  const targetSets: TargetSet[] = (backup.targetSets ?? [])
    .filter((s) => s && typeof s.setId === 'string')
    .map((s) => ({
      setId: s.setId,
      setName: s.setName ?? s.setId,
      releaseDate: s.releaseDate ?? '',
      totalCards: Number(s.totalCards) || 0,
      addedAt: s.addedAt ?? now,
      updatedAt: now,
    }));

  report.imported = await getRepository().importData(items, targetSets);
  if (Array.isArray(backup.priceHistory)) await db.priceHistory.bulkPut(backup.priceHistory.filter((p) => p && p.id));
  if (Array.isArray(backup.snapshots)) await db.snapshots.bulkPut(backup.snapshots.filter((s) => s && s.day));
  void ensureCards(items.map((i) => i.cardId));
  return report;
}
