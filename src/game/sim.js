// Game simulation, independent of the DOM and of wall-clock time. One step() is one original game frame.
// Addresses in comments are Ghidra addresses; evidence and remaining uncertainty: docs/port/evidence.md.
import { MAP_WIDTH, MAP_CELLS } from './level.js';

const CODE = 0x1000, DATA = 0x2041;
export class UnsupportedPath extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'UnsupportedPath'; this.detail = detail; }
}

// Tables read from the user's executable at runtime.
export function readTables(exe) {
  const lists = new Map();
  return {
    moveSteps: Array.from({ length: 32 }, (_, i) => exe.u16(CODE, 0x7b4a + 2 * i)), // cs:7B4A, [lag * 16 + speed]
    animBase: Array.from({ length: 16 }, (_, i) => exe.u16(CODE, 0x6545 + 2 * i)),  // cs:6545, per 4-bit direction
    animList(offset) { // DS word lists for the tile animation ticker 1000:8606
      if (!lists.has(offset)) {
        const words = [];
        for (let i = 0; i < 512; i++) { const w = exe.u16(DATA, offset + 2 * i); words.push(w); if (w >= 0xfffe) break; }
        if (words.at(-1) < 0xfffe) throw new Error(`Animation list ${offset.toString(16)} has no terminator`);
        lists.set(offset, words);
      }
      return lists.get(offset);
    },
  };
}

const s16 = v => (v << 16) >> 16, u16 = v => v & 0xffff;
export const INPUT = { RIGHT: 1, LEFT: 2, DOWN: 4, UP: 8, FIRE: 0x10, ACTION: 0x20 };

// Cell index for a world point, as 1000:3C80/3C08 compute it (world = map pixel + 16). The original reads unrelated
// memory for points left of or above the map and past its last cell; those paths are reported, not imitated.
export function cellAt(state, x, y) {
  const px = x - 16, py = y - 16;
  if (px < 0 || py < 0 || px > 4095 || py > 4095) throw new UnsupportedPath(`Probe outside the map tables at (${x}, ${y})`, { x, y });
  const index = (py >> 4) * MAP_WIDTH + (px >> 4); // column offsets past 119 run into the next row, as in the original
  if (index >= MAP_CELLS) throw new UnsupportedPath(`Probe past the last map cell at (${x}, ${y})`, { x, y });
  return index;
}

const WALLS = new Set([0x01, 0x45, 0x03, 0x15, 0x2a, 0x2b, 0x2c, 0x2d]);
// 1000:3C80: returns true when blocked. Sets state.probeCode like [AF81].
function wallTest(state, x, y, ownCell, alien = false) {
  const index = cellAt(state, x, y), word = state.types[index], code = word & 0xff;
  state.probeCode = code; state.probeIndex = index;
  if (WALLS.has(code) || (alien && code === 0x0d)) return true;
  return (word & 0x8000) !== 0 && index !== ownCell;
}

// Codes the per-probe handler 1000:61BB acts on but this port does not implement yet. Any other code has no effect there.
const UNSUPPORTED_PROBE_CODES = new Set([0x45, 0x44, 0x40, 0x64, 0x46, 0x15, 0x14]);
const PICKUPS = {
  0x04: { sound: 3, tile: 0x07a, anim: 0x8a9a, animOn1415: false, apply: p => { p.keys = u16(p.keys + 1); } },
  0x05: { sound: 3, tile: 0x155, anim: 0x8ae6, animOn1415: true, apply: (p, s) => { p.energy = u16(p.energy + 0x20); if (s16(p.energy) > 0x40) p.energy = 0x40; s.sounds.push(3); } },
  0x07: { sound: 3, tile: 0x154, anim: 0x8a74, animOn1415: true, apply: p => { p.lives = (p.lives + 1) & 0xff; } },
  0x06: { sound: 5, tile: 0x157, anim: 0x8ac0, animOn1415: false, apply: p => { p.ammo = u16(p.ammo + 0x100); } },
  0x0b: { sound: 3, tile: 0x169, anim: 0x8b0c, animOn1415: false, apply: (p, s) => addCredits(s, p, 0x100, 0x50) },
  0x0c: { sound: 3, tile: 0x17d, anim: 0x8b32, animOn1415: false, apply: (p, s) => addCredits(s, p, 0x1000, 0x500) },
};

// Packed BCD credits (+5E..+61), added like 1000:5FDC. Static reading only; the overflow past 8 digits is unverified.
export function addBcd(value, amount) {
  let result = 0, carry = 0;
  for (let shift = 0; shift < 32; shift += 4) {
    let digit = ((value >>> shift) & 15) + ((amount >>> shift) & 15) + carry;
    carry = digit > 9 ? 1 : 0; if (carry) digit -= 10;
    result |= digit << shift;
  }
  return result >>> 0;
}
function addCredits(state, player, single, shared) {
  if (state.playerCount === 1 || !state.shareCredits) player.credits = addBcd(player.credits, single);
  else for (const p of state.players) p.credits = addBcd(p.credits, shared);
}

// 1000:61BB for the code found by the last wall test at world point (x, y).
function probeEffects(state, player, x, y) {
  const code = state.probeCode, pickup = PICKUPS[code];
  if (pickup) {
    state.sounds.push(pickup.sound); pickup.apply(player, state);
    if (pickup.animOn1415 || (state.level !== 14 && state.level !== 15)) startAnimation(state, pickup.anim, state.probeIndex);
    writeCell(state, state.probeIndex, pickup.tile, 0);
  } else if (code === 0x17) player.onIntex = 0xffff;
  else if (code === 0x2f) { player.conveyor |= 2; state.skipSafe = true; }
  else if (code === 0x27) { player.conveyor |= 1; state.skipSafe = true; }
  else if (code === 0x3f) { player.conveyor |= 8; state.skipSafe = true; }
  else if (code === 0x37) { player.conveyor |= 4; state.skipSafe = true; }
  else if (code === 0x02) exitTouched(state);
  else if (code === 0x0a && (state.level === 16 || state.level === 17)) unsupported(state, 'Level 16/17 objective cell 0x0A');
  else if (UNSUPPORTED_PROBE_CODES.has(code) && !(code === 0x45 && s16(state.burning) <= 0)) unsupported(state, `Cell effect 0x${code.toString(16)} at (${x}, ${y})`);
}

// 1000:6286: the exit only counts on some levels or once the self-destruct or boss has started.
function exitTouched(state) {
  const l = state.level;
  if ([1, 11, 15, 16, 4, 7, 9, 10].includes(l) || (l === 3 && state.lasersHit >= 3) || state.bossActive || state.selfDestruct) unsupported(state, 'Level exit');
}

function unsupported(state, message) {
  state.diagnostics.push({ frame: state.frame, message });
  if (state.strict) throw new UnsupportedPath(message, { frame: state.frame });
}

// 1000:6566: replaces the tile and the whole type word (clearing occupancy).
function writeCell(state, index, tile, type) { state.tiles[index] = tile; state.types[index] = type; }

// 1000:86A9 / 8606: 80 slots, one list word per game frame.
function startAnimation(state, offset, cell) {
  const slot = state.animations.findIndex(a => !a);
  if (slot < 0) unsupported(state, 'All 80 tile animation slots are busy');
  else state.animations[slot] = { cell, list: state.tables.animList(offset), position: 0 };
}
export function tickAnimations(state) {
  for (let i = 0; i < state.animations.length; i++) {
    const a = state.animations[i]; if (!a) continue;
    let word = a.list[a.position++];
    if (word === 0xffff) { state.animations[i] = null; continue; }
    if (word === 0xfffe) { a.position = 0; word = a.list[a.position++]; }
    state.tiles[a.cell] = word;
  }
}

// 1000:5F03: steps only while the pre-step position is inside the screen limits; both directions may apply.
function moveClamped(state, player, step, bits) {
  const cx = state.camera.x, cy = state.camera.y, x = player.x, y = player.y;
  if (s16(cx + 0x130) >= x && bits & 1) player.x = s16(player.x + step);
  if (s16(cx + 0x10) <= x && bits & 2) player.x = s16(player.x - step);
  if (s16(cy + 0xb0) >= y && bits & 4) player.y = s16(player.y + step);
  if (s16(cy + 0x20) <= y && bits & 8) player.y = s16(player.y - step);
}

// Player update 1000:5B44 up to the end of the corner probes (5DAA). The remainder is updateCentre().
export function updatePlayer(state, player, input) {
  if (player.state === 2) return;
  state.firing = false;
  openDoors(state, player);
  if (input & INPUT.FIRE) unsupported(state, 'Firing');
  else player.fireRepeat = 0;
  if (input & INPUT.ACTION && s16(player.onIntex) === -1) unsupported(state, 'Intex terminal');
  const direction = input & 15, base = state.tables.animBase[direction];
  if (base !== 0xffff) { player.animBase = base; player.facing = direction; }
  if (player.hurt) { player.hurt = false; player.frame = player.animBase + 4; }
  else if (state.firing) player.frame = player.animBase + 3;
  else { let phase = (player.walk & 15) >> 2; if (phase === 3) phase = 1; player.frame = player.animBase + phase; }
  if (player.invulnerable) { player.invulnerable--; if (player.invulnerable & 1) player.frame = 0xf0; }
  player.oldX = player.x; player.oldY = player.y;
  state.movedDirections = direction;
  if (direction) player.walk = u16(player.walk + 1);
  moveClamped(state, player, state.tables.moveSteps[state.lag * 16 + 3], input & player.moveMask);
  moveClamped(state, player, 1, player.conveyor & player.moveMask);
  player.conveyor = 0; player.moveMask = 15; player.onIntex = 0; state.skipSafe = false;
  const own = player.cell;
  for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
    const x = player.x + dx, y = player.oldY + dy;
    const blocked = wallTest(state, x, y, own); probeEffects(state, player, x, y);
    if (blocked) player.x = player.oldX;
  }
  for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
    const x = player.oldX + dx, y = player.y + dy;
    const blocked = wallTest(state, x, y, own); probeEffects(state, player, x, y);
    if (blocked) player.y = player.oldY;
  }
  updateCentre(state, player);
}

// Filled in from the exact reading of 1000:4776 and 1000:5DAA-end; until then these paths are reported.
function openDoors(state, player) { if (state.doors.some(d => d.kind) && player.keys > 0) state.pendingDoorCheck = true; }
function updateCentre(state, player) { state.pendingCentre = true; }
