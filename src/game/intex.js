// The Intex terminal (1000:2588) and the map screen opened with M (1000:33C6), from docs/port/intex.md. One yield
// per vertical retrace. Texts, prices, pictures and the cheat table are read from the user's executable.
import { fadeIn, fadeOut, textSteps } from './screens.js';
import { drawSprite } from './sprites.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
import { addBcd } from './sim.js';
const DS = 0x2041, CODE = 0x1000, INFO = 0x3b1b, PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;
const RIGHT = 1, LEFT = 2, DOWN = 4, UP = 8, FIRE = 0x10, BOTH = 0x30;

export const intexFiles = exe => ({ computer: exe.string(DS, 0x9af2 + 8), weapons: exe.string(DS, 0x9a77 + 8), map: exe.string(DS, 0x9a9d + 8) });

// Variables the original keeps in its segments across sessions (and levels): writes into texts, the menu cursor,
// the weapon index, the typewriter sample, the message counter and the cheat ring.
export function createIntexMemory(exe) {
  return { cs: new Map(), ds: new Map(), menu: exe.u8(CODE, 0x137c), weapon: exe.u16(CODE, 0x3242), choice: exe.u8(CODE, 0x2b15),
    typed: { on: false, previous: exe.u16(CODE, 0x1517) }, message: exe.u16(CODE, 0x118d), ring: new Uint8Array(128), ringAt: 0, cheats: false };
}

// BCD subtraction 1000:6001 (SUB/DAS then SBB/DAS per byte; for valid BCD the decimal difference modulo 10^8).
function subBcd(value, amount) {
  let result = 0, borrow = 0;
  for (let shift = 0; shift < 32; shift += 4) {
    let digit = ((value >>> shift) & 15) - ((amount >>> shift) & 15) - borrow;
    borrow = digit < 0 ? 1 : 0; if (borrow) digit += 10;
    result |= digit << shift;
  }
  return result >>> 0;
}

// `c`: { exe, display, font, text, memory, player, state, pictures: { computer, map }, weaponSheet, descriptor,
//        input() (the owning player's live input word), scancode() / consumeScancode() ([B086]), sound(id),
//        music: { start(song), stop() }, ticks(), report }.
export function* intexSession(c) {
  const { exe, display, font, text, memory: m, player, state, report } = c;
  const pages = [new Uint8Array(PIXELS), new Uint8Array(PIXELS)], background = new Uint8Array(PIXELS); let draw = 0;
  let colourCounter = 0;
  const tick = () => { colourCounter = (colourCounter + c.ticks()) & 0xffff; }; // cs:13AD
  const cycle = () => exe.u8(CODE, 0x138d + ((colourCounter & 0x3f) >> 1)); // cs:13AF
  const flip = function* () { display.frame.set(pages[draw]); yield; draw ^= 1; tick(); };
  const restore = () => pages[draw].set(background); // 2576
  const restoreFlip2 = function* () { restore(); yield* flip(); restore(); yield* flip(); };
  const input = c.input;
  const waitRelease = function* (bits) { while (input() & bits) { yield; tick(); } };
  const readDs = o => m.ds.has(o & 0xffff) ? m.ds.get(o & 0xffff) : exe.u8(DS, o & 0xffff);
  const readCs = o => m.cs.has(o & 0xffff) ? m.cs.get(o & 0xffff) : exe.u8(CODE, o & 0xffff);
  const readInfo = o => exe.u8(INFO, o & 0xffff);
  const typewriter = { current: () => pages[draw], other: () => pages[draw ^ 1], flip, sound: c.sound, input, state: m.typed };
  const show = function* (read, offset) { yield* textSteps(pages[draw], font, text, read, offset, report, typewriter); };
  const bcdDigits = (bytes, end) => { bytes.forEach((b, i) => { m.ds.set(end - 2 * i, 0x30 + (b & 15)); m.ds.set(end - 2 * i - 1, 0x30 + (b >> 4)); }); };
  const recordBytes = (offset, count) => Array.from({ length: count }, (_, i) => offset + i < 0x63 ? recordByte(player, offset + i) : player.tally[offset + i - 0x63]);

  // 2.1-2.14: set-up.
  state.countdownFrozen = true;
  c.music.stop();
  yield* fadeOut(display);
  yield; tick(); // 3000:02A7
  pages[draw].set(c.pictures.computer.pixels.subarray(0, PIXELS)); yield* flip();
  pages[draw].set(c.pictures.computer.pixels.subarray(0, PIXELS)); yield* flip();
  background.set(pages[draw]);
  c.music.start('intex');
  yield* fadeIn(display, c.pictures.computer.palette);
  c.sound(6);
  Object.assign(text, { opaque: 0, lineHeight: 0x0d }); m.typed.on = true;

  // 4: boot text.
  for (let i = 0; i < 250; i++) {
    m.cs.set(0x128a, (0xf0 + cycle()) & 0xff);
    yield* show(readCs, 0x11ba); yield* flip();
    m.typed.on = false;
    if (input() & BOTH) { yield* waitRelease(FIRE); break; }
  }
  yield* restoreFlip2(); text.lineHeight = 0x10; m.typed.on = true;

  // 5: main menu.
  for (;;) {
    restore();
    cheatMatcher();
    for (let k = 0; k < 8; k++) { const at = exe.u16(CODE, 0x137d + 2 * k); m.cs.set(at, 0xf0); m.cs.set(at + 1, 0x20); }
    const selected = exe.u16(CODE, 0x137d + 2 * m.menu); m.cs.set(selected, (0xf0 + cycle()) & 0xff); m.cs.set(selected + 1, 0x24);
    yield* show(readCs, 0x128e); m.typed.on = false;
    if (m.message) { m.message--; yield* show(readCs, 0x118f); }
    yield* flip();
    if (input() & UP) { yield* waitRelease(UP); m.menu = (m.menu - 1) & 7; }
    if (input() & DOWN) { yield* waitRelease(DOWN); m.menu = (m.menu + 1) & 7; }
    let leave = false;
    for (const k of [0, 1, 2, 3, 5, 6, 4, 7]) {
      if (m.menu !== k || !(input() & BOTH)) continue;
      if (k === 7) { leave = true; break; } // no wait for release
      yield* waitRelease(FIRE);
      if (k === 0) yield* weaponShop(); else if (k === 1) yield* toolShop(); else if (k === 2) { yield* mapScreen(); yield* restoreFlip2(); }
      else if (k === 3) yield* mission(); else if (k === 4) yield* inaccessible(); else if (k === 5) yield* statistics(); else yield* infoPages();
    }
    if (leave) break;
  }

  // 8: leave.
  yield* fadeOut(display);
  c.music.stop();
  return 'resume'; // the caller runs the frame end, two game frames, the fade-in and the in-game song

  function* leaveScreen() { // 2AEA and friends
    yield* waitRelease(FIRE); yield* restoreFlip2();
    Object.assign(text, { colour: 0xfd, opaque: 0, lineHeight: 0x0d }); m.typed.on = true;
  }
  function* weaponShop() { // 6.1
    m.choice = 0; text.lineHeight = 0x0c; m.typed.on = true;
    for (;;) {
      restore();
      bcdDigits(recordBytes(0x5e, 4), 0x7f18);
      yield* show(readDs, 0x7e92); m.typed.on = false;
      const i = m.weapon, entry = 0x325c + 8 * i;
      yield* show(readDs, exe.u16(CODE, entry + 6));
      const d = c.descriptor(exe.u16(CODE, entry));
      drawSprite(pages[draw], d, [c.weaponSheet], exe.u16(CODE, entry + 2) + d.adjustX, exe.u16(CODE, entry + 4) + d.adjustY, false, 0, SCREEN_HEIGHT);
      yield* flip();
      const keys = input();
      if (keys & RIGHT) { yield* waitRelease(RIGHT); m.weapon = m.weapon + 1 >= 6 ? 0 : m.weapon + 1; }
      if (keys & LEFT) { yield* waitRelease(LEFT); m.weapon = m.weapon - 1 < 0 ? 5 : m.weapon - 1; }
      if (keys & UP) { yield* waitRelease(UP); m.choice = (m.choice + 1) & 1; }
      if (keys & DOWN) { yield* waitRelease(DOWN); m.choice = (m.choice - 1) & 1; }
      m.ds.set(0x7ee5, m.choice === 1 ? 0x24 : 0x20); m.ds.set(0x7f08, m.choice === 1 ? 0x20 : 0x24); // after the draw
      if (!(keys & FIRE)) continue;
      if (m.choice === 0) { yield* leaveScreen(); return; }
      const bit = 1 << (m.weapon + 1);
      if (player.owned & bit) continue;
      const price = (exe.u16(CODE, 0x3246 + 4 * m.weapon) << 16 | exe.u16(CODE, 0x3244 + 4 * m.weapon)) >>> 0;
      if (player.credits >>> 0 < price) continue; // 3164
      player.credits = subBcd(player.credits, price);
      player.weapon = m.weapon + 2; player.owned |= bit; player.ammo = (player.ammo + 0x80) & 0xffff;
      yield* leaveScreen(); return;
    }
  }
  function* toolShop() { // 6.2
    m.choice = 0; text.lineHeight = 0x10; m.typed.on = true;
    for (;;) {
      restore(); bcdDigits(recordBytes(0x5e, 4), 0x7d01); yield* show(readDs, 0x7c04); m.typed.on = false; yield* flip();
      const keys = input();
      if (keys & DOWN) { yield* waitRelease(DOWN); m.choice = m.choice + 1 > 5 ? 0 : m.choice + 1; }
      if (keys & UP) { yield* waitRelease(UP); m.choice = m.choice - 1 < 0 ? 5 : m.choice - 1; }
      for (let k = 0; k < 6; k++) m.ds.set(exe.u16(CODE, 0x3158 + 2 * k), 0x20);
      m.ds.set(exe.u16(CODE, 0x3158 + 2 * m.choice), 0x24);
      if (!(keys & FIRE)) continue;
      if (m.choice === 5) { yield* leaveScreen(); return; }
      yield* waitRelease(FIRE);
      const s = m.choice, price = (exe.u16(CODE, 0x3146 + 4 * s) << 16 | exe.u16(CODE, 0x3144 + 4 * s)) >>> 0;
      if (player.credits >>> 0 < price) continue;
      player.credits = subBcd(player.credits, price);
      if (s === 0) player.map |= 1;
      else if (s === 1) player.ammo = (player.ammo + 0x80) & 0xffff;
      else if (s === 2) player.energy = 0x40;
      else if (s === 3) player.keys = (player.keys + 6) & 0xffff;
      else { player.lives = (player.lives + 1) & 0xff; if (player.lives === 0) player.cell = (player.cell & 0xff00) | ((player.cell + 1) & 0xff); } // INC word +5B: the carry lands in +5C, the cell's low byte
    }
  }
  function* statistics() { // 6.3
    text.lineHeight = 0x0c; m.typed.on = true;
    for (;;) {
      restore();
      const clips = (player.ammo & 0xffff) >> 7;
      if (clips === 0) m.ds.set(0x7db7, 0x30);
      else { m.ds.set(0x7db6, (0x30 + clips % 10) & 0xff); m.ds.set(0x7db7, (0x30 + Math.floor(clips / 10)) & 0xff); } // units first
      bcdDigits(recordBytes(0x5e, 4), 0x7d7d); bcdDigits(recordBytes(0x63, 2), 0x7d5a); bcdDigits(recordBytes(0x65, 2), 0x7d3e); bcdDigits(recordBytes(0x67, 2), 0x7d9b);
      const e = (player.energy << 16) >> 16, cls = e >= 0x2a ? 0x2d73 : e >= 0x15 ? 0x2d7a : 0x2d81;
      for (let i = 0; i < 7; i++) m.ds.set(0x7dd1 + i, exe.u8(CODE, cls + i));
      for (let i = 0; i < 13; i++) m.ds.set(0x7dea + i, exe.u8(CODE, 0x2d03 + 16 * ((player.weapon - 1) & 0xff) + i));
      for (let k = 0; k < 6; k++) { const from = player.owned & (1 << k) ? 0x2d88 : 0x2d8b, to = exe.u16(CODE, 0x2d8e + 2 * k); for (let i = 0; i < 3; i++) m.ds.set(to + i, exe.u8(CODE, from + i)); }
      yield* show(readDs, 0x7d07); m.typed.on = false; yield* flip();
      if (input() & FIRE) { yield* leaveScreen(); return; }
    }
  }
  function* mission() { // 6.4
    yield* restoreFlip2(); Object.assign(text, { colour: 0xfd, opaque: 0, lineHeight: 0x0c }); m.typed.on = true;
    const index = state.level === 0 && state.exitTaken ? 0x13 : state.level;
    do { restore(); yield* show(readDs, exe.u16(DS, 0x5bde + 2 * index)); m.typed.on = false; yield* flip(); } while (!(input() & FIRE));
    yield* waitRelease(FIRE); text.lineHeight = 0x0d; m.typed.on = true; yield* restoreFlip2();
  }
  function* inaccessible() { // 285B
    do { restore(); yield* show(readDs, 0x7b69); yield* flip(); } while (!(input() & BOTH));
    yield* waitRelease(BOTH); yield* restoreFlip2();
  }
  function* infoPages() { // 6.5
    yield* restoreFlip2(); text.space = 6; let page = 0; text.lineHeight = 0x0c; m.typed.on = true;
    for (;;) {
      restore(); yield* show(readInfo, exe.u16(INFO, 2 * page));
      yield* show(readCs, page === 0 ? 0x2e90 : page === 0x12 ? 0x2f46 : 0x2ee7); m.typed.on = false; yield* flip();
      const keys = input();
      if (keys & RIGHT) { yield* waitRelease(RIGHT); if (page < 0x12) page++; }
      if (keys & LEFT) { yield* waitRelease(LEFT); if (page > 0) page--; }
      if (input() & FIRE) { yield* leaveScreen(); text.space = 0; return; }
    }
  }
  function* mapScreen() { yield* drawMap({ current: () => pages[draw], flip, restore, input, waitRelease, cycle, player, state }); m.typed.on = true; }

  // 5.3: one key per pass into a 128-byte ring, matched against the cheat words at cs:7EF4.
  function cheatMatcher() {
    const scancode = c.scancode();
    if (scancode & 0x80) return;
    c.consumeScancode();
    let ascii = null;
    for (let p = 0x818c; exe.u8(DS, p) !== 0xff; p += 2) if (exe.u8(DS, p) === (scancode & 0x7f)) { ascii = exe.u8(DS, p + 1); break; }
    if (ascii === null) return;
    m.ring[m.ringAt] = ascii; m.ringAt = (m.ringAt + 1) & 0x7f;
    for (let e = 0x7ef4; exe.u16(CODE, e) !== 0xffff; e += 4) {
      const string = exe.u16(CODE, e), handler = exe.u16(CODE, e + 2);
      for (let start = 127; start >= 0; start--) {
        let j = 0; while (exe.u8(CODE, string + j) !== 0xff && exe.u8(CODE, string + j) === m.ring[(start + j) & 0x7f]) j++;
        if (exe.u8(CODE, string + j) !== 0xff) continue;
        runCheat(handler); m.ring.fill(0); m.ringAt = 0; return;
      }
    }
  }
  function runCheat(h) {
    if (h === 0x7fd1) { m.cheats = true; c.sound(0); }
    else if (h === 0x7fda) { c.sound(0); report('Demo recording cheat'); }
    else if (h === 0x7fe3) state.players[0].keys = 0xffff;
    else if (h === 0x7fec) { if (state.players[1]) state.players[1].keys = 0xffff; }
    else if (h === 0x801b || h === 0x8027) { /* nothing */ }
    else if (h === 0x801c) report('Cheat word that exits to DOS');
    else if (h === 0x8020) c.sound(1);
    else if (h >= 0x8028 && h < 0x8060 && (h - 0x8028) % 7 === 0) { // SI = a 36-byte message, shown for 100 passes
      const from = exe.u16(CODE, h + 1); for (let i = 0; i < 36; i++) m.cs.set(0x1195 + i, exe.u8(CODE, from + i)); m.message = 100;
    } else if (h >= 0x8060 && h <= 0x8186 && (h - 0x8060) % 0x15 === 0) { // level codes
      state.levelCode = exe.u16(CODE, h + 4); state.exitTaken = true;
      const value = (exe.u16(CODE, h + 0x0f) << 16 | exe.u16(CODE, h + 0x0c)) >>> 0;
      for (const p of state.players) p.credits = addBcd(0, value); // player 2's record is written too, even unused
    } else report(`Cheat handler 1000:${h.toString(16)}`);
  }
}

// Player record bytes +5E..+62 as the port keeps them (credits as a 32-bit packed BCD value, the map flag).
function recordByte(player, offset) {
  if (offset >= 0x5e && offset <= 0x61) return (player.credits >>> ((offset - 0x5e) * 8)) & 0xff;
  if (offset === 0x62) return player.map & 0xff;
  throw new Error(`record byte +${offset.toString(16)}`);
}

// 7.1: the radar map (cell types 1 and 3 as 2x2 blocks) with the owning player's marker.
export function* drawMap({ current, flip, restore, input, waitRelease, cycle, player, state }) {
  restore(); yield* flip(); restore(); yield* flip();
  for (let i = 0; i < 2; i++) { plotMap(current(), state); yield* flip(); }
  for (;;) {
    const page = current(), x = ((player.x & 0xffff) >> 3) + 0x25, y = (player.y & 0xffff) >> 3, colour = (0xf0 + cycle()) & 0xff;
    for (const [dx, dy] of [[2, 0], [0, 2], [2, 2], [0, 0]]) block(page, x + dx, y + dy, colour);
    yield* flip();
    if (input() & BOTH) break;
  }
  yield* waitRelease(BOTH);
}
function plotMap(page, state) {
  for (const [type, colour] of [[1, 0xfe], [3, 0xf4]]) for (let r = 0; r < 96; r++) for (let col = 0; col < 120; col++) {
    const w = state.types[r * 120 + col]; if (w !== 0 && w === type) block(page, 0x28 + 2 * col, 3 + 2 * r, colour);
  }
}
function block(page, x, y, colour) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const px = x + dx, py = y + dy; if (px < SCREEN_WIDTH && py < SCREEN_HEIGHT) page[py * SCREEN_WIDTH + px] = colour; } }

// 7.2: the M screen. The music keeps playing; ARMDISPL.VHF as the background.
export function* mapSession(c) {
  const { display, state } = c;
  const pages = [new Uint8Array(PIXELS), new Uint8Array(PIXELS)], background = new Uint8Array(PIXELS); let draw = 0, colourCounter = 0;
  const tick = () => { colourCounter = (colourCounter + c.ticks()) & 0xffff; };
  const flip = function* () { display.frame.set(pages[draw]); yield; draw ^= 1; tick(); };
  const waitRelease = function* (bits) { while (c.input() & bits) { yield; tick(); } };
  state.countdownFrozen = true;
  yield* fadeOut(display);
  yield; tick();
  pages[draw].set(c.picture.pixels.subarray(0, PIXELS)); yield* flip();
  pages[draw].set(c.picture.pixels.subarray(0, PIXELS)); yield* flip();
  background.set(pages[draw]);
  yield* fadeIn(display, c.picture.palette);
  Object.assign(c.text, { opaque: 0, lineHeight: 0x10 });
  yield* drawMap({ current: () => pages[draw], flip, restore: () => pages[draw].set(background), input: c.input, waitRelease,
    cycle: () => c.exe.u8(CODE, 0x138d + ((colourCounter & 0x3f) >> 1)), player: c.player, state });
  c.memory.typed.on = true;
  yield* fadeOut(display);
}
