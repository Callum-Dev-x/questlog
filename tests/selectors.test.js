import { describe, it, expect } from './harness.js';
import {
  activityStreak, getHabitRows, getHeatmap, getProjectRows, getRecentActivity,
  getStats, getSummary, getTodayView, getTodoBuckets, xpByKind,
} from '../src/core/selectors.js';
import { seedState, on } from './helpers.js';

// One daily habit completed Mon/Tue/Wed. Each day is also a perfect day (+15),
// and Wednesday's award carries the 3-day streak bonus: 20 + 20 + 21 = 61.
function threeDays() {
  let state = seedState();
  state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
  state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
  state = on('2026-01-07', state, { type: 'habit/complete', id: 'h1' });
  return state;
}

describe('summary', () => {
  it('totals XP, level and streaks as of a given day', () => {
    const summary = getSummary(threeDays(), { today: '2026-01-07' });
    expect(summary.totalXp).toBe(61);
    expect(summary.level).toBe(2);
    expect(summary.todayXp).toBe(21);
    expect(summary.weekXp).toBe(61);
    expect(summary.activityStreak).toBe(3);
    expect(summary.perfectDays).toBe(3);
    expect(summary.rank).toBe('Wanderer');
  });

  it('scopes week XP to the configured week start', () => {
    let state = threeDays();
    state = on('2026-01-04', state, { type: 'habit/complete', id: 'h1', day: '2026-01-04' }); // Sunday
    expect(getSummary(state, { today: '2026-01-07' }).weekXp).toBe(61); // Sunday sits in the previous week
    state = on('2026-01-07', state, { type: 'settings/update', patch: { weekStartsOn: 0 } });
    expect(getSummary(state, { today: '2026-01-07' }).weekXp).toBeGreaterThan(61);
  });

  it('counts an activity streak across any kind of completion', () => {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't1', title: 'A' } });
    state = on('2026-01-05', state, { type: 'todo/toggle', id: 't1' });
    expect(activityStreak(state, '2026-01-05')).toBe(1);
    expect(activityStreak(state, '2026-01-06')).toBe(1); // today still pending
    expect(activityStreak(state, '2026-01-07')).toBe(0); // a whole day was missed
    expect(activityStreak(seedState(), '2026-01-07')).toBe(0);
  });
});

describe('habit rows', () => {
  function seedRows(today) {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
    state = on(today, state, { type: 'habit/complete', id: 'h1' });
    return state;
  }

  function rows(today) {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
    state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h2', title: 'Stretch', order: 2 } });
    state = on('2026-01-05', state, {
      type: 'habit/add',
      habit: { id: 'h3', title: 'Gym', order: 3, schedule: { kind: 'days', days: [1, 3, 5] } },
    });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'h1' });
    return getHabitRows(state, { today });
  }

  it('puts outstanding work first and non-scheduled habits last', () => {
    expect(rows('2026-01-06').map((r) => r.habit.id)).toEqual(['h2', 'h1', 'h3']);
  });

  it('reports streak, completion state and the XP on offer', () => {
    const [pending, done] = rows('2026-01-06');
    expect(done.done).toBe(true);
    expect(done.streak).toBe(1);
    expect(done.required).toBe(true);
    expect(pending.done).toBe(false);
    expect(pending.streak).toBe(0);
    expect(pending.xpIfDone).toBe(5);
    expect(pending.history).toHaveLength(7);
    expect(pending.history[6].day).toBe('2026-01-06');
  });

  it('does not mark days before the habit existed as missed', () => {
    const [row] = getHabitRows(seedRows('2026-01-06'), { today: '2026-01-06' });
    const before = row.history.filter((cell) => cell.day < '2026-01-05');
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((cell) => cell.scheduled === false)).toBe(true);
    expect(row.history[row.history.length - 1].scheduled).toBe(true);
  });

  it('marks weekday habits as not required on their off days', () => {
    const gym = rows('2026-01-06').find((r) => r.habit.id === 'h3');
    expect(gym.required).toBe(false);
    expect(rows('2026-01-07').find((r) => r.habit.id === 'h3').required).toBe(true);
  });

  it('carries weekly progress for target habits', () => {
    let state = seedState();
    state = on('2026-01-05', state, {
      type: 'habit/add', habit: { id: 'w1', title: 'Run', schedule: { kind: 'weekly', target: 3 } },
    });
    state = on('2026-01-06', state, { type: 'habit/complete', id: 'w1' });
    const [row] = getHabitRows(state, { today: '2026-01-06' });
    expect(row.weekly).toEqual({ count: 1, target: 3, remaining: 2 });
    expect(row.required).toBe(false);
    expect(row.dueToday).toBe(true);
  });
});

describe('todo buckets', () => {
  function seeded() {
    let state = seedState();
    const add = (id, due) => { state = on('2026-01-05', state, { type: 'todo/add', todo: { id, title: id, due, order: 1 } }); };
    add('past', '2026-01-04');
    add('now', '2026-01-06');
    add('soon', '2026-01-09');
    add('someday', null);
    add('done', '2026-01-06');
    state = on('2026-01-06', state, { type: 'todo/toggle', id: 'done' });
    return state;
  }

  it('splits by urgency against the reference day', () => {
    const buckets = getTodoBuckets(seeded(), { today: '2026-01-06' });
    expect(buckets.overdue.map((t) => t.id)).toEqual(['past']);
    expect(buckets.today.map((t) => t.id)).toEqual(['now']);
    expect(buckets.upcoming.map((t) => t.id)).toEqual(['soon']);
    expect(buckets.someday.map((t) => t.id)).toEqual(['someday']);
    expect(buckets.done.map((t) => t.id)).toEqual(['done']);
  });

  it('hides deleted todos', () => {
    const state = on('2026-01-06', seeded(), { type: 'todo/remove', id: 'past' });
    expect(getTodoBuckets(state, { today: '2026-01-06' }).overdue).toHaveLength(0);
  });

  it('sorts overdue items oldest first', () => {
    let state = seeded();
    state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 'older', title: 'older', due: '2026-01-01' } });
    const buckets = getTodoBuckets(state, { today: '2026-01-06' });
    expect(buckets.overdue.map((t) => t.id)).toEqual(['older', 'past']);
  });
});

describe('today view', () => {
  it('counts what is due, done and outstanding', () => {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h1', title: 'Read', order: 1 } });
    state = on('2026-01-05', state, { type: 'habit/add', habit: { id: 'h2', title: 'Stretch', order: 2 } });
    state = on('2026-01-05', state, { type: 'todo/add', todo: { id: 't1', title: 'Task', due: '2026-01-05' } });
    let view = getTodayView(state, { today: '2026-01-05' });
    expect(view.counts).toEqual({ habitsDue: 2, habitsDone: 0, todosOpen: 1, todosDoneToday: 0 });
    expect(view.perfectDay).toBe(false);

    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h1' });
    state = on('2026-01-05', state, { type: 'habit/complete', id: 'h2' });
    state = on('2026-01-05', state, { type: 'todo/toggle', id: 't1' });
    view = getTodayView(state, { today: '2026-01-05' });
    expect(view.counts).toEqual({ habitsDue: 2, habitsDone: 2, todosOpen: 0, todosDoneToday: 1 });
    expect(view.perfectDay).toBe(true);
    expect(view.summary.totalXp).toBe(31); // 5 + 5 + 15 + 6
  });

  it('is not a perfect day when nothing is scheduled', () => {
    expect(getTodayView(seedState(), { today: '2026-01-05' }).perfectDay).toBe(false);
  });
});

describe('project rows', () => {
  it('reports progress and the next due milestone', () => {
    let state = seedState();
    state = on('2026-01-05', state, { type: 'project/add', project: { id: 'p1', title: 'Ship', order: 1 } });
    state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm1', projectId: 'p1', title: 'A', order: 1 } });
    state = on('2026-01-05', state, { type: 'milestone/add', milestone: { id: 'm2', projectId: 'p1', title: 'B', order: 2, due: '2026-02-01' } });
    state = on('2026-01-06', state, { type: 'milestone/toggle', id: 'm1' });

    const [row] = getProjectRows(state, {});
    expect(row.total).toBe(2);
    expect(row.doneCount).toBe(1);
    expect(row.progress).toBe(0.5);
    expect(row.complete).toBe(false);
    expect(row.nextDue.id).toBe('m2');

    const finished = on('2026-01-07', state, { type: 'milestone/toggle', id: 'm2' });
    const [doneRow] = getProjectRows(finished, {});
    expect(doneRow.complete).toBe(true);
    expect(doneRow.progress).toBe(1);
    expect(doneRow.nextDue).toBeNull();
  });
});

describe('heatmap, activity and stats', () => {
  it('builds a fixed-length grid ending today', () => {
    const cells = getHeatmap(threeDays(), { today: '2026-01-07', days: 7 });
    expect(cells).toHaveLength(7);
    expect(cells[6].day).toBe('2026-01-07');
    expect(cells[6].xp).toBe(21);
    expect(cells[6].level).toBe(4);
    expect(cells[0].xp).toBe(0);
    expect(cells[0].level).toBe(0);
  });

  it('pads the grid so each row is one weekday', () => {
    // 2026-01-07 is a Wednesday, so the 7-day window opens on Thursday the 1st.
    const cells = getHeatmap(threeDays(), { today: '2026-01-07', days: 7, align: true });
    expect(cells).toHaveLength(10); // 3 blanks + 7 days
    expect(cells.slice(0, 3).every((cell) => cell.pad)).toBe(true);
    expect(cells[3].day).toBe('2026-01-01');
    expect(cells[9].day).toBe('2026-01-07');
    const sunday = getHeatmap(threeDays(), { today: '2026-01-07', days: 7, align: true, weekStartsOn: 0 });
    expect(sunday).toHaveLength(11); // Thursday is 4 days past a Sunday start
    expect(sunday[4].day).toBe('2026-01-01');
  });

  it('lists recent activity newest first', () => {
    const feed = getRecentActivity(threeDays(), { limit: 10 });
    expect(feed).toHaveLength(6); // 3 completions + 3 perfect days
    expect(feed[0].entry.day).toBe('2026-01-07');
    expect(feed[feed.length - 1].entry.day).toBe('2026-01-05');
    expect(feed.some((row) => row.kindLabel === 'Perfect day')).toBe(true);
    expect(feed.find((row) => row.entry.kind === 'habit').title).toBe('Read');
  });

  it('summarizes the last 30 days', () => {
    const stats = getStats(threeDays(), { today: '2026-01-07' });
    expect(stats.counts.habit).toBe(3);
    expect(stats.counts.perfect_day).toBe(3);
    expect(stats.bestDay.day).toBe('2026-01-07');
    expect(stats.bestStreak).toBe(3);
    expect(stats.activeDaysLast30).toBe(3);
    expect(stats.consistency).toBe(10);
    expect(stats.trackedHabits).toBe(1);
    expect(stats.openTodos).toBe(0);
  });

  it('splits XP by where it came from', () => {
    expect(xpByKind(threeDays().entries)).toEqual({ habit: 16, perfect_day: 45 });
    expect(xpByKind({})).toEqual({});
  });

  it('survives an empty document', () => {
    const stats = getStats(seedState(), { today: '2026-01-07' });
    expect(stats.totalXp).toBe(0);
    expect(stats.level).toBe(1);
    expect(stats.bestDay).toBeNull();
    expect(getHeatmap(seedState(), { today: '2026-01-07', days: 30 })).toHaveLength(30);
    expect(getRecentActivity(seedState(), {})).toEqual([]);
  });
});
