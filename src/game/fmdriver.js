// The CMF music driver AVMFM.BIN (Creative SBFMDRV 1.30B image), ported from docs/port/avmfm.md: the sequencer and
// the OPL2 register writes it makes. Tables and initial values are read from the user's AVMFM.BIN at runtime.
// `f:XXXX` below is a file offset in AVMFM.BIN. Output is a stream of opl(register, value) calls.
const s8 = v => (v << 24) >> 24, s16 = v => (v << 16) >> 16;
const BUFFER = 0x20000; // segment [E338] and what follows; CMF files are loaded at offset 0 and leave stale bytes behind

export function createFmDriver(driverBytes, opl, onReload) {
  const f = driverBytes, u16 = o => f[o] | f[o + 1] << 8;
  const opOff = Array.from({ length: 9 }, (_, v) => f[0x1c7 + v]);
  const percOp = i => f[0x1db + i - 6], bdBit = i => f[0x1e0 + i - 6], percVoice = i => f[0x1e5 + i - 6];
  const noteCode = n => f[0x295 + n], fnumTable = i => u16(0x315 + 2 * i);
  const velocityAdd = i => s16(u16(0x915 + 2 * i)); // index 16 reads f:935, the first code word (see the spec, 4.3)
  const sys = u16(0x03a);
  const d = {
    buffer: new Uint8Array(BUFFER), bank: 0, bankInBuffer: true, count: f[0x1ea], state: 0, cur: 0, start: 0, counter: 0,
    age: 0, voices: 9, rhythm: 0, bd: f[0x1f0], musicReload: u16(0x03c), status: 0, transpose: s16(u16(0x04c)),
    owner: Array.from({ length: 11 }, (_, v) => f[0x152 + v]), code: Array.from({ length: 11 }, (_, v) => f[0x15d + v]),
    key: Array.from({ length: 11 }, (_, v) => f[0x168 + v]), ksl: Array.from({ length: 11 }, (_, v) => f[0x173 + v]),
    vol: Array.from({ length: 11 }, (_, v) => f[0x17e + v]), fnum: Array.from({ length: 11 }, (_, v) => u16(0x194 + 2 * v)),
    stamp: Array.from({ length: 11 }, (_, v) => u16(0x1aa + 2 * v)), program: Array.from({ length: 16 }, (_, c) => f[0x1f3 + c]),
    pitch: Array.from({ length: 16 }, (_, c) => s16(u16(0x203 + 2 * c))), enable: Array.from({ length: 16 }, (_, c) => f[0x223 + c]),
    chan: 0, type: 0,
  };
  const next = () => d.buffer[d.cur++ & (BUFFER - 1)];
  const vlq = () => { let v = 0, b; do { b = next(); v = (v + (b & 0x7f)) >>> 0; if (b & 0x80) v = (v << 7) >>> 0; } while (b & 0x80); return v; };
  const bankByte = (p, i) => d.bankInBuffer ? d.buffer[(d.bank + 16 * p + i) & (BUFFER - 1)] : f[0x52 + 16 * p + i];
  const setPit = reload => onReload(reload);

  function voiceReset() { // f:09D8
    d.program.fill(0); d.owner.fill(0xff);
    for (let v = 0; v < 9; v++) {
      opl(0xbd, 0xc0); opl(0x08, 0x00);
      const op = opOff[v], D = i => f[0x1d0 + i];
      [0x20, 0x23, 0x40, 0x43, 0x60, 0x63, 0x80, 0x83, 0xe0, 0xe3].forEach((reg, i) => opl(reg + op, D(i)));
      opl(op + v, D(10)); // the original writes the feedback byte here instead of C0+v
    }
  }
  function modeReset() { d.voices = 9; d.bd = 0xc0; d.rhythm = 0; opl(0xbd, 0xc0); } // f:0C25
  function allNotesOff() { // f:0994
    for (let v = d.voices - 1; v >= 0; v--) {
      opl(0x83, 0x13); // meant 0x83 + v
      if (d.owner[v] <= 0x7f) { opl(0xa0 + v, d.fnum[v] & 0xff); opl(0xb0 + v, d.fnum[v] >> 8); }
    }
    d.bd &= 0xe0; opl(0xbd, d.bd);
  }
  function stop() { if (d.state === 0) return; d.state = 0; setPit(sys); allNotesOff(); d.status = 0; } // f:125C

  // f:0F31 / 0F5A: the F-number and block for a note code plus the channel's pitch offset.
  function frequency(v, chan, code) {
    d.code[v] = code;
    let blk4 = (code & 0x70) >> 2, idx = s16((code & 0x0f) * 64 + d.pitch[chan]);
    if (idx < 0) { idx += 0x300; blk4 -= 4; if (blk4 < 0) { blk4 = 0; idx = 0; } }
    else if (idx >= 0x300) { idx -= 0x300; blk4 += 4; if (blk4 > 0x1c) { idx = 0x2ff; blk4 = 0x1c; } }
    d.fnum[v] = (fnumTable(idx) | blk4 << 8) & 0xffff; d.stamp[v] = d.age;
    return d.fnum[v];
  }
  function noteFrequency(v, chan, key) {
    d.key[v] = key;
    const n = Math.min(127, Math.max(0, s8(key) + d.transpose));
    return frequency(v, chan, noteCode(n));
  }
  function loadInstrument(p, v) { // f:0A4C
    if (p >= d.count) return;
    const R = i => bankByte(p, i);
    let level = R(3); if (d.rhythm && v >= 7) level = R(2);
    d.ksl[v] = level & 0xc0; d.vol[v] = 63 - (level & 0x3f);
    if (!(d.rhythm && v > 6)) {
      const op = opOff[v];
      opl(0x20 + op, R(0)); opl(0x23 + op, R(1)); opl(0x40 + op, R(2));
      opl(0x60 + op, R(4)); opl(0x63 + op, R(5)); opl(0x80 + op, R(6)); opl(0x83 + op, R(7)); opl(0xe0 + op, R(8)); opl(0xe3 + op, R(9));
      opl(0xc0 + v, R(10));
    } else {
      const op = percOp(v);
      opl(0x20 + op, R(0)); opl(0x60 + op, R(4)); opl(0x80 + op, R(6)); opl(0xe0 + op, R(8));
      opl(0xc0 + percVoice(v), R(10));
    }
  }
  function allocVoice(chan) { // f:0BA5
    for (let v = 0; v < d.voices; v++) if (d.owner[v] === (chan | 0x80)) return v;
    for (let v = 0; v < d.voices; v++) if (d.owner[v] === 0xff) return v;
    for (let v = 0; v < d.voices; v++) if (d.owner[v] > 0x7f) return v;
    let best = 0, bestAge = -1;
    for (let v = 0; v < d.voices; v++) { const a = (d.age - d.stamp[v]) & 0xffff; if (a > bestAge) { bestAge = a; best = v; } }
    opl(0xa0 + best, d.fnum[best] & 0xff); opl(0xb0 + best, d.fnum[best] >> 8);
    return best;
  }
  const volumeAdd = velocity => velocityAdd((velocity >> 3) + ((velocity >> 2) & 1));
  function noteOn(chan, key, velocity) { // f:0E16
    if (velocity === 0) { noteOff(chan, key); return; }
    if (d.enable[chan] === 0) return;
    if (d.rhythm && chan >= 11) { percussionOn(chan, key, velocity); return; }
    const v = allocVoice(chan), old = d.owner[v]; d.owner[v] = chan;
    if ((old & 0x7f) !== chan) loadInstrument(d.program[chan], v);
    const x = Math.min(63, Math.max(0, s8(d.vol[v]) + volumeAdd(velocity)));
    opl(0x43 + opOff[v], (63 - x) | d.ksl[v]);
    const w = noteFrequency(v, chan, key);
    opl(0xa0 + v, w & 0xff); opl(0xb0 + v, (w >> 8) | 0x20);
  }
  function percussionOn(chan, key, velocity) { // f:0EBD
    const p = chan - 5;
    d.bd |= bdBit(p);
    const x = Math.min(63, Math.max(0, d.vol[p] + volumeAdd(velocity)));
    opl(0x40 + percOp(p) + (p === 6 ? 3 : 0), (63 - x) | d.ksl[p]);
    const w = noteFrequency(p, chan, key);
    opl(0xa0 + percVoice(p), w & 0xff); opl(0xb0 + percVoice(p), w >> 8);
    opl(0xbd, d.bd);
  }
  function noteOff(chan, key) { // f:0D9F
    if (d.voices <= 6 && chan >= 11) { d.bd &= ~f[0x1d5 + chan] & 0xff; opl(0xbd, d.bd); return; }
    for (let v = 0; v < d.voices; v++) if (d.key[v] === key && d.owner[v] === chan) {
      d.owner[v] |= 0x80; opl(0xa0 + v, d.fnum[v] & 0xff); opl(0xb0 + v, d.fnum[v] >> 8); return;
    }
  }
  function programChange(chan, value) { // f:104C
    let p = value; while (p >= d.count) p -= d.count;
    d.program[chan] = p;
    if (d.rhythm && chan >= 11) { loadInstrument(p, chan - 5); return; }
    for (let v = 0; v < d.voices; v++) {
      if (d.owner[v] === (chan | 0x80)) d.owner[v] = 0xff;
      else if (d.owner[v] === chan) loadInstrument(p, v);
    }
  }
  function controller(chan, c, v) { // f:0FB6
    if (c === 0x66) d.status = v;
    else if (c === 0x67) {
      voiceReset(); d.rhythm = v;
      if (v) { d.bd = 0xe0; d.voices = 6; } else { d.bd = 0xc0; d.voices = 9; }
      opl(0xbd, d.bd);
    } else if (c === 0x68 || c === 0x69) {
      d.pitch[chan] = s8(c === 0x68 ? v : -v & 0xff) >> 2;
      for (let voice = 0; voice < d.voices; voice++) if (d.owner[voice] === chan) {
        const w = frequency(voice, chan, d.code[voice]);
        opl(0xa0 + voice, w & 0xff); opl(0xb0 + voice, (w >> 8) | 0x20);
      }
    }
  }
  function system(low) { // f:10C6
    if (low === 0x0 || low === 0x7) { const len = vlq(); d.cur = (d.cur + len) >>> 0; }
    else if (low === 0x2) d.cur += 2;
    else if (low === 0x3) d.cur += 1;
    else if (low === 0xc) stop();
    else if (low === 0xf) { const t = next(); if (t === 0x2f) stop(); const len = vlq(); d.cur = (d.cur + len) >>> 0; }
  }
  function processBatch() { // f:0D0B
    d.age = (d.age + 1) & 0xffff;
    for (;;) {
      const b = d.buffer[d.cur & (BUFFER - 1)];
      if (b & 0x80) { d.cur++; d.chan = b & 0x0f; d.type = (b >> 4) - 8; }
      const chan = d.chan;
      switch (d.type) {
        case 0: { const k = next(); next(); noteOff(chan, k); break; }
        case 1: { const k = next(), v = next(); noteOn(chan, k, v); break; }
        case 2: case 6: d.cur += 2; break;
        case 3: { const c = next(), v = next(); controller(chan, c, v); break; }
        case 4: programChange(chan, next()); break;
        case 5: d.cur += 1; break;
        case 7: system(chan); break;
      }
      if (d.state === 0) return;
      const delta = vlq();
      if (delta !== 0) { d.counter = delta - 1; return; }
    }
  }

  return {
    get state() { return d.state; }, get status() { return d.status; }, get debug() { return d; },
    load(bytes) { d.buffer.set(bytes, 0); }, // the game's loader overwrites the buffer even while it plays
    instruments(offset, count) { d.count = count & 0xff; d.bank = offset; d.bankInBuffer = true; modeReset(); voiceReset(); }, // fn 2
    speed(reload) { d.musicReload = reload; setPit(reload); }, // fn 4
    play(offset) { // fn 6
      if (d.state !== 0) return 0xfffe;
      d.start = d.cur = offset; d.pitch.fill(0); for (let v = 0; v < 9; v++) d.owner[v] = 0xff;
      d.counter = vlq(); d.age = 0; setPit(d.musicReload); modeReset(); d.state = 1; d.status = 0xff;
      return 0;
    },
    stop() { if (d.state === 0) return 0xfffd; stop(); return 0; }, // fn 7
    tick() { // f:110E, one driver call
      if (d.state !== 1) return;
      const was = d.counter; d.counter = (d.counter - 1) >>> 0;
      if (was === 0) processBatch();
    },
  };
}

// The game's side (1000:2261, 2402 and friends, 796A): which song, the loop restart and the 'loop this song' flag.
export const SONGS = { title: 0xaf04, monster: 0xaf1c, ingame: 0xaf36, intex: 0xaf4f, alarmed: 0xaf67 };
export const songFile = (exe, song) => exe.string(0x2041, SONGS[song] + 8);
export function createMusic(driver) {
  let loop = 0, current = null;
  return {
    get song() { return current; },
    // `slow` (title, Intex): the PIT at 0x1234DC / T; otherwise 0x1234DC / (T + T/4), with T = header word 0x0C.
    start(song, bytes, { stopFirst = true } = {}) {
      if (stopFirst) { loop = 0; driver.stop(); }
      driver.load(bytes);
      const word = o => bytes[o] | bytes[o + 1] << 8, t = word(0x0c), slow = song === 'title' || song === 'intex';
      driver.instruments(word(0x06), word(0x24));
      driver.speed(Math.floor(0x1234dc / (slow ? t : t + (t >> 2))) & 0xffff);
      loop = 0xff; driver.play(word(0x08)); current = song;
    },
    stop() { loop = 0; driver.stop(); current = null; }, // 1000:2261
    irq() { // 1000:796A for an IRQ that reaches the driver
      driver.tick();
      if (driver.status === 0 && loop === 0xff) { driver.stop(); const b = driver.debug.buffer; driver.play(b[8] | b[9] << 8); }
    },
  };
}
