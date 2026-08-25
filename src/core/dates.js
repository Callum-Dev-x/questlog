// Local-calendar date helpers. Every "day" in questlog is a local calendar day
// keyed as 'YYYY-MM-DD'. Day keys are parsed at local noon so that DST
// transitions (±1h) can never shift a date across a day boundary.

export const MS_PER_DAY = 86400000;
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Date} [date] @returns {string} 'YYYY-MM-DD' in local time */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** @param {string} key @returns {Date} local noon on that day */
export function parseDay(key) {
  if (!DAY_RE.test(key)) throw new Error(`invalid day key: ${key}`);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** True for well-formed keys that name a real calendar day (rejects 2024-02-31). */
export function isDayKey(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d, 12, 0, 0, 0);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

export function addDays(key, n) {
  const date = parseDay(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** Signed whole days from `a` to `b` (b - a). */
export function diffDays(a, b) {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(key) {
  return parseDay(key).getDay();
}

export function startOfWeek(key, weekStartsOn = 1) {
  const delta = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function startOfMonth(key) {
  return `${key.slice(0, 7)}-01`;
}

/** Inclusive list of day keys from `from` to `to`. */
export function daysBetween(from, to) {
  const out = [];
  const span = diffDays(from, to);
  if (span < 0) return out;
  for (let i = 0; i <= span; i++) out.push(addDays(from, i));
  return out;
}

/** The last `count` days ending at `endKey`, oldest first. */
export function lastNDays(count, endKey = dayKey()) {
  return daysBetween(addDays(endKey, -(count - 1)), endKey);
}

/** 'Today' | 'Yesterday' | 'Tomorrow' | 'Mon 4 Aug' | 'Mon 4 Aug 2023' */
export function formatDay(key, today = dayKey()) {
  const delta = diffDays(today, key);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  const date = parseDay(key);
  const base = `${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  return date.getFullYear() === parseDay(today).getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** Local-time ISO-ish timestamp used for entry ordering and filenames. */
export function timestamp(date = new Date()) {
  return date.toISOString();
}

export function fileStamp(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${dayKey(date)}-${h}${m}`;
}
