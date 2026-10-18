// A YM3812 (OPL2) synthesizer written for this port from the chip's documented register behaviour. The register
// writes it receives are exact (fmdriver.js); the sound it makes is an approximation of the chip: envelope rates,
// key scaling, vibrato and tremolo depths follow the datasheet values, not a die-level model.
export const OPL_RATE = 49716; // 3.579545 MHz / 72

const SLOT_OF_OFFSET = [0, 1, 2, 3, 4, 5, -1, -1, 6, 7, 8, 9, 10, 11, -1, -1, 12, 13, 14, 15, 16, 17];
const CHANNEL_SLOTS = [[0, 3], [1, 4], [2, 5], [6, 9], [7, 10], [8, 11], [12, 15], [13, 16], [14, 17]];
const MULTIPLE = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30]; // twice the factor
const KSL_DB = [0, 9, 12, 13.875, 15, 16.125, 16.875, 17.625, 18, 18.75, 19.125, 19.5, 19.875, 20.25, 20.625, 21]; // block 7, 3 dB/octave
const KSL_SCALE = [0, 1, 0.5, 2]; // register value: off, 3, 1.5, 6 dB per octave
const STEP_DB = 0.1875, MAX_ATTENUATION = 511;
const SINE = Float64Array.from({ length: 1024 }, (_, i) => Math.sin((i + 0.5) / 1024 * 2 * Math.PI));
const LINEAR = Float64Array.from({ length: 2048 }, (_, a) => Math.pow(10, -a * STEP_DB / 20)); // attenuation units -> gain
const VIBRATO = [0, 1, 2, 1, 0, -1, -2, -1];

// Envelope speed: OPL2 decay from 0 to 96 dB takes 39.28 s at rate 1 (R = 4) and halves per rate step; R & 3 adds
// a quarter each. Attack is exponential and about 14 times faster.
const decayPerSample = R => R < 4 ? 0 : (4 + (R & 3)) * 2 ** (R >> 2) * (512 / (39.28 * OPL_RATE)) / 8;
const attackPerSample = R => R < 4 ? 0 : R >= 60 ? 1 : Math.min(1, (4 + (R & 3)) * 2 ** (R >> 2) * (6.24 / (2.826 * OPL_RATE)) / 8);

function createSlot() {
  return { am: 0, vib: 0, egt: 0, ksr: 0, mult: 0, ksl: 0, tl: 0, ar: 0, dr: 0, sl: 0, rr: 0, ws: 0,
    phase: 0, env: MAX_ATTENUATION, stage: 'off', out: 0, prev: 0, key: 0 };
}

export function createOpl() {
  const regs = new Uint8Array(256), slots = Array.from({ length: 18 }, createSlot);
  const ch = Array.from({ length: 9 }, () => ({ fnum: 0, block: 0, key: 0, fb: 0, cnt: 0 }));
  let noise = 1, counter = 0;
  const waveformEnabled = () => regs[1] & 0x20;
  function keyOn(slot) { if (!slot.key) { slot.key = 1; slot.phase = 0; slot.stage = 'attack'; } }
  function keyOff(slot) { if (slot.key) { slot.key = 0; if (slot.stage !== 'off') slot.stage = 'release'; } }
  function rhythmKeys(value) {
    const rhythm = value & 0x20, bits = rhythm ? value : 0;
    const set = (s, on) => on ? keyOn(slots[s]) : (!ch[CHANNEL_OF_SLOT[s]].key && keyOff(slots[s]));
    set(12, bits & 0x10); set(15, bits & 0x10); // bass drum, both operators of channel 6
    set(13, bits & 0x01); set(16, bits & 0x08); set(14, bits & 0x04); set(17, bits & 0x02); // HH, SD, TOM, CYM
  }
  const CHANNEL_OF_SLOT = []; CHANNEL_SLOTS.forEach(([m, c], i) => { CHANNEL_OF_SLOT[m] = i; CHANNEL_OF_SLOT[c] = i; });

  function write(reg, value) {
    reg &= 0xff; value &= 0xff; regs[reg] = value;
    const group = reg & 0xe0, slot = SLOT_OF_OFFSET[reg & 0x1f];
    if (group >= 0x20 && group <= 0x80 && reg < group + 0x16 && slot >= 0) {
      const s = slots[slot];
      if (group === 0x20) Object.assign(s, { am: value >> 7, vib: (value >> 6) & 1, egt: (value >> 5) & 1, ksr: (value >> 4) & 1, mult: value & 15 });
      else if (group === 0x40) Object.assign(s, { ksl: value >> 6, tl: value & 63 });
      else if (group === 0x60) Object.assign(s, { ar: value >> 4, dr: value & 15 });
      else if (group === 0x80) Object.assign(s, { sl: value >> 4, rr: value & 15 });
    } else if (reg >= 0xe0 && reg <= 0xf5 && SLOT_OF_OFFSET[reg - 0xe0] >= 0) slots[SLOT_OF_OFFSET[reg - 0xe0]].ws = value & 3;
    else if (reg >= 0xa0 && reg <= 0xa8) ch[reg - 0xa0].fnum = (ch[reg - 0xa0].fnum & 0x300) | value;
    else if (reg >= 0xb0 && reg <= 0xb8) {
      const c = ch[reg - 0xb0]; c.fnum = (c.fnum & 0xff) | (value & 3) << 8; c.block = (value >> 2) & 7;
      const on = (value >> 5) & 1; const [m, k] = CHANNEL_SLOTS[reg - 0xb0];
      if (on && !c.key) { keyOn(slots[m]); keyOn(slots[k]); } else if (!on && c.key) { keyOff(slots[m]); keyOff(slots[k]); }
      c.key = on;
    } else if (reg >= 0xc0 && reg <= 0xc8) { ch[reg - 0xc0].fb = (value >> 1) & 7; ch[reg - 0xc0].cnt = value & 1; }
    else if (reg === 0xbd) rhythmKeys(value);
  }

  function envelope(s, c, tremolo) {
    const keyRate = (c.block << 1) | (c.fnum >> 9), rof = s.ksr ? keyRate : keyRate >> 2;
    const rate = r => r ? Math.min(63, 4 * r + rof) : 0;
    switch (s.stage) {
      case 'attack': s.env -= (s.env + 1) * attackPerSample(rate(s.ar)); if (s.env <= 0) { s.env = 0; s.stage = 'decay'; } break;
      case 'decay': { const sustain = s.sl === 15 ? 496 : s.sl * 16; s.env += decayPerSample(rate(s.dr)); if (s.env >= sustain) { s.env = sustain; s.stage = 'sustain'; } break; }
      case 'sustain': if (!s.egt) s.env += decayPerSample(rate(s.rr)); break;
      case 'release': s.env += decayPerSample(rate(s.rr)); break;
    }
    if (s.env >= MAX_ATTENUATION) { s.env = MAX_ATTENUATION; if (s.stage === 'release' || s.stage === 'sustain') s.stage = s.stage === 'release' ? 'off' : s.stage; }
    const ksl = s.ksl ? Math.max(0, KSL_DB[c.fnum >> 6] - 3 * (7 - c.block)) * KSL_SCALE[s.ksl] / STEP_DB : 0;
    return Math.min(2047, Math.round(s.env + s.tl * 4 + ksl + (s.am ? tremolo : 0)));
  }
  function operator(s, c, phaseOffset, tremolo, vibrato) {
    const fnum = s.vib ? Math.max(0, c.fnum + vibrato * (c.fnum >> 7) * ((regs[0xbd] & 0x40) ? 1 : 0.5)) : c.fnum;
    s.phase = (s.phase + (fnum * (1 << c.block) * MULTIPLE[s.mult]) / 2) % (1 << 20);
    const attenuation = envelope(s, c, tremolo);
    if (s.stage === 'off') return 0;
    let index = (Math.floor(s.phase / 1024) + phaseOffset) & 1023, value = SINE[index];
    if (waveformEnabled()) {
      if (s.ws === 1 && value < 0) value = 0;
      else if (s.ws === 2) value = Math.abs(value);
      else if (s.ws === 3) value = (index & 0x100) ? 0 : Math.abs(value);
    }
    return value * LINEAR[attenuation] * 4095;
  }

  // Renders `count` samples (mono, roughly -1..1) into `target` from `offset`.
  function render(target, offset, count) {
    for (let i = 0; i < count; i++) {
      counter++;
      const tremoloDepth = (regs[0xbd] & 0x80) ? 26 : 6; // 4.8 dB or 1 dB, triangle at 3.7 Hz
      const tri = (counter % 13432) / 13432, tremolo = Math.round((tri < 0.5 ? tri * 2 : 2 - tri * 2) * tremoloDepth);
      const vibrato = VIBRATO[(counter >> 10) & 7];
      noise = (noise >> 1) | (((noise ^ (noise >> 14)) & 1) << 22);
      let mix = 0;
      const rhythm = regs[0xbd] & 0x20;
      for (let n = 0; n < 9; n++) {
        const c = ch[n], [m, k] = CHANNEL_SLOTS[n], mod = slots[m], car = slots[k];
        if (rhythm && n >= 6) continue;
        const feedback = c.fb ? (mod.out + mod.prev) / 2 ** (9 - c.fb) : 0; // phase units: 1024 per cycle
        const modOut = operator(mod, c, Math.floor(feedback), tremolo, vibrato); mod.prev = mod.out; mod.out = modOut;
        const carOut = operator(car, c, c.cnt ? 0 : Math.floor(modOut), tremolo, vibrato);
        mix += c.cnt ? modOut + carOut : carOut;
      }
      if (rhythm) mix += rhythmOutput(tremolo, vibrato);
      target[offset + i] = mix / (4095 * 6);
    }
  }
  // Rhythm mode: bass drum is channel 6 as a two-operator voice at double output; the snare, hi-hat, tom and cymbal
  // are single operators of channels 7 and 8 with noise (simplified).
  function rhythmOutput(tremolo, vibrato) {
    const c6 = ch[6], c7 = ch[7], c8 = ch[8];
    const bdMod = operator(slots[12], c6, 0, tremolo, vibrato), bd = operator(slots[15], c6, c6.cnt ? 0 : Math.floor(bdMod), tremolo, vibrato);
    const hh = operator(slots[13], c7, (noise & 1) ? 256 : 0, tremolo, vibrato);
    const sd = operator(slots[16], c7, (noise & 2) ? 512 : 0, tremolo, vibrato);
    const tom = operator(slots[14], c8, 0, tremolo, vibrato);
    const cym = operator(slots[17], c8, (noise & 4) ? 384 : 0, tremolo, vibrato);
    return 2 * bd + hh + sd + tom + cym;
  }
  return { write, render, regs };
}
