import { MAP_WIDTH, MAP_HEIGHT, MAP_CELLS, decodeMap } from '../game/level.js';
export const FORMAT = 'alien-breed-map-v1';
export function unpack(bytes, level) {
  const map = decodeMap(bytes);
  return { format: FORMAT, level, width: MAP_WIDTH, height: MAP_HEIGHT, tiles: [...map.tiles], types: [...map.types], reserved: Array.from({length: MAP_CELLS}, (_, i) => (bytes[i * 2] >> 1) & 1), extra: [...map.extra] };
}
export function validate(value) {
  if (!value || value.format !== FORMAT || value.width !== MAP_WIDTH || value.height !== MAP_HEIGHT || !Number.isInteger(value.level) || value.level < 0 || value.level > 18) throw new Error('Not a supported Alien Breed editor map.');
  for (const [key, length, max] of [['tiles', MAP_CELLS, 511], ['types', MAP_CELLS, 63], ['reserved', MAP_CELLS, 1], ['extra', null, 255]]) {
    const a = value[key];
    if (!Array.isArray(a) || (length !== null && a.length !== length) || a.length > 1000000 || !a.every(v => Number.isInteger(v) && v >= 0 && v <= max)) throw new Error(`Invalid ${key} data.`);
  }
  return value;
}
export function pack(map) {
  validate(map); const bytes = new Uint8Array(MAP_CELLS * 2 + map.extra.length);
  for (let i = 0; i < MAP_CELLS; i++) { const word = map.tiles[i] | (map.reserved[i] << 9) | (map.types[i] << 10); bytes[i * 2] = word >> 8; bytes[i * 2 + 1] = word & 255; }
  bytes.set(map.extra, MAP_CELLS * 2); return bytes;
}
export function floodIndices(values, start) {
  const seen = new Uint8Array(MAP_CELLS), queue = [start], value = values[start]; seen[start] = 1;
  for (let q = 0; q < queue.length; q++) { const i = queue[q], x = i % MAP_WIDTH, y = i / MAP_WIDTH | 0;
    for (const n of [x > 0 ? i - 1 : -1, x < MAP_WIDTH - 1 ? i + 1 : -1, y > 0 ? i - MAP_WIDTH : -1, y < MAP_HEIGHT - 1 ? i + MAP_WIDTH : -1]) if (n >= 0 && !seen[n] && values[n] === value) { seen[n] = 1; queue.push(n); }
  } return queue;
}
