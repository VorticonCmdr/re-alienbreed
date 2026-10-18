// Bosses (objective cell 0x3D, 1000:6030 / 6958 / 3669) on the levels that have one, driven by a scripted player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { decodeMap, levelMapNames } from '../src/game/level.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { readTables, startLevel, levelTileset, stepFrame, INPUT } from '../src/game/sim.js';

const game = new URL('../game/', import.meta.url), missing = !existsSync(new URL('ALIEN.EXE', game));
for (const [level, energy] of [[5, 0x200], [8, 0x280], [17, 0x300]]) {
  test(`level ${level}: the boss starts on the objective, fights, dies and starts the self-destruct`, { skip: missing }, async () => {
    const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
    const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL(levelMapNames(exe)[level].toUpperCase(), game)))));
    const state = startLevel({ tables: readTables(exe), map, level, tileset: levelTileset(exe, level), rngSeed: 1 });
    stepFrame(state, 0, 1); stepFrame(state, 0, 1);
    const p = state.players[0]; p.x = state.objective.x + 0x40; p.y = state.objective.y;
    state.objectiveTriggered = true; stepFrame(state, 0, 1);
    const boss = state.objects.find(o => o.active && o.type === 0x0c);
    assert.ok(boss, 'type 0x0C object created'); assert.equal(boss.energy, energy);
    assert.deepEqual([boss.x - state.objective.x, boss.y - state.objective.y], [0x40, -0x40]);
    assert.equal(state.music, 'monster'); assert.equal(state.musicStop, true); assert.equal(state.aliensSuppressed, true); assert.equal(state.bossActive, true);
    assert.notEqual(state.alienPalette, null); assert.notEqual(state.alienSheet, null);
    let hit = false, frames = 0;
    for (; frames < 4000 && !state.selfDestruct; frames++) {
      if (boss.type === 0x0c) { p.invulnerable = 2; p.energy = 0x40; p.x = boss.x; p.y = boss.y + 0x30; p.ammo = 0x17f; }
      stepFrame(state, INPUT.FIRE | INPUT.UP, 1);
      if (state.view.frameBanks[0xed] === 0x0e) hit = true;
    }
    assert.ok(hit, 'hits flash frames 0xED-0xEF with bank 0x0E'); assert.ok(state.selfDestruct, `boss died within ${frames} frames`);
    assert.equal(boss.type, 8); assert.equal(state.aliensSuppressed, false); assert.equal(state.alienPalette, null); assert.equal(state.music, 'alarmed');
    assert.ok(state.objects.filter(o => o.active && (o.type === 8 || o.type === 9)).length >= 15, 'death explosions');
  });
}

test('levels 16/17: an objective cell 0x0A arms a scripted kind-2 spawn there (1000:642D, 4F01, 515E)', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const level = 16, map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL(levelMapNames(exe)[level].toUpperCase(), game)))));
  const state = startLevel({ tables: readTables(exe), map, level, tileset: levelTileset(exe, level), rngSeed: 1 });
  stepFrame(state, 0, 1); stepFrame(state, 0, 1);
  const cell = map.types.findIndex(t => (t & 0xff) === 0x0a), cx = (cell % 120) * 16 + 16 + 8, cy = Math.floor(cell / 120) * 16 + 16 + 8;
  const p = state.players[0]; p.x = cx; p.y = cy + 12; // the upper corner probes land in the objective cell
  stepFrame(state, 0, 1);
  assert.equal(state.types[cell], 0, 'cell becomes floor'); assert.equal(state.tiles[cell], 0x223); assert.ok(state.sounds.includes(0x0a));
  assert.ok(state.scriptedSpawnTimer > 0 && state.scriptedSpawnTimer <= 0x78);
  p.x = 0x300; // move away so nothing else interferes with the objective
  let spawned = null;
  for (let f = 0; f < 200 && !spawned; f++) { stepFrame(state, 0, 1); spawned = state.aliens.find(a => a.kind === 2 && a.object && Math.abs(a.object.x - cx) < 16 && Math.abs(a.object.y - cy) < 24); }
  assert.ok(spawned, 'a kind-2 alien appears at the armed point'); assert.equal(state.scriptedSpawnTimer, -1); assert.equal(spawned.object.energy, 8);
});

test('frames after the exit is taken still run (the bare passes after the Intex and at level start do not test it)', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL(levelMapNames(exe)[2].toUpperCase(), game)))));
  const state = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), rngSeed: 1 });
  state.levelCode = 7; state.exitTaken = true; // what a level code typed in the Intex leaves behind
  stepFrame(state, 0, 1); assert.equal(state.levelOver, 'complete');
  stepFrame(state, 0, 1); assert.equal(state.levelOver, 'complete', 'the second exit frame does not throw');
});
