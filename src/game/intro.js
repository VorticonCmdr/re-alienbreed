// The start-up logos (1000:0761-0767), shown once before the font is loaded and the title loop starts. No key skips
// them. One yield per retrace, like the other screens.
import { fadeIn, fadeOut } from './screens.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
const DS = 0x2041, PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;

// File records in DS (name at record + 8): 7D0C TEAM_17 (AE0E), 7D38 AVM256 (ADFB) with the sample ADEB, 7D20 AL_LOGO (AE22).
// The retrace counts are cs:7D35 as each routine sets it.
export const introFiles = exe => ({
  logos: [[0xae0e, 100, false], [0xadfb, 200, true], [0xae22, 100, false]].map(([record, wait, sample]) => ({ name: exe.string(DS, record + 8), wait, sample })),
  sample: exe.string(DS, 0xadeb + 8),
});

// `context`: { display, logos: [{ pixels, palette, wait, sample }], playSample() }. 1000:7D52 for each logo: D924 draws the
// picture onto the shown page (the palette is still black there, observed), 767D waits for a retrace, the AVM logo
// starts its sample through the voice driver (only with a Sound Blaster, [AF94] = 4), then D863 fades in over 64
// retraces, 7709 waits the logo's count of retraces and D779 fades out over 64.
export function* intro(context) {
  const { display, logos } = context;
  for (const logo of logos) {
    display.frame.set(logo.pixels.subarray(0, PIXELS)); yield;
    if (logo.sample) context.playSample();
    yield* fadeIn(display, logo.palette);
    for (let i = 0; i < logo.wait; i++) yield;
    yield* fadeOut(display);
  }
}
