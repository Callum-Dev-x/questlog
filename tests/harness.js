// Minimal zero-dependency test harness. Runs in the browser; results are
// exposed on window.__testResults and rendered into the page.

/** @typedef {{name:string, fn:Function, only?:boolean}} TestCase */

const suites = [];
let current = null;

export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  try { fn(); } finally { current = prev; }
}

export function it(name, fn) {
  if (!current) throw new Error(`it("${name}") called outside describe()`);
  current.tests.push({ name, fn });
}

function show(v, depth = 0) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (depth > 3) return '…';
  try {
    const s = JSON.stringify(v);
    return s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch {
    return String(v);
  }
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

class AssertionError extends Error {
  constructor(message) { super(message); this.name = 'AssertionError'; }
}

export function expect(actual) {
  const api = {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new AssertionError(`expected ${show(expected)} but got ${show(actual)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        throw new AssertionError(`deep equality failed\n    expected: ${show(expected)}\n    actual:   ${show(actual)}`);
      }
    },
    toBeCloseTo(expected, digits = 2) {
      const tol = Math.pow(10, -digits) / 2;
      if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
        throw new AssertionError(`expected ${show(actual)} to be within ${tol} of ${show(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new AssertionError(`expected truthy, got ${show(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new AssertionError(`expected falsy, got ${show(actual)}`);
    },
    toBeNull() {
      if (actual !== null) throw new AssertionError(`expected null, got ${show(actual)}`);
    },
    toBeUndefined() {
      if (actual !== undefined) throw new AssertionError(`expected undefined, got ${show(actual)}`);
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new AssertionError(`expected ${show(actual)} > ${show(n)}`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n)) throw new AssertionError(`expected ${show(actual)} >= ${show(n)}`);
    },
    toBeLessThan(n) {
      if (!(actual < n)) throw new AssertionError(`expected ${show(actual)} < ${show(n)}`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) throw new AssertionError(`expected ${show(actual)} <= ${show(n)}`);
    },
    toHaveLength(n) {
      const len = actual == null ? undefined : actual.length;
      if (len !== n) throw new AssertionError(`expected length ${n}, got ${show(len)}`);
    },
    toContain(item) {
      const ok = typeof actual === 'string'
        ? actual.includes(item)
        : Array.isArray(actual) && actual.some((x) => deepEqual(x, item));
      if (!ok) throw new AssertionError(`expected ${show(actual)} to contain ${show(item)}`);
    },
    toThrow(match) {
      if (typeof actual !== 'function') throw new AssertionError('toThrow() needs a function');
      let threw = null;
      try { actual(); } catch (err) { threw = err; }
      if (!threw) throw new AssertionError('expected function to throw, but it did not');
      if (match instanceof RegExp && !match.test(String(threw.message))) {
        throw new AssertionError(`expected error matching ${match}, got ${show(threw.message)}`);
      }
      if (typeof match === 'string' && !String(threw.message).includes(match)) {
        throw new AssertionError(`expected error containing ${show(match)}, got ${show(threw.message)}`);
      }
    },
  };
  api.not = {
    toBe(expected) {
      if (Object.is(actual, expected)) throw new AssertionError(`expected value not to be ${show(expected)}`);
    },
    toEqual(expected) {
      if (deepEqual(actual, expected)) throw new AssertionError(`expected value not to deep-equal ${show(expected)}`);
    },
    toContain(item) {
      const found = typeof actual === 'string'
        ? actual.includes(item)
        : Array.isArray(actual) && actual.some((x) => deepEqual(x, item));
      if (found) throw new AssertionError(`expected ${show(actual)} not to contain ${show(item)}`);
    },
    toThrow() {
      if (typeof actual !== 'function') throw new AssertionError('not.toThrow() needs a function');
      try { actual(); } catch (err) {
        throw new AssertionError(`expected no throw, got ${show(err.message)}`);
      }
    },
  };
  return api;
}

export async function run() {
  const started = performance.now();
  const lines = [];
  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    lines.push(suite.name);
    for (const test of suite.tests) {
      try {
        await test.fn();
        passed++;
        lines.push(`  ok   ${test.name}`);
      } catch (err) {
        failures.push({ suite: suite.name, test: test.name, error: err });
        lines.push(`  FAIL ${test.name}`);
        lines.push(`       ${String(err && err.message || err).split('\n').join('\n       ')}`);
        if (err && err.name !== 'AssertionError' && err.stack) {
          lines.push(`       ${err.stack.split('\n').slice(1, 3).join('\n       ')}`);
        }
      }
    }
    lines.push('');
  }

  const ms = Math.round(performance.now() - started);
  const total = passed + failures.length;
  const summary = failures.length === 0
    ? `PASS  ${passed}/${total} tests in ${ms}ms`
    : `FAIL  ${failures.length} of ${total} tests failed (${ms}ms)`;
  lines.push(summary);

  return { passed, failed: failures.length, total, ms, failures, summary, text: lines.join('\n') };
}
