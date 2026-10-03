import { decompressLzhuf } from './lzhuf.js';

export const extension = path => path.split('/').pop().split('.').slice(1).pop()?.toLowerCase() || '';
export function category(path) {
  const ext = extension(path);
  if (['256', 'vhf', 'ehf'].includes(ext)) return 'images';
  if (ext === 'voc') return 'sounds';
  if (['bep', 'rol', 'cmf'].includes(ext)) return 'music';
  if (ext === 'huf') return 'maps';
  return 'other';
}
export const grayscale = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
const ascii = bytes => new TextDecoder('windows-1252').decode(bytes);
function check(condition, message) { if (!condition) throw new Error(message); }

export function decodeVga(bytes) {
  check(bytes.length === 64768, 'Expected a 320 × 200 VGA image with a 256-color palette');
  return { width: 320, height: 200, pixels: bytes.slice(0, 64000), palette: bytes.slice(64000).map(v => Math.round(v * 255 / 63)) };
}
export function decodePlanar(bytes) {
  check(bytes.length === 32000, 'Expected four 8,000-byte image planes');
  const pixels = new Uint8Array(64000);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
    let value = 0;
    for (let plane = 0; plane < 4; plane++) value |= ((bytes[plane * 8000 + y * 40 + (x >> 3)] >> (7 - (x & 7))) & 1) << plane;
    pixels[y * 320 + x] = value;
  }
  return { width: 320, height: 200, pixels, palette: null };
}
export function rgba(image, palette = image.palette || grayscale, transparent = false) {
  const result = new Uint8ClampedArray(image.pixels.length * 4);
  image.pixels.forEach((index, i) => {
    result[i * 4] = palette[index * 3]; result[i * 4 + 1] = palette[index * 3 + 1];
    result[i * 4 + 2] = palette[index * 3 + 2]; result[i * 4 + 3] = transparent && index === 0 ? 0 : 255;
  });
  return result;
}

export function decodeVoc(bytes) {
  check(bytes.length >= 26 && ascii(bytes.slice(0, 20)) === 'Creative Voice File\x1a', 'Invalid VOC header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), version = view.getUint16(22, true);
  check(view.getUint16(24, true) === ((~version + 0x1234) & 65535), 'Invalid VOC version checksum');
  let position = view.getUint16(20, true), sampleRate = 0, terminated = false;
  check(position >= 26 && position < bytes.length, 'Invalid VOC block offset');
  const segments = [];
  while (position < bytes.length) {
    const type = bytes[position++]; if (type === 0) { terminated = true; break; }
    check(position + 3 <= bytes.length, 'Truncated VOC block header');
    const length = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16); position += 3;
    check(position + length <= bytes.length, 'Truncated VOC block');
    const block = bytes.subarray(position, position + length); position += length;
    if (type === 1) {
      check(length >= 2 && block[1] === 0, 'Only unsigned 8-bit PCM VOC samples are supported');
      const rate = 1000000 / (256 - block[0]);
      check(!sampleRate || Math.abs(sampleRate - rate) < 0.01, 'VOC sample-rate changes are unsupported');
      sampleRate = rate; segments.push(block.slice(2));
    } else if (type === 2) { check(sampleRate > 0, 'VOC continuation without a sample block'); segments.push(block.slice()); }
    else if (![4, 5].includes(type)) throw new Error(`Unsupported VOC block type ${type}`);
  }
  check(terminated && sampleRate && segments.length, 'VOC has no terminated PCM data');
  const count = segments.reduce((sum, part) => sum + part.length, 0), samples = new Float32Array(count);
  let cursor = 0;
  for (const part of segments) for (const value of part) samples[cursor++] = (value - 128) / 128;
  return { samples, sampleRate, duration: count / sampleRate };
}

// Bounds-checked SMF/CMF event reader, including running status and VLQ deltas.
function readEvents(bytes, track = 0) {
  let position = 0, tick = 0, running = 0, order = 0;
  const events = [];
  function byte() { check(position < bytes.length, 'Truncated music event'); return bytes[position++]; }
  function vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) { const b = byte(); value = value * 128 + (b & 127); if (!(b & 128)) return value; }
    throw new Error('Music delta exceeds four bytes');
  }
  function payload(size) { check(position + size <= bytes.length, 'Truncated music payload'); const b = bytes.slice(position, position + size); position += size; return b; }
  while (position < bytes.length) {
    tick += vlq(); let status = byte();
    if (status < 128) { check(running, 'Missing MIDI running status'); position--; status = running; }
    const common = { tick, track, order: order++ };
    if (status === 255) {
      const type = byte(), data = payload(vlq());
      if (type === 81) { check(data.length === 3, 'Invalid MIDI tempo'); const tempo = data[0] * 65536 + data[1] * 256 + data[2]; check(tempo > 0, 'Zero MIDI tempo'); events.push({ ...common, kind: 'tempo', tempo }); }
      if (type === 47) { check(data.length === 0, 'Invalid end-of-track'); return { events, tick }; }
      // SMF running status is cancelled by meta and system-exclusive events.
      running = 0;
    } else if (status === 240 || status === 247) { payload(vlq()); running = 0; }
    else {
      check(status >= 128 && status < 240, `Unsupported music status 0x${status.toString(16)}`);
      running = status; const kind = status >> 4, channel = status & 15;
      const a = byte(), b = [12, 13].includes(kind) ? 0 : byte(); check(a < 128 && b < 128, 'Invalid MIDI data byte');
      events.push({ ...common, kind, channel, a, b });
    }
  }
  throw new Error('Music stream has no end-of-track marker');
}

export function decodeMusic(bytes, ext = 'rol') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), events = [];
  let ticksPerQuarter = 0, ticksPerSecond = 0, patches = [], trackCount = 0, endTick = 0;
  if (ascii(bytes.slice(0, 4)) === 'CTMF') {
    check(bytes.length >= 40 && view.getUint16(4, true) === 0x101, 'Expected CMF 1.1');
    const instrumentOffset = view.getUint16(6, true), musicOffset = view.getUint16(8, true), count = view.getUint16(36, true);
    ticksPerQuarter = view.getUint16(10, true); ticksPerSecond = view.getUint16(12, true);
    check(ticksPerSecond > 0 && count > 0 && instrumentOffset >= 40 && instrumentOffset + count * 16 <= musicOffset && musicOffset < bytes.length, 'Invalid CMF offsets or clock');
    patches = Array.from({ length: count }, (_, i) => bytes.slice(instrumentOffset + i * 16, instrumentOffset + (i + 1) * 16));
    const parsed = readEvents(bytes.subarray(musicOffset)); events.push(...parsed.events); endTick = parsed.tick; trackCount = 1;
  } else {
    check(bytes.length >= 14 && ascii(bytes.slice(0, 4)) === 'MThd', 'Invalid MIDI header');
    const headerLength = view.getUint32(4), format = view.getUint16(8); trackCount = view.getUint16(10); ticksPerQuarter = view.getUint16(12);
    check(headerLength >= 6 && headerLength + 8 <= bytes.length && format <= 1 && trackCount > 0 && ticksPerQuarter > 0 && !(ticksPerQuarter & 32768), 'Unsupported MIDI header, format, or SMPTE clock');
    let position = headerLength + 8;
    for (let track = 0; track < trackCount; track++) {
      check(position + 8 <= bytes.length && ascii(bytes.slice(position, position + 4)) === 'MTrk', 'Missing MIDI track');
      const length = view.getUint32(position + 4); position += 8; check(position + length <= bytes.length, 'Truncated MIDI track');
      const parsed = readEvents(bytes.subarray(position, position + length), track); events.push(...parsed.events); endTick = Math.max(endTick, parsed.tick); position += length;
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  let tick = 0, seconds = 0, tempo = 500000;
  for (const event of events) {
    seconds += (event.tick - tick) * (ticksPerSecond ? 1 / ticksPerSecond : tempo / (1000000 * ticksPerQuarter));
    tick = event.tick; event.time = seconds; if (event.kind === 'tempo' && !ticksPerSecond) tempo = event.tempo;
  }
  const duration = seconds + (endTick - tick) * (ticksPerSecond ? 1 / ticksPerSecond : tempo / (1000000 * ticksPerQuarter));
  const channels = Array.from({ length: 16 }, () => ({ program: 0, volume: 1, expression: 1, pan: 0, bend: 0, sustain: false }));
  const active = new Map(), notes = [], warnings = new Set();
  function finish(note, time) { note.duration = Math.max(0.015, time - note.time); }
  function releaseChannel(channel, time, force = false) {
    for (const [key, list] of active) {
      const keep = [];
      for (const note of list) if (note.channel === channel && (force || note.released)) finish(note, time); else keep.push(note);
      if (keep.length) active.set(key, keep); else active.delete(key);
    }
  }
  for (const event of events) {
    if (typeof event.kind !== 'number') continue;
    const state = channels[event.channel], key = `${event.channel}:${event.a}`;
    if (event.kind === 9 && event.b) {
      const note = { time: event.time, midi: event.a, velocity: event.b / 127, channel: event.channel, ...state, duration: 0 };
      notes.push(note); if (!active.has(key)) active.set(key, []); active.get(key).push(note);
    } else if (event.kind === 8 || (event.kind === 9 && !event.b)) {
      const list = active.get(key), note = list?.find(n => !n.released);
      if (note) { note.released = true; if (!state.sustain) { finish(note, event.time); list.splice(list.indexOf(note), 1); if (!list.length) active.delete(key); } }
    } else if (event.kind === 12) state.program = event.a;
    else if (event.kind === 14) { state.bend = ((event.b * 128 + event.a) - 8192) / 8192 * 2; warnings.add('Pitch changes during held notes are approximated'); }
    else if (event.kind === 11) {
      if (event.a === 7) state.volume = event.b / 127;
      else if (event.a === 11) state.expression = event.b / 127;
      else if (event.a === 10) state.pan = (event.b - 64) / 64;
      else if (event.a === 64) { state.sustain = event.b >= 64; if (!state.sustain) releaseChannel(event.channel, event.time); }
      else if ([120, 123].includes(event.a)) releaseChannel(event.channel, event.time, true);
      else if (event.a === 121) { Object.assign(state, { volume: 1, expression: 1, pan: 0, bend: 0, sustain: false }); releaseChannel(event.channel, event.time); }
      else if (ext === 'cmf' && event.a >= 102) warnings.add('CMF rhythm and custom controllers are approximated');
    }
  }
  for (const list of active.values()) for (const note of list) finish(note, duration);
  notes.sort((a, b) => a.time - b.time);
  // Some scores contain minutes of end-of-track padding after the final note.
  const audibleDuration = notes.reduce((end, note) => Math.max(end, note.time + note.duration), 0);
  return { notes, duration: audibleDuration, streamDuration: duration, patches, trackCount, ticksPerQuarter, ticksPerSecond, warnings: [...warnings], ext };
}

export function decodeAsset(path, bytes) {
  const ext = extension(path), kind = category(path), name = path.split('/').pop().toUpperCase();
  let decoded = bytes;
  if (['vhf', 'ehf', 'huf'].includes(ext) || ['AVM_DD.DAT', 'AVM_SB.DAT'].includes(name)) decoded = decompressLzhuf(bytes);
  const result = { path, ext, kind, raw: bytes, decoded };
  if (ext === '256' || ext === 'vhf') result.image = decodeVga(decoded);
  if (ext === 'ehf') result.image = decodePlanar(decoded);
  if (ext === 'voc') result.sound = decodeVoc(bytes);
  if (kind === 'music') result.music = decodeMusic(bytes, ext);
  if (['bat', 'ba1', 'me', 'doc', 'rst'].includes(ext)) result.text = ascii(bytes);
  return result;
}

export function hexDump(bytes, offset = 0, count = 512) {
  const lines = [];
  for (let p = offset; p < Math.min(bytes.length, offset + count); p += 16) {
    const row = bytes.slice(p, p + 16), hex = [...row].map(v => v.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const text = [...row].map(v => v >= 32 && v < 127 ? String.fromCharCode(v) : '.').join('');
    lines.push(`${p.toString(16).padStart(8, '0')}  ${hex}  ${text}`);
  }
  return lines.join('\n');
}
