import { describe, it, expect } from './harness.js';
import {
  BASE_XP, habitXp, levelFromXp, levelProgress, milestoneXp, rankFor,
  streakMultiplier, todoXp, xpForLevel, MAX_LEVEL,
} from '../src/core/xp.js';

describe('xp awards', () => {
  it('prices difficulty', () => {
    expect(BASE_XP.trivial).toBe(2);
    expect(BASE_XP.easy).toBe(5);
    expect(BASE_XP.medium).toBe(10);
    expect(BASE_XP.hard).toBe(20);
  });

  it('applies the highest matching streak tier', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(2)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.1);
    expect(streakMultiplier(6)).toBe(1.1);
    expect(streakMultiplier(7)).toBe(1.25);
    expect(streakMultiplier(14)).toBe(1.5);
    expect(streakMultiplier(29)).toBe(1.5);
    expect(streakMultiplier(30)).toBe(2);
    expect(streakMultiplier(400)).toBe(2);
  });

  it('rounds habit awards to whole XP', () => {
    expect(habitXp('easy', 1)).toBe(5);
    expect(habitXp('easy', 3)).toBe(6);   // 5 * 1.1 = 5.5
    expect(habitXp('easy', 7)).toBe(6);   // 5 * 1.25 = 6.25
    expect(habitXp('easy', 14)).toBe(8);  // 5 * 1.5 = 7.5
    expect(habitXp('easy', 30)).toBe(10);
    expect(habitXp('hard', 30)).toBe(40);
    expect(habitXp('trivial', 1)).toBe(2);
    expect(habitXp('nonsense', 1)).toBe(5); // unknown difficulty falls back to easy
  });

  it('bonuses on-time todos and never penalises late ones', () => {
    expect(todoXp('medium', { onTime: true })).toBe(13);
    expect(todoXp('medium', { onTime: false })).toBe(10);
    expect(todoXp('medium')).toBe(10);
    expect(todoXp('hard', { onTime: true })).toBe(25);
  });

  it('pays milestones triple', () => {
    expect(milestoneXp('hard')).toBe(60);
    expect(milestoneXp('easy')).toBe(15);
  });
});

describe('levels', () => {
  it('uses a 25*L*(L-1) curve', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(3)).toBe(150);
    expect(xpForLevel(4)).toBe(300);
    expect(xpForLevel(10)).toBe(2250);
  });

  it('inverts the curve exactly at the boundaries', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(149)).toBe(2);
    expect(levelFromXp(150)).toBe(3);
    expect(levelFromXp(299)).toBe(3);
    expect(levelFromXp(300)).toBe(4);
  });

  it('round-trips every level up to 200', () => {
    for (let level = 1; level <= 200; level++) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
      expect(levelFromXp(xpForLevel(level + 1) - 1)).toBe(level);
    }
  });

  it('never returns a level below 1 or above the cap', () => {
    expect(levelFromXp(-500)).toBe(1);
    expect(levelFromXp(NaN)).toBe(1);
    expect(levelFromXp(undefined)).toBe(1);
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  it('reports progress within the current level', () => {
    const p = levelProgress(200);
    expect(p.level).toBe(3);
    expect(p.levelStart).toBe(150);
    expect(p.nextLevelAt).toBe(300);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpForThisLevel).toBe(150);
    expect(p.xpToNext).toBe(100);
    expect(p.progress).toBeCloseTo(1 / 3, 4);
    expect(levelProgress(0).progress).toBe(0);
    expect(levelProgress(50).xpIntoLevel).toBe(0);
  });

  it('names ranks in bands of five levels', () => {
    expect(rankFor(1)).toBe('Wanderer');
    expect(rankFor(5)).toBe('Wanderer');
    expect(rankFor(6)).toBe('Apprentice');
    expect(typeof rankFor(999)).toBe('string');
  });
});
