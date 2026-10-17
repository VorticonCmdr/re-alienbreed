// Status panel (PANEL.VHF) and its live elements, as 1000:20C3-2175 (recolour and cut) and 18B2:17D0 (per frame) draw
// them. The panel buffer is 320 bytes wide; rows 2..21 are copied to screen rows 176..195 (18B2:3BB2).
import { SCREEN_WIDTH } from './render.js';
const WIDTH = 320, RECOLOURED_ROWS = 32, PANEL_TOP = 176;
// Element rectangles [x, y, width] (8 rows high); the cut source and the draw destination are the same place.
const ELEMENTS = { energy: [32, 2, 64], lives: [128, 2, 20], clips: [32, 14, 16], bullets: [56, 14, 32], keys: [128, 14, 28] };

export function createHud(panelPixels) {
  const buffer = Uint8Array.from(panelPixels.subarray(0, WIDTH * RECOLOURED_ROWS), p => 0xf0 | (p & 15));
  const cuts = {};
  for (const [name, [x, y, w]] of Object.entries(ELEMENTS)) {
    cuts[name] = new Uint8Array(w * 8);
    for (let row = 0; row < 8; row++) cuts[name].set(buffer.subarray((y + row) * WIDTH + x, (y + row) * WIDTH + x + w), row * w);
  }
  return { buffer, cuts };
}

const s8 = v => (v << 24) >> 24, s16 = v => (v << 16) >> 16;
// Builds one element: start from `base` (filled with 0xF0 or a copy of the cut with leading columns blanked), patch
// marker pixels, then copy `columns` columns of the cut; finally the whole rectangle is copied opaquely to the panel.
function element(hud, name, { columns, blank, marker }, offsetX) {
  const [x, y, w] = ELEMENTS[name], cut = hud.cuts[name], scratch = new Uint8Array(w * 8).fill(0xf0);
  if (blank !== undefined) for (let row = 0; row < 8; row++) for (let c = blank; c < w; c++) scratch[row * w + c] = cut[row * w + c];
  if (marker) for (const [mx, my] of [[0, 3], [1, 3], [0, 4], [1, 4]]) scratch[(marker.y + my - 3) * w + marker.x + mx] = marker.value;
  for (let row = 0; row < 8; row++) for (let c = 0; c < columns; c++) scratch[row * w + c] = cut[row * w + c];
  for (let row = 0; row < 8; row++) hud.buffer.set(scratch.subarray(row * w, row * w + w), (y + row) * WIDTH + x + offsetX);
}

// 18B2:17D0 (player 1) / 17FE (player 2, +160 px): energy, lives, clips, bullets, keys in that order.
export function drawHud(hud, player, offsetX = 0) {
  const energy = s16(player.energy), lives = player.lives & 0xff, ammo = player.ammo & 0xffff, keys = s16(player.keys);
  element(hud, 'energy', { columns: energy > 0 ? Math.min(energy, 64) : 0 }, offsetX);
  element(hud, 'lives', { blank: 16, columns: lives > 0 ? Math.min(lives, 4) * 4 : 0, marker: s8(lives) <= 4 ? { x: 16, y: 3, value: 0x00 } : null }, offsetX);
  const clips = ammo >> 7;
  element(hud, 'clips', { columns: s16(clips) > 0 ? Math.min(clips, 4) * 4 : 0 }, offsetX);
  element(hud, 'bullets', { columns: (ammo >> 2) & 0x1f }, offsetX);
  element(hud, 'keys', { blank: 24, columns: keys > 0 ? Math.min(keys, 6) * 4 : 0, marker: keys <= 6 ? { x: 24, y: 3, value: 0xff } : null }, offsetX);
}

export function blitPanel(frame, hud) {
  for (let row = 0; row < 20; row++) frame.set(hud.buffer.subarray((row + 2) * WIDTH, (row + 3) * WIDTH), (PANEL_TOP + row) * SCREEN_WIDTH);
}
