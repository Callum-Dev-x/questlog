import { describe, it, expect } from './harness.js';
import {
  exportDocument, exportFilename, importInto, parseDocument, serialize,
} from '../src/core/io.js';
import { entriesFor, totalXp } from '../src/core/ledger.js';
import { SCHEMA_VERSION } from '../src/core/schema.js';
import { seedState, on, atDay } from './helpers.js';

function populated() {
  let state = seedState();
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
  state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't1', title: 'Task', due: '2026-01-09' } });
  state = on('2026-01-05', state, { type: 'project/add', project: { id: 'p1', title: 'Ship' } });
  state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm1', projectId: 'p1', title: 'Engine' } });
  return state;
}

describe('export', () => {
  it('wraps the state with provenance and a summary', () => {
    const doc = exportDocument(populated(), { now: atDay('2026-01-06') });
    expect(doc.app).toBe('questlog');
    expect(doc.schema).toBe(SCHEMA_VERSION);
    expect(doc.exportedAt).toBe(atDay('2026-01-06').toISOString());
    expect(doc.deviceId).toBe('dev_test');
    expect(doc.stats.habits).toBe(1);
    expect(doc.stats.totalXp).toBe(20);
    expect(doc.state.habits.h1.title).toBe('Read');
  });

  it('names files by timestamp', () => {
    expect(exportFilename(atDay('2026-01-06', 14))).toBe('questlog-2026-01-06-1400.json');
  });

  it('serializes to indented JSON', () => {
    const text = serialize(populated(), { now: atDay('2026-01-06') });
    expect(text.startsWith('{\n')).toBe(true);
    expect(JSON.parse(text).app).toBe('questlog');
  });
});

describe('parseDocument', () => {
  it('round-trips a document without losing anything', () => {
    const original = populated();
    const parsed = parseDocument(serialize(original, { now: atDay('2026-01-06') }));
    expect(parsed.state).toEqual(original);
    expect(parsed.exportedAt).toBe(atDay('2026-01-06').toISOString());
    expect(parsed.warnings).toEqual([]);
  });

  it('accepts a bare state document', () => {
    const original = populated();
    const parsed = parseDocument(JSON.stringify(original));
    expect(parsed.state.habits.h1.title).toBe('Read');
    expect(parsed.exportedAt).toBeNull();
  });

  it('rejects things that are not questlog backups', () => {
    expect(() => parseDocument('not json at all')).toThrow("isn't valid JSON");
    expect(() => parseDocument('[]')).toThrow('does not contain');
    expect(() => parseDocument('{}')).toThrow('does not look like');
    expect(() => parseDocument('{"foo":1}')).toThrow('does not look like');
    expect(() => parseDocument('null')).toThrow('does not contain');
  });

  it('refuses documents from a newer schema', () => {
    const doc = exportDocument(populated(), {});
    doc.state.schema = SCHEMA_VERSION + 1;
    expect(() => parseDocument(JSON.stringify(doc))).toThrow('newer version');
  });

  it('drops malformed records and reports them', () => {
    const doc = exportDocument(populated(), {});
    doc.state.entries.junk1 = { id: 'junk1', kind: 'nope', at: 'whenever' };
    doc.state.entries.junk2 = null;
    doc.state.habits.broken = { id: 'broken', title: 42, schedule: 'sometimes', difficulty: 'impossible' };
    const parsed = parseDocument(JSON.stringify(doc));

    expect(Object.keys(parsed.state.entries)).toHaveLength(2); // habit + perfect day survive
    expect(parsed.warnings.join(' ')).toContain('skipped 2 malformed');
    expect(parsed.state.habits.broken.title).toBe('Untitled habit');
    expect(parsed.state.habits.broken.schedule).toEqual({ kind: 'daily' });
    expect(parsed.state.habits.broken.difficulty).toBe('easy');
  });

  it('warns about milestones whose project is missing', () => {
    const doc = exportDocument(populated(), {});
    delete doc.state.projects.p1;
    expect(parseDocument(JSON.stringify(doc)).warnings.join(' ')).toContain('missing project');
  });

  it('accepts collections stored as arrays', () => {
    const doc = exportDocument(populated(), {});
    doc.state.habits = Object.values(doc.state.habits);
    doc.state.entries = Object.values(doc.state.entries);
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.state.habits.h1.title).toBe('Read');
    expect(totalXp(parsed.state.entries)).toBe(20);
  });
});

describe('importInto', () => {
  it('merges by default, keeping work done on both devices', () => {
    const local = populated();
    let other = on('2026-01-06', seedState(), { type: 'habit/add', habit: { id: 'h2', title: 'Phone habit' } });
    other = on('2026-01-06', other, { type: 'habit/complete', id: 'h2' });

    const result = importInto(local, serialize(other, {}), { now: atDay('2026-01-07') });
    expect(result.mode).toBe('merge');
    expect(Object.keys(result.state.habits).sort()).toEqual(['h1', 'h2']);
    expect(result.state.todos.t1.title).toBe('Task');
    expect(totalXp(result.state.entries)).toBe(40); // 20 local + 20 imported
    expect(result.stats.entriesAdded).toBe(2);
  });

  it('replace swaps the document but keeps this device its identity', () => {
    const local = populated();
    const other = on('2026-01-06', seedState(), { type: 'habit/add', habit: { id: 'h2', title: 'Only habit' } });
    const result = importInto(local, serialize(other, {}), { mode: 'replace', now: atDay('2026-01-07') });

    expect(result.mode).toBe('replace');
    expect(Object.keys(result.state.habits)).toEqual(['h2']);
    expect(result.state.todos).toEqual({});
    expect(totalXp(result.state.entries)).toBe(0);
    expect(result.state.meta.deviceId).toBe('dev_test');
    expect(result.state.meta.lastImportAt).toBe(atDay('2026-01-07').toISOString());
  });

  it("importing a device's own export is a no-op", () => {
    const local = populated();
    const result = importInto(local, serialize(local, {}), { now: atDay('2026-01-07') });
    expect(result.stats.entriesAdded).toBe(0);
    expect(totalXp(result.state.entries)).toBe(20);
    expect(Object.keys(result.state.habits)).toEqual(['h1']);
  });

  it('awards a bonus that the merged history earned but neither device saw', () => {
    let base = seedState();
    base = on('2026-01-05', base, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
    base = on('2026-01-05', base, { type: 'habit/add', habit: { id: 'h2', title: 'Stretch', order: 2 } });
    // Half the habits ticked on each device, so neither can call it a perfect day.
    const laptop = on('2026-01-06', base, { type: 'habit/complete', id: 'h1' });
    const phone = on('2026-01-06', base, { type: 'habit/complete', id: 'h2' });
    expect(entriesFor(laptop.entries, { kind: 'perfect_day' })).toHaveLength(0);
    expect(entriesFor(phone.entries, { kind: 'perfect_day' })).toHaveLength(0);

    const result = importInto(laptop, serialize(phone, {}), { now: atDay('2026-01-06', 20) });
    expect(entriesFor(result.state.entries, { kind: 'perfect_day', day: '2026-01-06' })).toHaveLength(1);
    expect(totalXp(result.state.entries)).toBe(25); // 5 + 5 + 15

    // and importing the same file again changes nothing
    const again = importInto(result.state, serialize(phone, {}), { now: atDay('2026-01-06', 21) });
    expect(entriesFor(again.state.entries, { kind: 'perfect_day', day: '2026-01-06' })).toHaveLength(1);
    expect(totalXp(again.state.entries)).toBe(25);
  });

  it('does not pay twice when both devices ticked the same habit', () => {
    let base = seedState();
    base = on('2026-01-05', base, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
    base = on('2026-01-05', base, { type: 'habit/add', habit: { id: 'h2', title: 'Stretch', order: 2 } });
    // Both devices had the same kind of day, offline, before syncing.
    const laptop = on('2026-01-06', on('2026-01-06', base, { type: 'habit/complete', id: 'h1' }), { type: 'habit/complete', id: 'h2' });
    const phone = on('2026-01-06', on('2026-01-06', base, { type: 'habit/complete', id: 'h1' }, 20), { type: 'habit/complete', id: 'h2' }, 21);
    expect(totalXp(laptop.entries)).toBe(25);
    expect(totalXp(phone.entries)).toBe(25);

    const merged = importInto(laptop, serialize(phone, {}), { now: atDay('2026-01-06', 22) });
    expect(totalXp(merged.state.entries)).toBe(25); // not 50
    expect(entriesFor(merged.state.entries, { kind: 'habit', day: '2026-01-06' })).toHaveLength(2);
    expect(entriesFor(merged.state.entries, { kind: 'perfect_day', day: '2026-01-06' })).toHaveLength(1);
  });

  it('propagates the error for a bad file instead of corrupting state', () => {
    expect(() => importInto(populated(), 'garbage', {})).toThrow();
  });
});
