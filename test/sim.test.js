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
  const player = { x: 100, y: 100, keys: 0, energy: 64, lives: 4, ammo: 0x17f, weapon: 1, credits: 0, walk: 0, animBase: 11, facing: 1, moveMask: 15, conveyor: 0, cell: -1, hurt: false, invulnerable: 0, onIntex: 0, fireRepeat: 0, state: 1, tally: new Uint8Array(8) };
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
test('hazard cells: 0x44 always, 0x40 only when moving left (and it blocks left next frame)', () => {
  const lava = fixture({ [at(92, 92)]: 0x44 }); updatePlayer(lava.state, lava.player, 0);
  assert.equal(lava.player.energy, 64 - 16 * 2, 'two probes (X and Y passes) touch the cell'); assert.ok(lava.player.hurt); assert.deepEqual(lava.state.sounds, [0x0f, 0x0f]);
  const barrier = fixture({ [at(92, 92)]: 0x40 }); updatePlayer(barrier.state, barrier.player, 0); assert.equal(barrier.player.energy, 64);
  updatePlayer(barrier.state, barrier.player, INPUT.LEFT); assert.equal(barrier.player.energy, 64 - 32); assert.equal(barrier.player.moveMask, 0x0d);
});
test('touching cell 0x15 starts the self-destruct with the level\'s BCD seconds and red alert', () => {
  const { state, player } = fixture({ [at(92, 92)]: 0x15 }); state.tables.selfDestructSeconds = [0x50, 0x50, 0x60];
  updatePlayer(state, player, 0);
  assert.equal(state.selfDestruct, true); assert.equal(state.seconds, 0x60); assert.equal(state.redAlert, true);
});
test('unimplemented behaviour stops strict runs with a diagnostic', () => {
  const { state, player } = fixture(); player.onIntex = 0xffff;
  assert.throws(() => updatePlayer(state, player, INPUT.ACTION), /Intex terminal/);
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

test('HUD elements follow 18B2:17D0: clamps, icon widths, marker pixels and opaque copies', async () => {
  const { createHud, drawHud, blitPanel } = await import('../src/game/hud.js');
  const { createFramebuffer } = await import('../src/game/render.js');
  const panel = Uint8Array.from({ length: 320 * 200 }, (_, i) => (i % 320) & 15); // pixel = column & 15
  const hud = createHud(panel), at = (x, y) => hud.buffer[y * 320 + x];
  assert.equal(at(5, 0), 0xf5, 'top 32 rows recoloured to 0xF0 | p');
  drawHud(hud, { energy: 10, lives: 2, ammo: 0x183, keys: 7 });
  assert.equal(at(32 + 9, 2), 0xf0 | ((32 + 9) & 15), 'energy column 9 copied'); assert.equal(at(32 + 10, 2), 0xf0, 'energy column 10 blank');
  assert.equal(at(128 + 7, 2), 0xf0 | ((128 + 7) & 15), 'two lives = 8 columns'); assert.equal(at(128 + 8, 2), 0xf0);
  assert.equal(at(128 + 16, 2 + 3), 0x00, 'lives marker pixel when lives <= 4'); assert.equal(at(128 + 18, 2), 0xf0 | ((128 + 18) & 15), 'lives art columns 16..19 kept');
  assert.equal(at(32 + 11, 14), 0xf0 | ((32 + 11) & 15), 'three clips (0x183 >> 7 = 3) = 12 columns'); assert.equal(at(32 + 12, 14), 0xf0);
  assert.equal(at(56, 14), 0xf0, 'bullets: (0x183 >> 2) & 31 = 0, so no columns'); assert.equal(at(128 + 24, 14 + 3), 0xf0 | ((128 + 24) & 15), 'no keys marker when keys > 6');
  assert.equal(at(128 + 23, 14), 0xf0 | ((128 + 23) & 15), 'six key icons = 24 columns');
  drawHud(hud, { energy: 64, lives: 4, ammo: 0x17f, keys: 0 });
  assert.equal(at(56 + 30, 14), 0xf0 | ((56 + 30) & 15), 'bullets (0x17F >> 2) & 31 = 31 columns'); assert.equal(at(56 + 31, 14), 0xf0);
  assert.equal(at(128 + 24, 14 + 3), 0xff, 'keys marker when keys <= 6'); assert.equal(at(128, 14), 0xf0, 'no key icons');
  const frame = createFramebuffer(); blitPanel(frame, hud); assert.equal(frame[176 * 320 + 32], at(32, 2), 'panel row 2 lands on screen row 176');
});
test('tallies at +63..+6A: ADD/DAA then ADC/DAA adjust only the low byte of each word', async () => {
  const { tallyIncrement, TALLY } = await import('../src/game/sim.js');
  const t = new Uint8Array(8);
  for (let i = 0; i < 99; i++) tallyIncrement(t, TALLY.kills);
  assert.deepEqual([...t], [0, 0, 0x99, 0, 0, 0, 0, 0]);
  tallyIncrement(t, TALLY.kills); assert.deepEqual([...t], [0, 0, 0x00, 0, 0x01, 0, 0, 0], 'hundreds carry into +67, not into AH');
  t.set([0x09, 0x12]); tallyIncrement(t, TALLY.shots); assert.deepEqual([...t.subarray(0, 2)], [0x10, 0x12], 'AH kept');
  t.set([0x99, 0x00, 0x99, 0x00]); tallyIncrement(t, TALLY.shots); assert.deepEqual([...t.subarray(0, 4)], [0x00, 0x00, 0x00, 0x00], 'double carry is dropped after the second word');
  const d = new Uint8Array(8); d.set([0x99, 0, 0x0f, 0], 4); tallyIncrement(d, TALLY.doors); assert.deepEqual([...d.subarray(4)], [0, 0, 0x16, 0], 'door carry into the movement mask word');
});
test('1000:34E6 keys: releasing 1 cycles to the next owned weapon with sound 5; abort and unrelated keys', async () => {
  const { mainLoopKeys } = await import('../src/game/sim.js');
  const player = { weapon: 1, owned: 0x7f, map: 0 }, state = { players: [player], sounds: [], diagnostics: [], strict: true };
  assert.equal(mainLoopKeys(state, 0x82, 0x01), 'consumed'); assert.equal(player.weapon, 2); assert.deepEqual(state.sounds, [5]);
  player.weapon = 7; mainLoopKeys(state, 0x82, 0x01); assert.equal(player.weapon, 1, 'bit 7 is not owned, wraps to weapon 1');
  player.owned = 0x05; player.weapon = 1; mainLoopKeys(state, 0x82, 0x01); assert.equal(player.weapon, 3);
  assert.equal(mainLoopKeys(state, 0x02, 0x01), null, 'the press itself does nothing');
  assert.equal(mainLoopKeys(state, 0x01, 0x01), 'abort'); assert.equal(mainLoopKeys(state, 0x8b, 0x01), 'consumed', 'player 2 key without player 2');
  assert.equal(mainLoopKeys(state, 0x32, 0x01), 'consumed', 'M without the map does nothing');
});
test('the player save (1000:21A6) carries stats, tallies and the movement mask; a new game starts with mask 0', async () => {
  const { savePlayer, newGamePlayer } = await import('../src/game/sim.js');
  assert.deepEqual({ ...newGamePlayer(), tally: [...newGamePlayer().tally] }, { energy: 0x40, lives: 4, keys: 0, ammo: 0x17f, weapon: 1, owned: 0x7f, credits: 0, map: 0, tally: [0, 0, 0, 0, 0, 0, 0, 0], moveMask: 0 });
  const p = { ...newGamePlayer(), energy: 12, keys: 3, moveMask: 15, x: 5, tally: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8) };
  const saved = savePlayer(p); p.tally[0] = 99;
  assert.equal(saved.tally[0], 1, 'tally copied'); assert.equal(saved.x, undefined); assert.equal(saved.moveMask, 15); assert.equal(saved.keys, 3);
});
test('bouncing shots (1000:5445): sound 0x15, step back, new random direction never the old one, last bounce explodes', async () => {
  const { updateShots } = await import('../src/game/sim.js');
  const { seedRandom } = await import('../src/game/rng.js');
  const { state } = fixture({ [at(200, 116)]: 1 });
  Object.assign(state, { rng: seedRandom(1), bounceCounter: 0, objects: [], generatorFlags: [], generatorsDestroyed: 0, wallsDestroyed: 0 });
  state.camera = { x: 100, y: 0 };
  state.tables.bounceDirection = [1, 2, 4, 8, 5, 6, 9, 10, 1, 2, 4, 8, 5, 6, 9, 10];
  const shot = state.shots[0]; Object.assign(shot, { type: 3, x: 190, y: 100, vx: 8, vy: 0, direction: 1, counter: 2 });
  updateShots(state);
  assert.deepEqual(state.sounds, [0x15]); assert.equal(shot.type, 3); assert.equal(shot.counter, 1);
  assert.deepEqual([shot.x, shot.y], [190, 100], 'stepped back to the old position');
  assert.notEqual(shot.direction, 1); assert.equal(state.bounceCounter > 0, true);
  const [vx, vy] = [shot.direction & 1 ? 8 : shot.direction & 2 ? -8 : 0, shot.direction & 4 ? 8 : shot.direction & 8 ? -8 : 0];
  assert.deepEqual([shot.vx, shot.vy], [vx, vy], 'speed from the weapon, no spread');
});
test('destructible wall 0x12 (1000:5502): floor, three burning 0x45 cells one column right, burning 16, door sound', async () => {
  const { updateShots } = await import('../src/game/sim.js');
  const { state } = fixture({ [at(200, 116)]: 0x12 });
  Object.assign(state, { objects: [], generatorFlags: [], generatorsDestroyed: 0, wallsDestroyed: 0, level: 3 });
  state.camera = { x: 100, y: 0 };
  Object.assign(state.shots[0], { type: 1, x: 192, y: 100, vx: 8, vy: 0, direction: 1, counter: 0 });
  updateShots(state);
  assert.equal(state.types[at(200, 116)], 0);
  for (const dy of [0, 16, 32]) assert.equal(state.types[at(232, 116 + dy)], 0x45);
  assert.equal(state.burning, 0x10); assert.equal(state.wallsDestroyed, 1); assert.deepEqual(state.sounds, [1]); assert.equal(state.shots[0].type, 1, 'the shot flies on');
});
