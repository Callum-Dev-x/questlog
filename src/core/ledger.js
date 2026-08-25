// The XP ledger: an append-only list of immutable facts. Totals, levels and
// streaks are all *derived* from it, so two devices can merge by simply taking
// the union of their entries. Undo appends a 'void' entry rather than deleting.

import { newId } from './ids.js';
import { dayKey, timestamp } from './dates.js';

export const ENTRY_KINDS = ['habit', 'todo', 'milestone', 'project', 'perfect_day', 'void'];

/**
 * @typedef {{id:string, kind:string, refId:string|null, xp:number,
 *            day:string, at:string, meta:Object}} Entry
 */

export function makeEntry({ kind, refId = null, xp = 0, day, at, meta = {}, id }) {
  const when = at || timestamp();
  return {
    id: id || newId('e'),
    kind,
    refId,
    xp: Math.round(xp) || 0,
    day: day || dayKey(new Date(when)),
    at: when,
    meta,
  };
}

export function makeVoid(entryId, { at, day } = {}) {
  const when = at || timestamp();
  return {
    id: newId('v'),
    kind: 'void',
    refId: entryId,
    xp: 0,
    day: day || dayKey(new Date(when)),
    at: when,
    meta: {},
  };
}

export function entryList(entries) {
  return Array.isArray(entries) ? entries : Object.values(entries || {});
}

/** Ids of entries cancelled by a void entry. */
export function voidedIds(entries) {
  const out = new Set();
  for (const entry of entryList(entries)) {
    if (entry && entry.kind === 'void' && entry.refId) out.add(entry.refId);
  }
  return out;
}

/** Live entries: voids removed, and anything they cancelled removed. Sorted oldest → newest. */
export function effectiveEntries(entries) {
  const voided = voidedIds(entries);
  return entryList(entries)
    .filter((entry) => entry && entry.kind !== 'void' && !voided.has(entry.id))
    .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1));
}

export function totalXp(entries) {
  let sum = 0;
  for (const entry of effectiveEntries(entries)) sum += entry.xp || 0;
  return sum;
}

/** @returns {Map<string, number>} day key → XP earned that day */
export function xpByDay(entries) {
  const map = new Map();
  for (const entry of effectiveEntries(entries)) {
    map.set(entry.day, (map.get(entry.day) || 0) + (entry.xp || 0));
  }
  return map;
}

/** Live entries of a kind for one subject, optionally narrowed to a day. */
export function entriesFor(entries, { kind, refId, day } = {}) {
  return effectiveEntries(entries).filter((entry) => (
    (kind === undefined || entry.kind === kind)
    && (refId === undefined || entry.refId === refId)
    && (day === undefined || entry.day === day)
  ));
}

/** Days on which a habit was completed. @returns {Set<string>} */
export function completedDaysFor(entries, habitId) {
  const days = new Set();
  for (const entry of effectiveEntries(entries)) {
    if (entry.kind === 'habit' && entry.refId === habitId) days.add(entry.day);
  }
  return days;
}

/** Map of habitId → Set of completed days, built in one pass. */
export function completionsByHabit(entries) {
  const map = new Map();
  for (const entry of effectiveEntries(entries)) {
    if (entry.kind !== 'habit' || !entry.refId) continue;
    if (!map.has(entry.refId)) map.set(entry.refId, new Set());
    map.get(entry.refId).add(entry.day);
  }
  return map;
}
