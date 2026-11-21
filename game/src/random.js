// A small seeded random source (mulberry32). The whole city is grown from one seed, so the
// same seed always grows the same Bahía Rosa — that is what makes the screenshot scenes and
// every playthrough's map identical, while traffic's coin flips still feel unscripted.

export function createRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    /** Float in [min, max). */
    range(min, max) { return min + next() * (max - min); },
    /** Integer in [min, max], both ends included. */
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    /** True with probability p. */
    chance(p) { return next() < p; },
    /** One element of the array. */
    pick(list) { return list[Math.floor(next() * list.length)]; },
    /** A shuffled copy of the array. */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    },
  };
}
