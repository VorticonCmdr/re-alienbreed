// The title loop (1000:083B-0B2D): TITLE.VHF with the three-line menu, the credits pages after 1000 passes, the story
// pages on MOONPIC.VHF, then the attract demo. One yield per retrace; the generator returns 'start' or 'demo'.
import { fadeIn, fadeOut, drawText } from './screens.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
const DS = 0x2041, CODE = 0x1000, PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;
const RIGHT = 1, LEFT = 2, DOWN = 4, UP = 8, FIRE = 0x10, START = 0x30;

export const titleFiles = exe => ({ title: exe.string(DS, 0xae36 + 8), story: exe.string(DS, 0x9ab2 + 8) });

// `context`: { exe, display, font, text, title, story ({ pixels, palette }), input() (the combined input word [B42E]),
// ticks() (INT 8 runs during the last retrace), options: { players, share } (cs:1117, cs:1118), report }.
export function* titleLoop(context) {
  const { exe, display, font, text, input, options, report } = context;
  // Writes the menu makes into its code-segment text; reads see them.
  const written = new Map(), read = o => written.has(o & 0xffff) ? written.get(o & 0xffff) : exe.u8(CODE, o & 0xffff);
  const pages = [new Uint8Array(PIXELS), new Uint8Array(PIXELS)], backup = new Uint8Array(PIXELS); let draw = 0;
  const flip = function* () { display.frame.set(pages[draw]); yield; draw ^= 1; context.tick(); }; // 767D / 76C3
  const restore = () => pages[draw].set(backup); // 2576: the clean picture from 0x8340
  const waitRelease = function* (bits) { while (input() & bits) { yield; context.tick(); } }; // busy wait, no flips
  let cursor = 2, colourCounter = 0;
  context.tick = () => { colourCounter = (colourCounter + context.ticks()) & 0xffff; }; // cs:13AD, incremented by INT 8

  function* showTitle() { // 1000:0B2E
    pages[draw].set(context.title.pixels.subarray(0, PIXELS)); yield* flip();
    pages[draw].set(context.title.pixels.subarray(0, PIXELS)); backup.set(pages[draw]); yield* flip();
    cursor = 2; text.opaque = 1; text.lineHeight = 0x0e;
    yield* fadeIn(display, context.title.palette);
  }
  yield; context.tick(); // 3000:02A7
  yield* showTitle();
  for (;;) {
    let fired = false;
    // 1000:0880: option words into the template, all markers dark, the selected one cycling (cs:138D table)
    for (let k = 0; k < 4; k++) { written.set(0x1153 + k, exe.u8(CODE, 0x112e + options.players * 4 + k)); written.set(0x1173 + k, exe.u8(CODE, 0x1136 + options.share * 4 + k)); }
    for (let k = 0; k < 3; k++) written.set(exe.u16(CODE, 0x1128 + 2 * k), 0xf0);
    written.set(exe.u16(CODE, 0x1128 + 2 * cursor), (0xf0 + exe.u8(CODE, 0x138d + ((colourCounter & 0x3f) >> 1))) & 0xff);
    drawText(pages[draw], font, text, read, 0x1146, report); yield* flip();
    if (input() & UP) { yield* waitRelease(UP); cursor--; } // each test reads the live input word
    if (input() & DOWN) { yield* waitRelease(DOWN); cursor++; }
    if (cursor === -1) cursor = 2; if (cursor === 3) cursor = 0;
    const option = cursor === 0 ? 'players' : cursor === 1 ? 'share' : null;
    if (option) {
      if (input() & LEFT) { yield* waitRelease(LEFT); options[option] = (options[option] - 1) & 1; }
      if (input() & RIGHT) { yield* waitRelease(RIGHT); options[option] = (options[option] + 1) & 1; }
    } else if (input() & START) return 'start';
    options.passes = (options.passes ?? 0) + 1; if (options.passes <= 1000) continue; // cs:0F0D, never reset elsewhere
    // 1000:09E5: the credits pages, 150 retraces each, fire returns to the menu
    for (let p = 0x0f0f; exe.u16(CODE, p) !== 0xffff && !fired; p += 2) {
      restore(); text.opaque = 1; drawText(pages[draw], font, text, read, exe.u16(CODE, p), report); yield* flip();
      for (let i = 0; i < 150; i++) { yield; context.tick(); if (input() & FIRE) { fired = true; break; } }
    }
    if (!fired) fired = yield* story();
    yield* waitRelease(FIRE);
    restore(); yield* flip(); restore(); yield* flip();
    options.passes = 0;
    if (!fired) return 'demo';
  }

  function* story() { // 1000:0A5E: MOONPIC.VHF with two pages of 200 retraces, then the title again
    yield* fadeOut(display);
    pages[draw].set(context.story.pixels.subarray(0, PIXELS)); yield* flip();
    pages[draw].set(context.story.pixels.subarray(0, PIXELS)); backup.set(pages[draw]); yield* flip();
    text.opaque = 0; text.lineHeight = 0x0e;
    yield* fadeIn(display, context.story.palette);
    let fired = false;
    for (let i = 0; i < 200; i++) { restore(); drawText(pages[draw], font, text, read, 0x0c63, report); yield* flip(); if (input() & FIRE) break; }
    yield* waitRelease(FIRE); // fire on the first page only moves on to the second
    for (let i = 0; i < 200; i++) { restore(); drawText(pages[draw], font, text, read, 0x0dc2, report); yield* flip(); if (input() & FIRE) { fired = true; break; } }
    if (fired) yield* waitRelease(FIRE); // cs:[0A55] = 0xFF: back to the menu instead of the demo
    yield* fadeOut(display);
    yield* showTitle();
    return fired;
  }
}
