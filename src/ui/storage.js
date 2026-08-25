// On-device persistence. IndexedDB is the store of record; localStorage keeps a
// best-effort mirror so a corrupted or evicted IDB is not the end of the world.

const DB_NAME = 'questlog';
const DB_VERSION = 1;
const STORE = 'documents';
const KEY = 'state';
const MIRROR_KEY = 'questlog:state';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = fn(transaction.objectStore(STORE));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMirror(state) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode refusal — the mirror is optional.
  }
}

/** @returns {Promise<{state:Object|null, source:string}>} */
export async function loadState() {
  try {
    const state = await tx('readonly', (store) => store.get(KEY));
    if (state) return { state, source: 'indexeddb' };
  } catch {
    const mirror = readMirror();
    if (mirror) return { state: mirror, source: 'localstorage' };
    return { state: null, source: 'unavailable' };
  }
  const mirror = readMirror();
  return mirror ? { state: mirror, source: 'localstorage' } : { state: null, source: 'empty' };
}

export async function saveState(state) {
  writeMirror(state);
  await tx('readwrite', (store) => store.put(state, KEY));
}

export async function clearState() {
  try { localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
  await tx('readwrite', (store) => store.delete(KEY));
}

/** Ask the browser not to evict us. Safari grants this once installed. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}
