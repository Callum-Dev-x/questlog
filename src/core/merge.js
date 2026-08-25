// Merging two devices' documents. There is no server and no clock authority,
// so merging must be commutative and idempotent: merge(a,b) and merge(b,a)
// produce the same document, and merging twice changes nothing.
//
//   entries    – immutable facts, merged by union of ids (undo is itself an entry)
//   entities   – last-write-wins on updatedAt, ties broken by stable content order
//   tombstones – just entities with deletedAt, so deletes propagate like edits

import { COLLECTIONS } from './schema.js';

/** JSON with keys sorted, so equal-timestamp ties resolve the same way on both devices. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function timeOf(record) {
  const t = Date.parse(record && record.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

/** Pick the winner of two versions of the same record, deterministically. */
export function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (ta !== tb) return ta > tb ? a : b;
  const sa = stableStringify(a);
  const sb = stableStringify(b);
  if (sa === sb) return a;
  return sa > sb ? a : b;
}

function mergeCollection(local = {}, incoming = {}, stats, label) {
  const out = { ...local };
  for (const [id, record] of Object.entries(incoming)) {
    const mine = local[id];
    if (!mine) {
      out[id] = record;
      stats.added[label] = (stats.added[label] || 0) + 1;
      continue;
    }
    const winner = pickNewer(mine, record);
    if (winner !== mine && stableStringify(winner) !== stableStringify(mine)) {
      out[id] = winner;
      stats.updated[label] = (stats.updated[label] || 0) + 1;
    }
  }
  return out;
}

/**
 * @param {Object} local  the document on this device
 * @param {Object} incoming  a normalized document from an import file
 * @returns {{state:Object, stats:Object}}
 */
export function mergeStates(local, incoming, opts = {}) {
  const stats = { added: {}, updated: {}, entriesAdded: 0 };
  const next = { ...local };

  for (const collection of COLLECTIONS) {
    if (collection === 'entries') continue;
    next[collection] = mergeCollection(local[collection], incoming[collection], stats, collection);
  }

  // Entries are immutable: union by id, first one wins (they are identical anyway).
  const entries = { ...local.entries };
  for (const [id, entry] of Object.entries(incoming.entries || {})) {
    if (!entries[id]) {
      entries[id] = entry;
      stats.entriesAdded++;
    }
  }
  next.entries = entries;

  next.profile = pickNewer(local.profile, incoming.profile);
  next.settings = pickNewer(local.settings, incoming.settings);
  next.meta = {
    ...local.meta,
    lastImportAt: opts.now ? new Date(opts.now).toISOString() : new Date().toISOString(),
  };

  return { state: next, stats };
}

/** Flat count of everything the merge brought in — handy for the UI toast. */
export function summarizeMerge(stats) {
  const added = Object.values(stats.added).reduce((a, b) => a + b, 0);
  const updated = Object.values(stats.updated).reduce((a, b) => a + b, 0);
  const parts = [];
  if (added) parts.push(`${added} new item${added === 1 ? '' : 's'}`);
  if (updated) parts.push(`${updated} updated`);
  if (stats.entriesAdded) parts.push(`${stats.entriesAdded} XP record${stats.entriesAdded === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'already up to date';
}
