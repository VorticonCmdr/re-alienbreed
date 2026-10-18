// Independent-runtime checks: compares the port against state captured from the original in DOSBox. Captures are
// proprietary memory and live only in .work/captures (see docs/port/scenarios/). Missing captures fail the command.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createFmDriver, createMusic } from '../src/game/fmdriver.js';

const root = new URL('../', import.meta.url), game = new URL('game/', root);
const required = ['.work/captures/avmfm-title-1000.json', '.work/captures/avmfm-ingame-3000.json'];
const missing = required.filter(p => !existsSync(new URL(p, root)));
if (missing.length) { console.error(`Missing runtime captures: ${missing.join(', ')}`); process.exit(2); }
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`ok - ${name}`); };

// Driver state after N driver ticks from fn 6, against the original's memory f:000-f:23F.
async function driverAfter(song, file, ticks) {
  const driverBytes = new Uint8Array(await readFile(new URL('AVMFM.BIN', game)));
  const writes = []; const driver = createFmDriver(driverBytes, (r, v) => writes.push([r, v]), () => {});
  const music = createMusic(driver);
  music.start(song, new Uint8Array(await readFile(new URL(file, game))));
  for (let i = 0; i < ticks; i++) music.irq();
  return { d: driver.debug, writes };
}
const CAPTURES = [['avmfm-title-1000', 'title', 'ADLIB/TITLE.CMF'], ['avmfm-ingame-3000', 'ingame', 'ADLIB/INGAME.CMF']];
function originalState(b) {
  const u16 = o => b[o] | b[o + 1] << 8, s16 = v => (v << 16) >> 16;
  return { // the read position f:01E relative to the song buffer, whose segment is the start pointer's (f:026, f:028)
    position: (u16(0x20) - u16(0x28)) * 16 + u16(0x1e), counter: (u16(0x2a) | u16(0x2c) << 16) >>> 0, age: u16(0x4a), voices: u16(0x44),
    state: b[0x1eb], bd: b[0x1f0], rhythm: b[0x1f1], owner: [...b.subarray(0x152, 0x15d)], code: [...b.subarray(0x15d, 0x168)],
    key: [...b.subarray(0x168, 0x173)], ksl: [...b.subarray(0x173, 0x17e)], vol: [...b.subarray(0x17e, 0x189)],
    fnum: Array.from({ length: 11 }, (_, v) => u16(0x194 + 2 * v)), stamp: Array.from({ length: 11 }, (_, v) => u16(0x1aa + 2 * v)),
    program: [...b.subarray(0x1f3, 0x203)], pitch: Array.from({ length: 16 }, (_, c) => s16(u16(0x203 + 2 * c))),
  };
}
const portState = d => ({ position: d.cur, counter: d.counter, age: d.age, voices: d.voices, state: d.state, bd: d.bd, rhythm: d.rhythm,
  owner: d.owner, code: d.code, key: d.key, ksl: d.ksl, vol: d.vol, fnum: d.fnum, stamp: d.stamp, program: d.program, pitch: d.pitch });
for (const [name, song, file] of CAPTURES) {
  const capture = JSON.parse(await readFile(new URL(`.work/captures/${name}.json`, root), 'utf8'));
  const original = originalState(Buffer.from(capture.base64, 'base64'));
  const port = portState((await driverAfter(song, file, capture.driverTicks)).d);
  // Per-voice fields of voices that are free in the original (owner 0xFF) hold stale values from earlier songs, which
  // the driver never reads for a free voice; they are left out.
  const used = original.owner.map(o => o !== 0xff), voiceFields = ['code', 'key', 'ksl', 'vol', 'fnum', 'stamp'];
  for (const key of Object.keys(original)) {
    const pick = v => voiceFields.includes(key) ? v.map((x, i) => used[i] ? x : null) : v;
    check(`${name}: ${key}`, () => assert.deepEqual(pick(port[key]), pick(original[key])));
  }
  // Negative control: one tick more must differ somewhere.
  const later = portState((await driverAfter(song, file, capture.driverTicks + 1)).d);
  check(`${name}: one extra tick is detected`, () => assert.notDeepEqual(later, original));
}
console.log(`runtime checks: ${checks} passed`);
