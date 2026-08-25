import { describe, it, expect } from './harness.js';
import {
  computeStreak, describeSchedule, isScheduledOn, normalizeSchedule,
  streakIfCompletedOn, weeklyProgress,
} from '../src/core/streaks.js';

const DAILY = { kind: 'daily' };
// 2026-01-01 is a Thursday; 05 Mon, 06 Tue, 07 Wed, 08 Thu, 09 Fri, 10 Sat, 11 Sun
const MWF = { kind: 'days', days: [1, 3, 5] };

describe('schedules', () => {
  it('normalizes junk into a sane schedule', () => {
    expect(normalizeSchedule(undefined)).toEqual({ kind: 'daily' });
    expect(normalizeSchedule({ kind: 'days', days: [] })).toEqual({ kind: 'daily' });
    expect(normalizeSchedule({ kind: 'days', days: [3, 1, 1, 9, -2] })).toEqual({ kind: 'days', days: [1, 3] });
    expect(normalizeSchedule({ kind: 'weekly', target: 0 })).toEqual({ kind: 'weekly', target: 1 });
    expect(normalizeSchedule({ kind: 'weekly', target: 99 })).toEqual({ kind: 'weekly', target: 7 });
    expect(normalizeSchedule({ kind: 'bogus' })).toEqual({ kind: 'daily' });
  });

  it('knows which days a habit is due', () => {
    expect(isScheduledOn(DAILY, '2026-01-03')).toBe(true);
    expect(isScheduledOn(MWF, '2026-01-05')).toBe(true);  // Monday
    expect(isScheduledOn(MWF, '2026-01-06')).toBe(false); // Tuesday
    // weekly-target habits are due "sometime this week", never on a given day
    expect(isScheduledOn({ kind: 'weekly', target: 3 }, '2026-01-05')).toBe(false);
  });

  it('describes schedules for humans', () => {
    expect(describeSchedule(DAILY)).toBe('Every day');
    expect(describeSchedule({ kind: 'days', days: [1, 2, 3, 4, 5] })).toBe('Weekdays');
    expect(describeSchedule({ kind: 'days', days: [0, 6] })).toBe('Weekends');
    expect(describeSchedule(MWF)).toBe('Mon, Wed, Fri');
    expect(describeSchedule({ kind: 'weekly', target: 3 })).toBe('3× per week');
  });
});

describe('daily streaks', () => {
  it('counts consecutive completed days', () => {
    const done = ['2026-01-08', '2026-01-09', '2026-01-10'];
    expect(computeStreak(DAILY, done, { today: '2026-01-10' }).current).toBe(3);
  });

  it('treats an unfinished today as pending, not broken', () => {
    const done = ['2026-01-08', '2026-01-09'];
    const streak = computeStreak(DAILY, done, { today: '2026-01-10' });
    expect(streak.current).toBe(2);
  });

  it('breaks when a day in the middle is missed', () => {
    const done = ['2026-01-06', '2026-01-08', '2026-01-09'];
    expect(computeStreak(DAILY, done, { today: '2026-01-09' }).current).toBe(2);
  });

  it('resets to zero once two days have lapsed', () => {
    const done = ['2026-01-01', '2026-01-02'];
    expect(computeStreak(DAILY, done, { today: '2026-01-05' }).current).toBe(0);
  });

  it('reports the longest historical run', () => {
    const done = [
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', // run of 4
      '2026-01-09', '2026-01-10', // run of 2, current
    ];
    const streak = computeStreak(DAILY, done, { today: '2026-01-10' });
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(4);
  });

  it('handles empty history', () => {
    expect(computeStreak(DAILY, [], { today: '2026-01-10' })).toEqual({ current: 0, longest: 0, unit: 'day' });
    expect(computeStreak(DAILY, new Set(), { today: '2026-01-10' }).current).toBe(0);
  });

  it('spans a year without losing count', () => {
    const done = [];
    let day = new Date(2025, 0, 1);
    for (let i = 0; i < 400; i++) {
      done.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
      day.setDate(day.getDate() + 1);
    }
    const last = done[done.length - 1];
    expect(computeStreak(DAILY, done, { today: last }).current).toBe(400);
  });
});

describe('weekday streaks', () => {
  it('ignores days the habit is not scheduled on', () => {
    // Mon 5th, Wed 7th, Fri 9th — Tue/Thu absent should not matter
    const done = ['2026-01-05', '2026-01-07', '2026-01-09'];
    expect(computeStreak(MWF, done, { today: '2026-01-09' }).current).toBe(3);
  });

  it('stays alive on an off day', () => {
    const done = ['2026-01-05', '2026-01-07'];
    // Thursday the 8th is not a scheduled day, so nothing is missed
    expect(computeStreak(MWF, done, { today: '2026-01-08' }).current).toBe(2);
  });

  it('breaks when a scheduled day is skipped', () => {
    const done = ['2026-01-05', '2026-01-09']; // missed Wed 7th
    expect(computeStreak(MWF, done, { today: '2026-01-09' }).current).toBe(1);
  });

  it('does not count completions on unscheduled days toward the streak', () => {
    const done = ['2026-01-06', '2026-01-08']; // Tue + Thu only
    expect(computeStreak(MWF, done, { today: '2026-01-08' }).current).toBe(0);
  });
});

describe('weekly-target streaks', () => {
  const weekly = { kind: 'weekly', target: 3 };
  // weeks starting Mon: Jan 5, Jan 12, Jan 19
  const twoGoodWeeks = [
    '2026-01-05', '2026-01-06', '2026-01-08',
    '2026-01-12', '2026-01-14', '2026-01-16',
  ];

  it('counts weeks that hit the target', () => {
    expect(computeStreak(weekly, twoGoodWeeks, { today: '2026-01-16' }).current).toBe(2);
  });

  it('carries the streak through an unfinished current week', () => {
    const done = [...twoGoodWeeks, '2026-01-19']; // only 1 of 3 so far this week
    const streak = computeStreak(weekly, done, { today: '2026-01-20' });
    expect(streak.current).toBe(2);
    expect(streak.unit).toBe('week');
  });

  it('breaks after a week that missed the target', () => {
    const done = [...twoGoodWeeks, '2026-01-19', '2026-01-20']; // week of 19th short
    expect(computeStreak(weekly, done, { today: '2026-01-27' }).current).toBe(0);
  });

  it('respects a Sunday week start', () => {
    // Sun 4th + Mon 5th + Tue 6th is one Sunday-week, but straddles two Monday-weeks
    const done = ['2026-01-04', '2026-01-05', '2026-01-06'];
    expect(computeStreak(weekly, done, { today: '2026-01-06', weekStartsOn: 0 }).current).toBe(1);
    expect(computeStreak(weekly, done, { today: '2026-01-06', weekStartsOn: 1 }).current).toBe(0);
  });

  it('reports progress toward this week', () => {
    expect(weeklyProgress(weekly, twoGoodWeeks, { today: '2026-01-16' })).toEqual({ count: 3, target: 3, remaining: 0 });
    expect(weeklyProgress(weekly, twoGoodWeeks, { today: '2026-01-20' })).toEqual({ count: 0, target: 3, remaining: 3 });
    expect(weeklyProgress(DAILY, twoGoodWeeks, { today: '2026-01-20' })).toBeNull();
  });
});

describe('streakIfCompletedOn', () => {
  it('prices the completion about to happen', () => {
    const done = ['2026-01-08', '2026-01-09'];
    expect(streakIfCompletedOn(DAILY, done, '2026-01-10')).toBe(3);
  });

  it('starts a fresh streak after a lapse', () => {
    const done = ['2026-01-01'];
    expect(streakIfCompletedOn(DAILY, done, '2026-01-10')).toBe(1);
  });

  it('does not mutate the set it is given', () => {
    const done = new Set(['2026-01-09']);
    streakIfCompletedOn(DAILY, done, '2026-01-10');
    expect(done.size).toBe(1);
  });

  it('ignores completions logged after the day being priced', () => {
    const done = ['2026-01-09', '2026-01-12'];
    expect(streakIfCompletedOn(DAILY, done, '2026-01-10')).toBe(2);
  });
});
