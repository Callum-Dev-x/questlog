// The shape of the document that lives on disk, and the entity factories.
// normalizeState() is the trust boundary: everything arriving from an import
// file or from storage goes through it before the app touches it.

import { newId, newDeviceId } from './ids.js';
import { dayKey, isDayKey, timestamp } from './dates.js';
import { DIFFICULTIES } from './xp.js';
import { normalizeSchedule } from './streaks.js';
import { ENTRY_KINDS } from './ledger.js';

export const APP_ID = 'questlog';
export const SCHEMA_VERSION = 1;

export const COLLECTIONS = ['habits', 'todos', 'projects', 'milestones', 'entries'];

export function createState(opts = {}) {
  const at = timestamp(opts.now || new Date());
  return {
    schema: SCHEMA_VERSION,
    profile: { name: 'Adventurer', createdAt: at, updatedAt: at },
    settings: {
      weekStartsOn: 1,
      theme: 'auto',
      confetti: true,
      updatedAt: at,
    },
    habits: {},
    todos: {},
    projects: {},
    milestones: {},
    entries: {},
    meta: { deviceId: opts.deviceId || newDeviceId(), lastImportAt: null },
  };
}

// ---- coercion helpers ---------------------------------------------------

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
function trimmed(value, fallback = '') {
  return str(value, fallback).trim();
}
function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}
function int(value, fallback, min = -Infinity, max = Infinity) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function dayOrNull(value) {
  return isDayKey(value) ? value : null;
}
function isoOrNull(value) {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? value : null;
}

// ---- factories ----------------------------------------------------------

export function makeHabit(input = {}, now = new Date()) {
  const at = timestamp(now);
  return {
    id: input.id || newId('h'),
    title: trimmed(input.title, 'Untitled habit'),
    notes: trimmed(input.notes),
    schedule: normalizeSchedule(input.schedule),
    difficulty: oneOf(input.difficulty, DIFFICULTIES, 'easy'),
    icon: trimmed(input.icon),
    archived: bool(input.archived),
    order: int(input.order, Date.now()),
    createdAt: isoOrNull(input.createdAt) || at,
    updatedAt: isoOrNull(input.updatedAt) || at,
    deletedAt: isoOrNull(input.deletedAt),
  };
}

export function makeTodo(input = {}, now = new Date()) {
  const at = timestamp(now);
  return {
    id: input.id || newId('t'),
    title: trimmed(input.title, 'Untitled task'),
    notes: trimmed(input.notes),
    difficulty: oneOf(input.difficulty, DIFFICULTIES, 'easy'),
    due: dayOrNull(input.due),
    projectId: input.projectId ? str(input.projectId) : null,
    milestoneId: input.milestoneId ? str(input.milestoneId) : null,
    completedAt: isoOrNull(input.completedAt),
    completedDay: dayOrNull(input.completedDay),
    order: int(input.order, Date.now()),
    createdAt: isoOrNull(input.createdAt) || at,
    updatedAt: isoOrNull(input.updatedAt) || at,
    deletedAt: isoOrNull(input.deletedAt),
  };
}

export function makeProject(input = {}, now = new Date()) {
  const at = timestamp(now);
  return {
    id: input.id || newId('p'),
    title: trimmed(input.title, 'Untitled project'),
    notes: trimmed(input.notes),
    color: trimmed(input.color, 'violet'),
    archived: bool(input.archived),
    order: int(input.order, Date.now()),
    createdAt: isoOrNull(input.createdAt) || at,
    updatedAt: isoOrNull(input.updatedAt) || at,
    deletedAt: isoOrNull(input.deletedAt),
  };
}

export function makeMilestone(input = {}, now = new Date()) {
  const at = timestamp(now);
  return {
    id: input.id || newId('m'),
    projectId: str(input.projectId),
    title: trimmed(input.title, 'Untitled milestone'),
    notes: trimmed(input.notes),
    difficulty: oneOf(input.difficulty, DIFFICULTIES, 'hard'),
    due: dayOrNull(input.due),
    completedAt: isoOrNull(input.completedAt),
    completedDay: dayOrNull(input.completedDay),
    order: int(input.order, Date.now()),
    createdAt: isoOrNull(input.createdAt) || at,
    updatedAt: isoOrNull(input.updatedAt) || at,
    deletedAt: isoOrNull(input.deletedAt),
  };
}

function normalizeEntry(input) {
  if (!input || typeof input !== 'object') return null;
  const id = trimmed(input.id);
  const kind = oneOf(input.kind, ENTRY_KINDS, null);
  const at = isoOrNull(input.at);
  if (!id || !kind || !at) return null;
  const day = dayOrNull(input.day) || dayKey(new Date(at));
  return {
    id,
    kind,
    refId: input.refId ? str(input.refId) : null,
    xp: int(input.xp, 0),
    day,
    at,
    meta: input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : {},
  };
}

const FACTORIES = {
  habits: makeHabit,
  todos: makeTodo,
  projects: makeProject,
  milestones: makeMilestone,
};

/** Accepts a map or an array of records; drops anything unusable. */
function normalizeCollection(raw, factory, warnings, label) {
  const out = {};
  const records = Array.isArray(raw) ? raw : Object.values(raw && typeof raw === 'object' ? raw : {});
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      warnings.push(`${label}: skipped a non-object record`);
      continue;
    }
    const normalized = factory(record);
    if (!normalized.id) {
      warnings.push(`${label}: skipped a record with no id`);
      continue;
    }
    out[normalized.id] = normalized;
  }
  return out;
}

/**
 * Coerce arbitrary parsed JSON into a valid state document.
 * @returns {{state:Object, warnings:string[]}}
 * @throws if the input is not an object at all
 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('not a questlog document: expected an object');
  }
  const warnings = [];
  const base = createState();
  const state = {
    schema: SCHEMA_VERSION,
    profile: {
      name: trimmed(raw.profile && raw.profile.name, base.profile.name),
      createdAt: isoOrNull(raw.profile && raw.profile.createdAt) || base.profile.createdAt,
      updatedAt: isoOrNull(raw.profile && raw.profile.updatedAt) || base.profile.updatedAt,
    },
    settings: {
      weekStartsOn: oneOf(int(raw.settings && raw.settings.weekStartsOn, 1), [0, 1, 6], 1),
      theme: oneOf(raw.settings && raw.settings.theme, ['auto', 'dark', 'light'], 'auto'),
      confetti: bool(raw.settings && raw.settings.confetti, true),
      updatedAt: isoOrNull(raw.settings && raw.settings.updatedAt) || base.settings.updatedAt,
    },
    habits: normalizeCollection(raw.habits, makeHabit, warnings, 'habits'),
    todos: normalizeCollection(raw.todos, makeTodo, warnings, 'todos'),
    projects: normalizeCollection(raw.projects, makeProject, warnings, 'projects'),
    milestones: normalizeCollection(raw.milestones, makeMilestone, warnings, 'milestones'),
    entries: {},
    meta: {
      deviceId: trimmed(raw.meta && raw.meta.deviceId) || base.meta.deviceId,
      lastImportAt: isoOrNull(raw.meta && raw.meta.lastImportAt),
    },
  };

  const rawEntries = Array.isArray(raw.entries)
    ? raw.entries
    : Object.values(raw.entries && typeof raw.entries === 'object' ? raw.entries : {});
  let dropped = 0;
  for (const record of rawEntries) {
    const entry = normalizeEntry(record);
    if (entry) state.entries[entry.id] = entry;
    else dropped++;
  }
  if (dropped) warnings.push(`entries: skipped ${dropped} malformed ${dropped === 1 ? 'entry' : 'entries'}`);

  // Milestones pointing at a project that isn't here would be invisible forever.
  for (const milestone of Object.values(state.milestones)) {
    if (!state.projects[milestone.projectId]) {
      warnings.push(`milestones: "${milestone.title}" references a missing project`);
    }
  }

  return { state, warnings };
}

/** Bring older documents up to the current schema. Called before normalizeState. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let doc = raw;
  const version = Number(doc.schema) || 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`this file was written by a newer version of questlog (schema ${version})`);
  }
  // v0 → v1: the first released schema; nothing to rewrite yet.
  if (version < 1) doc = { ...doc, schema: 1 };
  return doc;
}
