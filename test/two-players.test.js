// Two players (docs/port/evidence.md, "Two players"): set-up, targets, camera, dropping out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { decodeMap } from '../src/game/level.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { readTables, startLevel, levelTileset, stepFrame, followCamera, newGamePlayer, alienTarget } from '../src/game/sim.js';
import { drawList } from '../src/game/objects.js';

const game = new URL('../game/', import.meta.url), strict = process.env.ALIEN_BREED_STRICT === '1';
const missing = !existsSync(new URL('ALIEN.EXE', game));
if (strict && missing) throw new Error('Strict verification needs the original files in game/ (see README).');
const both = () => ({ count: 2, inGame: [true, true], saved: [null, null] });
async function level2(party) {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  return startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), party });
}

test('new game: player 2 owns only the first weapon (1000:188B-1932)', () => {
  assert.equal(newGamePlayer(0).owned, 0x7f); assert.equal(newGamePlayer(1).owned, 0x01);
  assert.deepEqual({ ...newGamePlayer(1), owned: 0x7f, tally: null }, { ...newGamePlayer(0), tally: null });
});

test('level start: player 2 at camera + (0xC0, 0x78), drawn from the next sheet; one player keeps player 2 out', { skip: missing }, async () => {
  const s = await level2(both()), [p1, p2] = s.players;
  assert.deepEqual([p2.x - s.camera.x, p2.y - s.camera.y, p1.x - s.camera.x, p1.y - s.camera.y], [0xc0, 0x78, 0xb0, 0x68]);
  assert.equal(s.objectCount, 2); assert.equal(s.playerCount, 2);
  stepFrame(s, [0, 0], 0); assert.deepEqual(drawList(s).filter(o => o.frame === s.players[0].frame || o.player2).map(o => o.player2).slice(0, 2), [false, true]);
  const one = await level2({ count: 1, inGame: [true, false], saved: [null, null] });
  assert.equal(one.players[1].alive, false); assert.equal(one.players[1].active, false); assert.equal(one.objectCount, 1);
});

test('alien targets alternate by cs:5119 parity with two players; the remaining player otherwise (1000:50B1)', { skip: missing }, async () => {
  const s = await level2(both()), [p1, p2] = s.players;
  assert.deepEqual([0, 1, 2, 3].map(n => { s.spawnCounter = n; return alienTarget(s); }), [p1, p2, p1, p2], 'even: player 1, odd: player 2');
  s.playerCount = 1; p1.alive = false; s.spawnCounter = 0; assert.equal(alienTarget(s), p2, 'player 1 out ([B096] = 0)');
  p1.alive = true; p2.alive = false; s.spawnCounter = 1; assert.equal(alienTarget(s), p1);
});

test('camera: the midpoint of both players, the remaining one after a player is out (1000:7BBA)', { skip: missing }, async () => {
  const s = await level2(both()), [p1, p2] = s.players;
  p1.x = 1000; p2.x = 1100; p1.y = 700; p2.y = 640; s.camera = { x: 0, y: 0 };
  for (let i = 0; i < 400; i++) followCamera(s);
  assert.deepEqual([s.camera.x + 0xb0, s.camera.y + 0x68], [1050 - 1, 670 - 1], 'the midpoint (1050, 670) just past the dead band, as in DOSBox');
  p1.energy = 0; p1.lives = 0; stepFrame(s, [0, 0], 0);
  assert.deepEqual([p1.alive, s.playerCount, p1.type], [false, 1, 3], 'lives 0 -> 0xFF: out of the game');
  for (let i = 0; i < 400; i++) followCamera(s);
  assert.equal(s.camera.x + 0xb0, p2.x - 1, 'follows player 2 alone');
});

test('a player out of lives: the freed record saves as zeros and the next level keeps that player out', { skip: missing }, async () => {
  const { savePlayer } = await import('../src/game/sim.js');
  const s = await level2(both()), [p1, p2] = s.players;
  p1.credits = 0x1234; p2.energy = 0; p2.lives = 0;
  let frames = 0; while (p2.active !== false || frames === 0) { stepFrame(s, [0, 0], 0); frames++; if (frames > 200) break; }
  assert.equal(p2.active, false, 'the type-3 script ended and freed the record'); assert.equal(s.playerCount, 1);
  const party = { count: s.playerCount, inGame: s.players.map(p => p.alive), saved: s.players.map(savePlayer) };
  assert.deepEqual(party.inGame, [true, false]); assert.deepEqual([...party.saved[1].tally], [0, 0, 0, 0, 0, 0, 0, 0]);
  const next = await level2(party);
  assert.deepEqual([next.players[0].credits, next.players[1].alive, next.players[1].active, next.playerCount], [0x1234, false, false, 1]);
});

test('a level change during a recording (1E9D): player 1 restored, player 2 counted in but not created, out after one pass', { skip: missing }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const map = decodeMap(decompressLzhuf(new Uint8Array(await readFile(new URL('LBMZ.HUF', game)))));
  const saved = { ...newGamePlayer(0), credits: 0x4321 };
  const s = startLevel({ tables: readTables(exe), map, level: 2, tileset: levelTileset(exe, 2), recording: true, party: { count: 2, inGame: [true, true], saved: [saved, null] } });
  assert.equal(s.players[0].credits, 0x4321, 'player 1 restored as usual');
  assert.deepEqual([s.players[1].active, s.players[1].alive, s.playerCount], [false, true, 2], 'player 2 still counted in, no record');
  stepFrame(s, [0, 0], 0);
  assert.deepEqual([s.players[1].alive, s.playerCount, s.players[1].lives], [false, 1, 0xff], 'its death check takes it out for the rest of the game');
});
