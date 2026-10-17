import test from 'node:test';
import assert from 'node:assert/strict';
import { seedRandom, nextRandom } from '../src/game/rng.js';
import { addBcd, cellAt, tickAnimations, updatePlayer, UnsupportedPath, INPUT } from '../src/game/sim.js';
import { MAP_CELLS, MAP_WIDTH } from '../src/game/level.js';

// Reference step written independently from the 1000:75B5 instruction trace (16-bit halves, explicit carries).
function referenceRandom(state) {
  let low = state.s & 0xffff, high = state.s >>> 16;
  const shiftedHigh = (state.c << 15 | high >> 1) & 0xffff, carry = high & 1;
  const shiftedLow = (carry << 15 | low >> 1) & 0xffff;
  state.c = low & 1;
  for (let i = 0; i < 12; i++) { const top = low >> 15; low = (low << 1) & 0xffff; high = ((high << 1) | top) & 0xffff; }
  low ^= shiftedLow; high ^= shiftedHigh; low ^= high >> 4;
  state.s = (high << 16 | low) >>> 0; return low;
}
test('RNG matches an independent 16-bit trace of 1000:75B5 and seeds L=v, H=-v, history 1', () => {
  assert.deepEqual(seedRandom(0x040b), { s: (0xfbf5 << 16 | 0x040b) >>> 0, c: 1 });
  for (const seed of [0, 1, 0x1234, 0xffff]) {
    const a = seedRandom(seed), b = seedRandom(seed);
    for (let i = 0; i < 1000; i++) assert.equal(nextRandom(a), referenceRandom(b));
  }
});
test('packed BCD credit addition carries between digits', () => {
  assert.equal(addBcd(0x0950, 0x0050), 0x1000); assert.equal(addBcd(0x99999999, 1), 0); assert.equal(addBcd(0x1234, 0x1000), 0x2234);
});

function fixture(types = {}) {
  const tables = { moveSteps: [...Array(16).keys(), ...Array.from({ length: 16 }, (_, n) => Math.floor(n * 1.5))], animBase: [-1, 11, 31, -1, 21, 16, 26, -1, 1, 6, 36, -1, -1, -1, -1, -1].map(v => v & 0xffff), animList: () => [7, 8, 0xffff],
    fireMask: [3, 7, 15, 15, 7, 7, 15], ammoCost: [0, 1, 1, 2, 2, 2, 2, 2], fireSound: [7, 8, 0x11, 0x12, 0x14, 8, 0x11], shotDamage: [0, 5, 7, 8, 8, 16, 8, 16],
    shotSpeed: [8, 8, 8, 10, 8, 12, 12], shotOffset: Array.from({ length: 16 }, (_, i) => i === 1 ? [12, -12] : [0x4d2, 0x4d2]), spread: [Array(16).fill([0, 0]), Array(16).fill([0, 0])] };
  const state = { tables, tiles: new Uint16Array(MAP_CELLS), types: new Uint16Array(MAP_CELLS), camera: { x: 0, y: 0 }, lag: 0, level: 2, strict: true, diagnostics: [], sounds: [], animations: Array(80).fill(null), doors: [], playerCount: 1, frame: 0, burning: 0, spreadCounter: 0,
    shots: Array.from({ length: 32 }, () => ({ type: 0 })) };
  for (const [cell, code] of Object.entries(types)) state.types[+cell] = code;
  const player = { x: 100, y: 100, keys: 0, energy: 64, lives: 4, ammo: 0x17f, weapon: 1, credits: 0, walk: 0, animBase: 11, facing: 1, moveMask: 15, conveyor: 0, cell: -1, hurt: false, invulnerable: 0, onIntex: 0, fireRepeat: 0, state: 1 };
  state.players = [player];
  return { state, player };
}
const at = (x, y) => ((y - 16) >> 4) * MAP_WIDTH + ((x - 16) >> 4);

test('cell lookup subtracts the 16-pixel border and rejects reads the original takes from unrelated memory', () => {
  const { state } = fixture();
  assert.equal(cellAt(state, 16, 16), 0); assert.equal(cellAt(state, 31 + 16 * 3, 47), MAP_WIDTH + 3);
  assert.throws(() => cellAt(state, 15, 40), UnsupportedPath);
});
test('movement is 3 px per axis, diagonals unnormalised, collision per axis with sliding', () => {
  const { state, player } = fixture();
  updatePlayer(state, player, INPUT.RIGHT | INPUT.DOWN);
  assert.deepEqual([player.x, player.y, player.frame, player.walk], [103, 103, 16, 1]);
  // From x = 103 the X pass probes x = 114 (column 6); the Y pass probes old x + 8 = 111 (column 5).
  const blocked = fixture({ [at(114, 92)]: 1 }); blocked.player.x = 103;
  updatePlayer(blocked.state, blocked.player, INPUT.RIGHT | INPUT.DOWN);
  assert.deepEqual([blocked.player.x, blocked.player.y], [103, 103], 'x rolls back, y still moves');
  const camera = fixture(); camera.state.camera.x = 100 - 0x130 - 1;
  updatePlayer(camera.state, camera.player, INPUT.RIGHT); assert.equal(camera.player.x, 100, 'screen limit uses the pre-step position');
});
test('a key pickup increments keys, plays sound 3, clears the cell type and starts its tile animation', () => {
  const cell = at(108, 92); const { state, player } = fixture({ [cell]: 0x04 });
  updatePlayer(state, player, 0);
  assert.equal(player.keys, 1); assert.deepEqual(state.sounds, [3]); assert.equal(state.types[cell], 0); assert.equal(state.tiles[cell], 0x7a);
  tickAnimations(state); assert.equal(state.tiles[cell], 7); tickAnimations(state); tickAnimations(state); assert.equal(state.animations.filter(Boolean).length, 0);
});
test('unimplemented cell effects stop strict runs with a diagnostic', () => {
  const { state, player } = fixture({ [at(92, 92)]: 0x44 });
  assert.throws(() => updatePlayer(state, player, 0), /Cell effect 0x44/);
});
test('firing spends ammo, plays the weapon sound, creates a shot at the facing offset and respects the fire-rate mask', () => {
  const { state, player } = fixture();
  updatePlayer(state, player, INPUT.FIRE);
  const shot = state.shots.find(s => s.type);
  assert.equal(player.ammo, 0x17e); assert.deepEqual(state.sounds, [7]); assert.equal(player.fireRepeat, 1);
  assert.deepEqual([shot.x, shot.y, shot.vx, shot.vy, shot.direction], [112, 88, 8, 0, 1]);
  for (let i = 0; i < 3; i++) { state.sounds = []; updatePlayer(state, player, INPUT.FIRE); assert.deepEqual(state.sounds, []); }
  assert.equal(player.fireRepeat, 0, 'mask 3 wraps the repeat counter after four frames');
  player.ammo = 0; updatePlayer(state, player, INPUT.FIRE); assert.deepEqual(state.sounds, [0x17], 'empty sound');
});
