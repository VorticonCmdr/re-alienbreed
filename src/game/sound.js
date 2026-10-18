// Digital sound effects as the Sound Blaster path plays them (1000:72B0 with device [AF94] = 4, then 1000:7300).
// One voice: a new effect starts when nothing plays, or when its priority is not below the playing one's.
const CODE = 0x1000, SAMPLES = 0x1c9c;

// The sample list loaded at startup (1C9C:0365): near pointers from 1C9C:0184 up to 0xFFFF. Sound id n plays sample n.
export function sampleNames(exe) {
  const names = [];
  for (let p = 0x184; exe.u16(SAMPLES, p) !== 0xffff; p += 2) names.push(exe.string(SAMPLES, exe.u16(SAMPLES, p)));
  return names;
}
// Signed priority per sound id (cs:7275).
export const samplePriorities = (exe, count) => Array.from({ length: count }, (_, i) => exe.s16(CODE, 0x7275 + 2 * i));

// 1000:7300. `playing` is the driver's status word [AFD0] (non-zero while a sample plays). Returns true when the
// sample starts (after stopping the current one). The priority is stored even when the sample is missing.
export function startEffect(channel, priority, playing) {
  if (!playing) channel.priority = 0;
  else if (channel.priority > priority) return false;
  channel.priority = priority;
  return true;
}

// Web Audio boundary: `buffers[id]` are decoded samples; ids come from the simulation's per-frame `sounds` list.
export function createEffectPlayer(context, destination, buffers, priorities) {
  const channel = { priority: 0 }; let source = null;
  return {
    played: [], // sample ids started, for the browser scenario
    play(id) {
      if (!startEffect(channel, priorities[id], source !== null)) return;
      this.stop(); if (!buffers[id]) return;
      const node = context.createBufferSource(); node.buffer = buffers[id]; node.connect(destination);
      node.onended = () => { if (source === node) source = null; };
      node.start(); source = node; if (this.played.push(id) > 64) this.played.shift();
    },
    // Started directly through the voice driver (function 6), as the game-over screen does: the stored priority stays.
    playBuffer(buffer) {
      this.stop(); const node = context.createBufferSource(); node.buffer = buffer; node.connect(destination);
      node.onended = () => { if (source === node) source = null; }; node.start(); source = node;
    },
    stop() { if (source) { source.onended = null; source.stop(); source = null; } },
  };
}
