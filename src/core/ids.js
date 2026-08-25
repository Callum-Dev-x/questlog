// Sortable-ish unique ids: time prefix + randomness, so entries created on two
// devices never collide and a plain string sort is roughly chronological.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(n) {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Monotonic within a session, so two entries created in the same millisecond
// still sort in the order they were created.
let counter = 0;

/** @param {string} prefix short entity tag, e.g. 'h' for habit */
export function newId(prefix = 'x', now = Date.now()) {
  const seq = (counter = (counter + 1) % 1296).toString(36).padStart(2, '0');
  return `${prefix}_${now.toString(36)}${seq}${randomChars(6)}`;
}

export function newDeviceId() {
  return `dev_${randomChars(10)}`;
}
