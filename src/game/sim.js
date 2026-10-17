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

// 1000:4894: writes a whole type word (clearing occupancy); skipped within one cell of the top or left edge.
// Returns whether it wrote, because the original's AL only changes when it does.
function writeType(state, x, y, type) {
  if (s16(x - 16) < 16 || s16(y - 16) < 16) return false;
  state.types[cellAt(state, x, y)] = type; return true;
}
const worldCell = (state, x, y) => cellAt(state, x, y);

// 1000:4776, before every player update: each closed door whose box contains the player opens; keys are only
// checked once per frame, so one key can open several doors and the count can wrap to 0xFFFF (then unlimited).
function openDoors(state, player) {
  if (player.keys === 0 || state.doors.length === 0) return;
  for (const door of state.doors) {
    if (!door.kind) continue;
    const { x: dx, y: dy } = door, px = s16(player.x), py = s16(player.y);
    const vertical = door.kind === 1;
    const inside = vertical ? px >= dx - 16 && px <= dx + 32 && py >= dy && py <= dy + 32 : px >= dx && px <= dx + 32 && py >= dy - 16 && py <= dy + 32;
    if (!inside) continue;
    door.kind = 0;
    const second = vertical ? [dx, dy + 16] : [dx + 16, dy];
    writeType(state, dx, dy, 0); startAnimation(state, vertical ? 0x8b74 : 0x8b58, worldCell(state, dx, dy));
    writeType(state, ...second, 0); startAnimation(state, vertical ? 0x8b82 : 0x8b66, worldCell(state, ...second));
    player.keys = u16(player.keys - 1); state.sounds.push(1);
    player.doorsOpened = addBcd(player.doorsOpened, 1) & 0xffff; // +67 via DAA; the carry into +69 is overwritten later
  }
}

// 1000:5DAA to 5ED6: centre-cell effects, occupancy and the safe position.
function updateCentre(state, player) {
  const px = player.x, py = player.y;
  if (px - 16 < 0 || py - 16 < 0) { if (!state.skipSafe) { player.safeX = px; player.safeY = py; } return; }
  const cell = cellAt(state, px, py), code = state.types[cell] & 0xff;
  if (code === 0x16 && (state.frameCounter & 15) === 0) {
    // The original tests the byte at DS:[cell offset + 0x6B] (high byte of the type word 53 cells further on),
    // apparently meant as the player's +6B. Reproduced as read.
    if (cell + 0x35 >= MAP_CELLS) unsupported(state, 'Floor-damage test past the map');
    else if ((state.types[cell + 0x35] >> 8) === 0) { player.hurt = true; player.energy = u16(player.energy - 4); }
    state.sounds.push(0x10);
  }
  if (code === 0x47 && state.timer104 > 0x4c && state.timer104 < 0x54) { player.hurt = true; player.energy = 0; }
  const masks = { 0x0e: 0x0b, 0x0f: 0x0d, 0x10: 0x07, 0x11: 0x0e, 0x38: 0x09, 0x39: 0x05, 0x3a: 0x06, 0x3b: 0x0a };
  if (code in masks) { player.moveMask &= masks[code]; state.skipSafe = true; }
  if (code === 0x3d) state.objectiveTriggered = true;
  if (player.cell !== cell) {
    if (player.cell >= 0 && player.cell <= 0x2d00) state.types[player.cell] &= 0x7fff;
    if (cell <= 0x2d00) { state.types[cell] |= 0x8000; player.cell = cell; }
  }
  if (!state.skipSafe) { player.safeX = px; player.safeY = py; }
}

// Level start, 1000:1BB7 onwards. Scan points at world column/row 0 make the original read unrelated memory;
// they are skipped here (LBMZ's resulting start position matches the original, docs/port/evidence.md).
function* scanPoints() { for (let y = 16; y <= 0x5f0; y += 16) for (let x = 16; x <= 0x770; x += 16) yield [x, y]; }
// Tileset id per level, byte table cs:4021 in the executable.
export const levelTileset = (exe, level) => exe.u8(CODE, 0x4021 + level);

export function startLevel({ tables, map, level, tileset, demoMode = 0, strict = true, saved }) {
  const state = {
    tables, level, strict, demoMode, tiles: Uint16Array.from(map.tiles), types: Uint16Array.from(map.types),
    camera: { x: 0, y: 0 }, lag: 0, frame: 0, frameCounter: 0, timer60: 0, timer104: 0, burning: 0,
    animations: Array(79).fill(null), doors: [], sounds: [], diagnostics: [], playerCount: 1, shareCredits: false,
    lasersHit: 0, bossActive: false, selfDestruct: false, objectiveTriggered: false,
  };
  // Probes above the top row read unrelated memory in the original; a decision that depends on one is reported.
  const codeAt = (x, y) => {
    if (y - 16 < 0) { unsupported(state, `Level-start probe above the map at (${x}, ${y})`); return -1; }
    return state.types[cellAt(state, x, y)] & 0xff;
  };
  const find = code => { for (const [x, y] of scanPoints()) if (codeAt(x, y) === code) return { x, y }; return { x: 0x780, y: 0x600, missing: true }; };
  state.generators = [0x2a, 0x2b, 0x2c, 0x2d].map(find); state.objective = find(0x3d); state.marker33 = find(0x33);
  for (const [x, y] of scanPoints()) { // 1000:403A door list
    if (codeAt(x, y) !== 3 || (y - 16 >= 16 && codeAt(x, y - 16) === 3) || (x - 16 >= 16 && codeAt(x - 16, y) === 3)) continue;
    if (level === 0 && x < 0x3c0) continue;
    if (state.doors.length >= 0xc0) { unsupported(state, 'Door list overflow'); break; }
    state.doors.push({ x, y, kind: codeAt(x + 16, y) === 3 ? 2 : 1 });
  }
  convertDecor(state, tileset, codeAt);
  const start = find(0x35); // 1000:3BA6; the camera stays at 0 if there is no marker
  const camX = start.missing ? 0 : Math.max(0, s16(start.x - 0xa0)), camY = start.missing ? 0 : Math.max(0, s16(start.y - 0x58));
  state.camera = { x: camX, y: camY }; state.viewCamera = { ...state.camera };
  const stats = saved || { energy: 0x40, lives: 4, keys: 0, ammo: 0x17f, weapon: 1, owned: 0x7f, credits: 0, map: 0, doorsOpened: 0 };
  const player = {
    x: s16(camX + 0xb0), y: s16(camY + 0x68), frame: 0x0b, animBase: 0x0b, walk: 0, facing: 1, state: 1, height: 0,
    ...stats, fireRepeat: 0, conveyor: 0, moveMask: 15, onIntex: 0, hurt: false, invulnerable: 0, cell: -1,
  };
  player.oldX = player.safeX = player.x; player.oldY = player.safeY = player.y;
  if (player.x - 16 >= 0 && player.y - 16 >= 0) player.cell = cellAt(state, player.x, player.y); // no occupancy bit yet
  state.players = [player];
  state.spawnPoints = [[0x28, 1], [0x29, 2], [0x34, 3]].flatMap(([code, type]) => { // 1000:48D3
    const points = []; for (let y = 8; y <= 0x5f8; y += 16) for (let x = 8; x <= 0x778; x += 16) if (x >= 16 && y >= 16 && codeAt(x, y) === code) points.push({ x, y, type, cooldown: 0 });
    return points;
  }).slice(0, 0x80);
  return state;
}

// 1000:3D10 for the tileset of this level. `al` models the register the original keeps between tests.
function convertDecor(state, tileset, codeAt) {
  const anim = (list, x, y) => { startAnimation(state, list, cellAt(state, x, y)); return list & 0xff; };
  for (const [x, y] of scanPoints()) {
    let al = codeAt(x, y);
    if (al === 0x0f && tileset === 5) { if (codeAt(x, y - 16) !== 0x0f) { anim(0x838c, x, y - 16); anim(0x83de, x, y); } continue; }
    if ((al === 0x1c && tileset === 5) || al === 0x1f) { anim(0x81c4, x, y); anim(0x8236, x + 16, y); anim(0x82a8, x, y + 16); anim(0x831a, x + 16, y + 16); continue; }
    if (al === 0x1d) { if (tileset === 1) anim(0x8430, x, y); else if (tileset === 4) anim(0x8472, x, y); continue; }
    if (al === 0x1a && tileset === 1) { for (const [l, dx, dy] of [[0x872c, 1, 0], [0x87fe, 2, 0], [0x88d0, 1, 1], [0x89a2, 2, 1]]) { anim(l, x + dx * 16, y + dy * 16); writeType(state, x + dx * 16, y + dy * 16, 0x47); } state.timer104 = 0; continue; }
    if (al === 0x1e && tileset === 2) { for (const [l, dx] of [[0x86f0, 1], [0x8704, 2], [0x8718, 3]]) { anim(l, x + dx * 16, y); writeType(state, x + dx * 16, y, 0x44); } continue; }
    const pairs = { 1: [0x8688, 0x86a2], 3: [0x86bc, 0x86d6], 4: [0x864c, 0x8674] };
    const place = (lists, type) => lists.forEach((list, i) => { al = anim(list, x, y + 16 * i); if (writeType(state, x, y + 16 * i, type)) al = type; });
    if (al === 0x26) {
      al = codeAt(x, y - 16); if (al === 0x26) continue;
      if (tileset === 4 && state.level === 2) place([0x864c, 0x8660, 0x8674], 0x40);
      else if (pairs[tileset]) place(pairs[tileset], 0x40);
    }
    if (al === 0x2e) {
      al = codeAt(x, y - 16); if (al === 0x26) continue;
      if (pairs[tileset]) { place(pairs[tileset], 0x64); continue; }
    }
    if (al === 0x18 && tileset === 5) {
      writeType(state, x, y, 0x01);
      for (const [l, dy] of [[0x84de, 1], [0x8558, 2], [0x85d2, 3]]) { anim(l, x, y + dy * 16); writeType(state, x, y + dy * 16, 0x46); }
      state.timer60 = 0;
    }
  }
}

// 1000:7BAE, one player: up to 3 one-pixel steps per axis (4 on a lag frame), with a dead zone.
export function followCamera(state) {
  const target = state.players[0], camera = state.camera, steps = state.tables.moveSteps[state.lag * 16 + 3];
  const maxX = ((MAP_WIDTH + 1) * 16 - 0x140) & 0xffff, maxY = (96 * 16 - 0xb0) & 0xffff;
  for (let i = 0; i < steps; i++) {
    let left = true;
    if (s16(target.x) >= s16(camera.x + 0x90)) { if ((camera.x & 0xffff) < maxX) camera.x = s16(camera.x + 1); else left = false; }
    if (left && s16(target.x) <= s16(camera.x + 0xb0) && s16(camera.x) > 0x10) camera.x = s16(camera.x - 1);
    let up = true;
    if (s16(target.y) >= s16(camera.y + 0x58)) { if ((camera.y & 0xffff) < maxY) camera.y = s16(camera.y + 1); else up = false; }
    if (up && s16(target.y) <= s16(camera.y + 0x68) && s16(camera.y) > 0) camera.y = s16(camera.y - 1);
  }
}

// One pass of 1000:37D6. `view` is what the original shows after this frame's flip: tiles scrolled to the camera
// from before this frame's follow, sprites at the current camera, objects as updated in the previous frame.
export function stepFrame(state, input) {
  state.sounds = [];
  if (s16(state.burning) > 0) state.burning--;
  state.frameCounter = u16(state.frameCounter + 1);
  const tileCamera = { ...state.camera };
  followCamera(state); tickAnimations(state);
  state.view = { tileCamera, spriteCamera: { ...state.camera }, players: state.players.map(p => ({ x: p.x, y: p.y, height: p.height, frame: p.frame })) };
  state.timer60 = (state.timer60 + 1) % 60; state.timer104 = (state.timer104 + 1) % 104;
  if (state.objectiveTriggered) { state.objectiveTriggered = false; unsupported(state, 'Objective cell 0x3D (self-destruct or boss start)'); }
  for (const player of state.players) updatePlayer(state, player, input);
  for (const player of state.players) if (s16(player.energy) <= 0) unsupported(state, 'Player death');
  checkAlienSpawn(state);
  state.frame++;
}

// Spawn eligibility of 1000:4EF7 with no live aliens: the first record that is inside the extended camera window,
// off screen unless it is type 3, and at least 16 pixels from the origin spawns. Aliens are not implemented yet.
function checkAlienSpawn(state) {
  if (!state.spawnPoints.length || state.aliensSkipped) return;
  const cx = state.camera.x, cy = state.camera.y;
  const spawn = state.spawnPoints.find(r => {
    if (r.cooldown > 0) return false;
    if (r.x < cx - 0x40 || r.x > cx + 0x180 || r.y < cy - 0x40 || r.y > cy + 0xf0) return false;
    if (r.type !== 3 && r.x >= cx - 0x10 && r.x <= cx + 0x150 && r.y >= cy - 0x10 && r.y <= cy + 0xc0) return false;
    return r.x >= 0x10 && r.y >= 0x10;
  });
  if (spawn) { unsupported(state, `Alien spawn (type ${spawn.type} at ${spawn.x}, ${spawn.y})`); state.aliensSkipped = true; }
}
