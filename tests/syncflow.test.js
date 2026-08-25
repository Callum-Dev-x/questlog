// End-to-end sync against the emulator built into tools/serve.py, which mirrors
// worker/sync-worker.js. Two in-memory "devices" push and pull through a real
// HTTP round trip, including JSON serialization and document re-validation.

import { describe, it, expect } from './harness.js';
import { createSyncManager } from '../src/ui/syncclient.js';
import { newSyncKey, sameSyncContent } from '../src/core/sync.js';
import { totalXp, entriesFor } from '../src/core/ledger.js';
import { getSummary } from '../src/core/selectors.js';
import { seedState, on } from './helpers.js';

const ENDPOINT = `${location.origin}/v1/doc`;

async function emulatorAvailable() {
  try {
    const probe = await fetch(`${ENDPOINT}/${newSyncKey()}`, { cache: 'no-store' });
    return probe.status === 404; // "no document yet" means the route exists
  } catch {
    return false;
  }
}

/** A store shaped like the real one, without persistence or rendering. */
function fakeStore(state) {
  let current = state;
  return {
    getState: () => current,
    setState(next) { current = next; return current; },
  };
}

function device(state, key) {
  const store = fakeStore(state);
  const manager = createSyncManager(store);
  manager.connect(`${ENDPOINT}/${key}`);
  return { store, manager };
}

const available = await emulatorAvailable();

if (!available) {
  describe('sync flow (end to end)', () => {
    it('SKIPPED — run the tests through tools/serve.py to exercise the sync emulator', () => {
      expect(available).toBe(false);
    });
  });
} else {
  describe('sync flow (end to end)', () => {
    // localStorage is shared by these managers; put back whatever was there.
    const saved = localStorage.getItem('questlog:sync');
    const restore = () => { if (saved === null) localStorage.removeItem('questlog:sync'); else localStorage.setItem('questlog:sync', saved); };

    it('seeds an empty server, then a second device joins and converges', async () => {
      const key = newSyncKey();
      let laptopState = seedState();
      laptopState = on('2026-01-05', laptopState, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
      laptopState = on('2026-01-05', laptopState, { type: 'habit/complete', id: 'h1' });

      let phoneState = seedState();
      phoneState = on('2026-01-05', phoneState, { type: 'habit/add', habit: { id: 'h2', title: 'Gym', order: 2 } });
      phoneState = on('2026-01-05', phoneState, { type: 'habit/complete', id: 'h2' });

      const laptop = device(laptopState, key);
      const phone = device(phoneState, key);

      const first = await laptop.manager.syncNow();
      expect(first.error).toBeUndefined();
      expect(first.uploaded).toBe(true);

      // The phone pulls the laptop's work and pushes its own in one round.
      const second = await phone.manager.syncNow();
      expect(second.error).toBeUndefined();
      expect(second.pulled).toBe(true);
      expect(second.uploaded).toBe(true);
      expect(Object.keys(phone.store.getState().habits).sort()).toEqual(['h1', 'h2']);

      // The laptop picks up the phone's half.
      const third = await laptop.manager.syncNow();
      expect(third.error).toBeUndefined();
      expect(third.pulled).toBe(true);

      expect(sameSyncContent(laptop.store.getState(), phone.store.getState())).toBe(true);
      expect(totalXp(laptop.store.getState().entries)).toBe(totalXp(phone.store.getState().entries));
      expect(getSummary(laptop.store.getState(), { today: '2026-01-05' }).level)
        .toBe(getSummary(phone.store.getState(), { today: '2026-01-05' }).level);
      restore();
    });

    it('is idempotent — syncing again moves nothing', async () => {
      const key = newSyncKey();
      let state = seedState();
      state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
      state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
      const laptop = device(state, key);

      await laptop.manager.syncNow();
      const again = await laptop.manager.syncNow();
      expect(again.error).toBeUndefined();
      expect(again.uploaded).toBe(false);
      expect(again.pulled).toBe(false);
      restore();
    });

    it('keeps this device’s id and never uploads it', async () => {
      const key = newSyncKey();
      const laptop = device(seedState(), key);
      await laptop.manager.syncNow();
      const stored = await (await fetch(`${ENDPOINT}/${key}`, { cache: 'no-store' })).json();
      expect(stored.doc.meta).toBeUndefined();
      expect(JSON.stringify(stored.doc)).not.toContain('dev_test');
      expect(laptop.store.getState().meta.deviceId).toBe('dev_test');
      restore();
    });

    it('does not pay twice when both devices ticked the same habit offline', async () => {
      const key = newSyncKey();
      const build = () => {
        let s = seedState();
        s = on('2026-01-05', s, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
        return on('2026-01-05', s, { type: 'habit/complete', id: 'h1' });
      };
      const laptop = device(build(), key);
      const phone = device(build(), key);

      await laptop.manager.syncNow();
      await phone.manager.syncNow();
      await laptop.manager.syncNow();

      const merged = phone.store.getState();
      expect(entriesFor(merged.entries, { kind: 'habit', refId: 'h1', day: '2026-01-05' })).toHaveLength(1);
      expect(totalXp(merged.entries)).toBe(20); // one completion + one perfect day
      expect(sameSyncContent(laptop.store.getState(), merged)).toBe(true);
      restore();
    });

    it('recovers from a version conflict by re-merging', async () => {
      const key = newSyncKey();
      let base = seedState();
      base = on('2026-01-05', base, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
      const laptop = device(base, key);
      await laptop.manager.syncNow();

      // Another writer bumps the version behind this device's back.
      const current = await (await fetch(`${ENDPOINT}/${key}`, { cache: 'no-store' })).json();
      const sneaky = await fetch(`${ENDPOINT}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: current.doc, baseVersion: current.version }),
      });
      expect(sneaky.status).toBe(200);

      // The device now holds a stale version, makes a change, and syncs again.
      laptop.store.setState(on('2026-01-06', laptop.store.getState(), { type: 'habit/complete', id: 'h1' }));
      const result = await laptop.manager.syncNow();
      expect(result.error).toBeUndefined();
      expect(result.uploaded).toBe(true);

      const after = await (await fetch(`${ENDPOINT}/${key}`, { cache: 'no-store' })).json();
      expect(after.version).toBeGreaterThan(current.version);
      expect(Object.keys(after.doc.entries).length).toBeGreaterThan(0);
      restore();
    });

    it('reports a clear error for an unreachable server instead of throwing', async () => {
      const laptop = device(seedState(), newSyncKey());
      laptop.manager.connect(`http://localhost:9/v1/doc/${newSyncKey()}`); // nothing listens on port 9
      const result = await laptop.manager.syncNow();
      expect(typeof result.error).toBe('string');
      expect(['error', 'offline']).toContain(laptop.manager.status.state);
      restore();
    });
  });
}
