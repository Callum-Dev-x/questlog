// The reducer. Every mutation in the app goes through reduce(state, action):
// pure, synchronous, and the only place ledger entries are ever created.

import { dayKey, lastNDays, timestamp } from './dates.js';
import { makeHabit, makeTodo, makeProject, makeMilestone } from './schema.js';
import {
  makeEntry, makeVoid, entriesFor, completedDaysFor, effectiveEntries,
} from './ledger.js';
import { habitXp, todoXp, milestoneXp, PERFECT_DAY_XP, PROJECT_COMPLETE_XP } from './xp.js';
import { isScheduledOn, streakIfCompletedOn } from './streaks.js';

function put(state, collection, entity) {
  return { ...state, [collection]: { ...state[collection], [entity.id]: entity } };
}

function addEntries(state, entries) {
  if (!entries.length) return state;
  const next = { ...state.entries };
  for (const entry of entries) next[entry.id] = entry;
  return { ...state, entries: next };
}

function touch(entity, patch, at) {
  return { ...entity, ...patch, id: entity.id, updatedAt: at };
}

/** Live habits: not deleted, not archived. */
export function activeHabits(state) {
  return Object.values(state.habits).filter((h) => !h.deletedAt && !h.archived);
}

export function habitsDueOn(state, day) {
  return activeHabits(state).filter((h) => isScheduledOn(h.schedule, day));
}

export function isHabitDoneOn(state, habitId, day) {
  return entriesFor(state.entries, { kind: 'habit', refId: habitId, day }).length > 0;
}

function voidAll(state, matcher, at, day) {
  const targets = effectiveEntries(state.entries).filter(matcher);
  if (!targets.length) return state;
  return addEntries(state, targets.map((entry) => makeVoid(entry.id, { at, day: day || entry.day })));
}

/**
 * Award or revoke the "perfect day" bonus for `day`. Runs after any habit
 * completion changes so the bonus always matches reality, in both directions.
 * With `revoke: false` it can only ever add — used when reconciling an import,
 * where taking XP away that another device paid out would be unfair.
 */
function syncPerfectDay(state, day, at, opts = {}) {
  const due = habitsDueOn(state, day);
  const existing = entriesFor(state.entries, { kind: 'perfect_day', day });
  const complete = due.length > 0 && due.every((habit) => isHabitDoneOn(state, habit.id, day));

  if (complete && existing.length === 0) {
    return addEntries(state, [makeEntry({
      kind: 'perfect_day', refId: null, xp: PERFECT_DAY_XP, day, at,
      meta: { habits: due.length },
    })]);
  }
  if (!complete && existing.length > 0 && opts.revoke !== false) {
    return addEntries(state, existing.map((entry) => makeVoid(entry.id, { at, day })));
  }
  return state;
}

/** Award or revoke the completion bonus for a project once every milestone is done. */
function syncProjectComplete(state, projectId, at, day, opts = {}) {
  const project = state.projects[projectId];
  const milestones = Object.values(state.milestones)
    .filter((m) => m.projectId === projectId && !m.deletedAt);
  const existing = entriesFor(state.entries, { kind: 'project', refId: projectId });
  const complete = Boolean(project) && !project.deletedAt
    && milestones.length > 0 && milestones.every((m) => m.completedAt);

  if (complete && existing.length === 0) {
    return addEntries(state, [makeEntry({
      kind: 'project', refId: projectId, xp: PROJECT_COMPLETE_XP, day, at,
      meta: { milestones: milestones.length, title: project.title },
    })]);
  }
  if (!complete && existing.length > 0 && opts.revoke !== false) {
    return addEntries(state, existing.map((entry) => makeVoid(entry.id, { at, day })));
  }
  return state;
}

/**
 * What makes two entries the same fact. Ticking a habit on two devices on the
 * same day is one completion, not two — merging unions by entry id, so these
 * have to be collapsed afterwards.
 */
function identityOf(entry) {
  switch (entry.kind) {
    case 'habit': return `habit|${entry.refId}|${entry.day}`;
    case 'todo': return `todo|${entry.refId}`;
    case 'milestone': return `milestone|${entry.refId}`;
    case 'project': return `project|${entry.refId}`;
    case 'perfect_day': return `perfect_day|${entry.day}`;
    default: return null;
  }
}

/** Void every entry that duplicates a fact already recorded, keeping the earliest. */
function dedupeEntries(state, at) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of effectiveEntries(state.entries)) { // oldest first
    const key = identityOf(entry);
    if (!key) continue;
    if (seen.has(key)) duplicates.push(entry);
    else seen.add(key);
  }
  if (!duplicates.length) return state;
  return addEntries(state, duplicates.map((entry) => makeVoid(entry.id, { at, day: entry.day })));
}

/**
 * Put the ledger straight after a merge.
 *
 * First collapse duplicates: two devices that each ticked the same habit today
 * produced two entries for one completion. Then award anything the combined
 * history has earned but no single device could see — if one device ticked half
 * the habits and the other ticked the rest, neither could call it a perfect day
 * on its own. Awarding is one-way: it never revokes a bonus another device
 * already paid out.
 *
 * @param {Object} state
 * @param {{now?:Date, days?:number}} [opts]
 */
export function reconcileAfterMerge(state, opts = {}) {
  const now = opts.now || new Date();
  const at = timestamp(now);
  const today = dayKey(now);
  let next = dedupeEntries(state, at);
  for (const day of lastNDays(opts.days || 30, today)) {
    next = syncPerfectDay(next, day, at, { revoke: false });
  }
  for (const project of Object.values(next.projects)) {
    if (!project.deletedAt) next = syncProjectComplete(next, project.id, at, today, { revoke: false });
  }
  return next;
}

/**
 * @param {Object} state
 * @param {{type:string}} action
 * @param {{now?:Date}} [ctx]
 */
export function reduce(state, action, ctx = {}) {
  const now = ctx.now || new Date();
  const at = timestamp(now);
  const today = dayKey(now);

  switch (action.type) {
    // ---- habits ---------------------------------------------------------
    case 'habit/add': {
      const habit = makeHabit(action.habit || {}, now);
      return put(state, 'habits', habit);
    }
    case 'habit/update': {
      const habit = state.habits[action.id];
      if (!habit) return state;
      return put(state, 'habits', touch(habit, action.patch || {}, at));
    }
    case 'habit/remove': {
      const habit = state.habits[action.id];
      if (!habit) return state;
      // Soft delete: the tombstone is what propagates the deletion on merge.
      // Earned XP stays earned — past entries are never voided by a delete.
      const next = put(state, 'habits', touch(habit, { deletedAt: at }, at));
      return syncPerfectDay(next, today, at);
    }
    case 'habit/complete': {
      const habit = state.habits[action.id];
      if (!habit || habit.deletedAt) return state;
      const day = action.day || today;
      if (isHabitDoneOn(state, habit.id, day)) return state;

      const done = completedDaysFor(state.entries, habit.id);
      const streak = streakIfCompletedOn(habit.schedule, done, day, {
        weekStartsOn: state.settings.weekStartsOn,
      });
      const xp = habitXp(habit.difficulty, streak);
      const entry = makeEntry({
        kind: 'habit', refId: habit.id, xp, day, at,
        meta: {
          streak,
          unit: habit.schedule.kind === 'weekly' ? 'week' : 'day',
          difficulty: habit.difficulty,
          title: habit.title,
        },
      });
      return syncPerfectDay(addEntries(state, [entry]), day, at);
    }
    case 'habit/uncomplete': {
      const habit = state.habits[action.id];
      if (!habit) return state;
      const day = action.day || today;
      const next = voidAll(
        state,
        (entry) => entry.kind === 'habit' && entry.refId === habit.id && entry.day === day,
        at, day,
      );
      if (next === state) return state;
      return syncPerfectDay(next, day, at);
    }

    // ---- todos ----------------------------------------------------------
    case 'todo/add': {
      const todo = makeTodo(action.todo || {}, now);
      return put(state, 'todos', todo);
    }
    case 'todo/update': {
      const todo = state.todos[action.id];
      if (!todo) return state;
      return put(state, 'todos', touch(todo, action.patch || {}, at));
    }
    case 'todo/remove': {
      const todo = state.todos[action.id];
      if (!todo) return state;
      return put(state, 'todos', touch(todo, { deletedAt: at }, at));
    }
    case 'todo/toggle': {
      const todo = state.todos[action.id];
      if (!todo || todo.deletedAt) return state;
      const done = action.done === undefined ? !todo.completedAt : Boolean(action.done);
      if (done === Boolean(todo.completedAt)) return state;
      const day = action.day || today;

      if (done) {
        const onTime = !todo.due || day <= todo.due;
        const xp = todoXp(todo.difficulty, { onTime });
        const entry = makeEntry({
          kind: 'todo', refId: todo.id, xp, day, at,
          meta: { onTime, difficulty: todo.difficulty, title: todo.title },
        });
        const next = put(state, 'todos', touch(todo, { completedAt: at, completedDay: day }, at));
        return addEntries(next, [entry]);
      }
      const cleared = put(state, 'todos', touch(todo, { completedAt: null, completedDay: null }, at));
      return voidAll(cleared, (entry) => entry.kind === 'todo' && entry.refId === todo.id, at, day);
    }

    // ---- projects & milestones -------------------------------------------
    case 'project/add': {
      return put(state, 'projects', makeProject(action.project || {}, now));
    }
    case 'project/update': {
      const project = state.projects[action.id];
      if (!project) return state;
      return put(state, 'projects', touch(project, action.patch || {}, at));
    }
    case 'project/remove': {
      const project = state.projects[action.id];
      if (!project) return state;
      let next = put(state, 'projects', touch(project, { deletedAt: at }, at));
      for (const milestone of Object.values(next.milestones)) {
        if (milestone.projectId === project.id && !milestone.deletedAt) {
          next = put(next, 'milestones', touch(milestone, { deletedAt: at }, at));
        }
      }
      return syncProjectComplete(next, project.id, at, today);
    }
    case 'milestone/add': {
      const milestone = makeMilestone(action.milestone || {}, now);
      if (!milestone.projectId) return state;
      const next = put(state, 'milestones', milestone);
      return syncProjectComplete(next, milestone.projectId, at, today);
    }
    case 'milestone/update': {
      const milestone = state.milestones[action.id];
      if (!milestone) return state;
      return put(state, 'milestones', touch(milestone, action.patch || {}, at));
    }
    case 'milestone/remove': {
      const milestone = state.milestones[action.id];
      if (!milestone) return state;
      const next = put(state, 'milestones', touch(milestone, { deletedAt: at }, at));
      return syncProjectComplete(next, milestone.projectId, at, today);
    }
    case 'milestone/toggle': {
      const milestone = state.milestones[action.id];
      if (!milestone || milestone.deletedAt) return state;
      const done = action.done === undefined ? !milestone.completedAt : Boolean(action.done);
      if (done === Boolean(milestone.completedAt)) return state;
      const day = action.day || today;

      let next;
      if (done) {
        const xp = milestoneXp(milestone.difficulty);
        next = put(state, 'milestones', touch(milestone, { completedAt: at, completedDay: day }, at));
        next = addEntries(next, [makeEntry({
          kind: 'milestone', refId: milestone.id, xp, day, at,
          meta: { difficulty: milestone.difficulty, title: milestone.title, projectId: milestone.projectId },
        })]);
      } else {
        next = put(state, 'milestones', touch(milestone, { completedAt: null, completedDay: null }, at));
        next = voidAll(next, (entry) => entry.kind === 'milestone' && entry.refId === milestone.id, at, day);
      }
      return syncProjectComplete(next, milestone.projectId, at, day);
    }

    // ---- app ------------------------------------------------------------
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch, updatedAt: at } };
    case 'profile/update':
      return { ...state, profile: { ...state.profile, ...action.patch, updatedAt: at } };
    case 'state/replace':
      return action.state;

    default:
      return state;
  }
}
