// Closed-loop replay of the original's attract demo against observed checkpoints (docs/port/scenarios/demo-lbmz.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { decodeMap } from '../src/game/level.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { readTables, startLevel, levelTileset, stepFrame, UnsupportedPath } from '../src/game/sim.js';

const game = new URL('../game/', import.meta.url), strict = process.env.ALIEN_BREED_STRICT === '1';
const missing = !existsSync(new URL('ALIEN.EXE', game));
if (strict && missing) throw new Error('Strict verification needs the original files in game/ (see README).');
const manifest = JSON.parse(await readFile(new URL('../docs/port/scenarios/demo-lbmz.json', import.meta.url), 'utf8'));

async function replay(frames, demoBytes) {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), demoMode: 2 });
  const demo = demoBytes || new Uint8Array(await readFile(new URL('DEMO.DAT', game)));
  assert.equal(demo.length, 1024, 'DEMO.DAT must hold 1024 input bytes');
  const log = [];
  for (let frame = 0; frame < frames; frame++) {
    stepFrame(state, demo[frame]);
    const p = state.players[0];
    log.push({ x: p.x, y: p.y, frame: p.frame, camera: { ...state.camera }, tileCamera: { ...state.view.tileCamera } });
  }
  return { log, state };
}

test('demo replay reproduces the observed player and camera checkpoints', { skip: missing }, async () => {
  const last = Math.max(...manifest.checkpoints.map(c => c.afterFrame)) + 2;
  const { log } = await replay(last);
  assert.ok(manifest.checkpoints.length >= 2, 'manifest must list checkpoints');
  for (const c of manifest.checkpoints) {
    const at = log[c.afterFrame], next = log[c.afterFrame + 1];
    assert.deepEqual({ x: at.x, y: at.y, frame: at.frame }, c.player, `player after frame ${c.afterFrame}`);
    assert.deepEqual(next.camera, c.nextFrame.camera, `camera after frame ${c.afterFrame + 1}`);
    assert.deepEqual(next.tileCamera, c.nextFrame.tileCamera, `tile camera shown after frame ${c.afterFrame + 1}`);
  }
});

test('the strict replay stops at the first unimplemented behaviour instead of continuing silently', { skip: missing }, async () => {
  await assert.rejects(replay(1024), error => error instanceof UnsupportedPath && /Firing/.test(error.message));
});

test('negative control: dropping one input byte breaks the checkpoint comparison', { skip: missing }, async () => {
  const demo = new Uint8Array(await readFile(new URL('DEMO.DAT', game)));
  const altered = new Uint8Array(1024); altered.set(demo.subarray(0, 10)); altered.set(demo.subarray(11), 10);
  const { log } = await replay(60, altered), c = manifest.checkpoints[1];
  assert.notDeepEqual({ x: log[c.afterFrame].x, y: log[c.afterFrame].y, frame: log[c.afterFrame].frame }, c.player);
});
