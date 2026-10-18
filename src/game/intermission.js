// The screen between levels, 1000:44EC: a picture, the deck-man walking in (object script type 4 with the DECKMAN1
// sheet), the level's briefing page and, from level index 2 on, the level code. One yield per vertical retrace.
import { fadeIn, fadeOut, drawText } from './screens.js';
import { runScripts, drawList, emptyRecord, PLAYER_RECORDS, OBJECT_SLOTS } from './objects.js';
import { drawObjects } from './render.js';
import { drawSprite } from './sprites.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
const DS = 0x2041, CODE = 0x1000, FIRE = 0x10;

// Pictures by level (records 2041:9B07 before index 1, 9B31 otherwise; the name follows each 8-byte record).
export const intermissionPicture = (exe, level) => exe.string(DS, (level === 1 ? 0x9b07 : 0x9b31) + 8);
export const deckmanSheetName = exe => exe.string(DS, 0x9b46 + 8);

// `context`: { exe, display, font, text (text state), picture: { pixels, palette }, deckman (4-bit sheet), tables,
// descriptor, input() -> input byte, report(message), exitTaken }.
export function* intermission(level, context) {
  const { exe, display, font, text, picture, tables, descriptor, input, report } = context;
  const pages = [new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT), new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)];
  let draw = 0; // [B014]; the other page is on screen
  const backup = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT); // video memory at 0x8340
  const flip = function* () { display.frame.set(pages[draw]); yield; draw ^= 1; }; // 1000:767D
  const fire = () => input() & FIRE;
  const written = new Map(), read = o => written.has(o & 0xffff) ? written.get(o & 0xffff) : exe.u8(DS, o & 0xffff);

  pages[draw].set(picture.pixels.subarray(0, SCREEN_WIDTH * SCREEN_HEIGHT)); // D924, then 767D, then D924 again
  yield* flip();
  pages[draw].set(picture.pixels.subarray(0, SCREEN_WIDTH * SCREEN_HEIGHT));
  backup.set(pages[draw]); // D9C2 [B014] -> 8340
  const palette = picture.palette; // B0F9, the picture's 0x300 palette bytes

  if (level === 1) yield* fadeIn(display, palette);
  else {
    // 74FC on the player 1 record: type 4 at (0x32, 0), z 0; nothing else is active (6644 cleared the records).
    const objects = Array.from({ length: PLAYER_RECORDS + OBJECT_SLOTS }, emptyRecord);
    const state = { tables, objects, objectCount: 1, sounds: [], report, frameCounter: 0 };
    Object.assign(objects[0], { active: true, flags0A: 0x80, flags0B: 0x40, type: 4, script: tables.scriptStart(4), x: 0x32, y: 0, oldX: 0x32, oldY: 0, priority: 8 });
    yield* fadeIn(display, palette);
    const sheets = { 0xb0b4: [context.deckman] };
    for (let i = 0; i < 150; i++) {
      pages[draw].set(backup); runScripts(state);
      drawObjects(pages[draw], { objects: drawList(state), spriteCamera: { x: 0, y: 0 } }, sheets, descriptor, drawSprite, SCREEN_HEIGHT);
      yield* flip();
      if (fire()) break;
    }
    pages[draw].set(pages[draw ^ 1]); // D9C2 [B016] -> [B014]
    while (fire()) yield; // no flips while fire is held
  }

  // 1000:4646: the briefing, redrawn every frame for up to 400 frames.
  Object.assign(text, { colour: 0xfd, opaque: 0, lineHeight: 0x0c });
  const page = level === 0 && context.exitTaken ? 0x13 : level;
  const briefing = exe.u16(DS, 0x5bde + 2 * page);
  for (let i = 0; i < 400; i++) {
    drawText(pages[draw], font, text, read, briefing, report);
    yield* flip();
    if (fire()) break;
  }
  while (fire()) yield;

  if (level > 1) { // 1000:46C1: the 9-character level code into the template at 2041:7A3E (every second byte from 7A9C)
    for (let k = 0; k < 9; k++) written.set(0x7a9c + 2 * k, exe.u8(CODE, 0x82a6 + (level - 2) * 10 + k));
    Object.assign(text, { colour: 0xfd, opaque: 0, lineHeight: 0x0c });
    for (let i = 0; i < 2; i++) { pages[draw].set(backup); drawText(pages[draw], font, text, read, 0x7a3e, report); yield* flip(); }
    for (let i = 0; i < 3000; i++) { yield* flip(); if (fire()) break; }
  }
  yield* fadeOut(display);
}
