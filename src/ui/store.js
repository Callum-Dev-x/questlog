// Wires the pure reducer to persistence and to the views.

import { reduce } from '../core/state.js';
import { totalXp } from '../core/ledger.js';
import { levelFromXp } from '../core/xp.js';
import { saveState } from './storage.js';

const SAVE_DEBOUNCE_MS = 200;

export function createStore(initialState) {
  let state = initialState;
  let timer = null;
  let pending = false;
  const listeners = new Set();
  const events = new Set();

  function flush() {
    if (!pending) return Promise.resolve();
    pending = false;
    if (timer) { clearTimeout(timer); timer = null; }
    return saveState(state).catch((err) => {
      console.error('questlog: save failed', err);
      emit({ type: 'save-error', error: err });
    });
  }

  function schedule() {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, SAVE_DEBOUNCE_MS);
  }

  function emit(event) {
    for (const handler of events) handler(event);
  }

  function notify() {
    for (const listener of listeners) listener(state);
  }

  /** @param {{type:string}} action @returns {Object} the new state */
  function dispatch(action) {
    const before = state;
    const next = reduce(before, action, { now: new Date() });
    if (next === before) return before;

    const xpBefore = totalXp(before.entries);
    const xpAfter = totalXp(next.entries);
    state = next;
    schedule();
    notify();

    if (xpAfter !== xpBefore) {
      emit({ type: 'xp', delta: xpAfter - xpBefore, total: xpAfter });
      const levelBefore = levelFromXp(xpBefore);
      const levelAfter = levelFromXp(xpAfter);
      if (levelAfter > levelBefore) emit({ type: 'level-up', level: levelAfter });
    }
    return state;
  }

  /** Swap the whole document (import, reset). */
  function setState(next, meta = {}) {
    state = next;
    schedule();
    notify();
    emit({ type: 'replaced', ...meta });
    return state;
  }

  // Never lose the last few hundred milliseconds of work to a backgrounded tab.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  return {
    getState: () => state,
    dispatch,
    setState,
    flush,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    on(handler) { events.add(handler); return () => events.delete(handler); },
  };
}
