// Full-screen presentation outside the playfield: palette fades, pictures and the bitmap font. DOM-free; callers
// step the generators once per vertical retrace and show `display.frame` through `display.dac`.
import { SCREEN_WIDTH, SCREEN_HEIGHT } from './render.js';
const DS = 0x2041, GLYPH = 88, GLYPHS = 42, PAGE_WIDTH = 336;

export const createDisplay = () => ({ frame: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT), dac: new Uint8Array(768) });

// 1000:D867 (far D863): 64 retraces; each step moves every stored component one unit towards the target. The
// original adds the green and blue adjustments to the red value it outputs, and outputs green and blue from before
// their own step, so mid-fade colours are off; the stored copy (and so the end result) is exact.
export function* fadeIn(display, target) {
  const stored = Uint8Array.from(display.dac);
  for (let step = 0; step < 64; step++) {
    yield;
    for (let i = 0; i < 768; i += 3) {
      let red = stored[i];
      const green = stored[i + 1], blue = stored[i + 2];
      for (let c = 0; c < 3; c++) {
        const s8 = v => (v << 24) >> 24, current = stored[i + c], wanted = target[i + c];
        if (wanted === current) continue;
        const delta = s8(wanted) < s8(current) ? -1 : 1; // JL: signed byte compare
        stored[i + c] = (current + delta) & 0xff; red = (red + delta) & 0xff;
      }
      display.dac[i] = red; display.dac[i + 1] = green; display.dac[i + 2] = blue;
    }
  }
}
// 1000:D7D8 (far D779): 64 retraces; every non-zero component (low 6 bits) drops by one.
export function* fadeOut(display) {
  for (let step = 0; step < 64; step++) {
    yield;
    for (let i = 0; i < 768; i++) if (display.dac[i] & 0x3f) display.dac[i] = (display.dac[i] - 1) & 0xff;
  }
}

// 1000:0787-0826: 42 glyphs of 8 x 11 cut from FONT.VHF (40 per glyph row), then a blank glyph 42.
export function cutFont(pixels) {
  const font = new Uint8Array((GLYPHS + 1) * GLYPH);
  for (let g = 0; g < GLYPHS; g++) for (let row = 0; row < 11; row++) {
    const source = Math.floor(g / 40) * 11 * 320 + (g % 40) * 8 + row * 320;
    font.set(pixels.subarray(source, source + 8), g * GLYPH + row * 8);
  }
  return font;
}
// 1000:143A-1482: A-Z, comma, 0-9, period, ! ? : $. Other bytes index past the cut glyphs in the original.
function glyphFor(code) {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 0x1b;
  return { 0x2c: 0x1a, 0x2e: 0x25, 0x21: 0x26, 0x3f: 0x27, 0x3a: 0x28, 0x24: 0x29 }[code] ?? null;
}

// Text cursor and style kept between calls, as the original keeps them in its code segment: x cs:1119, line start
// cs:1122, y cs:111B, colour cs:1121, line height cs:1124, opaque font cs:1126, space width cs:2E8C.
export const createTextState = () => ({ x: 0, lineX: 0, y: 0, colour: 0, lineHeight: 0, opaque: 0, space: 0 });

// 1000:13B2 without the typewriter effect (cs:13B0 = 0): `read(offset)` returns the byte at DS:offset. Glyphs are
// drawn into a 336-pixel page whose first 320 columns are displayed. `report` receives unsupported cases.
export function drawText(frame, font, text, read, offset, report) {
  const word = o => read(o) | read(o + 1) << 8;
  text.x = text.lineX = word(offset); text.y = word(offset + 2);
  for (let p = offset + 4; ;) {
    const code = read(p++);
    if (code === 0xff) return;
    if (code === 0xfe) { text.colour = read(p++); continue; }
    if (code === 0xfd) { text.space = read(p++); continue; }
    if (code === 0x00) { text.x = text.lineX; text.y = (text.y + text.lineHeight) & 0xffff; continue; }
    let glyph = glyphFor(code);
    if (code === 0x20) {
      if (!text.opaque) { text.x = (text.x + (text.space || 9)) & 0xffff; continue; }
      glyph = 0x2a;
    }
    if (glyph === null) { report(`Text character 0x${code.toString(16)} outside the font`); text.x = (text.x + 9) & 0xffff; continue; }
    if (text.x + 8 > PAGE_WIDTH || text.y + 11 > SCREEN_HEIGHT) report(`Text drawn outside the page at (${text.x}, ${text.y})`);
    for (let row = 0; row < 11; row++) for (let column = 0; column < 8; column++) {
      const x = text.x + column, y = text.y + row, pixel = font[glyph * GLYPH + row * 8 + column];
      if (x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) continue;
      if (pixel) frame[y * SCREEN_WIDTH + x] = text.colour; else if (text.opaque) frame[y * SCREEN_WIDTH + x] = 0;
    }
    text.x = (text.x + 9) & 0xffff;
  }
}

export const DATA_SEGMENT = DS;
