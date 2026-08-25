// Streak maths. Pure functions over a set of completed day keys — they never
// touch app state, which makes them cheap to test and cheap to recompute.

import { addDays, diffDays, dayKey, isDayKey, startOfWeek, weekdayOf } from './dates.js';

/**
 * @typedef {{kind:'daily'}
 *          |{kind:'days', days:number[]}
 *          |{kind:'weekly', target:number}} Schedule
 */

export const DEFAULT_SCHEDULE = { kind: 'daily' };

export function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return { ...DEFAULT_SCHEDULE };
  if (schedule.kind === 'days') {
    const days = Array.from(new Set((schedule.days || []).map(Number)))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    return days.length ? { kind: 'days', days } : { ...DEFAULT_SCHEDULE };
  }
  if (schedule.kind === 'weekly') {
    const target = Math.min(7, Math.max(1, Math.floor(Number(schedule.target) || 1)));
    return { kind: 'weekly', target };
  }
  return { ...DEFAULT_SCHEDULE };
}

/** Is this habit expected on this day? Weekly-target habits are never "due" on a specific day. */
export function isScheduledOn(schedule, day) {
  const s = normalizeSchedule(schedule);
  if (s.kind === 'daily') return true;
  if (s.kind === 'days') return s.days.includes(weekdayOf(day));
  return false;
}

/** Human summary, e.g. 'Every day', 'Mon, Wed, Fri', '3× per week'. */
export function describeSchedule(schedule) {
  const s = normalizeSchedule(schedule);
  if (s.kind === 'daily') return 'Every day';
  if (s.kind === 'weekly') return `${s.target}× per week`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (s.days.length === 7) return 'Every day';
  if (s.days.join() === '1,2,3,4,5') return 'Weekdays';
  if (s.days.join() === '0,6') return 'Weekends';
  return s.days.map((d) => names[d]).join(', ');
}

function toSet(days) {
  return days instanceof Set ? days : new Set(days || []);
}

function earliestDay(set, fallback) {
  let min = null;
  for (const day of set) {
    if (!isDayKey(day)) continue;
    if (min === null || day < min) min = day;
  }
  return min || fallback;
}

/**
 * Current + longest streak for a scheduled habit.
 * An incomplete *today* does not break the streak — it is still pending.
 *
 * @param {Schedule} schedule
 * @param {Set<string>|string[]} completedDays
 * @param {{today?:string, weekStartsOn?:number}} [opts]
 */
export function computeStreak(schedule, completedDays, opts = {}) {
  const s = normalizeSchedule(schedule);
  const done = toSet(completedDays);
  const today = opts.today || dayKey();
  const weekStartsOn = opts.weekStartsOn ?? 1;
  if (s.kind === 'weekly') return weeklyStreak(s, done, today, weekStartsOn);
  return dailyStreak(s, done, today);
}

function dailyStreak(schedule, done, today) {
  const first = earliestDay(done, today);
  let current = 0;
  let cursor = today;
  while (diffDays(first, cursor) >= 0) {
    if (isScheduledOn(schedule, cursor)) {
      if (done.has(cursor)) current++;
      else if (cursor !== today) break; // a missed scheduled day ends the run
    }
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  const span = diffDays(first, today);
  for (let i = 0; i <= span; i++) {
    const day = addDays(first, i);
    if (!isScheduledOn(schedule, day)) continue;
    if (done.has(day)) {
      run++;
      if (run > longest) longest = run;
    } else if (day !== today) {
      run = 0;
    }
  }

  return { current, longest: Math.max(longest, current), unit: 'day' };
}

function weeklyStreak(schedule, done, today, weekStartsOn) {
  const counts = new Map();
  for (const day of done) {
    if (!isDayKey(day)) continue;
    const week = startOfWeek(day, weekStartsOn);
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  const met = (week) => (counts.get(week) || 0) >= schedule.target;

  const thisWeek = startOfWeek(today, weekStartsOn);
  let current = 0;
  // The current week only counts once its target is met; until then the streak
  // is carried by the weeks before it rather than being broken.
  let cursor = met(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  while (met(cursor)) {
    current++;
    cursor = addDays(cursor, -7);
  }

  let longest = 0;
  let run = 0;
  const weeks = Array.from(counts.keys()).sort();
  const firstWeek = weeks.length ? weeks[0] : thisWeek;
  for (let week = firstWeek; week <= thisWeek; week = addDays(week, 7)) {
    if (met(week)) {
      run++;
      if (run > longest) longest = run;
    } else if (week !== thisWeek) {
      run = 0;
    }
  }

  return { current, longest: Math.max(longest, current), unit: 'week' };
}

/** The streak a habit *would* have if it were completed on `day` — used to price the award. */
export function streakIfCompletedOn(schedule, completedDays, day, opts = {}) {
  const done = new Set(toSet(completedDays));
  done.add(day);
  return computeStreak(schedule, done, { ...opts, today: day }).current;
}

/** Completions in the current week, for weekly-target habits. */
export function weeklyProgress(schedule, completedDays, opts = {}) {
  const s = normalizeSchedule(schedule);
  if (s.kind !== 'weekly') return null;
  const today = opts.today || dayKey();
  const week = startOfWeek(today, opts.weekStartsOn ?? 1);
  let count = 0;
  for (const day of toSet(completedDays)) {
    if (isDayKey(day) && startOfWeek(day, opts.weekStartsOn ?? 1) === week) count++;
  }
  return { count, target: s.target, remaining: Math.max(0, s.target - count) };
}
