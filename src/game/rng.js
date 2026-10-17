// The game's only random generator (1000:75B5). State: 32-bit S = [B0BC]:[B0BA] and a history bit c (bit 0 of [B0BE]).
// Callers read the 16-bit result from [B038]. Static evidence only until checked against a live sequence.
export function seedRandom(v) {
  const low = v & 0xffff, high = -v & 0xffff;
  return { s: (high << 16 | low) >>> 0, c: 1 };
}

// Seeds used by the original: boot (1000:027D, from the RTC) and every new game (1000:17FC, high word of the INT 8 counter).
export const seedForNewGame = tickCounterHigh => seedRandom(tickCounterHigh);

export function nextRandom(state) {
  const shifted = (state.c << 31 | state.s >>> 1) >>> 0;
  state.c = state.s & 1;
  let s = (state.s << 12 ^ shifted) >>> 0;
  s = (s & 0xffff0000 | (s ^ s >>> 20) & 0xffff) >>> 0;
  state.s = s;
  return s & 0xffff;
}
