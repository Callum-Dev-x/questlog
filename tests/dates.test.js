import { describe, it, expect } from './harness.js';
import {
  addDays, dayKey, daysBetween, diffDays, formatDay, isDayKey, lastNDays,
  parseDay, startOfMonth, startOfWeek, weekdayOf,
} from '../src/core/dates.js';
import { atDay } from './helpers.js';

describe('dates', () => {
  it('formats a local date as a day key', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  it('round-trips through parseDay at local noon', () => {
    const date = parseDay('2026-03-08');
    expect(date.getHours()).toBe(12);
    expect(dayKey(date)).toBe('2026-03-08');
  });

  it('rejects malformed and impossible day keys', () => {
    expect(isDayKey('2026-01-05')).toBe(true);
    expect(isDayKey('2024-02-29')).toBe(true);
    expect(isDayKey('2025-02-29')).toBe(false);
    expect(isDayKey('2026-02-31')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('26-01-01')).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(() => parseDay('nope')).toThrow('invalid day key');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
  });

  it('counts whole days even across DST shifts', () => {
    expect(diffDays('2026-01-01', '2026-01-02')).toBe(1);
    expect(diffDays('2026-01-02', '2026-01-01')).toBe(-1);
    // spans both northern-hemisphere DST transitions in either direction
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2024-01-01', '2024-12-31')).toBe(365);
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31);
    expect(diffDays('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('finds week and month starts', () => {
    // 2026-01-07 is a Wednesday
    expect(weekdayOf('2026-01-07')).toBe(3);
    expect(startOfWeek('2026-01-07', 1)).toBe('2026-01-05');
    expect(startOfWeek('2026-01-07', 0)).toBe('2026-01-04');
    expect(startOfWeek('2026-01-05', 1)).toBe('2026-01-05');
    expect(startOfMonth('2026-07-19')).toBe('2026-07-01');
  });

  it('lists inclusive ranges', () => {
    expect(daysBetween('2026-01-01', '2026-01-03')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(daysBetween('2026-01-03', '2026-01-01')).toEqual([]);
    expect(lastNDays(3, '2026-01-03')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(lastNDays(91, '2026-01-03')).toHaveLength(91);
  });

  it('describes days relative to today', () => {
    expect(formatDay('2026-01-05', '2026-01-05')).toBe('Today');
    expect(formatDay('2026-01-04', '2026-01-05')).toBe('Yesterday');
    expect(formatDay('2026-01-06', '2026-01-05')).toBe('Tomorrow');
    expect(formatDay('2026-01-20', '2026-01-05')).toBe('Tue 20 Jan');
    expect(formatDay('2025-01-20', '2026-01-05')).toBe('Mon 20 Jan 2025');
  });

  it('day keys sort chronologically as plain strings', () => {
    const keys = ['2026-10-01', '2026-02-09', '2025-12-31'];
    expect([...keys].sort()).toEqual(['2025-12-31', '2026-02-09', '2026-10-01']);
    expect(dayKey(atDay('2026-02-09'))).toBe('2026-02-09');
  });
});
