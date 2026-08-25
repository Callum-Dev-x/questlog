import { describe, it, expect } from './harness.js';
import { reduce, reconcileAfterMerge, activeHabits, habitsDueOn, isHabitDoneOn } from '../src/core/state.js';
import { effectiveEntries, entriesFor, totalXp } from '../src/core/ledger.js';
import { seedState, on, atDay } from './helpers.js';

// Two daily habits: with a second habit left undone, the perfect-day bonus
// stays out of the way of the XP arithmetic being asserted.
function base() {
  let state = seedState();
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', difficulty: 'easy' } });
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h2', title: 'Stretch', difficulty: 'easy' } });
  return state;
}

describe('habits', () => {
  it('adds a habit with sane defaults', () => {
    const state = on('2026-01-05', seedState(), { type: 'habit/add', habit: { id: 'h1', title: '  Read  ' } });
    const habit = state.habits.h1;
    expect(habit.title).toBe('Read');
    expect(habit.difficulty).toBe('easy');
    expect(habit.schedule).toEqual({ kind: 'daily' });
    expect(habit.archived).toBe(false);
    expect(habit.deletedAt).toBeNull();
    expect(habit.createdAt).toBe(atDay('2026-01-05').toISOString());
  });

  it('awards base XP for the first completion', () => {
    const state = on('2026-01-05', base(), { type: 'habit/complete', id: 'h1' });
    expect(totalXp(state.entries)).toBe(5);
    const [entry] = entriesFor(state.entries, { kind: 'habit', refId: 'h1' });
    expect(entry.day).toBe('2026-01-05');
    expect(entry.xp).toBe(5);
    expect(entry.meta.streak).toBe(1);
    expect(entry.meta.title).toBe('Read');
    expect(isHabitDoneOn(state, 'h1', '2026-01-05')).toBe(true);
  });

  it('ignores a second completion on the same day', () => {
    const once = on('2026-01-05', base(), { type: 'habit/complete', id: 'h1' });
    const twice = on('2026-01-05', once, { type: 'habit/complete', id: 'h1' }, 22);
    expect(twice).toBe(once);
    expect(totalXp(twice.entries)).toBe(5);
  });

  it('ignores completions for unknown or deleted habits', () => {
    const state = base();
    expect(on('2026-01-05', state, { type: 'habit/complete', id: 'nope' })).toBe(state);
    const removed = on('2026-01-05', state, { type: 'habit/remove', id: 'h1' });
    expect(totalXp(on('2026-01-05', removed, { type: 'habit/complete', id: 'h1' }).entries)).toBe(0);
  });

  it('multiplies the award once the streak reaches three days', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1' });
    expect(entriesFor(state.entries, { kind: 'habit' }).map((e) => e.xp)).toEqual([5, 5, 6]);
    expect(totalXp(state.entries)).toBe(16);
  });

  it('undoing a completion refunds exactly that day', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/uncomplete', id: 'h1' });
    expect(totalXp(state.entries)).toBe(5);
    expect(isHabitDoneOn(state, 'h1', '2026-01-06')).toBe(false);
    expect(isHabitDoneOn(state, 'h1', '2026-01-05')).toBe(true);
  });

  it('can log a completion for an earlier day', () => {
    let state = base();
    state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1', day: '2026-01-05' });
    state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1', day: '2026-01-06' });
    state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1' });
    const entries = entriesFor(state.entries, { kind: 'habit' });
    expect(entries.map((e) => e.day)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    expect(entries[2].meta.streak).toBe(3);
  });

  it('keeps earned XP when a habit is deleted', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/remove', id: 'h1' });
    expect(totalXp(state.entries)).toBe(5);
    expect(state.habits.h1.deletedAt).toBe(atDay('2026-01-06').toISOString());
    expect(activeHabits(state).map((h) => h.id)).toEqual(['h2']);
  });

  it('excludes archived habits from the due list but keeps the record', () => {
    let state = base();
    state = on('2026-01-06', state, { type: 'habit/update', id: 'h2', patch: { archived: true } });
    expect(habitsDueOn(state, '2026-01-06').map((h) => h.id)).toEqual(['h1']);
    expect(state.habits.h2.title).toBe('Stretch');
  });
});

describe('perfect day bonus', () => {
  it('lands when every due habit is done', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    expect(entriesFor(state.entries, { kind: 'perfect_day' })).toHaveLength(0);
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
    expect(totalXp(state.entries)).toBe(25); // 5 + 5 + 15
  });

  it('is revoked when a completion is undone', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    state = on('2026-01-05', state, { type: 'habit/uncomplete', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day' })).toHaveLength(0);
    expect(totalXp(state.entries)).toBe(5);
  });

  it('is not paid twice for the same day', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    state = on('2026-01-05', state, { type: 'habit/uncomplete', id: 'h2' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
    expect(totalXp(state.entries)).toBe(25);
  });

  it('only counts habits actually scheduled that day', () => {
    let state = base();
    state = on('2026-01-05', state, {
      type: 'habit/add',
      habit: { id: 'h3', title: 'Gym', schedule: { kind: 'days', days: [1, 3, 5] } },
    });
    // Tuesday the 6th: h3 is not due, so h1 + h2 are enough
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day', day: '2026-01-06' })).toHaveLength(1);
  });

  it('ignores weekly-target habits, which are never due on a given day', () => {
    let state = base();
    state = on('2026-01-05', state, {
      type: 'habit/add',
      habit: { id: 'h4', title: 'Long run', schedule: { kind: 'weekly', target: 2 } },
    });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day', day: '2026-01-06' })).toHaveLength(1);
  });

  it('appears when deleting the last outstanding habit', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/remove', id: 'h2' });
    expect(entriesFor(state.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
  });
});

describe('reconcileAfterMerge', () => {
  it('awards a missing perfect day without being asked twice', () => {
    let state = base();
    // Entries are added directly, as a merge would, bypassing the reducer's own bonus check.
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    const withoutBonus = {
      ...state,
      entries: Object.fromEntries(Object.entries(state.entries).filter(([, e]) => e.kind !== 'perfect_day')),
    };
    expect(totalXp(withoutBonus.entries)).toBe(10);

    const fixed = reconcileAfterMerge(withoutBonus, { now: atDay('2026-01-05', 22) });
    expect(totalXp(fixed.entries)).toBe(25);
    const twice = reconcileAfterMerge(fixed, { now: atDay('2026-01-05', 23) });
    expect(totalXp(twice.entries)).toBe(25);
  });

  it('never revokes a bonus another device already paid', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    expect(totalXp(state.entries)).toBe(25);
    // A third habit arrives later, so that day no longer looks perfect.
    state = on('2026-01-06', state, { type: 'habit/add', habit: { id: 'h3', title: 'New habit' } });
    const reconciled = reconcileAfterMerge(state, { now: atDay('2026-01-06') });
    expect(entriesFor(reconciled.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
    expect(totalXp(reconciled.entries)).toBe(25);
  });

  it('collapses a completion that two devices both recorded', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    // The same tick arriving from another device: a second entry, same fact.
    const [existing] = entriesFor(state.entries, { kind: 'habit', refId: 'h1' });
    const twin = { ...existing, id: 'e_from_phone', at: '2026-01-05T21:00:00.000Z' };
    const doubled = { ...state, entries: { ...state.entries, [twin.id]: twin } };
    expect(totalXp(doubled.entries)).toBe(10);

    const fixed = reconcileAfterMerge(doubled, { now: atDay('2026-01-06') });
    expect(totalXp(fixed.entries)).toBe(5);
    expect(entriesFor(fixed.entries, { kind: 'habit', refId: 'h1', day: '2026-01-05' })).toHaveLength(1);
    // and running it again is a no-op
    expect(totalXp(reconcileAfterMerge(fixed, { now: atDay('2026-01-06') }).entries)).toBe(5);
  });

  it('collapses two perfect-day bonuses for the same day', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    const [bonus] = entriesFor(state.entries, { kind: 'perfect_day' });
    const twin = { ...bonus, id: 'e_bonus_phone', at: '2026-01-05T22:00:00.000Z' };
    const doubled = { ...state, entries: { ...state.entries, [twin.id]: twin } };
    expect(totalXp(doubled.entries)).toBe(40);

    const fixed = reconcileAfterMerge(doubled, { now: atDay('2026-01-06') });
    expect(entriesFor(fixed.entries, { kind: 'perfect_day', day: '2026-01-05' })).toHaveLength(1);
    expect(totalXp(fixed.entries)).toBe(25);
  });

  it('keeps completions of different habits and different days apart', () => {
    let state = base();
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    const before = totalXp(state.entries);
    expect(totalXp(reconcileAfterMerge(state, { now: atDay('2026-01-06') }).entries)).toBe(before);
  });

  it('leaves an untouched document alone', () => {
    const state = base();
    expect(totalXp(reconcileAfterMerge(state, { now: atDay('2026-01-05') }).entries)).toBe(0);
  });
});

describe('todos', () => {
  function withTodo(due = null, difficulty = 'medium') {
    return on('2026-01-05', seedState(), {
      type: 'todo/add', todo: { id: 't1', title: 'File taxes', due, difficulty },
    });
  }

  it('adds a todo', () => {
    const state = withTodo('2026-01-09');
    expect(state.todos.t1.due).toBe('2026-01-09');
    expect(state.todos.t1.completedAt).toBeNull();
    expect(totalXp(state.entries)).toBe(0);
  });

  it('drops an invalid due date rather than storing it', () => {
    const state = withTodo('sometime');
    expect(state.todos.t1.due).toBeNull();
  });

  it('pays an on-time bonus when completed before the due date', () => {
    const state = on('2026-01-07', withTodo('2026-01-09'), { type: 'todo/toggle', id: 't1' });
    expect(totalXp(state.entries)).toBe(13); // 10 + 25%
    expect(state.todos.t1.completedDay).toBe('2026-01-07');
    expect(entriesFor(state.entries, { kind: 'todo' })[0].meta.onTime).toBe(true);
  });

  it('pays the bonus on the due date itself', () => {
    const state = on('2026-01-09', withTodo('2026-01-09'), { type: 'todo/toggle', id: 't1' });
    expect(totalXp(state.entries)).toBe(13);
  });

  it('pays base XP when late, and never a penalty', () => {
    const state = on('2026-01-11', withTodo('2026-01-09'), { type: 'todo/toggle', id: 't1' });
    expect(totalXp(state.entries)).toBe(10);
    expect(entriesFor(state.entries, { kind: 'todo' })[0].meta.onTime).toBe(false);
  });

  it('treats an undated todo as on time', () => {
    const state = on('2026-01-11', withTodo(null), { type: 'todo/toggle', id: 't1' });
    expect(totalXp(state.entries)).toBe(13);
  });

  it('un-completing clears the flag and voids the XP', () => {
    let state = on('2026-01-07', withTodo('2026-01-09'), { type: 'todo/toggle', id: 't1' });
    state = on('2026-01-08', state, { type: 'todo/toggle', id: 't1' });
    expect(state.todos.t1.completedAt).toBeNull();
    expect(state.todos.t1.completedDay).toBeNull();
    expect(totalXp(state.entries)).toBe(0);
    expect(effectiveEntries(state.entries)).toHaveLength(0);
  });

  it('is a no-op when toggling to the state it is already in', () => {
    const state = withTodo();
    expect(on('2026-01-07', state, { type: 'todo/toggle', id: 't1', done: false })).toBe(state);
    const done = on('2026-01-07', state, { type: 'todo/toggle', id: 't1', done: true });
    expect(on('2026-01-07', done, { type: 'todo/toggle', id: 't1', done: true })).toBe(done);
  });

  it('soft-deletes so the deletion can propagate on merge', () => {
    const state = on('2026-01-08', withTodo(), { type: 'todo/remove', id: 't1' });
    expect(state.todos.t1.deletedAt).toBe(atDay('2026-01-08').toISOString());
  });
});

describe('projects and milestones', () => {
  function withProject() {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'project/add', project: { id: 'p1', title: 'Ship questlog' } });
    state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm1', projectId: 'p1', title: 'Engine', difficulty: 'medium' } });
    state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm2', projectId: 'p1', title: 'UI' } });
    return state;
  }

  it('refuses a milestone with no project', () => {
    const state = withProject();
    expect(on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm9', title: 'Orphan' } })).toBe(state);
  });

  it('pays triple for a milestone', () => {
    const state = on('2026-01-06', withProject(), { type: 'milestone/toggle', id: 'm1' });
    expect(totalXp(state.entries)).toBe(30); // medium 10 × 3
    expect(state.milestones.m1.completedDay).toBe('2026-01-06');
  });

  it('pays a completion bonus once the last milestone lands', () => {
    let state = withProject();
    state = on('2026-01-06', state, { type: 'milestone/toggle', id: 'm1' });
    expect(entriesFor(state.entries, { kind: 'project' })).toHaveLength(0);
    state = on('2026-01-07', state, { type: 'milestone/toggle', id: 'm2' });
    expect(entriesFor(state.entries, { kind: 'project', refId: 'p1' })).toHaveLength(1);
    expect(totalXp(state.entries)).toBe(140); // 30 + 60 + 50
  });

  it('revokes the bonus when a milestone is reopened', () => {
    let state = withProject();
    state = on('2026-01-06', state, { type: 'milestone/toggle', id: 'm1' });
    state = on('2026-01-07', state, { type: 'milestone/toggle', id: 'm2' });
    state = on('2026-01-08', state, { type: 'milestone/toggle', id: 'm1' });
    expect(entriesFor(state.entries, { kind: 'project' })).toHaveLength(0);
    expect(totalXp(state.entries)).toBe(60);
  });

  it('does not pay the bonus for a project with no milestones', () => {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'project/add', project: { id: 'p2', title: 'Empty' } });
    expect(entriesFor(state.entries, { kind: 'project' })).toHaveLength(0);
  });

  it('deleting a project tombstones its milestones', () => {
    let state = withProject();
    state = on('2026-01-06', state, { type: 'milestone/toggle', id: 'm1' });
    state = on('2026-01-07', state, { type: 'project/remove', id: 'p1' });
    expect(state.projects.p1.deletedAt).toBeTruthy();
    expect(state.milestones.m1.deletedAt).toBeTruthy();
    expect(state.milestones.m2.deletedAt).toBeTruthy();
    expect(totalXp(state.entries)).toBe(30); // earned XP survives
  });
});

describe('reducer contract', () => {
  it('never mutates the state it is given', () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    const after = on('2026-01-05', before, { type: 'habit/complete', id: 'h1' });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
    expect(Object.keys(before.entries)).toHaveLength(0);
  });

  it('returns the same object for unknown actions', () => {
    const state = base();
    expect(on('2026-01-05', state, { type: 'nonsense/thing' })).toBe(state);
  });

  it('stamps settings and profile updates', () => {
    let state = on('2026-01-05', seedState(), { type: 'settings/update', patch: { weekStartsOn: 0 } });
    expect(state.settings.weekStartsOn).toBe(0);
    expect(state.settings.updatedAt).toBe(atDay('2026-01-05').toISOString());
    state = on('2026-01-06', state, { type: 'profile/update', patch: { name: 'Cal' } });
    expect(state.profile.name).toBe('Cal');
  });

  it('replaces wholesale on state/replace', () => {
    const fresh = seedState('2026-02-01');
    expect(reduce(base(), { type: 'state/replace', state: fresh })).toBe(fresh);
  });
});
