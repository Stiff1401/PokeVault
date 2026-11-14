'use client';

import { useSyncExternalStore } from 'react';
import { newId, nowIso } from './db';

export type VaultRole = 'editor' | 'viewer';
export type VaultDriver = 'local' | 'selfhosted' | 'supabase';

export interface VaultConfig {
  vaultId: string;
  name: string;
  role: VaultRole;
  driver: VaultDriver;
  /** Base URL of a self-hosted PokéVault server (driver `selfhosted`). */
  endpoint: string;
  /** Supabase project URL + anon key (driver `supabase`). */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Role PIN of this device. Together with the vault id it forms the access token. */
  pin: string;
  /** Editors keep the viewer PIN so they can create gift-viewer invites. */
  viewerPin: string;
  /** Display name used for gift reservations, e.g. "Opa". */
  memberName: string;
  createdAt: string;
}

export interface InvitePayload {
  v: 1;
  i: string; // vault id
  n: string; // vault name
  r: VaultRole;
  d: VaultDriver;
  e?: string; // endpoint
  u?: string; // supabase url
  k?: string; // supabase anon key
  p: string; // pin for the invited role
  vp?: string; // viewer pin (only inside editor invites)
}

const KEY = 'vaultConfig';
const listeners = new Set<() => void>();
let cache: VaultConfig | null | undefined;

function read(): VaultConfig | null {
  if (typeof window === 'undefined') return null;
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as VaultConfig) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function getVaultConfig(): VaultConfig | null {
  return read();
}

export function saveVaultConfig(config: VaultConfig | null): void {
  cache = config;
  try {
    if (config) window.localStorage.setItem(KEY, JSON.stringify(config));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVaultConfig(): VaultConfig | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function useRole(): VaultRole {
  return useVaultConfig()?.role ?? 'editor';
}

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePin(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PIN_ALPHABET[b % PIN_ALPHABET.length]).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Access token sent to the sync backend. The backend only stores its hash. */
export function accessToken(vaultId: string, pin: string): Promise<string> {
  return sha256Hex(`${vaultId}:${pin.trim().toUpperCase()}`);
}

export function createVaultConfig(input: {
  name: string;
  driver: VaultDriver;
  endpoint?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): VaultConfig {
  return {
    vaultId: newId(),
    name: input.name.trim() || 'PokéVault',
    role: 'editor',
    driver: input.driver,
    endpoint: (input.endpoint ?? '').trim().replace(/\/+$/, ''),
    supabaseUrl: (input.supabaseUrl ?? '').trim().replace(/\/+$/, ''),
    supabaseAnonKey: (input.supabaseAnonKey ?? '').trim(),
    pin: generatePin(),
    viewerPin: generatePin(),
    memberName: '',
    createdAt: nowIso(),
  };
}

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function appBaseUrl(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${window.location.origin}${basePath}`;
}

export function buildInvite(config: VaultConfig, role: VaultRole): InvitePayload {
  const payload: InvitePayload = {
    v: 1,
    i: config.vaultId,
    n: config.name,
    r: role,
    d: config.driver,
    p: role === 'editor' ? config.pin : config.viewerPin,
  };
  if (config.driver === 'selfhosted') payload.e = config.endpoint;
  if (config.driver === 'supabase') {
    payload.u = config.supabaseUrl;
    payload.k = config.supabaseAnonKey;
  }
  if (role === 'editor') payload.vp = config.viewerPin;
  return payload;
}

/** The invite lives in the URL fragment so it never reaches a web server log. */
export function inviteUrl(payload: InvitePayload): string {
  return `${appBaseUrl()}/#join=${toBase64Url(JSON.stringify(payload))}`;
}

export function parseInvite(input: string): InvitePayload | null {
  const text = input.trim();
  if (!text) return null;
  const match = text.match(/[#?&]join=([A-Za-z0-9_-]+)/);
  const encoded = match ? match[1] : /^[A-Za-z0-9_-]{40,}$/.test(text) ? text : null;
  if (!encoded) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as InvitePayload;
    if (payload.v !== 1 || !payload.i || !payload.p || !payload.d) return null;
    if (payload.r !== 'editor' && payload.r !== 'viewer') return null;
    if (payload.d === 'local') return null;
    return payload;
  } catch {
    return null;
  }
}

export function configFromInvite(payload: InvitePayload, memberName: string): VaultConfig {
  return {
    vaultId: payload.i,
    name: payload.n || 'PokéVault',
    role: payload.r,
    driver: payload.d,
    endpoint: (payload.e ?? '').replace(/\/+$/, ''),
    supabaseUrl: (payload.u ?? '').replace(/\/+$/, ''),
    supabaseAnonKey: payload.k ?? '',
    pin: payload.p,
    viewerPin: payload.r === 'editor' ? (payload.vp ?? '') : payload.p,
    memberName: memberName.trim(),
    createdAt: nowIso(),
  };
}
