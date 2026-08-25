// XP awards and the level curve. Every number here is deterministic: the XP a
// completion is worth is computed once, stored on its ledger entry, and never
// recomputed — so tuning these constants later cannot rewrite past history.

export const DIFFICULTIES = ['trivial', 'easy', 'medium', 'hard'];

export const BASE_XP = { trivial: 2, easy: 5, medium: 10, hard: 20 };

export const DIFFICULTY_LABELS = { trivial: 'Trivial', easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Longer streaks multiply the base award. Highest matching tier wins. */
export const STREAK_TIERS = [
  { min: 30, multiplier: 2 },
  { min: 14, multiplier: 1.5 },
  { min: 7, multiplier: 1.25 },
  { min: 3, multiplier: 1.1 },
];

export const ON_TIME_BONUS = 0.25;
export const MILESTONE_MULTIPLIER = 3;
export const PERFECT_DAY_XP = 15;
export const PROJECT_COMPLETE_XP = 50;

export function baseXp(difficulty) {
  return BASE_XP[difficulty] ?? BASE_XP.easy;
}

export function streakMultiplier(streak) {
  for (const tier of STREAK_TIERS) {
    if (streak >= tier.min) return tier.multiplier;
  }
  return 1;
}

/** @param {string} difficulty @param {number} streakAfter streak *including* this completion */
export function habitXp(difficulty, streakAfter = 1) {
  return Math.max(1, Math.round(baseXp(difficulty) * streakMultiplier(streakAfter)));
}

/** @param {{onTime?: boolean}} opts */
export function todoXp(difficulty, opts = {}) {
  const base = baseXp(difficulty);
  return opts.onTime ? base + Math.round(base * ON_TIME_BONUS) : base;
}

export function milestoneXp(difficulty) {
  return baseXp(difficulty) * MILESTONE_MULTIPLIER;
}

// ---- levels -------------------------------------------------------------
// Total XP required to reach level L is 25 * L * (L - 1): 0, 50, 150, 300, 500…
// Each level costs 50 XP more than the one before it.

export const MAX_LEVEL = 999;

export function xpForLevel(level) {
  if (level <= 1) return 0;
  return 25 * level * (level - 1);
}

export function levelFromXp(xp) {
  const safe = Math.max(0, Math.floor(xp || 0));
  const level = Math.floor((25 + Math.sqrt(625 + 100 * safe)) / 50);
  return Math.min(MAX_LEVEL, Math.max(1, level));
}

/**
 * @returns {{level:number, totalXp:number, levelStart:number, nextLevelAt:number,
 *            xpIntoLevel:number, xpForThisLevel:number, xpToNext:number, progress:number}}
 */
export function levelProgress(xp) {
  const totalXp = Math.max(0, Math.floor(xp || 0));
  const level = levelFromXp(totalXp);
  const levelStart = xpForLevel(level);
  const nextLevelAt = xpForLevel(level + 1);
  const xpForThisLevel = nextLevelAt - levelStart;
  const xpIntoLevel = totalXp - levelStart;
  return {
    level,
    totalXp,
    levelStart,
    nextLevelAt,
    xpIntoLevel,
    xpForThisLevel,
    xpToNext: nextLevelAt - totalXp,
    progress: xpForThisLevel === 0 ? 1 : xpIntoLevel / xpForThisLevel,
  };
}

const RANKS = [
  'Wanderer', 'Apprentice', 'Journeyer', 'Adept', 'Ranger', 'Artisan',
  'Strategist', 'Vanguard', 'Champion', 'Warden', 'Paragon', 'Ascendant',
];

/** Flavour title for a level — cosmetic only. */
export function rankFor(level) {
  const index = Math.min(RANKS.length - 1, Math.floor((level - 1) / 5));
  return RANKS[index];
}
