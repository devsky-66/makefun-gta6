// Deterministic randomness for Cinder Bay (round 5 build).
// A compact mulberry32 core plus the small helpers the city builder and the
// simulation need. Fixing one seed fixes the entire world, so a screenshot
// taken with ?seed=1 always frames the same streets and parked cars.
export function makeRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return function nextValue() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mix = Math.imul(state ^ (state >>> 15), 1 | state);
    mix = (mix + Math.imul(mix ^ (mix >>> 7), 61 | mix)) ^ mix;
    return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, low, high) {
  return low + rng() * (high - low);
}

export function intRange(rng, low, high) {
  return low + Math.floor(rng() * (high - low + 1));
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

export function chance(rng, probability) {
  return rng() < probability;
}

export function shuffle(rng, items) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const held = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = held;
  }
  return shuffled;
}
