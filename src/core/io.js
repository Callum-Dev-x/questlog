// Export / import. The exported file is the entire app: no server round-trip,
// no partial state. Import defaults to merge so a stale file can never delete
// work done on the other device.

import { APP_ID, SCHEMA_VERSION, normalizeState, migrate } from './schema.js';
import { mergeStates } from './merge.js';
import { reconcileAfterMerge } from './state.js';
import { fileStamp, timestamp } from './dates.js';
import { totalXp } from './ledger.js';

export function exportDocument(state, opts = {}) {
  const now = opts.now || new Date();
  return {
    app: APP_ID,
    schema: SCHEMA_VERSION,
    exportedAt: timestamp(now),
    deviceId: state.meta && state.meta.deviceId,
    stats: {
      totalXp: totalXp(state.entries),
      habits: Object.keys(state.habits).length,
      todos: Object.keys(state.todos).length,
      projects: Object.keys(state.projects).length,
      entries: Object.keys(state.entries).length,
    },
    state,
  };
}

export function serialize(state, opts = {}) {
  return JSON.stringify(exportDocument(state, opts), null, 2);
}

export function exportFilename(now = new Date()) {
  return `questlog-${fileStamp(now)}.json`;
}

/**
 * Parse an export file (or a bare state document) into a normalized state.
 * @returns {{state:Object, warnings:string[], exportedAt:string|null, deviceId:string|null}}
 */
export function parseDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`that file isn't valid JSON (${err.message})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('that file does not contain a questlog backup');
  }
  const wrapped = raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state);
  if (!wrapped && !raw.habits && !raw.entries && !raw.todos && !raw.projects) {
    throw new Error('that file does not look like a questlog backup');
  }
  const body = migrate(wrapped ? raw.state : raw);
  const { state, warnings } = normalizeState(body);
  return {
    state,
    warnings,
    exportedAt: wrapped && typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    deviceId: wrapped && typeof raw.deviceId === 'string' ? raw.deviceId : null,
  };
}

/**
 * @param {Object} local current state
 * @param {string} text file contents
 * @param {{mode?:'merge'|'replace', now?:Date}} [opts]
 * @returns {{state:Object, warnings:string[], stats:Object, mode:string}}
 */
export function importInto(local, text, opts = {}) {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const parsed = parseDocument(text);

  if (mode === 'replace') {
    const state = {
      ...parsed.state,
      meta: {
        ...parsed.state.meta,
        deviceId: local.meta.deviceId, // this device keeps its own identity
        lastImportAt: timestamp(opts.now || new Date()),
      },
    };
    return { state, warnings: parsed.warnings, stats: null, mode };
  }

  const { state, stats } = mergeStates(local, parsed.state, { now: opts.now });
  // Collapse duplicated facts, then award what the merged history has earned.
  const reconciled = reconcileAfterMerge(state, { now: opts.now || new Date() });
  return { state: reconciled, warnings: parsed.warnings, stats, mode };
}
