// Sprite frames. EHF sheets become 4-bit pixels (1000:666C); frame descriptors are 16 bytes at 2041:9E47 + (n - 1) * 16.
import { SCREEN_WIDTH } from './render.js';
const DATA_SEGMENT = 0x2041, DESCRIPTORS = 0x9E47;
// Descriptor +C indexes word offsets 0x0000, 0x7D00, 0xFA00 inside the sheet segment: one 32000-byte sheet each.
const SHEET_SLOT = { 0: 0, 2: 1, 4: 2 };

export function frameDescriptor(exe, frame) {
  const off = DESCRIPTORS + (frame - 1) * 16, u16 = o => exe.u16(DATA_SEGMENT, off + o), s16 = o => exe.s16(DATA_SEGMENT, off + o);
  return {
    sourceX: u16(0), sourceY: u16(2), width: u16(4) * 4, height: u16(6), adjustX: s16(8), adjustY: s16(10),
    slotIndex: exe.u8(DATA_SEGMENT, off + 12), bank: exe.u8(DATA_SEGMENT, off + 13), sheetVariable: u16(14),
  };
}

// sheets: array of 320x200 4-bit pixel arrays indexed by slot (0 = first file in the segment, 1 = the one at +0x7D00).
// Pixel 0 is transparent; others are ORed with bank * 16 (1CE3:0527, 18B2:103D). Clips to [clipTop, clipBottom).
export function drawSprite(frame, descriptor, sheets, x, y, flip = false, clipTop = 0, clipBottom = 200) {
  const slot = SHEET_SLOT[descriptor.slotIndex], sheet = sheets[slot];
  if (!sheet) throw new Error(`Sprite sheet slot ${descriptor.slotIndex} is not loaded`);
  const { sourceX, sourceY, width, height } = descriptor, bank = descriptor.bank << 4;
  for (let row = 0; row < height; row++) {
    const screenY = y + row; if (screenY < clipTop || screenY >= clipBottom) continue;
    for (let column = 0; column < width; column++) {
      const screenX = x + column; if (screenX < 0 || screenX >= SCREEN_WIDTH) continue;
      const value = sheet[(sourceY + row) * 320 + sourceX + (flip ? width - 1 - column : column)];
      if (value) frame[screenY * SCREEN_WIDTH + screenX] = value | bank;
    }
  }
}
