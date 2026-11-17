// Seeded randomness for Neon Bay Nights. One tiny generator (mulberry32) drives
// every random choice in the game — city dressing, traffic, pedestrians, pickups —
// so the same ?seed= number always builds the same city and the same day.
export function createRandom(seed) {
  let a = (seed >>> 0) || 1;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one entry from an array with the seeded generator.
export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// A number between low and high (inclusive of low, exclusive of high).
export function range(random, low, high) {
  return low + random() * (high - low);
}

// A whole number between low and high, inclusive on both ends.
export function intRange(random, low, high) {
  return low + Math.floor(random() * (high - low + 1));
}
