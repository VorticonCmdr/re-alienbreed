// Native Web Audio preview instruments. These are not DOS hardware emulators.
export class AssetPlayer {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate; this.context = null; this.nodes = new Set();
    this.asset = null; this.offset = 0; this.playing = false; this.volume = 0.35; this.generation = 0;
  }
  load(asset) { this.stop(); this.asset = asset; this.emit(); }
  get duration() { return this.asset?.sound?.duration || this.asset?.music?.duration || 0; }
  get position() { return this.playing ? Math.min(this.duration, this.offset + this.context.currentTime - this.startedAt) : this.offset; }
  emit() { this.onUpdate({ playing: this.playing, position: this.position, duration: this.duration }); }
  setVolume(value) { this.volume = value; if (this.master) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.01); }
  async play() {
    if (!this.asset || this.playing || !this.duration) return;
    const selected = this.asset, generation = this.generation;
    if (!this.context) {
      this.context = new AudioContext(); this.master = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor(); this.master.connect(compressor); compressor.connect(this.context.destination);
      this.master.gain.value = this.volume;
    }
    await this.context.resume();
    if (this.asset !== selected || this.playing || generation !== this.generation) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.startedAt = this.context.currentTime; this.playing = true;
    if (selected.sound) {
      const { samples, sampleRate } = selected.sound;
      const buffer = this.context.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0);
      const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.master);
      this.track(source, [source]); source.start(this.startedAt, this.offset);
    } else {
      this.noteCursor = 0; this.schedule();
    }
    this.timer = setInterval(() => {
      if (this.position >= this.duration) { this.halt(); this.offset = this.duration; this.emit(); return; }
      if (this.asset.music) this.schedule(); this.emit();
    }, 40);
    this.emit();
  }
  halt() {
    clearInterval(this.timer); this.playing = false; this.generation++;
    for (const source of [...this.nodes]) { try { source.stop(); } catch { /* Already ended. */ } }
    this.nodes.clear();
  }
  pause() { const position = this.position; this.halt(); this.offset = position; this.emit(); }
  stop() { this.halt(); this.offset = 0; this.emit(); }
  async seek(position) {
    const resume = this.playing; this.halt(); this.offset = Math.max(0, Math.min(this.duration, position)); this.emit();
    if (resume && this.offset < this.duration) await this.play();
  }
  track(source, connected) {
    this.nodes.add(source);
    source.onended = () => { this.nodes.delete(source); connected.forEach(node => node.disconnect()); };
  }
  schedule() {
    const { notes } = this.asset.music, position = this.position;
    while (this.noteCursor < notes.length && notes[this.noteCursor].time <= position + 0.18) {
      const note = notes[this.noteCursor++];
      if (note.time + note.duration <= this.offset) continue;
      const begin = Math.max(note.time, this.offset), when = Math.max(this.context.currentTime, this.startedAt + begin - this.offset);
      this.voice(note, when, Math.max(0.015, note.time + note.duration - begin));
    }
  }
  voice(note, when, duration) {
    const ctx = this.context, music = this.asset.music, gain = ctx.createGain(), pan = ctx.createStereoPanner();
    gain.connect(pan); pan.pan.value = Math.max(-1, Math.min(1, note.pan)); pan.connect(this.master);
    const frequency = 440 * 2 ** ((note.midi - 69 + note.bend) / 12);
    const level = 0.085 * note.velocity * note.volume * note.expression;
    let attack = 0.006, decay = 0.12, sustain = 0.65, release = 0.06;
    const connections = [gain, pan], sources = [];
    const drum = (music.ext === 'rol' && note.channel === 9) || (music.ext === 'cmf' && note.channel >= 11);
    if (drum) {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const data = this.noise.getChannelData(0); let seed = 17;
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
      }
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(); source.buffer = this.noise; source.loop = true;
      filter.type = 'bandpass'; filter.frequency.value = Math.min(10000, 150 + frequency * 5); filter.Q.value = 0.7;
      source.connect(filter); filter.connect(gain); sources.push(source); connections.push(filter); sustain = 0.01; decay = 0.09;
    } else {
      const carrier = ctx.createOscillator(); carrier.frequency.value = Math.min(frequency, ctx.sampleRate / 3); sources.push(carrier);
      if (music.ext === 'cmf') {
        const patch = music.patches[note.program % music.patches.length];
        const ratios = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
        carrier.frequency.value = Math.min(frequency * ratios[patch[1] & 15], ctx.sampleRate / 3);
        this.oplWave(carrier, patch[9] & 3);
        const modulator = ctx.createOscillator(), depth = ctx.createGain(); this.oplWave(modulator, patch[8] & 3);
        modulator.frequency.value = Math.min(frequency * ratios[patch[0] & 15], ctx.sampleRate / 3);
        depth.gain.value = (patch[10] & 1 ? 0.035 : frequency * 3) * 10 ** (-(patch[2] & 63) * 0.75 / 20);
        modulator.connect(depth); depth.connect(patch[10] & 1 ? gain : carrier.frequency);
        sources.push(modulator); connections.push(depth);
        attack = 0.002 + (15 - (patch[5] >> 4)) ** 2 * 0.002;
        decay = 0.015 + (15 - (patch[5] & 15)) ** 2 * 0.008;
        sustain = 10 ** (-(patch[7] >> 4) * 3 / 20);
        release = 0.025 + (15 - (patch[7] & 15)) ** 2 * 0.004;
        carrier.connect(gain);
      } else { carrier.type = music.ext === 'bep' ? 'square' : ['triangle', 'sine', 'sawtooth', 'square'][note.program % 4]; carrier.connect(gain); }
    }
    const patchLevel = music.ext === 'cmf' ? 10 ** (-(music.patches[note.program % music.patches.length][3] & 63) * 0.75 / 20) : 1;
    const peak = Math.max(0.00001, level * patchLevel), attackEnd = when + Math.min(attack, duration / 3), decayEnd = Math.min(attackEnd + decay, when + duration);
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * sustain), decayEnd);
    gain.gain.setValueAtTime(Math.max(0.00001, peak * sustain), when + duration);
    gain.gain.exponentialRampToValueAtTime(0.00001, when + duration + release);
    // Disconnect the whole voice after the carrier ends; also track modulators for cancellation.
    sources.forEach((source, i) => { this.track(source, i === 0 ? [...connections, ...sources] : [source]); source.start(when); source.stop(when + duration + release + 0.01); });
  }
  oplWave(oscillator, shape) {
    if (!shape) { oscillator.type = 'sine'; return; }
    // Fourier approximation of the four OPL2 waveform shapes.
    const real = new Float32Array(33), imaginary = new Float32Array(33);
    for (let k = 1; k < 33; k++) {
      for (let j = 0; j < 128; j++) {
        const phase = 2 * Math.PI * j / 128, sine = Math.sin(phase);
        const value = shape === 1 ? Math.max(0, sine) : shape === 2 ? Math.abs(sine) : (phase < Math.PI / 2 ? sine : 0);
        real[k] += value * Math.cos(k * phase) * 2 / 128; imaginary[k] += value * Math.sin(k * phase) * 2 / 128;
      }
    }
    oscillator.setPeriodicWave(this.context.createPeriodicWave(real, imaginary));
  }
}

export function wavFile(sound) {
  const buffer = new ArrayBuffer(44 + sound.samples.length * 2), view = new DataView(buffer);
  function text(offset, value) { [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0))); }
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  const rate = Math.round(sound.sampleRate); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, sound.samples.length * 2, true);
  sound.samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true));
  return new Blob([buffer], { type: 'audio/wav' });
}
