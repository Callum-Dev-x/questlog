// Sync — the network half. Decisions live in core/sync.js; this does the I/O,
// holds the config, and keeps the UI informed without ever blocking it.
//
// The config lives in localStorage rather than in the document, for two
// reasons: the key is a credential and must never travel inside an export, and
// each device needs its own copy anyway.

import {
  formatSyncLink, isSyncKey, newSyncKey, parseSyncLink, planSync, readRemote, toSyncDoc,
} from '../core/sync.js';

const CONFIG_KEY = 'questlog:sync';
const REQUEST_TIMEOUT_MS = 15000;
const DEBOUNCE_MS = 4000;
const MAX_CONFLICT_RETRIES = 3;

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.endpoint || !isSyncKey(parsed.key)) return null;
    return { endpoint: parsed.endpoint, key: parsed.key, lastSyncedAt: parsed.lastSyncedAt || null };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Private mode or full quota — sync just will not persist across reloads.
  }
}

export function clearSyncConfig() {
  try { localStorage.removeItem(CONFIG_KEY); } catch { /* ignore */ }
}

/**
 * Accepts either a bare server URL (first device — mint a new key) or a full
 * sync link copied from another device (second device — join it).
 */
export function configFromInput(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('paste your sync server URL, or a sync link from your other device');
  try {
    return parseSyncLink(raw);
  } catch (err) {
    // Not a link — treat it as the endpoint and generate a key for it.
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw err;
    }
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !localhost) throw new Error('the sync server must be https');
    const path = url.pathname.replace(/\/$/, '') || '/v1/doc';
    return { endpoint: `${url.origin}${path}`, key: newSyncKey() };
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    let body = null;
    try { body = await response.json(); } catch { /* some errors have no body */ }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{getState:Function, setState:Function}} store
 */
export function createSyncManager(store) {
  let config = loadSyncConfig();
  let status = { state: config ? 'idle' : 'off', message: '', lastSyncedAt: config && config.lastSyncedAt };
  let running = false;
  let queued = false;
  let timer = null;
  let applyingRemote = false;
  const listeners = new Set();

  function setStatus(next) {
    status = { ...status, ...next };
    for (const listener of listeners) listener(status);
  }

  function docUrl() {
    return formatSyncLink(config.endpoint, config.key);
  }

  async function runOnce() {
    const url = docUrl();
    let remote = null;
    let version = 0;

    const got = await request(url);
    if (got.status === 200) {
      const parsed = readRemote(got.body, store.getState().meta);
      remote = parsed.state;
      version = parsed.version;
    } else if (got.status !== 404) {
      const detail = (got.body && got.body.error) || `server said ${got.status}`;
      throw new Error(detail);
    }

    // Re-read now: the user may have ticked something while that request flew.
    const local = store.getState();
    const plan = planSync({ local, remote, now: new Date() });

    if (plan.changedLocally) {
      applyingRemote = true;
      try {
        store.setState(plan.merged, { source: 'sync' });
      } finally {
        applyingRemote = false;
      }
    }

    if (!plan.upload) return { uploaded: false, pulled: plan.changedLocally };

    const put = await request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: toSyncDoc(plan.merged), baseVersion: version }),
    });

    if (put.status === 409) return { conflict: true };
    if (!put.ok) {
      throw new Error((put.body && put.body.error) || `server said ${put.status}`);
    }
    return { uploaded: true, pulled: plan.changedLocally };
  }

  async function syncNow({ silent = false } = {}) {
    if (!config) return { skipped: 'not configured' };
    if (running) { queued = true; return { skipped: 'already running' }; }
    running = true;
    if (!silent) setStatus({ state: 'syncing', message: '' });

    try {
      let result = null;
      for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
        result = await runOnce();
        // A conflict means someone wrote first; re-read and merge again.
        if (!result.conflict) break;
        if (attempt === MAX_CONFLICT_RETRIES) throw new Error('kept colliding with another device — try again');
      }
      const lastSyncedAt = new Date().toISOString();
      config = { ...config, lastSyncedAt };
      saveSyncConfig(config);
      setStatus({ state: 'ok', message: '', lastSyncedAt });
      return result;
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setStatus({
        state: offline ? 'offline' : 'error',
        message: offline ? 'no connection — will sync when you are back online' : err.message,
      });
      return { error: err.message };
    } finally {
      running = false;
      if (queued) { queued = false; setTimeout(() => syncNow({ silent: true }), 250); }
    }
  }

  function schedule() {
    if (!config || applyingRemote) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; syncNow({ silent: true }); }, DEBOUNCE_MS);
  }

  return {
    get config() { return config; },
    get status() { return status; },
    isEnabled: () => Boolean(config),
    link: () => (config ? docUrl() : null),

    connect(text) {
      const next = configFromInput(text);
      config = { ...next, lastSyncedAt: null };
      saveSyncConfig(config);
      setStatus({ state: 'idle', message: '', lastSyncedAt: null });
      return config;
    },
    disconnect() {
      config = null;
      clearSyncConfig();
      if (timer) { clearTimeout(timer); timer = null; }
      setStatus({ state: 'off', message: '', lastSyncedAt: null });
    },

    syncNow,
    schedule,
    onStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },

    /** Sync on launch, when the app is brought back, and when the network returns. */
    start() {
      if (!config) return;
      syncNow({ silent: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncNow({ silent: true });
      });
      window.addEventListener('online', () => syncNow({ silent: true }));
    },
  };
}
