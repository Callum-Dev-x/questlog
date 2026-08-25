import { describe, it, expect } from './harness.js';
import {
  completedDaysFor, completionsByHabit, effectiveEntries, entriesFor,
  makeEntry, makeVoid, totalXp, voidedIds, xpByDay,
} from '../src/core/ledger.js';

function entry(over = {}) {
  return makeEntry({ kind: 'habit', refId: 'h1', xp: 5, day: '2026-01-05', at: '2026-01-05T09:00:00.000Z', ...over });
}

describe('ledger entries', () => {
  it('fills in id, day and rounded xp', () => {
    const e = makeEntry({ kind: 'todo', xp: 7.6, at: '2026-01-05T09:00:00.000Z', day: '2026-01-05' });
    expect(e.id.startsWith('e_')).toBe(true);
    expect(e.xp).toBe(8);
    expect(e.day).toBe('2026-01-05');
    expect(e.refId).toBeNull();
    expect(e.meta).toEqual({});
  });

  it('derives the day from the timestamp when not given', () => {
    const at = new Date(2026, 0, 5, 23, 30).toISOString();
    expect(makeEntry({ kind: 'todo', xp: 1, at }).day).toBe('2026-01-05');
  });

  it('gives every entry a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => entry().id));
    expect(ids.size).toBe(200);
  });
});

describe('voids', () => {
  it('removes the voided entry and the void itself', () => {
    const a = entry();
    const b = entry({ refId: 'h2' });
    const v = makeVoid(a.id, { at: '2026-01-06T09:00:00.000Z' });
    const all = { [a.id]: a, [b.id]: b, [v.id]: v };

    expect(voidedIds(all)).toEqual(new Set([a.id]));
    const live = effectiveEntries(all);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(b.id);
    expect(totalXp(all)).toBe(5);
  });

  it('is idempotent when the same entry is voided twice', () => {
    const a = entry();
    const all = { [a.id]: a };
    const v1 = makeVoid(a.id);
    const v2 = makeVoid(a.id);
    all[v1.id] = v1;
    all[v2.id] = v2;
    expect(effectiveEntries(all)).toHaveLength(0);
    expect(totalXp(all)).toBe(0);
  });

  it('ignores voids that point at nothing', () => {
    const a = entry();
    const v = makeVoid('e_missing');
    expect(totalXp({ [a.id]: a, [v.id]: v })).toBe(5);
  });
});

describe('ledger queries', () => {
  const a = entry({ at: '2026-01-05T09:00:00.000Z', day: '2026-01-05', xp: 5 });
  const b = entry({ at: '2026-01-05T20:00:00.000Z', day: '2026-01-05', xp: 10, refId: 'h2' });
  const c = entry({ at: '2026-01-06T08:00:00.000Z', day: '2026-01-06', xp: 6, kind: 'todo', refId: 't1' });
  const all = { [a.id]: a, [b.id]: b, [c.id]: c };

  it('sums xp', () => {
    expect(totalXp(all)).toBe(21);
    expect(totalXp({})).toBe(0);
    expect(totalXp([a, b])).toBe(15);
  });

  it('groups xp by day', () => {
    const byDay = xpByDay(all);
    expect(byDay.get('2026-01-05')).toBe(15);
    expect(byDay.get('2026-01-06')).toBe(6);
    expect(byDay.get('2026-01-07')).toBeUndefined();
  });

  it('returns entries oldest first', () => {
    expect(effectiveEntries(all).map((e) => e.xp)).toEqual([5, 10, 6]);
  });

  it('filters by kind, subject and day', () => {
    expect(entriesFor(all, { kind: 'habit' })).toHaveLength(2);
    expect(entriesFor(all, { kind: 'habit', refId: 'h2' })).toHaveLength(1);
    expect(entriesFor(all, { day: '2026-01-06' })).toHaveLength(1);
    expect(entriesFor(all, { kind: 'habit', day: '2026-01-06' })).toHaveLength(0);
  });

  it('collects completed days per habit', () => {
    expect(completedDaysFor(all, 'h1')).toEqual(new Set(['2026-01-05']));
    expect(completedDaysFor(all, 't1')).toEqual(new Set());
    const map = completionsByHabit(all);
    expect(map.get('h1')).toEqual(new Set(['2026-01-05']));
    expect(map.get('h2')).toEqual(new Set(['2026-01-05']));
    expect(map.has('t1')).toBe(false);
  });
});
