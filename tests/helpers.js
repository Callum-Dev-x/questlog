// Shared test fixtures. All tests pin `now` explicitly so nothing depends on
// the wall clock or on which side of midnight the suite happens to run.

import { createState } from '../src/core/schema.js';
import { reduce } from '../src/core/state.js';

/** A Date at 09:00 local time on the given day key. */
export function atDay(day, hour = 9) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

export function seedState(day = '2026-01-01') {
  return createState({ now: atDay(day), deviceId: 'dev_test' });
}

/** reduce() with the clock pinned to a day. */
export function on(day, state, action, hour = 9) {
  return reduce(state, action, { now: atDay(day, hour) });
}

/** Apply a list of [day, action] pairs in order. */
export function script(state, steps) {
  return steps.reduce((acc, [day, action]) => on(day, acc, action), state);
}

export function addHabit(state, day, habit) {
  return on(day, state, { type: 'habit/add', habit });
}
