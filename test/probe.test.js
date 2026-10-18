// 1000:3C08 for shot probes outside the map: row words before 2EF5:1CA8, column words before 3CA8 (docs/port/evidence.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { decodeMap } from '../src/game/level.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { readTables, startLevel, levelTileset, shotProbe } from '../src/game/sim.js';

const game = new URL('../game/', import.meta.url), strict = process.env.ALIEN_BREED_STRICT === '1';
const missing = !existsSync(new URL('ALIEN.EXE', game));
if (strict && missing) throw new Error('Strict verification needs the original files in game/ (see README).');

test('shot probe addresses: inside the map, 1-3 pixels above (stride, height, width), the relocated word, left of the map', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), strict: false });
  const di = (x, y) => shotProbe(state, x, y).di, x = 16 + 25 * 16 + 3; // column 25
  assert.equal(di(x, 16 + 5 * 16 + 7), 5 * 240 + 50, 'row 5, column 25');
  assert.deepEqual([di(x, 15), di(x, 14), di(x, 13)], [0xf0 + 50, 0x60 + 50, 0x78 + 50], '2EF5:1CA6, 1CA4, 1CA2');
  assert.equal(di(x, 10), (0x36b8 + 50) & 0xffff, '6 pixels above: MOV AX,1236h with the DOSBox load segment');
  assert.equal(di(x, 12), 0xc3d8 + 50, '4 pixels above: object records');
  assert.equal(di(15, 16 + 32), (2 * 240 + 0xef10) & 0xffff, 'one pixel left of the map: the row table tail');
  assert.equal(shotProbe(state, x, 12).word, 0, 'a freed record reads as zero');
  assert.equal(shotProbe(state, x, 11).word, null, '5 pixels above (the panel buffer) is not modelled');
});
