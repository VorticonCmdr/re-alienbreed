// In-game palette, kept as the original's 6-bit DAC values (buffer DS:B45F, built at level load 1000:19B6-1A6E).
const DATA_SEGMENT = 0x2041;
// 16-entry banks copied from the executable: [first entry, table offset].
export const EXE_BANKS = [[0x80, 0x945D], [0x90, 0x948D], [0xA0, 0x9DE0], [0xE0, 0x9E10], [0xF0, 0x9DB0]];

// tileSheetBytes: the raw second .256 sheet of the level (its 0x180 palette bytes at 0xFA00 win over the first sheet's).
// The level's alien palette (word table 2041:96F4 + level * 4) fills bank 0xC0 (copied to B69F, 1000:2068).
export function buildGamePalette(exe, tileSheetBytes, level) {
  const palette = new Uint8Array(768);
  palette.set(tileSheetBytes.subarray(0xfa00, 0xfa00 + 0x180), 0);
  for (const [first, offset] of EXE_BANKS) palette.set(exe.bytes(DATA_SEGMENT, offset, 48), first * 3);
  if (level !== undefined) palette.set(exe.bytes(DATA_SEGMENT, exe.u16(DATA_SEGMENT, 0x96f4 + level * 4), 48), 0xc0 * 3);
  return palette;
}

// The level's alien sprite sheet file name (record pointer table 2041:96F2 + level * 4).
export const alienSheetName = (exe, level) => exe.string(DATA_SEGMENT, exe.u16(DATA_SEGMENT, exe.u16(DATA_SEGMENT, 0x96f2 + level * 4)));

export const dacToRgb = palette => Uint8Array.from(palette, v => Math.round((v & 63) * 255 / 63));
