// Level table and map decoding. Evidence: docs/port/evidence.md, "Level table and map format".
export const MAP_WIDTH = 120, MAP_HEIGHT = 96, MAP_CELLS = MAP_WIDTH * MAP_HEIGHT, TILE = 16;
const DATA_SEGMENT = 0x2041, LEVEL_TABLE = 0x957D, LEVEL_COUNT = 19;

// Map file name for each level index, read from the executable's own table (1000:1B70 indexes it by [B0B2]).
export function levelMapNames(exe) {
  return Array.from({ length: LEVEL_COUNT }, (_, index) => exe.string(DATA_SEGMENT, exe.u16(DATA_SEGMENT, LEVEL_TABLE + 2 * index) + 8));
}

// Splits the decompressed .HUF data like the level initialiser 2EF5:0000: each big-endian cell word holds
// a tile index in bits 0-8 and a 6-bit cell type in bits 10-15. Bit 9 is discarded by the original.
export function decodeMap(bytes) {
  if (bytes.length < MAP_CELLS * 2) throw new Error(`Map data is ${bytes.length} bytes; expected at least ${MAP_CELLS * 2}`);
  const tiles = new Uint16Array(MAP_CELLS), types = new Uint8Array(MAP_CELLS);
  for (let i = 0; i < MAP_CELLS; i++) {
    const word = bytes[2 * i] << 8 | bytes[2 * i + 1];
    tiles[i] = word & 0x1ff; types[i] = word >> 10;
  }
  return { tiles, types, extra: bytes.slice(MAP_CELLS * 2) };
}

// Cuts 16x16 tiles from 320x200 byte-per-pixel sheets: 20 per row, 12 rows, 240 per sheet, in sheet order.
export function buildTileStore(sheets) {
  const store = new Uint8Array(sheets.length * 240 * 256);
  sheets.forEach((sheet, s) => {
    for (let t = 0; t < 240; t++) for (let y = 0; y < TILE; y++) {
      const source = ((t / 20 | 0) * TILE + y) * 320 + (t % 20) * TILE;
      store.set(sheet.pixels.subarray(source, source + TILE), (s * 240 + t) * 256 + y * TILE);
    }
  });
  return store;
}
