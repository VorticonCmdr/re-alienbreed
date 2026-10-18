// The start-up logos (1000:0761-0767) and demo recording (1000:364A, 3935).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { decodeMap } from '../src/game/level.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { intro, introFiles } from '../src/game/intro.js';
import { createDisplay } from '../src/game/screens.js';
import { readTables, startLevel, levelTileset, stepFrame } from '../src/game/sim.js';

const game = new URL('../game/', import.meta.url), strict = process.env.ALIEN_BREED_STRICT === '1';
const missing = !existsSync(new URL('ALIEN.EXE', game));
if (strict && missing) throw new Error('Strict verification needs the original files in game/ (see README).');

test('intro: three logos, each drawn, one retrace, fade-in 64, its wait, fade-out 64; the sample starts with the second', () => {
  const logo = (value, wait, sample) => ({ pixels: new Uint8Array(64000).fill(value), palette: new Uint8Array(768).fill(value + 10), wait, sample });
  const display = createDisplay(), logos = [logo(1, 100, false), logo(2, 200, true), logo(3, 100, false)], sampleAt = [];
  let retraces = 0; const shown = [];
  for (const _ of intro({ display, logos, playSample: () => sampleAt.push(retraces) })) { retraces++; shown.push(display.frame[0]); }
  assert.equal(retraces, 3 * (1 + 64 + 64) + 100 + 200 + 100);
  assert.deepEqual(sampleAt, [229 + 1], 'after the second picture is shown, before its fade-in');
  assert.equal(display.dac[0], 0, 'black after the last fade-out'); assert.equal(display.frame[0], 3);
  assert.equal(shown.indexOf(2), 229); assert.equal(shown.indexOf(3), 229 + 329);
});

test('intro: the logo and sample files named in the executable exist', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game)))), files = new Set((await readdir(game)).map(f => f.toUpperCase()));
  const { logos, sample } = introFiles(exe);
  assert.deepEqual(logos.map(l => [l.wait, l.sample]), [[100, false], [200, true], [100, false]]);
  for (const name of [...logos.map(l => l.name), sample]) assert.ok(files.has(name.toUpperCase()), name);
});

test('demo recording: input bytes go into the shared buffer, lag stays 0, and 0x400 bytes end it', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2) });
  const buffer = new Uint8Array(0x400).fill(0xaa); state.demoRecord = { buffer, index: 0 };
  for (let k = 0; k < 0x400; k++) { stepFrame(state, k & 1 ? 0 : 0x10, 6); assert.equal(state.lag, 0, `lag at pass ${k}`); }
  assert.deepEqual([...buffer.subarray(0, 4)], [0x10, 0, 0x10, 0]);
  assert.equal(state.demoRecord, null); assert.equal(state.demoSaved, buffer);
  stepFrame(state, 0, 6); assert.equal(state.lag, 1, 'the lag flag works again after the recording');
});
