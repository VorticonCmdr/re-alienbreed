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
