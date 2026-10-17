// In-game palette, kept as the original's 6-bit DAC values (buffer DS:B45F, built at level load 1000:19B6-1A6E).
const DATA_SEGMENT = 0x2041;
// 16-entry banks copied from the executable: [first entry, table offset].
export const EXE_BANKS = [[0x80, 0x945D], [0x90, 0x948D], [0xA0, 0x9DE0], [0xE0, 0x9E10], [0xF0, 0x9DB0]];

// tileSheetBytes: the raw second .256 sheet of the level (its 0x180 palette bytes at 0xFA00 win over the first sheet's).
export function buildGamePalette(exe, tileSheetBytes) {
  const palette = new Uint8Array(768);
  palette.set(tileSheetBytes.subarray(0xfa00, 0xfa00 + 0x180), 0);
  for (const [first, offset] of EXE_BANKS) palette.set(exe.bytes(DATA_SEGMENT, offset, 48), first * 3);
  return palette;
}

export const dacToRgb = palette => Uint8Array.from(palette, v => Math.round((v & 63) * 255 / 63));
