import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exeView, openExe } from '../src/game/exe.js';
import { MAP_CELLS, levelMapNames, decodeMap, buildTileStore } from '../src/game/level.js';
import { createFramebuffer, drawMap } from '../src/game/render.js';
import { decompressLzhuf } from '../src/lzhuf.js';
const game = new URL('../game/', import.meta.url);

test('executable view maps Ghidra segment:offset to file offsets and rejects addresses outside the image', () => {
  const bytes = new Uint8Array(0x900); bytes[0x800 + 0x12] = 0x34; bytes[0x800 + 0x13] = 0x12; bytes.set([65, 66, 0], 0x800 + 0x20);
  const exe = exeView(bytes);
  assert.equal(exe.u16(0x1000, 0x12), 0x1234); assert.equal(exe.u16(0x1001, 0x02), 0x1234); assert.equal(exe.string(0x1000, 0x20), 'AB');
  assert.throws(() => exe.u8(0x0fff, 0), /outside/); assert.throws(() => exe.u8(0x1000, 0x100), /outside/);
});
test('unknown executables are rejected by hash', async () => { await assert.rejects(openExe(new Uint8Array(16)), /Unsupported executable/); });
test('map cells are big-endian: tile in bits 0-8, type in bits 10-15, bit 9 dropped', () => {
  const bytes = new Uint8Array(MAP_CELLS * 2 + 3); bytes.set([0x04, 0xde, 0xfe, 0x00, 0x02, 0x01], 0);
  const map = decodeMap(bytes);
  assert.deepEqual([...map.tiles.slice(0, 3)], [0xde, 0, 0x001]); assert.deepEqual([...map.types.slice(0, 3)], [1, 63, 0]);
  assert.equal(map.extra.length, 3); assert.throws(() => decodeMap(bytes.slice(0, 100)), /expected/);
});
test('tile store cuts 20x12 grids of 16x16 tiles in sheet order and drawMap scrolls by pixels', () => {
  const sheet = n => ({ pixels: Uint8Array.from({ length: 64000 }, (_, i) => ((i % 320 >> 4) + 20 * ((i / 320 | 0) >> 4) + n) & 255) });
  const store = buildTileStore([sheet(0), sheet(7)]);
  assert.equal(store[5 * 256], 5); assert.equal(store[(20 + 1) * 256 + 255], 21); assert.equal(store[240 * 256], 7);
  const map = { tiles: new Uint16Array(MAP_CELLS), types: new Uint8Array(MAP_CELLS) }; map.tiles[1] = 3;
  const frame = createFramebuffer(); drawMap(frame, map, store, 8, 0);
  assert.equal(frame[0], 0); assert.equal(frame[8], 3); assert.equal(frame[23], 3); assert.equal(frame[24], 0);
  drawMap(frame, map, store, -4, 0); assert.equal(frame[0], 0);
});

test('original executable: level table names and level 1 map decode', { skip: !existsSync(game) }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const names = levelMapNames(exe);
  assert.equal(names.length, 19); assert.equal(names[2], 'lbmz.huf'); assert.equal(names[0], 'lzmz.huf'); assert.equal(names[18], 'pcmap6.huf');
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  assert.equal(Math.max(...map.tiles), 470); assert.equal(map.extra.length, 3188);
  assert.equal(map.types.filter(t => t === 1).length, 2295);
  // Decoded tile and type arrays; 77 of 96 tile rows were matched against live memory (docs/port/evidence.md).
  assert.equal(createHash('sha256').update(map.tiles).update(map.types).digest('hex'), '282e0d38d7d6b393ba7b44dca9ef1920dfb4457cc05bbe75499896b134baafba');
});
