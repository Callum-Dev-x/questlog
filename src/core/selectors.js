// Read models. Everything the UI renders is derived here from state + a
// reference day, so the views stay dumb and the maths stays testable.

import { addDays, dayKey, diffDays, lastNDays, startOfWeek, weekdayOf } from './dates.js';
import {
  completionsByHabit, effectiveEntries, entriesFor, totalXp, xpByDay,
} from './ledger.js';
import { levelProgress, rankFor, habitXp } from './xp.js';
import { computeStreak, isScheduledOn, streakIfCompletedOn, weeklyProgress } from './streaks.js';

function byOrder(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function liveValues(collection) {
  return Object.values(collection || {}).filter((record) => !record.deletedAt);
}

/** Consecutive days ending today with at least one completion. Today may still be pending. */
export function activityStreak(state, today = dayKey()) {
  const days = new Set();
  for (const entry of effectiveEntries(state.entries)) {
    if (entry.kind === 'perfect_day') continue; // bonuses ride on real completions
    days.add(entry.day);
  }
  if (!days.size) return 0;
  let earliest = today;
  for (const day of days) if (day < earliest) earliest = day;

  let streak = 0;
  let cursor = today;
  while (diffDays(earliest, cursor) >= 0) {
    if (days.has(cursor)) streak++;
    else if (cursor !== today) break;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function getSummary(state, opts = {}) {
  const today = opts.today || dayKey();
  const perDay = xpByDay(state.entries);
  const total = totalXp(state.entries);
  const progress = levelProgress(total);
  const weekStart = startOfWeek(today, state.settings.weekStartsOn);

  let weekXp = 0;
  for (const [day, xp] of perDay) {
    if (day >= weekStart && day <= today) weekXp += xp;
  }

  return {
    ...progress,
    rank: rankFor(progress.level),
    todayXp: perDay.get(today) || 0,
    weekXp,
    activityStreak: activityStreak(state, today),
    perfectDays: entriesFor(state.entries, { kind: 'perfect_day' }).length,
  };
}

/** One row per active habit, with everything the Today list needs to render. */
export function getHabitRows(state, opts = {}) {
  const today = opts.today || dayKey();
  const weekStartsOn = state.settings.weekStartsOn;
  const completions = completionsByHabit(state.entries);

  return liveValues(state.habits)
    .filter((habit) => opts.includeArchived || !habit.archived)
    .map((habit) => {
      const done = completions.get(habit.id) || new Set();
      const streak = computeStreak(habit.schedule, done, { today, weekStartsOn });
      const isDone = done.has(today);
      const dueToday = isScheduledOn(habit.schedule, today) || habit.schedule.kind === 'weekly';
      const nextStreak = isDone
        ? streak.current
        : streakIfCompletedOn(habit.schedule, done, today, { weekStartsOn });
      const born = dayKey(new Date(habit.createdAt));
      return {
        habit,
        done: isDone,
        dueToday,
        required: isScheduledOn(habit.schedule, today),
        streak: streak.current,
        longest: streak.longest,
        unit: streak.unit,
        weekly: weeklyProgress(habit.schedule, done, { today, weekStartsOn }),
        totalCompletions: done.size,
        xpIfDone: habitXp(habit.difficulty, nextStreak),
        history: lastNDays(7, today).map((day) => ({
          day,
          done: done.has(day),
          scheduled: day >= born && isScheduledOn(habit.schedule, day),
        })),
      };
    })
    .sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return byOrder(a.habit, b.habit);
    });
}

/** Todos bucketed by urgency relative to `today`. */
export function getTodoBuckets(state, opts = {}) {
  const today = opts.today || dayKey();
  const todos = liveValues(state.todos);
  const buckets = { overdue: [], today: [], upcoming: [], someday: [], done: [] };

  for (const todo of todos) {
    if (todo.completedAt) {
      buckets.done.push(todo);
    } else if (!todo.due) {
      buckets.someday.push(todo);
    } else if (todo.due < today) {
      buckets.overdue.push(todo);
    } else if (todo.due === today) {
      buckets.today.push(todo);
    } else {
      buckets.upcoming.push(todo);
    }
  }

  const byDue = (a, b) => (a.due === b.due ? byOrder(a, b) : a.due < b.due ? -1 : 1);
  buckets.overdue.sort(byDue);
  buckets.today.sort(byOrder);
  buckets.upcoming.sort(byDue);
  buckets.someday.sort(byOrder);
  buckets.done.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  return buckets;
}

export function getTodayView(state, opts = {}) {
  const today = opts.today || dayKey();
  const habits = getHabitRows(state, { today });
  const todos = getTodoBuckets(state, { today });
  const required = habits.filter((row) => row.required);
  const doneCount = required.filter((row) => row.done).length;

  return {
    day: today,
    habits,
    todos,
    counts: {
      habitsDue: required.length,
      habitsDone: doneCount,
      todosOpen: todos.overdue.length + todos.today.length,
      todosDoneToday: todos.done.filter((todo) => todo.completedDay === today).length,
    },
    perfectDay: required.length > 0 && doneCount === required.length,
    summary: getSummary(state, { today }),
  };
}

export function getProjectRows(state, opts = {}) {
  const milestones = liveValues(state.milestones);
  return liveValues(state.projects)
    .filter((project) => opts.includeArchived || !project.archived)
    .map((project) => {
      const own = milestones.filter((m) => m.projectId === project.id).sort(byOrder);
      const done = own.filter((m) => m.completedAt).length;
      const linkedTodos = liveValues(state.todos).filter((t) => t.projectId === project.id);
      return {
        project,
        milestones: own,
        doneCount: done,
        total: own.length,
        progress: own.length ? done / own.length : 0,
        complete: own.length > 0 && done === own.length,
        openTodos: linkedTodos.filter((t) => !t.completedAt).length,
        nextDue: own.filter((m) => !m.completedAt && m.due).sort((a, b) => (a.due < b.due ? -1 : 1))[0] || null,
      };
    })
    .sort((a, b) => byOrder(a.project, b.project));
}

/**
 * GitHub-style contribution grid data.
 * With `align`, blank cells are prepended so that each row of the 7-row grid
 * is a single weekday, starting from the configured week start.
 */
export function getHeatmap(state, opts = {}) {
  const today = opts.today || dayKey();
  const days = opts.days || 91;
  const perDay = xpByDay(state.entries);
  const range = lastNDays(days, today);
  const max = range.reduce((m, day) => Math.max(m, perDay.get(day) || 0), 0);

  const cells = range.map((day) => {
    const xp = perDay.get(day) || 0;
    return { day, xp, level: xp === 0 ? 0 : Math.min(4, Math.ceil((xp / (max || 1)) * 4)), pad: false };
  });

  if (opts.align) {
    const weekStartsOn = opts.weekStartsOn ?? 1;
    const lead = (weekdayOf(range[0]) - weekStartsOn + 7) % 7;
    for (let i = 0; i < lead; i++) cells.unshift({ day: null, xp: 0, level: 0, pad: true });
  }
  return cells;
}

const KIND_LABELS = {
  habit: 'Habit', todo: 'Task', milestone: 'Milestone',
  project: 'Project complete', perfect_day: 'Perfect day',
};

export function getRecentActivity(state, opts = {}) {
  const limit = opts.limit || 30;
  return effectiveEntries(state.entries)
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      entry,
      kindLabel: KIND_LABELS[entry.kind] || entry.kind,
      title: entry.meta.title || (entry.kind === 'perfect_day' ? 'Every habit done' : 'Bonus'),
      streak: entry.meta.streak || 0,
      streakUnit: entry.meta.unit === 'week' ? 'week' : 'day',
    }));
}

/** @returns {Object<string, number>} entry kind → XP earned from it */
export function xpByKind(entries) {
  const out = {};
  for (const entry of effectiveEntries(entries)) {
    out[entry.kind] = (out[entry.kind] || 0) + (entry.xp || 0);
  }
  return out;
}

export function getStats(state, opts = {}) {
  const today = opts.today || dayKey();
  const entries = effectiveEntries(state.entries);
  const perDay = xpByDay(state.entries);
  const counts = { habit: 0, todo: 0, milestone: 0, project: 0, perfect_day: 0 };
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] || 0) + 1;

  let bestDay = null;
  for (const [day, xp] of perDay) {
    if (!bestDay || xp > bestDay.xp) bestDay = { day, xp };
  }

  const rows = getHabitRows(state, { today });
  const bestStreak = rows.reduce((best, row) => Math.max(best, row.longest), 0);
  const last30 = lastNDays(30, today);
  const activeDays = last30.filter((day) => (perDay.get(day) || 0) > 0).length;

  return {
    ...getSummary(state, { today }),
    counts,
    bestDay,
    bestStreak,
    activeDaysLast30: activeDays,
    consistency: Math.round((activeDays / 30) * 100),
    trackedHabits: rows.length,
    openTodos: liveValues(state.todos).filter((todo) => !todo.completedAt).length,
    projects: getProjectRows(state).length,
  };
}
