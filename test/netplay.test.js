// Network play lockstep (src/game/netplay.js) over an in-memory transport pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLockstep, stateHash, DELAY } from '../src/game/netplay.js';

function pair() {
  const ends = [0, 1].map(() => ({ handlers: [], closers: [], queue: [] }));
  const make = (me, other) => ({ send: m => other.queue.push(structuredClone(m)), onMessage: fn => me.handlers.push(fn), onClose: fn => me.closers.push(fn), close: () => {} });
  const flush = () => { for (const end of ends) while (end.queue.length) { const m = end.queue.shift(); for (const fn of end.handlers) fn(m); } };
  return { a: make(ends[0], ends[1]), b: make(ends[1], ends[0]), flush };
}

test('lockstep: the first DELAY retraces run at once; later ones wait for both inputs and see the same keys in the same roles', () => {
  const { a, b, flush } = pair(), host = createLockstep('host', a), guest = createLockstep('guest', b);
  for (let n = 0; n < DELAY; n++) assert.ok(host.ready(n) && guest.ready(n));
  host.queue(0, [['KeyZ', true]], 0); assert.equal(host.ready(DELAY), false, 'the guest input for retrace DELAY is still missing');
  guest.queue(0, [['KeyP', true]], 0x11); flush();
  assert.ok(host.ready(DELAY) && guest.ready(DELAY));
  for (let n = 0; n < DELAY; n++) { host.take(n); guest.take(n); }
  const h = host.take(DELAY), g = guest.take(DELAY);
  assert.deepEqual(h, g, 'both sides apply the same inputs');
  assert.deepEqual(h, { host: { keys: [['KeyZ', true]], joy: 0 }, guest: { keys: [['KeyP', true]], joy: 0x11 } });
});

test('lockstep: a different state hash at the same retrace is reported; equal hashes are not', () => {
  const { a, b, flush } = pair(), seen = [];
  const host = createLockstep('host', a, { desync: n => seen.push(n) }), guest = createLockstep('guest', b);
  host.hash(120, 7); guest.hash(120, 7); flush(); assert.deepEqual(seen, []);
  host.hash(240, 7); guest.hash(240, 8); flush(); assert.deepEqual(seen, [240]);
});

test('lockstep: start resets both sides to retrace 0 and passes the host settings', () => {
  const { a, b, flush } = pair(); let settings = null;
  const host = createLockstep('host', a), guest = createLockstep('guest', b, { start: s => { settings = s; } });
  host.queue(0, [], 0); guest.queue(0, [], 0); flush();
  host.start({ preview: false }); flush();
  assert.deepEqual(settings, { preview: false }); assert.ok(host.ready(0) && guest.ready(0) && !host.ready(DELAY));
});

test('stateHash changes with the RNG, a player position or an object', () => {
  const state = { frameCounter: 5, rng: { s: 1, c: 1 }, aliveAliens: 0, playerCount: 1, players: [{ x: 1, y: 2, energy: 64, ammo: 383, lives: 4 }], objects: [{ active: true, type: 5, x: 3, y: 4, frame: 9 }] };
  const base = stateHash(state);
  for (const change of [s => { s.rng.s = 2; }, s => { s.players[0].x = 9; }, s => { s.objects[0].frame = 10; }]) {
    const copy = structuredClone(state); change(copy); assert.notEqual(stateHash(copy), base);
  }
});
