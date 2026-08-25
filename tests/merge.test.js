import { describe, it, expect } from './harness.js';
import { mergeStates, pickNewer, stableStringify, summarizeMerge } from '../src/core/merge.js';
import { totalXp } from '../src/core/ledger.js';
import { seedState, on } from './helpers.js';

// A shared history, then two devices that each did their own thing offline.
function ancestor() {
  let state = seedState();
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
  state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
  return state;
}

function deviceA(base) {
  let state = on('2026-01-06', base, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-06', state, { type: 'todo/add', todo: { id: 'ta', title: 'Laptop task' } });
  return state;
}

function deviceB(base) {
  let state = on('2026-01-07', base, { type: 'habit/complete', id: 'h1', day: '2026-01-07' });
  state = on('2026-01-07', state, { type: 'habit/add', habit: { id: 'h9', title: 'Phone habit', order: 2 } });
  return state;
}

function withoutVolatileMeta(state) {
  return { ...state, meta: { ...state.meta, lastImportAt: null, deviceId: 'x' } };
}

describe('stableStringify', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }));
  });
  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
  });
});

describe('pickNewer', () => {
  it('prefers the later updatedAt', () => {
    const older = { id: 'a', title: 'old', updatedAt: '2026-01-01T00:00:00.000Z' };
    const newer = { id: 'a', title: 'new', updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(pickNewer(older, newer).title).toBe('new');
    expect(pickNewer(newer, older).title).toBe('new');
  });

  it('breaks exact ties the same way regardless of argument order', () => {
    const a = { id: 'a', title: 'alpha', updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'a', title: 'beta', updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(pickNewer(a, b)).toEqual(pickNewer(b, a));
  });

  it('tolerates a missing side or a missing timestamp', () => {
    const a = { id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(pickNewer(a, null)).toBe(a);
    expect(pickNewer(null, a)).toBe(a);
    expect(pickNewer(a, { id: 'a' })).toBe(a);
  });
});

describe('mergeStates', () => {
  it('takes the union of XP entries from both devices', () => {
    const base = ancestor();
    const a = deviceA(base);
    const b = deviceB(base);
    const { state, stats } = mergeStates(a, b, { now: new Date(2026, 0, 8) });

    // Jan 5 shared (5 + 15 perfect day) + Jan 6 from A + Jan 7 from B
    expect(totalXp(state.entries)).toBe(60);
    expect(stats.entriesAdded).toBe(2);
    expect(Object.keys(state.habits).sort()).toEqual(['h1', 'h9']);
    expect(state.todos.ta.title).toBe('Laptop task');
  });

  it('keeps the newer edit of the same record', () => {
    const base = ancestor();
    const a = on('2026-01-06', base, { type: 'habit/update', id: 'h1', patch: { title: 'Read (laptop)' } });
    const b = on('2026-01-08', base, { type: 'habit/update', id: 'h1', patch: { title: 'Read (phone)' } });
    expect(mergeStates(a, b).state.habits.h1.title).toBe('Read (phone)');
    expect(mergeStates(b, a).state.habits.h1.title).toBe('Read (phone)');
  });

  it('propagates deletions as tombstones', () => {
    const base = ancestor();
    const a = deviceA(base);
    const b = on('2026-01-09', base, { type: 'habit/remove', id: 'h1' });
    const merged = mergeStates(a, b).state;
    expect(merged.habits.h1.deletedAt).toBeTruthy();
    expect(totalXp(merged.entries)).toBe(40); // the XP earned before the delete survives
  });

  it('does not resurrect a record deleted after the other edit', () => {
    const base = ancestor();
    const deleted = on('2026-01-09', base, { type: 'habit/remove', id: 'h1' });
    const edited = on('2026-01-06', base, { type: 'habit/update', id: 'h1', patch: { title: 'Stale rename' } });
    expect(mergeStates(deleted, edited).state.habits.h1.deletedAt).toBeTruthy();
    expect(mergeStates(edited, deleted).state.habits.h1.deletedAt).toBeTruthy();
  });

  it('is commutative', () => {
    const base = ancestor();
    const a = deviceA(base);
    const b = deviceB(base);
    const ab = withoutVolatileMeta(mergeStates(a, b).state);
    const ba = withoutVolatileMeta(mergeStates(b, a).state);
    expect(stableStringify(ab)).toBe(stableStringify(ba));
  });

  it('is idempotent', () => {
    const base = ancestor();
    const a = deviceA(base);
    const b = deviceB(base);
    const once = mergeStates(a, b).state;
    const twice = mergeStates(once, b);
    expect(stableStringify(withoutVolatileMeta(twice.state))).toBe(stableStringify(withoutVolatileMeta(once)));
    expect(twice.stats.entriesAdded).toBe(0);
    expect(summarizeMerge(twice.stats)).toBe('already up to date');
  });

  it('merging a device with itself changes nothing', () => {
    const a = deviceA(ancestor());
    const merged = mergeStates(a, a);
    expect(stableStringify(withoutVolatileMeta(merged.state))).toBe(stableStringify(withoutVolatileMeta(a)));
    expect(merged.stats.entriesAdded).toBe(0);
  });

  it('keeps the local device id and stamps the import time', () => {
    const a = deviceA(ancestor());
    const b = { ...deviceB(ancestor()), meta: { deviceId: 'dev_other', lastImportAt: null } };
    const merged = mergeStates(a, b, { now: new Date(2026, 0, 8, 10) }).state;
    expect(merged.meta.deviceId).toBe('dev_test');
    expect(merged.meta.lastImportAt).toBe(new Date(2026, 0, 8, 10).toISOString());
  });

  it('describes what came in', () => {
    const base = ancestor();
    const { stats } = mergeStates(deviceA(base), deviceB(base));
    expect(summarizeMerge(stats)).toContain('1 new item');
    expect(summarizeMerge(stats)).toContain('2 XP records');
  });
});
