import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openExe } from '../src/game/exe.js';
import { sampleNames, samplePriorities, startEffect, createEffectPlayer } from '../src/game/sound.js';
import { decodeVoc } from '../src/formats.js';
const game = new URL('../game/', import.meta.url);

test('1000:7300 single voice: idle always plays, a lower priority is refused, equal or higher replaces', () => {
  const channel = { priority: 0 };
  assert.equal(startEffect(channel, 6, false), true); assert.equal(channel.priority, 6);
  assert.equal(startEffect(channel, 4, true), false); assert.equal(channel.priority, 6);
  assert.equal(startEffect(channel, 6, true), true);
  assert.equal(startEffect(channel, 24, true), true); assert.equal(channel.priority, 24);
  assert.equal(startEffect(channel, -1, true), false, 'signed compare: priority -1 never interrupts');
  assert.equal(startEffect(channel, -1, false), true, 'but plays when idle'); assert.equal(channel.priority, -1);
  assert.equal(startEffect(channel, 0, true), true);
});

test('effect player stops the playing sample before starting the next and follows the sample end', () => {
  const log = [], sources = [];
  const context = { createBufferSource: () => { const s = { connect() {}, start: () => log.push(`start ${s.buffer}`), stop: () => log.push(`stop ${s.buffer}`) }; sources.push(s); return s; } };
  const player = createEffectPlayer(context, {}, ['a', 'b', 'c'], [8, 4, 8]);
  player.play(0); player.play(1); player.play(2);
  assert.deepEqual(log, ['start a', 'stop a', 'start c']);
  sources[1].onended(); player.play(1); assert.deepEqual(log.slice(3), ['start b'], 'idle after the end');
});

test('original executable: 25 samples in load order, all decodable, priorities from cs:7275', { skip: !existsSync(game) }, async () => {
  const exe = await openExe(new Uint8Array(await readFile(new URL('ALIEN.EXE', game))));
  const names = sampleNames(exe);
  assert.equal(names.length, 25);
  // Ids used by the simulation: 1 door, 3 pickup, 4 alien killed, 0x0F hurt, 0x16 countdown tick, 0x17 out of ammo.
  assert.deepEqual([1, 3, 4, 0x0f, 0x16, 0x17].map(i => names[i].toUpperCase()),
    ['SAMS\\DOORS.VOC', 'SAMS\\PICKUP2.VOC', 'SAMS\\ALIENKL1.VOC', 'SAMS\\URRGH1.VOC', 'SAMS\\CLOCKTIC.VOC', 'SAMS\\EMPTY.VOC']);
  for (const name of names) assert.ok(decodeVoc(new Uint8Array(await readFile(new URL(name.replaceAll('\\', '/'), game)).catch(() => readFile(new URL(name.replaceAll('\\', '/').toUpperCase(), game))))).samples.length > 0, name);
  const priorities = samplePriorities(exe, names.length);
  assert.equal(priorities.length, 25); assert.ok(priorities.every(p => p >= -1 && p <= 24));
});

test('PIT model: 120 Hz IRQs per 70.086 Hz retrace; the in-game window only drops music ticks unless it spans two IRQs', async () => {
  const { createTimer, advanceRetrace, RELOAD } = await import('../src/game/timing.js');
  const run = share => { const t = createTimer(RELOAD.game); let ticks = 0, music = 0; for (let i = 0; i < 70086; i++) { const r = advanceRetrace(t, share); ticks += r.ticks; music += r.music.length; } return { ticks, music }; };
  const all = run(1), game = run(0.8), fast = run(0.1);
  assert.ok(Math.abs(all.ticks - 120000) <= 2 && all.music === all.ticks);
  assert.equal(game.ticks, all.ticks, 'a 2.9 ms window never holds two IRQs');
  assert.ok(Math.abs(game.music / all.ticks - 0.8) < 0.01, 'music advances on 80% of the IRQs');
  assert.ok(fast.ticks < all.ticks * 0.75, 'a machine that waits most of the frame with interrupts off loses IRQs');
  const slow = createTimer(RELOAD.stopped); let n = 0; for (let i = 0; i < 70086; i++) n += advanceRetrace(slow).ticks;
  assert.ok(Math.abs(n - 69000) <= 2, `0x438C gives 69 Hz (${n})`);
});

test('original driver: the in-game song restarts at its 0x66 marker through the game loop check (1000:796A)', { skip: !existsSync(game) }, async () => {
  const { createFmDriver, createMusic } = await import('../src/game/fmdriver.js');
  const reloads = [], writes = [];
  const driver = createFmDriver(new Uint8Array(await readFile(new URL('AVMFM.BIN', game))), (r, v) => writes.push([r, v]), r => reloads.push(r));
  const music = createMusic(driver);
  music.start('ingame', new Uint8Array(await readFile(new URL('ADLIB/INGAME.CMF', game))));
  assert.deepEqual(reloads, [0x26d7, 0x26d7], 'fn 4 and fn 6 program the PIT (fn 7 does nothing while stopped)');
  for (let i = 0; i < 12288; i++) music.irq();
  assert.equal(driver.status, 0xff); const before = driver.debug.cur;
  music.irq(); // tick 12289 runs the marker batch: status 0, so the game stops and replays at once
  assert.ok(driver.debug.cur < before, 'read position back near the start'); assert.equal(driver.status, 0xff); assert.equal(driver.state, 1);
  assert.ok(writes.some(([r, v]) => r === 0x83 && v === 0x13), 'the stop writes 0x13 to register 0x83');
});
