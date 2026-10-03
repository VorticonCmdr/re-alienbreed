// Alien Breed's size-prefixed adaptive LZHUF stream. See docs/lzhuf.md.
export function decompressLzhuf(data) {
  if (data.length < 4) throw new Error('Missing LZHUF length header');
  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
  if (!size || size > 8 * 1024 * 1024) throw new Error('Invalid decoded size');
  const N = 4096, F = 60, NC = 314, T = 627, R = 626;
  const freq = new Uint32Array(T + 1), son = new Uint32Array(T), parent = new Uint32Array(T + NC);
  for (let i = 0; i < NC; i++) { freq[i] = 1; son[i] = i + T; parent[i + T] = i; }
  for (let i = 0, j = NC; j < T; i += 2, j++) {
    freq[j] = freq[i] + freq[i + 1]; son[j] = i; parent[i] = parent[i + 1] = j;
  }
  freq[T] = 65535;
  const lengths = [3, ...Array(3).fill(4), ...Array(8).fill(5), ...Array(12).fill(6), ...Array(24).fill(7), ...Array(16).fill(8)];
  const codes = [0, 32, 48, 64, 80, 88, 96, 104, 112, 120, 128, 136, 144, 148, 152, 156, 160, 164, 168, 172, 176, 180, 184, 188,
    ...Array.from({ length: 24 }, (_, i) => 192 + i * 2), ...Array.from({ length: 16 }, (_, i) => 240 + i)];
  const positionCode = new Uint8Array(256), positionLength = new Uint8Array(256);
  codes.forEach((code, i) => {
    for (let q = code; q < code + (1 << (8 - lengths[i])); q++) { positionCode[q] = i; positionLength[q] = lengths[i]; }
  });
  let bitPosition = 32;
  function bits(count) {
    let value = 0;
    while (count--) {
      if (bitPosition >= data.length * 8) throw new Error('Truncated LZHUF stream');
      value = (value << 1) | ((data[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1); bitPosition++;
    }
    return value;
  }
  function rebuild() {
    let j = 0;
    for (let i = 0; i < T; i++) if (son[i] >= T) { freq[j] = (freq[i] + 1) >> 1; son[j++] = son[i]; }
    for (let i = 0, node = NC; node < T; i += 2, node++) {
      const total = freq[i] + freq[i + 1]; let k = node - 1;
      while (k >= 0 && total < freq[k]) k--;
      k++;
      for (let m = node; m > k; m--) { freq[m] = freq[m - 1]; son[m] = son[m - 1]; }
      freq[k] = total; son[k] = i;
    }
    for (let i = 0; i < T; i++) { parent[son[i]] = i; if (son[i] < T) parent[son[i] + 1] = i; }
  }
  function update(symbol) {
    if (freq[R] === 0x8000) rebuild();
    let c = parent[symbol + T];
    do {
      const value = ++freq[c]; let l = c + 1;
      if (value > freq[l]) {
        while (value > freq[++l]) { /* Find the last smaller node. */ }
        l--; freq[c] = freq[l]; freq[l] = value;
        const a = son[c], b = son[l];
        parent[a] = l; if (a < T) parent[a + 1] = l;
        parent[b] = c; if (b < T) parent[b + 1] = c;
        son[l] = a; son[c] = b; c = l;
      }
      c = parent[c];
    } while (c !== 0);
  }
  const ring = new Uint8Array(N), output = new Uint8Array(size); ring.fill(32, 0, N - F);
  let cursor = N - F, written = 0;
  while (written < size) {
    let symbol = son[R];
    while (symbol < T) symbol = son[symbol + bits(1)];
    symbol -= T; update(symbol);
    if (symbol < 256) {
      output[written++] = symbol; ring[cursor] = symbol; cursor = (cursor + 1) & (N - 1);
    } else {
      let q = bits(8); const high = positionCode[q] << 6, extra = positionLength[q] - 2;
      for (let i = 0; i < extra; i++) q = (q << 1) | bits(1);
      const start = (cursor - (high | (q & 63)) - 1) & (N - 1), length = symbol - 253;
      if (written + length > size) throw new Error('LZHUF match exceeds declared size');
      for (let i = 0; i < length; i++) {
        const value = ring[(start + i) & (N - 1)]; output[written++] = value;
        ring[cursor] = value; cursor = (cursor + 1) & (N - 1);
      }
    }
  }
  return output;
}
