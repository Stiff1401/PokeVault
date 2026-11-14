import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Server-only helpers for the optional self-hosted backend
 * (`BUILD_TARGET=selfhost`). Never imported by client code.
 */

const globalForPrisma = globalThis as unknown as { pokevaultPrisma?: PrismaClient };

export const prisma = globalForPrisma.pokevaultPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.pokevaultPrisma = prisma;

export type VaultRole = 'editor' | 'viewer';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const VAULT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Resolves the role for a vault id + access token, or `null` when not authorised. */
export async function authorize(vaultId: string, token: string | null): Promise<{ role: VaultRole; name: string } | null> {
  if (!token || !TOKEN_PATTERN.test(token) || !VAULT_ID_PATTERN.test(vaultId)) return null;
  const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
  if (!vault) return null;
  const hash = sha256(token);
  if (safeEqual(hash, vault.editorTokenHash)) return { role: 'editor', name: vault.name };
  if (safeEqual(hash, vault.viewerTokenHash)) return { role: 'viewer', name: vault.name };
  return null;
}

/** CORS headers so a static PokéVault frontend on another origin can sync here. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.PV_CORS_ORIGINS ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-vault-token,x-vault-id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}
