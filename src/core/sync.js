// Sync protocol — the pure half. No network here: this decides *what* should
// happen, and syncclient.js does it.
//
// The document is stored remotely as one JSON blob per key. Because merging is
// commutative and idempotent, a lost write is self-healing: the device whose
// upload was dropped still holds its data and re-merges on the next attempt.
// That is what makes eventually-consistent storage (Cloudflare KV) safe here.

import { mergeStates, stableStringify } from './merge.js';
import { reconcileAfterMerge } from './state.js';
import { migrate, normalizeState } from './schema.js';

/** The key is the only secret: long, unguessable, and never sent in an export. */
export const SYNC_KEY_RE = /^[a-z0-9]{24,64}$/;
const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newSyncKey(length = 32) {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < length; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

export function isSyncKey(value) {
  return typeof value === 'string' && SYNC_KEY_RE.test(value);
}

/**
 * A sync link is the full document URL — one string to carry to the other
 * device, rather than two fields to copy separately.
 * @returns {{endpoint:string, key:string}}
 */
export function parseSyncLink(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('paste the sync link from your other device');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('that is not a valid sync link');
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !localhost) {
    throw new Error('the sync link must be https');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const key = parts[parts.length - 1];
  if (!isSyncKey(key)) {
    throw new Error('that link has no valid sync key on the end');
  }
  const endpoint = `${url.origin}/${parts.slice(0, -1).join('/')}`.replace(/\/$/, '');
  if (!endpoint.includes('/')) throw new Error('that link is missing its path');
  return { endpoint, key };
}

export function formatSyncLink(endpoint, key) {
  return `${String(endpoint).replace(/\/$/, '')}/${key}`;
}

/**
 * What actually travels: the document minus `meta`, which holds this device's
 * own id and import timestamp. Uploading meta would make every device see a
 * difference and re-upload forever.
 */
export function toSyncDoc(state) {
  const { meta, ...rest } = state;
  return rest;
}

export function fromSyncDoc(doc, localMeta) {
  const { state } = normalizeState(migrate({ ...doc, meta: localMeta }));
  return state;
}

/** True when two documents carry the same synced content. */
export function sameSyncContent(a, b) {
  return stableStringify(toSyncDoc(a)) === stableStringify(toSyncDoc(b));
}

/**
 * Decide the outcome of one sync round.
 *
 * @param {{local:Object, remote:Object|null, now?:Date}} input
 * @returns {{merged:Object, upload:boolean, changedLocally:boolean}}
 */
export function planSync({ local, remote, now }) {
  if (!remote) {
    // Nothing stored yet: this device seeds it.
    return { merged: local, upload: true, changedLocally: false };
  }
  const when = now || new Date();
  const { state: mergedRaw } = mergeStates(local, remote, { now: when });
  const merged = reconcileAfterMerge(mergedRaw, { now: when });
  return {
    merged,
    upload: !sameSyncContent(merged, remote),
    changedLocally: !sameSyncContent(merged, local),
  };
}

/** Validate what came back from the server before it touches app state. */
export function readRemote(payload, localMeta) {
  if (!payload || typeof payload !== 'object') throw new Error('the sync server sent something unreadable');
  if (!payload.doc || typeof payload.doc !== 'object') throw new Error('the sync server sent no document');
  const version = Number(payload.version);
  return {
    state: fromSyncDoc(payload.doc, localMeta),
    version: Number.isFinite(version) ? version : 0,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
}
