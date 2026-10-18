// PIT channel 0 as the music driver programs it, and which IRQ0s reach the game's INT 8 work and the music driver.
// docs/port/avmfm.md section 2: 0x438C (69 Hz) after a stop, 0x308C (96 Hz) for title and Intex music, 0x26D7
// (120 Hz) for in-game, monster and alarmed music.
export const PIT_CLOCK = 1193182, RETRACE_HZ = 70.086;
export const RELOAD = { stopped: 0x438c, slow: 0x308c, game: 0x26d7 };

// In a game frame, interrupts are off from 1000:3873 until the retrace at 2EF5:12B3, and music skips every IRQ until
// 1000:3898. IRQs in that span collapse into one, delivered without a music tick. The share of the frame spent before
// the span depends on the machine; 0.8 is chosen so in-game songs advance 96 ticks per second, the rate their CMF
// headers declare (the game programs 120 Hz, 1.25 times that). Approximation, see docs/port/STATUS.md.
export const GAME_OPEN_SHARE = 0.8;

export const createTimer = (reload = RELOAD.stopped) => ({ reload, untilNext: reload / PIT_CLOCK });
// fn 4 / fn 7 reload the counter; the next IRQ comes one full period after the write.
export function setReload(timer, reload) { timer.reload = reload; timer.untilNext = reload / PIT_CLOCK; }

// Advances one retrace. Returns the INT 8 runs (`ticks`) and the offsets in seconds of those that tick the music.
export function advanceRetrace(timer, openShare = 1) {
  const frame = 1 / RETRACE_HZ, period = timer.reload / PIT_CLOCK, music = [];
  let ticks = 0, collapsed = false, t = timer.untilNext;
  for (; t < frame; t += period) {
    if (t < frame * openShare) { ticks++; music.push(t); } else collapsed = true;
  }
  if (collapsed) ticks++; // delivered at the STI, with the music flag still set
  timer.untilNext = t - frame;
  return { ticks, music };
}
