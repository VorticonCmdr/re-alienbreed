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
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), demoMode: 2, rngSeed: manifest.environment.rngSeed.value });
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

test('demo replay reproduces the fitted 2026-10-17 player and camera checkpoints', { skip: missing }, async () => {
  const fitted = manifest.checkpoints.filter(c => c.afterFrame !== undefined);
  const last = Math.max(...fitted.map(c => c.afterFrame)) + 2;
  const { log } = await replay(last);
  assert.ok(fitted.length >= 2, 'manifest must list checkpoints');
  for (const c of fitted) {
    const at = log[c.afterFrame], next = log[c.afterFrame + 1];
    assert.deepEqual({ x: at.x, y: at.y, frame: at.frame }, c.player, `player after frame ${c.afterFrame}`);
    assert.deepEqual(next.camera, c.nextFrame.camera, `camera after frame ${c.afterFrame + 1}`);
    assert.deepEqual(next.tileCamera, c.nextFrame.tileCamera, `tile camera shown after frame ${c.afterFrame + 1}`);
  }
});

// Unfitted checkpoints: frame-end hit k is the flip of step k-2 (manifest "alignment"). Player, alien, RNG and counts
// are compared after step k-3; the camera and script-driven object fields after step k-2.
test('demo replay with the original seed matches unfitted checkpoints, including aliens and the RNG', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), demoMode: 2, rngSeed: manifest.environment.rngSeed.value });
  const demo = new Uint8Array(await readFile(new URL('DEMO.DAT', game)));
  const checkpoints = manifest.checkpoints.filter(c => c.hit);
  assert.ok(checkpoints.length >= 3, 'manifest must list unfitted checkpoints');
  const pick = (object, fields) => Object.fromEntries(Object.keys(fields).map(k => [k, object[k]]));
  const seen = new Set();
  for (let step = 0; step <= Math.max(...checkpoints.map(c => c.hit)) - 2; step++) {
    stepFrame(state, demo[step]);
    for (const c of checkpoints) {
      if (step === c.hit - 3) {
        const p = state.players[0], label = `hit ${c.hit}`;
        assert.deepEqual(pick(p, c.player), c.player, `${label} player`);
        assert.equal(state.aliveAliens, c.counts.aliens, `${label} live aliens`);
        assert.deepEqual({ low: state.rng.s & 0xffff, high: state.rng.s >>> 16, bit: state.rng.c }, c.rng, `${label} RNG`);
        if (c.alienSlot0) assert.deepEqual(pick(state.aliens[0], c.alienSlot0), c.alienSlot0, `${label} alien slot 0`);
        if (c.spawnRecord) assert.equal(state.spawnPoints.find(r => r.x === c.spawnRecord.x && r.y === c.spawnRecord.y).cooldown, c.spawnRecord.cooldown, `${label} spawn cooldown`);
        if (c.object) { const { frame, ...rest } = c.object; assert.deepEqual(pick(state.aliens[0].object, rest), rest, `${label} object`); }
        seen.add(`${c.hit}a`);
      }
      if (step === c.hit - 2) {
        assert.deepEqual({ x: state.camera.x, y: state.camera.y }, c.camera, `hit ${c.hit} camera`);
        assert.equal(state.atFlip.objectCount, c.counts.objects, `hit ${c.hit} object count at the flip`);
        if (c.object) assert.equal(state.aliens[0].object.frame, c.object.frame, `hit ${c.hit} object frame (scripts of step k-2)`);
        seen.add(`${c.hit}b`);
      }
    }
  }
  assert.equal(seen.size, checkpoints.length * 2, 'every checkpoint was compared');
});

test('the strict replay of the whole demo meets no unimplemented behaviour', { skip: missing }, async () => {
  const { state } = await replay(1024);
  assert.deepEqual(state.diagnostics, []);
});

test('negative control: dropping one input byte breaks the checkpoint comparison', { skip: missing }, async () => {
  const demo = new Uint8Array(await readFile(new URL('DEMO.DAT', game)));
  const altered = new Uint8Array(1024); altered.set(demo.subarray(0, 10)); altered.set(demo.subarray(11), 10);
  const { log } = await replay(60, altered), c = manifest.checkpoints[1];
  assert.notDeepEqual({ x: log[c.afterFrame].x, y: log[c.afterFrame].y, frame: log[c.afterFrame].frame }, c.player);
});
