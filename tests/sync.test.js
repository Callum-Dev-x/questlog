import { describe, it, expect } from './harness.js';
import {
  formatSyncLink, fromSyncDoc, isSyncKey, newSyncKey, parseSyncLink, planSync,
  readRemote, sameSyncContent, toSyncDoc,
} from '../src/core/sync.js';
import { totalXp, entriesFor } from '../src/core/ledger.js';
import { seedState, on, atDay } from './helpers.js';

function deviceWith(id, title, day = '2026-01-05') {
  let state = seedState();
  state = on(day, state, { type: 'habit/add', habit: { id, title, order: 1 } });
  state = on(day, state, { type: 'habit/complete', id });
  return state;
}

describe('sync keys and links', () => {
  it('generates keys of the accepted shape', () => {
    const key = newSyncKey();
    expect(key).toHaveLength(32);
    expect(isSyncKey(key)).toBe(true);
    const many = new Set(Array.from({ length: 200 }, () => newSyncKey()));
    expect(many.size).toBe(200);
  });

  it('rejects keys that are too short or wrongly shaped', () => {
    expect(isSyncKey('short')).toBe(false);
    expect(isSyncKey('UPPERCASEKEYNOTALLOWED123456')).toBe(false);
    expect(isSyncKey('has spaces in it abcdefghijkl')).toBe(false);
    expect(isSyncKey('')).toBe(false);
    expect(isSyncKey(null)).toBe(false);
  });

  it('round-trips a sync link', () => {
    const key = newSyncKey();
    const link = formatSyncLink('https://sync.example.workers.dev/v1/doc', key);
    expect(link).toBe(`https://sync.example.workers.dev/v1/doc/${key}`);
    expect(parseSyncLink(link)).toEqual({ endpoint: 'https://sync.example.workers.dev/v1/doc', key });
  });

  it('insists on https, except on localhost', () => {
    const key = newSyncKey();
    expect(() => parseSyncLink(`http://sync.example.com/v1/doc/${key}`)).toThrow('https');
    expect(parseSyncLink(`http://localhost:8123/v1/doc/${key}`).endpoint).toBe('http://localhost:8123/v1/doc');
  });

  it('refuses links with no usable key', () => {
    expect(() => parseSyncLink('')).toThrow('paste the sync link');
    expect(() => parseSyncLink('not a url')).toThrow('not a valid sync link');
    expect(() => parseSyncLink('https://sync.example.workers.dev/v1/doc/short')).toThrow('no valid sync key');
  });
});

describe('the synced document', () => {
  it('never carries this device’s meta', () => {
    const state = deviceWith('h1', 'Read');
    const doc = toSyncDoc(state);
    expect(doc.meta).toBeUndefined();
    expect(doc.habits.h1.title).toBe('Read');
    expect(JSON.stringify(doc)).not.toContain('dev_test');
  });

  it('re-attaches local meta on the way back in', () => {
    const state = deviceWith('h1', 'Read');
    const restored = fromSyncDoc(toSyncDoc(state), { deviceId: 'dev_phone', lastImportAt: null });
    expect(restored.meta.deviceId).toBe('dev_phone');
    expect(totalXp(restored.entries)).toBe(totalXp(state.entries));
    expect(sameSyncContent(restored, state)).toBe(true);
  });

  it('compares content while ignoring meta', () => {
    const a = deviceWith('h1', 'Read');
    const b = { ...a, meta: { deviceId: 'dev_other', lastImportAt: '2026-02-02T00:00:00.000Z' } };
    expect(sameSyncContent(a, b)).toBe(true);
  });

  it('validates whatever the server returns', () => {
    const meta = { deviceId: 'dev_test', lastImportAt: null };
    expect(() => readRemote(null, meta)).toThrow('unreadable');
    expect(() => readRemote({ version: 1 }, meta)).toThrow('no document');
    const good = readRemote({ version: 4, updatedAt: 'x', doc: toSyncDoc(deviceWith('h1', 'Read')) }, meta);
    expect(good.version).toBe(4);
    expect(good.state.habits.h1.title).toBe('Read');
  });
});

describe('planSync', () => {
  it('seeds an empty server', () => {
    const local = deviceWith('h1', 'Read');
    const plan = planSync({ local, remote: null });
    expect(plan.upload).toBe(true);
    expect(plan.changedLocally).toBe(false);
    expect(plan.merged).toBe(local);
  });

  it('does nothing when both sides already agree', () => {
    const local = deviceWith('h1', 'Read');
    const remote = fromSyncDoc(toSyncDoc(local), { deviceId: 'dev_phone', lastImportAt: null });
    const plan = planSync({ local, remote, now: atDay('2026-01-06') });
    expect(plan.upload).toBe(false);
    expect(plan.changedLocally).toBe(false);
  });

  it('pulls when the server is ahead', () => {
    const local = seedState();
    const remote = deviceWith('h1', 'Read');
    const plan = planSync({ local, remote, now: atDay('2026-01-06') });
    expect(plan.changedLocally).toBe(true);
    expect(plan.upload).toBe(false);
    expect(totalXp(plan.merged.entries)).toBe(totalXp(remote.entries));
  });

  it('pushes when this device is ahead', () => {
    const remote = seedState();
    const local = deviceWith('h1', 'Read');
    const plan = planSync({ local, remote, now: atDay('2026-01-06') });
    expect(plan.upload).toBe(true);
    expect(plan.changedLocally).toBe(false);
  });

  it('merges both sides when they diverged', () => {
    const local = deviceWith('h1', 'Read');
    const remote = deviceWith('h2', 'Gym');
    const plan = planSync({ local, remote, now: atDay('2026-01-06') });
    expect(plan.upload).toBe(true);
    expect(plan.changedLocally).toBe(true);
    expect(Object.keys(plan.merged.habits).sort()).toEqual(['h1', 'h2']);
    // Each device called it a perfect day for its own single habit. Merged, the
    // day has two habits and both are done — that is one bonus, not two.
    expect(totalXp(plan.merged.entries)).toBe(25); // 5 + 5 + a single 15
    expect(entriesFor(plan.merged.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
  });

  it('is idempotent — syncing twice changes nothing', () => {
    const local = deviceWith('h1', 'Read');
    const remote = deviceWith('h2', 'Gym');
    const first = planSync({ local, remote, now: atDay('2026-01-06') });
    const second = planSync({ local: first.merged, remote: first.merged, now: atDay('2026-01-06') });
    expect(second.upload).toBe(false);
    expect(second.changedLocally).toBe(false);
  });

  it('does not double-count a habit both devices ticked', () => {
    const local = deviceWith('h1', 'Read');
    const remote = fromSyncDoc(toSyncDoc(deviceWith('h1', 'Read')), { deviceId: 'dev_phone', lastImportAt: null });
    // same habit id, same day, entries created independently on each device
    const plan = planSync({ local, remote, now: atDay('2026-01-06') });
    expect(entriesFor(plan.merged.entries, { kind: 'habit', refId: 'h1', day: '2026-01-05' })).toHaveLength(1);
    expect(totalXp(plan.merged.entries)).toBe(20); // 5 + one perfect day, not doubled
  });
});
