// Deterministic randomness for Neon Bay.
// One mulberry32 stream per seed, so ?seed=N replays the same city,
// the same traffic and the same pedestrians every single run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(lo, hi) { return lo + next() * (hi - lo); },
    int(lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    chance(p) { return next() < p; },
  };
}

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function lerp(a, b, t) { return a + (b - a) * t; }

export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

// Shortest signed turn from heading a to heading b, in (-PI, PI].
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function parseSeed(query) {
  const m = /[?&]seed=(-?\d+)/.exec(query || '');
  if (!m) return 1;
  return (parseInt(m[1], 10) >>> 0) || 1;
}
