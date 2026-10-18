// The game-over screen (1000:4109) and the ending after level index 18 (1000:41A2). One yield per retrace.
import { fadeIn, fadeOut, drawText } from './screens.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
const DS = 0x2041, CODE = 0x1000, FIRE = 0x10, PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;

// File records: the name follows each 8-byte record.
export const gameOverFiles = exe => ({ picture: exe.string(DS, 0xae48 + 8), sample: exe.string(DS, 0xae5d + 8) });
export const endingPictures = exe => [0x9422, 0x9436].map(record => exe.string(DS, record + 8));

// `context`: { display, picture: { pixels, palette }, playSample(), input() }.
export function* gameOver(context) {
  const { display, picture, input } = context;
  yield; // 3000:02A7: a retrace, then the split screen is switched off
  display.frame.set(picture.pixels.subarray(0, PIXELS)); yield; // D924 and a flip
  context.playSample(); // started directly through the voice driver (function 6), not through 1000:72B0
  yield* fadeIn(display, picture.palette);
  for (let i = 0; i < 200; i++) { yield; if (input() & FIRE) break; } // 1000:7709 waits for one retrace
  yield* fadeOut(display);
}

// `context`: { exe, display, font, text, pictures: [{ pixels, palette }, …], input(), report }.
export function* ending(context) {
  const { exe, display, font, text, pictures, input, report } = context;
  yield; // 3000:02A7
  const read = o => exe.u8(CODE, o & 0xffff); // the texts live in the code segment (ES = CS)
  for (const [picture, page] of [[pictures[0], 0x4280], [pictures[1], 0x4418]]) {
    const pages = [new Uint8Array(PIXELS), new Uint8Array(PIXELS)]; let draw = 0;
    const flip = function* () { display.frame.set(pages[draw]); yield; draw ^= 1; };
    pages[draw].set(picture.pixels.subarray(0, PIXELS)); yield* flip();
    pages[draw].set(picture.pixels.subarray(0, PIXELS));
    yield* fadeIn(display, picture.palette);
    Object.assign(text, { colour: 0xfd, opaque: 0, lineHeight: 0x0c });
    for (let i = 0; i < 1000; i++) {
      drawText(pages[draw], font, text, read, page, report); yield* flip();
      if (input() & FIRE) break;
    }
    yield* fadeOut(display);
  }
}
