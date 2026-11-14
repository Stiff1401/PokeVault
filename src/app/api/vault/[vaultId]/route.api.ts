import type { NextRequest } from 'next/server';
import { authorize, corsHeaders, json, prisma, sha256, TOKEN_PATTERN, VAULT_ID_PATTERN } from '@/server/vault-auth';

/**
 * Sync API of the optional self-hosted backend.
 *
 *   PUT  /api/vault/{vaultId}            create a vault        { name, editorToken, viewerToken }
 *   GET  /api/vault/{vaultId}?since=ISO  pull changes          header x-vault-token
 *   POST /api/vault/{vaultId}            push changes          header x-vault-token, { changes }
 *
 * The file is named `route.api.ts` so it only becomes a route in the
 * self-hosted build (see next.config.mjs); a static export cannot contain it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'collection' | 'targetSets';

interface SyncChange {
  kind: Kind;
  id: string;
  updatedAt: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

interface RouteContext {
  params: Promise<{ vaultId: string }>;
}

const MAX_CHANGES = 1000;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, max: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, max) : fallback);
const count = (value: unknown, fallback: number): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n < 100000 ? n : fallback;
};
const iso = (value: unknown, fallback: string): string => (typeof value === 'string' && ISO_PATTERN.test(value) ? value : fallback);

/** Timestamp that is guaranteed to be newer than `previous` (ISO strings sort lexicographically). */
function newerThan(previous: string | undefined): string {
  const now = new Date();
  if (previous && previous >= now.toISOString()) return new Date(new Date(previous).getTime() + 1).toISOString();
  return now.toISOString();
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  const origin = request.headers.get('origin');
  const { vaultId } = await context.params;
  const body = (await request.json().catch(() => null)) as { name?: unknown; editorToken?: unknown; viewerToken?: unknown } | null;
  const editorToken = text(body?.editorToken, 64);
  const viewerToken = text(body?.viewerToken, 64);
  if (!VAULT_ID_PATTERN.test(vaultId) || !TOKEN_PATTERN.test(editorToken) || !TOKEN_PATTERN.test(viewerToken)) {
    return json({ error: 'Invalid vault id or tokens' }, 400, origin);
  }
  const existing = await prisma.vault.findUnique({ where: { id: vaultId } });
  if (existing) {
    // Idempotent for the owner (retry after a network error), closed for everyone else.
    if (existing.editorTokenHash === sha256(editorToken)) return json({ ok: true, created: false }, 200, origin);
    return json({ error: 'Vault already exists' }, 409, origin);
  }
  await prisma.vault.create({
    data: {
      id: vaultId,
      name: text(body?.name, 80, 'PokéVault') || 'PokéVault',
      editorTokenHash: sha256(editorToken),
      viewerTokenHash: sha256(viewerToken),
    },
  });
  return json({ ok: true, created: true }, 201, origin);
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const origin = request.headers.get('origin');
  const { vaultId } = await context.params;
  const session = await authorize(vaultId, request.headers.get('x-vault-token'));
  if (!session) return json({ error: 'Unknown vault or wrong PIN' }, 401, origin);

  const sinceParam = request.nextUrl.searchParams.get('since');
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : new Date(0);
  // The cursor lags two seconds behind so writes that commit during this read are not skipped.
  const cursor = new Date(Date.now() - 2000).toISOString();

  const [items, sets] = await Promise.all([
    prisma.collectionItem.findMany({ where: { vaultId, syncedAt: { gt: since } } }),
    prisma.targetSet.findMany({ where: { vaultId, syncedAt: { gt: since } } }),
  ]);

  const changes: SyncChange[] = [
    ...items.map<SyncChange>((item) => ({
      kind: 'collection',
      id: item.id,
      updatedAt: item.updatedAt,
      deleted: item.deleted,
      data: item.deleted
        ? null
        : {
            id: item.id,
            cardId: item.cardId,
            variant: item.variant,
            condition: item.condition,
            vaultQuantity: item.vaultQuantity,
            tradeQuantity: item.tradeQuantity,
            reservedAsGiftBy: item.reservedAsGiftBy,
            acquiredAt: item.acquiredAt,
            updatedAt: item.updatedAt,
          },
    })),
    ...sets.map<SyncChange>((set) => ({
      kind: 'targetSets',
      id: set.setId,
      updatedAt: set.updatedAt,
      deleted: set.deleted,
      data: set.deleted
        ? null
        : {
            setId: set.setId,
            setName: set.setName,
            releaseDate: set.releaseDate,
            totalCards: set.totalCards,
            addedAt: set.addedAt,
            updatedAt: set.updatedAt,
          },
    })),
  ];

  return json({ vaultName: session.name, role: session.role, cursor, changes }, 200, origin);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const origin = request.headers.get('origin');
  const { vaultId } = await context.params;
  const session = await authorize(vaultId, request.headers.get('x-vault-token'));
  if (!session) return json({ error: 'Unknown vault or wrong PIN' }, 401, origin);

  const body = (await request.json().catch(() => null)) as { changes?: unknown } | null;
  if (!body || !Array.isArray(body.changes)) return json({ error: 'Body must be { changes: [] }' }, 400, origin);
  if (body.changes.length > MAX_CHANGES) return json({ error: `At most ${MAX_CHANGES} changes per request` }, 413, origin);

  const fallbackTime = new Date().toISOString();
  let accepted = 0;

  await prisma.$transaction(async (tx) => {
    for (const raw of body.changes as Partial<SyncChange>[]) {
      if (!raw || typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) continue;
      const updatedAt = iso(raw.updatedAt, fallbackTime);
      const data = (raw.data ?? {}) as Record<string, unknown>;
      const syncedAt = new Date();

      if (raw.kind === 'collection') {
        const key = { vaultId_id: { vaultId, id: raw.id } };
        const existing = await tx.collectionItem.findUnique({ where: key });

        if (session.role === 'viewer') {
          // Gift viewers may only set or clear a reservation – nothing else.
          if (raw.deleted) continue;
          const reservedAsGiftBy = text(data.reservedAsGiftBy, 60) || null;
          if (existing) {
            if (existing.deleted || existing.reservedAsGiftBy === reservedAsGiftBy) continue;
            await tx.collectionItem.update({
              where: key,
              data: { reservedAsGiftBy, updatedAt: newerThan(existing.updatedAt), syncedAt },
            });
            accepted++;
          } else if (reservedAsGiftBy && text(data.cardId, 80)) {
            // Reservation for a card the vault does not own yet: empty placeholder row.
            await tx.collectionItem.create({
              data: {
                vaultId,
                id: raw.id,
                cardId: text(data.cardId, 80),
                variant: 'Normal',
                condition: 'Near Mint',
                vaultQuantity: 0,
                tradeQuantity: 0,
                reservedAsGiftBy,
                acquiredAt: fallbackTime,
                updatedAt: newerThan(undefined),
                syncedAt,
              },
            });
            accepted++;
          }
          continue;
        }

        // Editors: last write wins on the client timestamp.
        if (existing && existing.updatedAt >= updatedAt) continue;
        if (raw.deleted) {
          if (!existing) continue;
          await tx.collectionItem.update({ where: key, data: { deleted: true, updatedAt, syncedAt } });
          accepted++;
          continue;
        }
        const cardId = text(data.cardId, 80);
        if (!cardId) continue;
        const fields = {
          cardId,
          variant: text(data.variant, 30, 'Normal') || 'Normal',
          condition: text(data.condition, 30, 'Near Mint') || 'Near Mint',
          vaultQuantity: count(data.vaultQuantity, 0),
          tradeQuantity: count(data.tradeQuantity, 0),
          reservedAsGiftBy: text(data.reservedAsGiftBy, 60) || null,
          acquiredAt: iso(data.acquiredAt, updatedAt),
          updatedAt,
          deleted: false,
          syncedAt,
        };
        await tx.collectionItem.upsert({ where: key, update: fields, create: { vaultId, id: raw.id, ...fields } });
        accepted++;
      } else if (raw.kind === 'targetSets') {
        if (session.role !== 'editor') continue;
        const key = { vaultId_setId: { vaultId, setId: raw.id } };
        const existing = await tx.targetSet.findUnique({ where: key });
        if (existing && existing.updatedAt >= updatedAt) continue;
        if (raw.deleted) {
          if (!existing) continue;
          await tx.targetSet.update({ where: key, data: { deleted: true, updatedAt, syncedAt } });
          accepted++;
          continue;
        }
        const fields = {
          setName: text(data.setName, 120, raw.id) || raw.id,
          releaseDate: text(data.releaseDate, 30),
          totalCards: count(data.totalCards, 0),
          addedAt: iso(data.addedAt, updatedAt),
          updatedAt,
          deleted: false,
          syncedAt,
        };
        await tx.targetSet.upsert({ where: key, update: fields, create: { vaultId, setId: raw.id, ...fields } });
        accepted++;
      }
    }
  });

  return json({ accepted }, 200, origin);
}
