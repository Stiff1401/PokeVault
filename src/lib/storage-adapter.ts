'use client';

import { useSyncExternalStore } from 'react';
import {
  db,
  newId,
  nowIso,
  type CollectionItem,
  type Condition,
  type TargetSet,
  type Variant,
} from './db';
import { ensureCards } from './tcg-api';
import { accessToken, getVaultConfig, saveVaultConfig, type VaultConfig } from './vault';

/* ------------------------------------------------------------------ */
/* Repository contract                                                 */
/* ------------------------------------------------------------------ */

export type Binder = 'vault' | 'trade';

export interface AddCopyInput {
  cardId: string;
  binder: Binder;
  variant?: Variant;
  condition?: Condition;
  quantity?: number;
  customScanDataUrl?: string | null;
}

export interface TradeGive {
  itemId: string;
  quantity: number;
}

export interface TradeReceive {
  cardId: string;
  quantity: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

/**
 * Single write API of the app. Reads go through Dexie live queries
 * (`useVaultData` etc.) – both drivers keep IndexedDB as the local source of
 * truth, the remote driver additionally replicates it to a backend.
 */
export interface VaultRepository {
  readonly remote: boolean;
  addCopy(input: AddCopyInput): Promise<CollectionItem>;
  /** Moves one copy between main binder and trade binder. */
  moveCopy(itemId: string, to: Binder): Promise<void>;
  /** Changes a quantity by `delta`; rows without copies or reservation are removed. */
  adjust(itemId: string, binder: Binder, delta: number): Promise<void>;
  updateItem(itemId: string, patch: Partial<Pick<CollectionItem, 'variant' | 'condition'>>): Promise<void>;
  removeItem(itemId: string): Promise<void>;
  /** Marks/unmarks a card as "Als Geschenk vorgemerkt" (allowed for viewers). */
  setReservation(cardId: string, reservedBy: string | null): Promise<void>;
  pinSet(set: Omit<TargetSet, 'addedAt' | 'updatedAt'>): Promise<void>;
  unpinSet(setId: string): Promise<void>;
  /** Atomically removes given trade copies and adds received cards to the main binder. */
  applyTrade(give: TradeGive[], receive: TradeReceive[]): Promise<void>;
  /** Bulk upsert used by CSV/JSON import. */
  importData(items: CollectionItem[], targetSets: TargetSet[]): Promise<number>;
  sync(): Promise<SyncResult>;
}

export class ReadOnlyVaultError extends Error {
  constructor() {
    super('This vault is read-only for the gift viewer role.');
    this.name = 'ReadOnlyVaultError';
  }
}

/* ------------------------------------------------------------------ */
/* Local driver                                                        */
/* ------------------------------------------------------------------ */

export class LocalIndexedDbDriver implements VaultRepository {
  readonly remote: boolean = false;

  constructor(protected readonly config: VaultConfig) {}

  protected assertEditor(): void {
    if (this.config.role !== 'editor') throw new ReadOnlyVaultError();
  }

  /** Hook for the remote driver. */
  protected changed(): void {}

  private async dropRow(item: CollectionItem): Promise<void> {
    await db.collection.delete(item.id);
    await db.tombstones.put({ key: `collection:${item.id}`, kind: 'collection', id: item.id, updatedAt: nowIso() });
  }

  private async saveOrDrop(item: CollectionItem): Promise<void> {
    item.vaultQuantity = Math.max(0, item.vaultQuantity);
    item.tradeQuantity = Math.max(0, item.tradeQuantity);
    item.updatedAt = nowIso();
    if (item.vaultQuantity + item.tradeQuantity === 0 && !item.reservedAsGiftBy) await this.dropRow(item);
    else await db.collection.put(item);
  }

  async addCopy(input: AddCopyInput): Promise<CollectionItem> {
    this.assertEditor();
    const variant = input.variant ?? 'Normal';
    const condition = input.condition ?? 'Near Mint';
    const quantity = Math.max(1, input.quantity ?? 1);

    const result = await db.transaction('rw', db.collection, db.tombstones, async () => {
      const rows = await db.collection.where('cardId').equals(input.cardId).toArray();
      // Reuse a matching stack, or an empty gift-reservation placeholder.
      let row =
        rows.find((r) => r.variant === variant && r.condition === condition) ??
        rows.find((r) => r.vaultQuantity + r.tradeQuantity === 0);
      if (row) {
        row.variant = variant;
        row.condition = condition;
        if (input.binder === 'vault') row.vaultQuantity += quantity;
        else row.tradeQuantity += quantity;
        if (input.customScanDataUrl) row.customScanDataUrl = input.customScanDataUrl;
        row.updatedAt = nowIso();
      } else {
        const now = nowIso();
        row = {
          id: newId(),
          cardId: input.cardId,
          variant,
          condition,
          vaultQuantity: input.binder === 'vault' ? quantity : 0,
          tradeQuantity: input.binder === 'trade' ? quantity : 0,
          reservedAsGiftBy: null,
          customScanDataUrl: input.customScanDataUrl ?? null,
          acquiredAt: now,
          updatedAt: now,
        };
      }
      await db.collection.put(row);
      return row;
    });
    this.changed();
    return result;
  }

  async moveCopy(itemId: string, to: Binder): Promise<void> {
    this.assertEditor();
    await db.transaction('rw', db.collection, db.tombstones, async () => {
      const row = await db.collection.get(itemId);
      if (!row) return;
      if (to === 'trade' && row.vaultQuantity > 0) {
        row.vaultQuantity -= 1;
        row.tradeQuantity += 1;
      } else if (to === 'vault' && row.tradeQuantity > 0) {
        row.tradeQuantity -= 1;
        row.vaultQuantity += 1;
      } else return;
      await this.saveOrDrop(row);
    });
    this.changed();
  }

  async adjust(itemId: string, binder: Binder, delta: number): Promise<void> {
    this.assertEditor();
    await db.transaction('rw', db.collection, db.tombstones, async () => {
      const row = await db.collection.get(itemId);
      if (!row) return;
      if (binder === 'vault') row.vaultQuantity += delta;
      else row.tradeQuantity += delta;
      await this.saveOrDrop(row);
    });
    this.changed();
  }

  async updateItem(itemId: string, patch: Partial<Pick<CollectionItem, 'variant' | 'condition'>>): Promise<void> {
    this.assertEditor();
    await db.collection.update(itemId, { ...patch, updatedAt: nowIso() });
    this.changed();
  }

  async removeItem(itemId: string): Promise<void> {
    this.assertEditor();
    await db.transaction('rw', db.collection, db.tombstones, async () => {
      const row = await db.collection.get(itemId);
      if (row) await this.dropRow(row);
    });
    this.changed();
  }

  async setReservation(cardId: string, reservedBy: string | null): Promise<void> {
    await db.transaction('rw', db.collection, db.tombstones, async () => {
      const rows = await db.collection.where('cardId').equals(cardId).toArray();
      const now = nowIso();
      if (reservedBy) {
        const row = rows[0];
        if (row) {
          await db.collection.update(row.id, { reservedAsGiftBy: reservedBy, updatedAt: now });
        } else {
          // Missing card: an empty placeholder row carries the reservation.
          await db.collection.put({
            id: newId(),
            cardId,
            variant: 'Normal',
            condition: 'Near Mint',
            vaultQuantity: 0,
            tradeQuantity: 0,
            reservedAsGiftBy: reservedBy,
            customScanDataUrl: null,
            acquiredAt: now,
            updatedAt: now,
          });
        }
      } else {
        for (const row of rows) {
          if (!row.reservedAsGiftBy) continue;
          row.reservedAsGiftBy = null;
          if (this.config.role === 'viewer') {
            // Viewers cannot sync deletions, so the empty placeholder row stays.
            await db.collection.update(row.id, { reservedAsGiftBy: null, updatedAt: now });
          } else {
            await this.saveOrDrop(row);
          }
        }
      }
    });
    this.changed();
  }

  async pinSet(set: Omit<TargetSet, 'addedAt' | 'updatedAt'>): Promise<void> {
    this.assertEditor();
    const now = nowIso();
    await db.transaction('rw', db.targetSets, db.tombstones, async () => {
      const existing = await db.targetSets.get(set.setId);
      await db.targetSets.put({ ...set, addedAt: existing?.addedAt ?? now, updatedAt: now });
      await db.tombstones.delete(`targetSets:${set.setId}`);
    });
    this.changed();
  }

  async unpinSet(setId: string): Promise<void> {
    this.assertEditor();
    await db.transaction('rw', db.targetSets, db.tombstones, async () => {
      await db.targetSets.delete(setId);
      await db.tombstones.put({ key: `targetSets:${setId}`, kind: 'targetSets', id: setId, updatedAt: nowIso() });
    });
    this.changed();
  }

  async applyTrade(give: TradeGive[], receive: TradeReceive[]): Promise<void> {
    this.assertEditor();
    await db.transaction('rw', db.collection, db.tombstones, async () => {
      for (const entry of give) {
        const row = await db.collection.get(entry.itemId);
        if (!row || row.tradeQuantity < entry.quantity) {
          throw new Error('Trade binder changed in the meantime – please review the trade.');
        }
        row.tradeQuantity -= entry.quantity;
        await this.saveOrDrop(row);
      }
      for (const entry of receive) {
        const rows = await db.collection.where('cardId').equals(entry.cardId).toArray();
        const now = nowIso();
        const row = rows.find((r) => r.variant === 'Normal' && r.condition === 'Near Mint') ?? rows[0];
        if (row) {
          row.vaultQuantity += entry.quantity;
          // The wish came true – a pending gift reservation is obsolete now.
          row.reservedAsGiftBy = null;
          row.updatedAt = now;
          await db.collection.put(row);
        } else {
          await db.collection.put({
            id: newId(),
            cardId: entry.cardId,
            variant: 'Normal',
            condition: 'Near Mint',
            vaultQuantity: entry.quantity,
            tradeQuantity: 0,
            reservedAsGiftBy: null,
            customScanDataUrl: null,
            acquiredAt: now,
            updatedAt: now,
          });
        }
      }
    });
    this.changed();
  }

  async importData(items: CollectionItem[], targetSets: TargetSet[]): Promise<number> {
    this.assertEditor();
    const now = nowIso();
    await db.transaction('rw', db.collection, db.targetSets, db.tombstones, async () => {
      await db.collection.bulkPut(items.map((i) => ({ ...i, updatedAt: now })));
      await db.targetSets.bulkPut(targetSets.map((s) => ({ ...s, updatedAt: now })));
      await db.tombstones.bulkDelete([
        ...items.map((i) => `collection:${i.id}`),
        ...targetSets.map((s) => `targetSets:${s.setId}`),
      ]);
    });
    this.changed();
    return items.length;
  }

  async sync(): Promise<SyncResult> {
    return { pushed: 0, pulled: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Remote sync                                                         */
/* ------------------------------------------------------------------ */

export type SyncKind = 'collection' | 'targetSets';

/** Wire format shared by the self-hosted API and the Supabase RPC functions. */
export interface SyncChange {
  kind: SyncKind;
  id: string;
  updatedAt: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface PullResponse {
  vaultName: string;
  role: 'editor' | 'viewer';
  cursor: string;
  changes: SyncChange[];
}

export interface SyncTransport {
  createVault(name: string, editorToken: string, viewerToken: string): Promise<void>;
  pull(since: string | null): Promise<PullResponse>;
  push(changes: SyncChange[]): Promise<number>;
}

export class SyncError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = (body as { error?: string; message?: string } | null) ?? null;
    throw new SyncError(detail?.error ?? detail?.message ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

/** Talks to `/api/vault/[vaultId]` of a self-hosted PokéVault server. */
export class SelfHostedTransport implements SyncTransport {
  constructor(
    private readonly endpoint: string,
    private readonly vaultId: string,
    private readonly token: string,
  ) {}

  private get url(): string {
    return `${this.endpoint.replace(/\/+$/, '')}/api/vault/${encodeURIComponent(this.vaultId)}/`;
  }

  private headers(): HeadersInit {
    return { 'Content-Type': 'application/json', 'x-vault-token': this.token };
  }

  async createVault(name: string, editorToken: string, viewerToken: string): Promise<void> {
    await parseJson(
      await fetch(this.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, editorToken, viewerToken }),
      }),
    );
  }

  async pull(since: string | null): Promise<PullResponse> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    return parseJson<PullResponse>(await fetch(`${this.url}${query}`, { headers: this.headers(), cache: 'no-store' }));
  }

  async push(changes: SyncChange[]): Promise<number> {
    const body = await parseJson<{ accepted: number }>(
      await fetch(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify({ changes }) }),
    );
    return body.accepted;
  }
}

/** Calls the `pv_*` Postgres functions from `supabase/schema.sql` via PostgREST. */
export class SupabaseTransport implements SyncTransport {
  constructor(
    private readonly projectUrl: string,
    private readonly anonKey: string,
    private readonly vaultId: string,
    private readonly token: string,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.projectUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
      },
      body: JSON.stringify(args),
    });
    return parseJson<T>(res);
  }

  async createVault(name: string, editorToken: string, viewerToken: string): Promise<void> {
    await this.rpc('pv_create_vault', {
      p_vault: this.vaultId,
      p_name: name,
      p_editor_token: editorToken,
      p_viewer_token: viewerToken,
    });
  }

  pull(since: string | null): Promise<PullResponse> {
    return this.rpc<PullResponse>('pv_pull', { p_vault: this.vaultId, p_token: this.token, p_since: since });
  }

  async push(changes: SyncChange[]): Promise<number> {
    const body = await this.rpc<{ accepted: number }>('pv_push', {
      p_vault: this.vaultId,
      p_token: this.token,
      p_changes: changes,
    });
    return body.accepted;
  }
}

export async function createTransport(config: VaultConfig): Promise<SyncTransport> {
  const token = await accessToken(config.vaultId, config.pin);
  if (config.driver === 'supabase') {
    return new SupabaseTransport(config.supabaseUrl, config.supabaseAnonKey, config.vaultId, token);
  }
  return new SelfHostedTransport(config.endpoint, config.vaultId, token);
}

/** Registers a freshly created vault at the backend (called once during onboarding). */
export async function registerRemoteVault(config: VaultConfig): Promise<void> {
  const transport = await createTransport(config);
  const [editorToken, viewerToken] = await Promise.all([
    accessToken(config.vaultId, config.pin),
    accessToken(config.vaultId, config.viewerPin),
  ]);
  await transport.createVault(config.name, editorToken, viewerToken);
}

/* ---------------- sync status store (for the UI) ------------------- */

export interface SyncStatus {
  state: 'local' | 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  error: string | null;
}

let status: SyncStatus = { state: 'local', lastSyncAt: null, error: null };
const statusListeners = new Set<() => void>();

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  statusListeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
    () => status,
  );
}

const PUSH_CHUNK = 400;

interface SyncState {
  cursor: string | null;
  lastPushAt: string | null;
}

function stateKey(vaultId: string): string {
  return `pv.sync.${vaultId}`;
}

function loadState(vaultId: string): SyncState {
  try {
    const raw = window.localStorage.getItem(stateKey(vaultId));
    if (raw) return JSON.parse(raw) as SyncState;
  } catch {
    /* ignore */
  }
  return { cursor: null, lastPushAt: null };
}

function saveState(vaultId: string, state: SyncState): void {
  try {
    window.localStorage.setItem(stateKey(vaultId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearSyncState(vaultId: string): void {
  try {
    window.localStorage.removeItem(stateKey(vaultId));
  } catch {
    /* ignore */
  }
}

function serializeItem(item: CollectionItem): Record<string, unknown> {
  // Personal scans stay on the device: they are large and private.
  const { customScanDataUrl: _scan, ...rest } = item;
  return rest;
}

/**
 * Offline-first replication: every write lands in IndexedDB first and is
 * pushed afterwards; remote changes are merged with last-write-wins on
 * `updatedAt`. Works against the self-hosted API or Supabase.
 */
export class RemoteSyncDriver extends LocalIndexedDbDriver {
  override readonly remote = true;
  private transport: Promise<SyncTransport> | null = null;
  private running: Promise<SyncResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rerun = false;

  constructor(config: VaultConfig) {
    super(config);
    setStatus({ state: 'idle', error: null });
  }

  private getTransport(): Promise<SyncTransport> {
    if (!this.transport) this.transport = createTransport(this.config);
    return this.transport;
  }

  protected override changed(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.sync().catch(() => undefined);
    }, 1200);
  }

  override sync(): Promise<SyncResult> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.runSync()
      .then((result) => {
        setStatus({ state: 'idle', lastSyncAt: nowIso(), error: null });
        return result;
      })
      .catch((err: unknown) => {
        setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) });
        throw err;
      })
      .finally(() => {
        this.running = null;
        if (this.rerun) {
          this.rerun = false;
          this.changed();
        }
      });
    return this.running;
  }

  private async collectLocalChanges(since: string | null): Promise<SyncChange[]> {
    const lower = since ?? '';
    const [items, sets, tombstones] = await Promise.all([
      db.collection.where('updatedAt').above(lower).toArray(),
      db.targetSets.where('updatedAt').above(lower).toArray(),
      db.tombstones.where('updatedAt').above(lower).toArray(),
    ]);
    const changes: SyncChange[] = [
      ...items.map<SyncChange>((i) => ({
        kind: 'collection',
        id: i.id,
        updatedAt: i.updatedAt,
        deleted: false,
        data: serializeItem(i),
      })),
      ...sets.map<SyncChange>((s) => ({
        kind: 'targetSets',
        id: s.setId,
        updatedAt: s.updatedAt,
        deleted: false,
        data: { ...s },
      })),
      ...tombstones.map<SyncChange>((t) => ({
        kind: t.kind,
        id: t.id,
        updatedAt: t.updatedAt,
        deleted: true,
        data: null,
      })),
    ];
    // Viewers may only write gift reservations; the backend enforces this too.
    return this.config.role === 'viewer' ? changes.filter((c) => c.kind === 'collection' && !c.deleted) : changes;
  }

  private async applyRemoteChanges(changes: SyncChange[]): Promise<string[]> {
    const touchedCards: string[] = [];
    await db.transaction('rw', db.collection, db.targetSets, db.tombstones, async () => {
      for (const change of changes) {
        const key = `${change.kind}:${change.id}`;
        const tombstone = await db.tombstones.get(key);
        const table = change.kind === 'collection' ? db.collection : db.targetSets;
        const local = (await table.get(change.id)) as { updatedAt: string } | undefined;

        if (change.deleted) {
          if (local && local.updatedAt > change.updatedAt) continue; // local edit is newer
          await table.delete(change.id);
          if (!tombstone || tombstone.updatedAt < change.updatedAt) {
            await db.tombstones.put({ key, kind: change.kind, id: change.id, updatedAt: change.updatedAt });
          }
          continue;
        }
        if (!change.data) continue;
        if (tombstone && tombstone.updatedAt >= change.updatedAt) continue; // deleted locally afterwards
        if (local && local.updatedAt >= change.updatedAt) continue;

        if (change.kind === 'collection') {
          const existing = local as CollectionItem | undefined;
          const incoming = change.data as unknown as CollectionItem;
          await db.collection.put({
            ...incoming,
            id: change.id,
            updatedAt: change.updatedAt,
            reservedAsGiftBy: incoming.reservedAsGiftBy ?? null,
            customScanDataUrl: existing?.customScanDataUrl ?? null,
          });
          touchedCards.push(incoming.cardId);
        } else {
          await db.targetSets.put({ ...(change.data as unknown as TargetSet), setId: change.id, updatedAt: change.updatedAt });
        }
        if (tombstone) await db.tombstones.delete(key);
      }
    });
    return touchedCards;
  }

  private async runSync(): Promise<SyncResult> {
    setStatus({ state: 'syncing' });
    const transport = await this.getTransport();
    const state = loadState(this.config.vaultId);

    const pushStartedAt = nowIso();
    const outgoing = await this.collectLocalChanges(state.lastPushAt);
    // Chunked so a first full upload of a large collection stays below request limits.
    for (let offset = 0; offset < outgoing.length; offset += PUSH_CHUNK) {
      await transport.push(outgoing.slice(offset, offset + PUSH_CHUNK));
    }
    state.lastPushAt = pushStartedAt;
    saveState(this.config.vaultId, state);

    const response = await transport.pull(state.cursor);
    const touchedCards = await this.applyRemoteChanges(response.changes);
    state.cursor = response.cursor;
    saveState(this.config.vaultId, state);

    const current = getVaultConfig();
    if (current && current.vaultId === this.config.vaultId && response.vaultName && current.name !== response.vaultName) {
      saveVaultConfig({ ...current, name: response.vaultName });
    }
    // Card metadata is a per-device cache – load what the other devices added.
    if (touchedCards.length) void ensureCards(touchedCards, { maxAgeMs: Number.MAX_SAFE_INTEGER });

    return { pushed: outgoing.length, pulled: response.changes.length };
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

let instance: { signature: string; repo: VaultRepository } | null = null;

export function createRepository(config: VaultConfig): VaultRepository {
  return config.driver === 'local' ? new LocalIndexedDbDriver(config) : new RemoteSyncDriver(config);
}

/** Repository for the active vault. Throws when onboarding has not happened yet. */
export function getRepository(): VaultRepository {
  const config = getVaultConfig();
  if (!config) throw new Error('No vault configured');
  const signature = [config.vaultId, config.driver, config.role, config.endpoint, config.supabaseUrl, config.pin].join('|');
  if (!instance || instance.signature !== signature) {
    if (config.driver === 'local') setStatus({ state: 'local', error: null, lastSyncAt: null });
    instance = { signature, repo: createRepository(config) };
  }
  return instance.repo;
}
