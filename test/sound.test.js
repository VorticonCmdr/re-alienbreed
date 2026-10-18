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
