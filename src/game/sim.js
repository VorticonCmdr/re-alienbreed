// Game simulation, independent of the DOM and of wall-clock time. One step() is one original game frame.
// Addresses in comments are Ghidra addresses; evidence and remaining uncertainty: docs/port/evidence.md.
import { MAP_WIDTH, MAP_CELLS } from './level.js';
import { emptyRecord, scriptTables, allocObject, setObjectType, runScripts, drawList, PLAYER_RECORDS, OBJECT_SLOTS } from './objects.js';
import { seedRandom, nextRandom } from './rng.js';

const CODE = 0x1000, DATA = 0x2041;
export class UnsupportedPath extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'UnsupportedPath'; this.detail = detail; }
}

// Tables read from the user's executable at runtime.
export function readTables(exe) {
  const lists = new Map();
  return {
    ...scriptTables(exe),
    moveSteps: Array.from({ length: 32 }, (_, i) => exe.u16(CODE, 0x7b4a + 2 * i)), // cs:7B4A, [lag * 16 + speed]
    animBase: Array.from({ length: 16 }, (_, i) => exe.u16(CODE, 0x6545 + 2 * i)),  // cs:6545, per 4-bit direction
    // Aliens (1000:4A66) and shots (5928, 52F4); indexing follows the original, including its quirks.
    contactDamage: Array.from({ length: 38 }, (_, i) => exe.u16(CODE, 0x4a1a + 2 * i)), // [level + (kind & 1)]
    wanderDirection: Array.from({ length: 32 }, (_, i) => exe.u16(CODE, 0x49da + 2 * i)),
    alienBase: [0x511b, 0x513d].map(t => Array.from({ length: 16 }, (_, i) => exe.u16(CODE, t + 2 * i))),
    fireMask: Array.from({ length: 7 }, (_, i) => exe.u8(CODE, 0x5b1d + i)),              // [weapon - 1]
    ammoCost: Array.from({ length: 8 }, (_, i) => exe.u16(CODE, 0x5b26 + 2 * i)),        // [weapon]
    fireSound: Array.from({ length: 7 }, (_, i) => exe.u16(CODE, 0x5b36 + 2 * i)),       // [weapon - 1]
    shotDamage: Array.from({ length: 8 }, (_, i) => exe.u16(CODE, 0x5638 + 2 * i)),      // [type]
    shotSpeed: Array.from({ length: 7 }, (_, i) => exe.u16(CODE, 0x5a00 + 2 * i)),       // [type - 1]
    shotOffset: Array.from({ length: 16 }, (_, i) => [exe.s16(CODE, 0x5add + 4 * i), exe.s16(CODE, 0x5add + 4 * i + 2)]),
    spread: [0x5a65, 0x5aa1].map(t => Array.from({ length: 16 }, (_, i) => [exe.s16(CODE, t + 4 * i), exe.s16(CODE, t + 4 * i + 2)])),
    bounceDirection: Array.from({ length: 16 }, (_, i) => exe.u8(CODE, 0x5672 + i)),
    selfDestructSeconds: Array.from({ length: 19 }, (_, i) => exe.u8(CODE, 0x5fc9 + i)), // BCD, 1000:5F94
    // Shot frames for 1000:568E: [type - 2][direction], two alternating rows for type 6, and type 5's sequence.
    shotFrames: Array.from({ length: 6 }, (_, t) => Array.from({ length: 16 }, (_, i) => exe.u16(CODE, 0x570c + 32 * t + 2 * i))),
    shotPhaseFrames: [0x57cc, 0x57ec].map(o => Array.from({ length: 16 }, (_, i) => exe.u16(CODE, o + 2 * i))),
    fadingShotFrames: Array.from({ length: 7 }, (_, i) => exe.u16(CODE, 0x5682 + 2 * i)),
    codeWord: offset => exe.u16(CODE, offset & 0xffff), // for reads the original makes past the end of a table
    dataWord: offset => exe.u16(DATA, offset & 0xffff),
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
const UNSUPPORTED_PROBE_CODES = new Set();
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
// Player record bytes +63..+6A hold overlapping packed-BCD tallies: shots fired at +63 (1000:59DC), kills at +65
// (4B5A) and doors opened at +67 (4806). Each is ADD AX,1 / DAA on one word, then ADC AX,0 / DAA on the next; DAA
// only adjusts AL, so AH never changes. +69 doubles as the movement mask, which the player update rewrites.
const daa = (al, af, cf) => {
  const oldAl = al, oldCf = cf;
  if ((al & 15) > 9 || af) { al += 6; cf = oldCf || al > 0xff; } else cf = false;
  if (oldAl > 0x99 || oldCf) { al += 0x60; cf = true; } else cf = false;
  return { al: al & 0xff, cf };
};
export function tallyIncrement(tally, offset) {
  let carry = 1;
  for (const at of [offset, offset + 2]) {
    if (at + 1 >= tally.length) return; // +6B onwards is not a tally
    const ax = tally[at] | tally[at + 1] << 8, sum = ax + carry;
    const r = daa(sum & 0xff, (ax & 15) + carry > 15, sum > 0xffff);
    tally[at] = r.al; tally[at + 1] = (sum >> 8) & 0xff; carry = r.cf ? 1 : 0;
  }
}
export const TALLY = { shots: 0, kills: 2, doors: 4 };
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
  } else if ((code === 0x45 && s16(state.burning) > 0) || code === 0x44) hurt(state, player, 0x10);
  else if (code === 0x40) { if (state.movedDirections & 2) { player.moveMask = 0x0d; hurt(state, player, 0x10); } }
  else if (code === 0x64) { if (state.movedDirections & 1) { player.moveMask = 0x0e; hurt(state, player, 0x10); } }
  else if (code === 0x46) { if (s16(state.timer60) > 0x28 && (state.timer60 & 3) === 0) hurt(state, player, 1); }
  else if (code === 0x14) { state.skipSafe = true; player.energy = u16(player.energy - 8); state.sounds.push(0x0f); }
  else if (code === 0x17) player.onIntex = 0xffff;
  else if (code === 0x15) startSelfDestruct(state);
  else if (code === 0x2f) { player.conveyor |= 2; state.skipSafe = true; }
  else if (code === 0x27) { player.conveyor |= 1; state.skipSafe = true; }
  else if (code === 0x3f) { player.conveyor |= 8; state.skipSafe = true; }
  else if (code === 0x37) { player.conveyor |= 4; state.skipSafe = true; }
  else if (code === 0x02) exitTouched(state);
  else if (code === 0x0a && (state.level === 16 || state.level === 17)) { // 1000:642D: arm a scripted spawn here
    state.scriptedSpawn = { x, y }; state.scriptedSpawnTimer = 0x78; state.sounds.push(0x0a);
    startAnimation(state, 0x84b4, state.probeIndex); writeCell(state, state.probeIndex, 0x223, 0);
  }
  else if (UNSUPPORTED_PROBE_CODES.has(code)) unsupported(state, `Cell effect 0x${code.toString(16)} at (${x}, ${y})`);
}
// 1000:61DC and its copies: hurt flash, energy loss, sound 0x0F.
function hurt(state, player, amount) { player.hurt = true; player.energy = u16(player.energy - amount); state.sounds.push(0x0f); }

// 1000:6286: the exit only counts on some levels or once the self-destruct or boss has started.
function exitTouched(state) {
  const l = state.level;
  if ([1, 11, 15, 16, 4, 7, 9, 10].includes(l) || (l === 3 && ((state.wallsDestroyed << 24) >> 24) >= 3) || state.bossActive || state.selfDestruct) state.exitTaken = true;
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
  if (player.type === 2) return; // dying (1000:5B49)
  state.firing = false;
  openDoors(state, player);
  if (input & INPUT.FIRE) firePlayer(state, player);
  else player.fireRepeat = 0;
  if (input & INPUT.ACTION && s16(player.onIntex) === -1) { state.intexRequest = player; state.sounds.push(0); } // 1000:5BD6
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
    // The carry lands in +69, the movement mask that this frame's move still uses (reset to 0x0F after it).
    player.tally[6] = player.moveMask & 0xff; player.tally[7] = player.moveMask >> 8;
    tallyIncrement(player.tally, TALLY.doors); player.moveMask = player.tally[6] | player.tally[7] << 8;
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

export function startLevel({ tables, map, level, tileset, demoMode = 0, strict = true, saved, rngSeed = 0, rng, globals }) {
  const state = {
    tables, level, strict, demoMode, tiles: Uint16Array.from(map.tiles), types: Uint16Array.from(map.types),
    camera: { x: 0, y: 0 }, lag: 0, frameTicks: 0, loadingFile: false, countdownFrozen: false, frame: 0, frameCounter: 0, timer60: 0, timer104: 0, burning: 0,
    animations: Array(79).fill(null), doors: [], sounds: [], diagnostics: [], playerCount: 1, shareCredits: false,
    wallsDestroyed: 0, bossActive: false, aliensSuppressed: false, bossDying: false, alienPalette: null, alienSheet: null, frameBanks: {}, musicStop: false, selfDestruct: false, objectiveTriggered: false,
    shots: Array.from({ length: 32 }, () => ({ type: 0, x: 0, y: 0, direction: 0, counter: 0, vx: 0, vy: 0 })),
    spreadCounter: 0, // cs:5A43; its value at program start is not yet confirmed
    bounceCounter: 0, // cs:5671, likewise
    objects: Array.from({ length: PLAYER_RECORDS + OBJECT_SLOTS }, () => ({ ...emptyRecord(), push: 0, moveMask: 0, stuck: 0 })), // fields 7376 never sets: 0 after boot (observed) objectCount: 0,
    aliens: Array.from({ length: 6 }, () => ({ kind: 0, direction: 0, object: null, cell: -1, speed: 0, timer: 0, column: 0 })),
    aliveAliens: 0, spawnCounter: 0, scriptedSpawnTimer: -1, scriptedSpawn: null,
    rng: rng ? { ...rng } : seedRandom(rngSeed), // 1000:17FC seeds from the high word of the INT 8 counter, 0 early in a session
    generatorFlags: [false, false, false, false], generatorsDestroyed: 0, selfDestruct: false, seconds: 0, redAlert: false,
    endSequence: 0, exitTaken: false, levelOver: null, tickAccumulator: 0, secondCycle: 0, levelTenTimer: 0x0f, // boot values from the image (cs:7969 is 0)
    music: 'ingame',
  };
  state.report = message => unsupported(state, message);
  state.objectHook = record => objectHook(state, record);
  if (globals) Object.assign(state, globals, { rng: { ...globals.rng } }); // before 3D10, which may reset the timers
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
    state.doors.push({ x, y, kind: codeAt(x + 16, y) === 3 ? 2 : 1, hp: 0xc0 });
  }
  convertDecor(state, tileset, codeAt);
  const start = find(0x35); // 1000:3BA6; the camera stays at 0 if there is no marker
  const camX = start.missing ? 0 : Math.max(0, s16(start.x - 0xa0)), camY = start.missing ? 0 : Math.max(0, s16(start.y - 0x58));
  state.camera = { x: camX, y: camY }; state.viewCamera = { ...state.camera };
  const stats = saved ? { ...saved, tally: Uint8Array.from(saved.tally) } : newGamePlayer();
  const player = {
    x: s16(camX + 0xb0), y: s16(camY + 0x68), frame: 0x0b, animBase: 0x0b, walk: 0, facing: 1, state: 1, height: 0,
    ...stats, fireRepeat: 0, conveyor: 0, onIntex: 0, hurt: false, invulnerable: 0, cell: -1,
  };
  player.oldX = player.safeX = player.x; player.oldY = player.safeY = player.y;
  if (player.x - 16 >= 0 && player.y - 16 >= 0) player.cell = cellAt(state, player.x, player.y); // no occupancy bit yet
  // Player record set up like 7376 without clearing the player fields (74FC is not fully read yet).
  Object.assign(player, { alive: true, active: true, flags0A: 0x80, flags0B: 0x40, type: 1, script: tables.scriptStart(1), z: 0, oldZ: 0, delay: 0, priority: 8, ticks: 0 });
  state.objects[0] = player; state.objectCount = 1; state.players = [player];
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

// The key checks at the top of each main-loop pass (1000:34E6), before the level-over tests (M is checked after the
// frame, see mapRequested): `scancode` is [B086],
// the last INT 9 scancode. Returns 'abort' (the abort key ends the game like losing), 'consumed' (the caller clears
// [B086]) or null. The cheat keys need cs:[7FD9] = 0xFF, which nothing sets in normal play; they are not modelled.
export function mainLoopKeys(state, scancode, abortScancode, cheats = false) {
  if ((scancode & 0xff) === abortScancode) return 'abort';
  if (cheats) { // cs:[7FD9], set by a cheat word in the Intex: = takes the exit, - goes back one level (1000:3502-3532)
    if (scancode === 0x0d && state.level < 0x12) state.exitTaken = true;
    if (scancode === 0x0c && state.level >= 0) return 'previous';
  }
  const cycle = [0x82, 0x8b].indexOf(scancode); // release of 1 (player 1) or 0 (player 2): next owned weapon
  if (cycle >= 0) {
    const player = state.players[cycle];
    if (player) {
      if (!(player.owned & 0xff)) { unsupported(state, 'Weapon cycle with no weapon owned (the original loops forever)'); return 'consumed'; }
      let bit = (player.weapon - 1) & 7;
      do bit = (bit + 1) & 7; while (!(player.owned & (1 << bit)));
      player.weapon = bit + 1; state.sounds.push(5);
    }
    return 'consumed';
  }
  return null;
}

// Variables the level load never resets (static audit of 1000:1937-1FC1): the RNG [B0BA]-[B0BE], the frame counter
// [AF84], cs:4035/4037 (reset only by some decor in 3D10), [8182], cs:5A43, cs:5671, cs:5119, the INT 8 work [AD4C]
// and cs:7969, and the level 16/17 spawn timer cs:602A.
const CARRIED = ['frameTicks', 'lag', 'aliensSuppressed', 'rng', 'frameCounter', 'timer60', 'timer104', 'burning', 'spreadCounter', 'bounceCounter', 'spawnCounter', 'tickAccumulator', 'secondCycle', 'scriptedSpawnTimer', 'scriptedSpawn'];
export const carriedGlobals = state => Object.fromEntries(CARRIED.map(k => [k, k === 'rng' ? { ...state.rng } : state[k]]));

// 1000:35F2: M (make code 0x32) after the frame, without the end sequence, for a player who owns the map.
export function mapRequested(state, scancode) {
  if (scancode !== 0x32) return { consumed: false, player: null };
  return { consumed: true, player: state.endSequence ? null : state.players.find(p => p.alive && p.map & 1) ?? null };
}

// 1000:1FEE-2011 (and 3526 for the '-' cheat): what follows a level. A level code typed in the Intex has already set
// [B0B2], so the usual increment then leads to its index plus one.
export function nextStage(level, result, levelCode) {
  if (result === 'previous') return { kind: 'level', level: level - 1 };
  if (result !== 'complete') return { kind: result === 'demo' ? 'title' : 'gameover' };
  const index = levelCode ?? level;
  if (index === 18) return { kind: 'ending' };
  if (index === 0) return { kind: 'level0' };
  return { kind: 'level', level: index + 1 };
}

// Player 1's carried values for a new game (1000:188B-1932, 18BD-18FF) and their save at the end of a level
// (1000:21A6), restored by the next level's start (1000:1E15-1E6C). +69, the movement mask, is part of the save.
export const newGamePlayer = () => ({ energy: 0x40, lives: 4, keys: 0, ammo: 0x17f, weapon: 1, owned: 0x7f, credits: 0, map: 0, tally: new Uint8Array(8), moveMask: 0 });
export function savePlayer(player) {
  const { energy, lives, keys, ammo, weapon, owned, credits, map, moveMask } = player;
  return { energy, lives, keys, ammo, weapon, owned, credits, map, tally: Uint8Array.from(player.tally), moveMask };
}

// One pass of 1000:37D6. `view` is what the original shows after this frame's flip: tiles scrolled to the camera
// from before this frame's follow, sprites at the current camera, objects as updated in the previous frame.
export function stepFrame(state, input, ticks = 0, { demoEnd = false } = {}) {
  // Only the main loop (1000:34E6) tests for the end of a level; the bare passes at level start and after the Intex
  // run whatever the state, so a frame may follow one that ended the level; the reason is what 34E6 would see now.
  state.sounds = [];
  for (let i = 0; i < ticks; i++) timerTick(state); // INT 8 work, applied at the frame start (its exact phase is approximate)
  if (s16(state.levelTenTimer) < 0 && state.level === 10 && !state.endSequence) startSelfDestruct(state);
  if (s16(state.burning) > 0) state.burning--;
  state.frameCounter = u16(state.frameCounter + 1);
  const tileCamera = { ...state.camera };
  followCamera(state); tickAnimations(state);
  const objects = drawList(state); // 1000:6764 draws before this frame's shots and scripts
  updateShots(state);
  if (state.endSequence) endSequenceFrame(state);
  if (state.bossDying) { state.bossDying = false; bossDeath(state); } // 1000:3846
  for (const r of state.objects) if (r.active) { r.oldX = r.x; r.oldY = r.y; r.oldZ = r.z; } // 1000:65FC
  runScripts(state);
  state.view = {
    tileCamera, spriteCamera: { ...state.camera }, objects, frameCounter: state.frameCounter, shotPhase: state.shotPhase, frameBanks: { ...state.frameBanks },
    timerDigits: state.selfDestruct ? state.seconds : null, // 1000:3AED, drawn after the shots
    shots: state.shots.filter(s => s.type).map(s => ({ type: s.type, x: s.x, y: s.y, direction: s.direction, counter: s.counter })),
  };
  state.shotPhase = (state.frameCounter >> 2) & 1; // cs:578C refreshed after 52F4 for the next frame's type-6 shots
  state.atFlip = { objectCount: state.objectCount, rng: { ...state.rng } }; // what the original holds at its frame flip (for comparisons)
  if (state.recordFlip) Object.assign(state.atFlip, { objects: state.objects.map(r => ({ ...r })), players: state.players.map(p => ({ ...p })),
    generatorsDestroyed: state.generatorsDestroyed });
  // 2EF5:12B4: the frame end takes the INT 8 count since the previous one; 5 or more makes this a lag frame.
  state.lag = !state.demoMode && state.frameTicks >= 5 ? 1 : 0; state.frameTicks = 0;
  state.timer60 = (state.timer60 + 1) % 60; state.timer104 = (state.timer104 + 1) % 104;
  if (state.objectiveTriggered) { state.objectiveTriggered = false; startBoss(state); } // 1000:38C6
  // 1000:3928: the demo's 1024th input byte ends the main loop before the player update (POP AX / RET at 39BC).
  if (demoEnd) { state.frame++; state.levelOver = 'demo'; return; }
  if (!state.endSequence) for (const player of state.players) if (player.alive) updatePlayer(state, player, input);
  for (const player of state.players) if (player.alive && s16(player.energy) <= 0) killPlayer(state, player);
  if (!state.endSequence) updateAliens(state);
  state.frame++;
  // 1000:34E6 at the top of the next pass: exit taken, nobody left, or the end sequence finished.
  if (state.levelOver === 'demo') return;
  state.levelOver = state.exitTaken ? 'complete' : !state.players.some(p => p.alive) || s16(state.endSequence) >= 0x8c ? 'gameover' : null;
}

// ---- Shots (1000:5B58 player fire, 5928 creation, 52F4 per-frame update) ----

// 1000:5648: the velocity for a 4-bit direction.
function velocity(direction, step) {
  let vx = 0, vy = 0;
  if (direction & 1) vx += step; if (direction & 2) vx -= step;
  if (direction & 4) vy += step; if (direction & 8) vy -= step;
  return [vx, vy];
}

function firePlayer(state, player) {
  const t = state.tables;
  if (player.fireRepeat !== 0) { player.fireRepeat = u16(player.fireRepeat + 1) & t.fireMask[player.weapon - 1]; return; }
  player.fireRepeat = u16(player.fireRepeat + 1);
  if (s16(player.ammo) <= 0) { state.sounds.push(0x17); return; }
  player.ammo = u16(player.ammo - t.ammoCost[player.weapon]); if (s16(player.ammo) < 0) player.ammo = 0;
  state.sounds.push(t.fireSound[player.weapon - 1]); state.firing = true;
  createShot(state, player, player.facing, player.weapon, player.x, player.y);
}

// 1000:5928. No free record: nothing happens.
function createShot(state, player, facing, type, x, y) {
  const shot = state.shots.find(s => !s.type); if (!shot) return;
  const t = state.tables, direction = facing & 15, [dx, dy] = t.shotOffset[direction];
  shot.x = dx === 0x4d2 ? x : s16(x + dx); shot.y = dx === 0x4d2 ? y : s16(y + dy);
  shot.direction = facing; shot.type = type;
  [shot.vx, shot.vy] = velocity(direction, t.moveSteps[state.lag * 16 + t.shotSpeed[type - 1]]);
  if (type === 3 || type === 4 || type === 6) { // 1000:5A10: spread pattern none, A, B, none
    const pattern = state.spreadCounter & 3;
    if (pattern === 1 || pattern === 2) { const [sx, sy] = t.spread[pattern - 1][direction]; shot.vx += sx; shot.vy += sy; }
    state.spreadCounter = (state.spreadCounter + 1) & 15;
  }
  if (type === 3) shot.counter = 4; else if (type === 7) shot.counter = 6; else if (type === 5) shot.counter = 0x18;
  tallyIncrement(player.tally, TALLY.shots);
}

// 1000:3C08 for a shot: a point 1-3 pixels above the map reads the row table's preceding words, which are zero
// bytes in the executable (2EF5:1CA2-1CA7), so it tests row 0. Higher points read unrelated memory (reported).
function shotCell(state, x, y) {
  const py = y - 16;
  if (py < 0 && py >= -3 && x - 16 >= 0) return cellAt(state, x, 16);
  return cellAt(state, x, y);
}

// 1000:5812: shots damage closed doors whose box contains (x, y + 0x18); the shot is not consumed.
function shootDoors(state, x, y, damage) {
  for (const door of state.doors) {
    if (!door.kind) continue;
    const { x: dx, y: dy } = door, vertical = door.kind === 1;
    const inside = vertical ? x >= dx - 16 && x <= dx + 32 && y >= dy && y <= dy + 32 : x >= dx && x <= dx + 32 && y >= dy - 0x12 && y <= dy + 0x24;
    if (!inside) continue;
    door.hp = s16(door.hp - damage); if (door.hp > 0) continue;
    door.kind = 0;
    const second = vertical ? [dx, dy + 16] : [dx + 16, dy];
    writeType(state, dx, dy, 0); startAnimation(state, vertical ? 0x8b74 : 0x8b58, worldCell(state, dx, dy));
    writeType(state, ...second, 0); startAnimation(state, vertical ? 0x8b82 : 0x8b66, worldCell(state, ...second));
    state.sounds.push(1);
  }
}

export function updateShots(state) {
  const { x: cx, y: cy } = state.camera, t = state.tables;
  for (const shot of state.shots) {
    if (!shot.type) continue;
    if (shot.x < cx || shot.x > cx + 0x140 || shot.y < cy || shot.y > cy + 0xc8) { shot.type = 0; continue; }
    if (shot.type === 5) { shot.counter = s16(shot.counter - 1); if (shot.counter <= 0) { shot.type = 0; continue; } }
    const oldX = shot.x, oldY = shot.y;
    shot.x = s16(shot.x + shot.vx); shot.y = s16(shot.y + shot.vy);
    if (!(shot.direction & 15)) unsupported(state, 'Shot without a direction');
    shootDoors(state, shot.x, s16(shot.y + 0x18), t.shotDamage[shot.type]);
    const index = shotCell(state, shot.x, s16(shot.y + 0x10)), code = state.types[index] & 0xff;
    if (WALLS.has(code)) {
      if (code >= 0x2a && code <= 0x2d) hitGenerator(state, code - 0x2a);
      if (s16(state.generatorsDestroyed) >= 4) startSelfDestruct(state);
      if ((shot.type === 3 || shot.type === 7) && bounce(state, shot, oldX, oldY)) continue;
      shot.type = 0; createEffect(state, 5, shot.x, s16(shot.y + 8));
      continue;
    }
    if (code === 0x12 || code === 0x13) destroyWall(state, shot.x, s16(shot.y + 0x10), code === 0x12 ? 0x20 : -0x20);
  }
}

// 1000:5445: sound 0x15, one bounce fewer; with bounces left the shot steps back and takes a random new direction
// from cs:5672, indexed by the RNG's low byte plus the rolling counter cs:[5671], never its current one. No spread.
function bounce(state, shot, oldX, oldY) {
  state.sounds.push(0x15);
  shot.counter = (shot.counter - 1) & 0xffff; if (shot.counter === 0) return false;
  shot.x = oldX; shot.y = oldY;
  let direction;
  do {
    state.bounceCounter = (state.bounceCounter + 1) & 15;
    direction = state.tables.bounceDirection[((random(state) & 0xff) + state.bounceCounter) & 15];
  } while ((shot.direction & 0xff) === direction);
  shot.direction = (shot.direction & 0xff00) | direction;
  const t = state.tables;
  [shot.vx, shot.vy] = velocity(direction, t.moveSteps[state.lag * 16 + t.shotSpeed[shot.type - 1]]);
  return true;
}

// 1000:5502 (0x12, debris to the right) and 5579 (0x13, to the left): the cell becomes floor, three cells one column
// over become burning debris 0x45 for 16 frames ([8182]); the third wall on level index 3 starts the self-destruct.
function destroyWall(state, x, y, dx) {
  state.wallsDestroyed = (state.wallsDestroyed + 1) & 0xff; state.burning = 0x10;
  writeType(state, x, y, 0); startAnimation(state, 0x8ba8, worldCell(state, x, y));
  for (const dy of [0, 0x10, 0x20]) { writeType(state, x + dx, y + dy, 0x45); startAnimation(state, 0x8bae, worldCell(state, x + dx, y + dy)); }
  state.sounds.push(1);
  if (state.level === 3 && ((state.wallsDestroyed << 24) >> 24) >= 3) startSelfDestruct(state);
}

// 1000:5286 through the shot wall handler: flag, count, 2x2 destroyed tiles, explosion object type 9, sound 0x0E.
function hitGenerator(state, index) {
  if (state.generatorFlags[index]) return;
  state.generatorFlags[index] = true; state.generatorsDestroyed++;
  const { x, y } = state.generators[index];
  [[0x8b90, x, y + 16], [0x8b96, x + 16, y + 16], [0x8b9c, x, y + 32], [0x8ba2, x + 16, y + 32]].forEach(([list, cx, cy]) => startAnimation(state, list, cellAt(state, cx, cy)));
  createEffect(state, 9, s16(x + 16), s16(y + 24)); state.sounds.push(0x0e);
}

// 1000:5F94: once per level; red palette except on levels 14/15, BCD seconds from cs:5FC9, alarm music.
export function startSelfDestruct(state) {
  if (state.selfDestruct) return;
  if (state.level !== 14 && state.level !== 15) state.redAlert = true;
  state.selfDestruct = true; state.seconds = state.tables.selfDestructSeconds[state.level]; state.music = 'alarmed';
}
// The INT 8 handler's once-per-"second" work (1000:7872, carry of [AD4C] += 0x334). Ticks are an explicit input.
export function timerTick(state) {
  state.frameTicks = (state.frameTicks + 1) & 0xffff; // [8184]
  if (state.loadingFile) return; // [7B4A]: the file loaders pause the rest
  state.tickAccumulator += 0x334;
  if (state.tickAccumulator <= 0xffff) return;
  state.tickAccumulator &= 0xffff;
  state.secondCycle--; if (state.secondCycle < 0) state.secondCycle = 10;
  if (state.selfDestruct && !state.countdownFrozen) { // cs:37D3 freezes it in the Intex
    if (state.secondCycle === 0) state.sounds.push(0x0b);
    state.sounds.push(0x16);
    state.seconds = bcdDecrement(state.seconds);
    if (state.seconds === 0) { state.endSequence = 1; state.selfDestruct = false; }
  }
  state.levelTenTimer = s16(state.levelTenTimer - 1);
}
const bcdDecrement = v => { let low = (v & 15) - 1, high = v >> 4; if (low < 0) { low += 10; high--; } return ((high & 15) << 4 | low) & 0xff; };

// 1000:3AED while [92F2] != 0: random explosions over the screen for 139 frames.
function endSequenceFrame(state) {
  state.endSequence++;
  if (s16(random(state)) >= 0x800) return;
  let x, y; do x = random(state) & 0x1ff; while (s16(x) > 0x140); x = s16(x + state.camera.x);
  do y = random(state) & 0xff; while (y > 0xc8); y = s16(y + state.camera.y);
  const r = random(state) & 1; state.sounds.push(0x0d + r); createEffect(state, 8 + r, x, y);
}

// Impacts, explosions and death animations are objects driven by their scripts.
function createEffect(state, type, x, y) { return allocObject(state, type, x, y); }

// ---- Aliens (1000:4A66, once per frame after the player updates) ----

// Death check after the player updates (1000:3A00): refill, lose a life, dying script; the last life ends the game.
function killPlayer(state, player) {
  player.energy = 0x40; player.lives = (player.lives - 1) & 0xff;
  setObjectType(state, player, 2); player.invulnerable = 0x4b;
  if (player.lives === 0xff) {
    player.alive = false; state.playerCount--; setObjectType(state, player, 3);
    if (player.cell >= 0 && player.cell <= 0x2d00) state.types[player.cell] &= 0x7fff;
  }
}

const random = state => nextRandom(state.rng);

// 1000:4EF7 for one free slot. Every call walks the records from the start, so cooldowns of records before the one
// that spawns are decremented once per free slot and frame, as in the original.
function spawnAlien(state, slot) {
  if (s16(state.aliveAliens) >= 6) return;
  if (state.scriptedSpawnTimer !== -1) { // 1000:4F01, once per free slot and frame
    state.scriptedSpawnTimer = s16(state.scriptedSpawnTimer - 1);
    if (state.scriptedSpawnTimer <= -1) { scriptedSpawn(state, slot); return; }
  }
  const cx = state.camera.x, cy = state.camera.y;
  for (const r of state.spawnPoints) {
    if (s16(r.cooldown) > 0) { r.cooldown = s16(r.cooldown - 1); continue; }
    if (r.x < cx - 0x40 || r.x > cx + 0x180 || r.y < cy - 0x40 || r.y > cy + 0xf0) continue;
    if (r.type !== 3 && r.x >= cx - 0x10 && r.x <= cx + 0x150 && r.y >= cy - 0x10 && r.y <= cy + 0xc0) continue;
    if (r.x < 0x10 || r.y < 0x10) continue;
    slot.kind = r.type === 3 ? 1 : r.type;
    r.cooldown = s16((random(state) & 0x3ff) + 0x400); state.aliveAliens++;
    const cell = cellAt(state, r.x, r.y); state.types[cell] |= 0x8000; slot.cell = cell;
    slot.direction = 1;
    let speed = (slot.kind & 3) + (state.level >> 1) + 5; if (speed > 15) speed = 15;
    slot.speed = speed; slot.timer = s16(0x22 - 2 * speed);
    slot.column = (speed >> 3) + (random(state) & 1) + 1;
    let type = 6, x = r.x;
    if (r.type === 3) { type = 7; x = s16(x + 8); r.cooldown = s16(r.cooldown + 0x800); state.sounds.push(0x0a); }
    const object = allocObject(state, type, x, r.y); if (!object) return;
    Object.assign(object, { walk: 0, facing: 1, energy: 0x10 }); // 1000:5074: push +26, move mask +69 and stuck +4D keep the record's old values
    object.flags0B |= 0x80; slot.object = object;
    if (object.type !== 7) object.frame = object.animBase = 0x49;
    if (slot.kind === 2) { object.energy = 8; object.frame = object.animBase = 0x8d; }
    const target = state.players[0]; // one player: P1 (two-player alternation by cs:5119 parity not modelled)
    if (state.playerCount !== 1) state.report('Alien targets with two players');
    object.target = target; state.spawnCounter = (state.spawnCounter + 1) & 0xffff;
    return;
  }
}

// 1000:515E: a kind-2 alien at the armed cell; no cooldowns, no target alternation counter.
function scriptedSpawn(state, slot) {
  const { x, y } = state.scriptedSpawn;
  slot.kind = 2; state.aliveAliens++;
  if (x >= 16 && y >= 16) { const cell = cellAt(state, x, y); state.types[cell] |= 0x8000; slot.cell = cell; } // 3C08 out of range: no occupancy
  slot.direction = 1;
  let speed = (slot.kind & 3) + (state.level >> 1) + 5; if (speed > 15) speed = 15;
  slot.speed = speed; slot.timer = s16(0x22 - 2 * speed);
  slot.column = (speed >> 3) + (random(state) & 1) || 1;
  const object = allocObject(state, 6, x, y);
  if (object) {
    Object.assign(object, { walk: 0, facing: 1, energy: 8, frame: 0x8d, animBase: 0x8d });
    object.flags0B |= 0x80; slot.object = object; object.target = state.players[0];
    if (state.playerCount !== 1) state.report('Alien targets with two players');
  }
  state.scriptedSpawn = null; state.scriptedSpawnTimer = -1;
}
// 1000:4B74: occupancy cleared, death animation started on the same object, slot freed and refilled this frame.
function removeAlien(state, slot) {
  if (slot.cell >= 0 && slot.cell <= 0x2d00) state.types[slot.cell] &= 0x7fff;
  setObjectType(state, slot.object, 8); if (slot.kind === 2) setObjectType(state, slot.object, 0x0a);
  state.aliveAliens--; slot.kind = 0;
  spawnAlien(state, slot);
}
// 1000:4B4C. Returns true when the alien died (and its slot was refilled).
function hitAlien(state, slot, damage, player) {
  state.alienHit = true; slot.object.energy = s16(slot.object.energy - damage);
  if (slot.object.energy > 0) return false;
  tallyIncrement(player.tally, TALLY.kills); state.sounds.push(4);
  removeAlien(state, slot); return true;
}

const ONE_WAY = { 0x0e: 0x0b, 0x0f: 0x0d, 0x10: 0x07, 0x11: 0x0e, 0x38: 0x09, 0x39: 0x05, 0x3a: 0x06, 0x3b: 0x0a };
// 1000:5ED7: like the player mover but without the screen limits.
function moveObject(object, step, bits) {
  if (bits & 1) object.x = s16(object.x + step); if (bits & 2) object.x = s16(object.x - step);
  if (bits & 4) object.y = s16(object.y + step); if (bits & 8) object.y = s16(object.y - step);
}

export function updateAliens(state) {
  if (!state.spawnPoints.length) return;
  const t = state.tables;
  for (const slot of state.aliens) {
    if (!slot.kind) { spawnAlien(state, slot); continue; }
    const a = slot.object; if (a.type === 7) continue;
    state.alienHit = false;
    if (state.aliensSuppressed) { removeAlien(state, slot); continue; } // 1000:4A98 while a boss is active
    const { x: cx, y: cy } = state.camera;
    if (a.x < cx - 0x40 || a.x > cx + 0x180 || a.y < cy - 0x40 || a.y > cy + 0xf0) { removeAlien(state, slot); continue; }
    let lastPlayer = null, died = false;
    for (const p of state.players) { // 1000:4AE8 contact; the alien always dies on contact
      lastPlayer = p;
      if (a.x < p.x - 0x18 || a.x > p.x + 0x18 || a.y < p.y - 0x18 || a.y > p.y + 0x18 || !(a.frame & 1)) continue;
      if (!p.invulnerable) { p.energy = u16(p.energy - t.contactDamage[state.level + (slot.kind & 1)]); state.sounds.push(0x0f); }
      if (hitAlien(state, slot, 0x40, p)) { died = true; break; }
    }
    if (died) continue;
    const shot = state.shots.find(s => s.type && a.x >= s.x - 16 && a.x <= s.x + 16 && a.y >= s.y && a.y <= s.y + 0x20); // 1000:4987: y from shot y (+10h -10h) to +20h
    if (shot) { const damage = t.shotDamage[shot.type]; shot.type = 0; if (hitAlien(state, slot, damage, lastPlayer)) continue; }
    if (s16(slot.timer) >= 0) slot.timer = s16(slot.timer - 1);
    else {
      slot.timer = s16((random(state) & 15) + 0x22 - 2 * slot.speed);
      const r = random(state);
      if (r < ((0x0fff * slot.speed) & 0xffff)) {
        const target = a.target; let d = 0;
        if (s16(a.x & 0xfff0) < s16(target.x & 0xfff0)) d |= 1; else if (s16(a.x & 0xfff0) > s16(target.x & 0xfff0)) d |= 2;
        if (s16(a.y & 0xfff0) < s16(target.y & 0xfff0)) d |= 4; else if (s16(a.y & 0xfff0) > s16(target.y & 0xfff0)) d |= 8;
        slot.direction = d;
      } else slot.direction = t.wanderDirection[r & 0x1f];
    }
    const d = slot.direction & 15;
    for (const table of slot.kind === 2 ? [t.alienBase[0], t.alienBase[1]] : [t.alienBase[0]]) if (table[d] !== 0xffff) { a.animBase = table[d]; a.facing = d; }
    if (state.alienHit) a.frame = a.animBase + 3;
    else { let f = (a.walk & 7) >> 1; if (f === 3) f = 1; a.frame = a.animBase + f; }
    a.oldX = a.x; a.oldY = a.y;
    if (d) a.walk = u16(a.walk + 1);
    moveObject(a, t.moveSteps[state.lag * 16 + slot.column], slot.direction & a.moveMask);
    if (!(state.frameCounter & 1)) moveObject(a, 1, a.push & a.moveMask);
    a.push = 0; a.moveMask = 15;
    const h = slot.kind === 2 ? 6 : 8, yOffset = slot.kind === 2 ? 8 : 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (wallTest(state, a.x + sx * h, a.oldY + sy * h + yOffset, slot.cell, true)) a.x = a.oldX;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (wallTest(state, a.oldX + sx * h, a.y + sy * h + yOffset, slot.cell, true)) a.y = a.oldY;
    if (a.x - 16 >= 0 && a.y - 16 >= 0) {
      const cell = cellAt(state, a.x, a.y), code = state.types[cell] & 0xff;
      if (code in ONE_WAY) a.moveMask &= ONE_WAY[code];
      if (slot.cell !== cell) {
        if (slot.cell >= 0 && slot.cell <= 0x2d00) state.types[slot.cell] &= 0x7fff;
        state.types[cell] |= 0x8000; slot.cell = cell;
      }
    } else state.report('Alien probe left of or above the map');
    if (a.x === a.oldX && a.y === a.oldY) { a.stuck = (a.stuck + 1) & 0xffff; if (s16(a.stuck) >= 8) { slot.direction = 0; slot.timer = s16(slot.timer - 1); } }
    else a.stuck = 0;
  }
}

// ---- Bosses (objective cell 0x3D on levels 5, 8 and 17) ----

// Per-level boss set-up in 1000:6030: blocked cells [x, y, animation list, tile, type] relative to the objective,
// the 48-byte palette for bank 0xC0, the sprite file record, and the boss's energy.
const BOSSES = {
  5: { cells: [[0x50, 0x50], [0x60, 0x50]].map(([x, y]) => [x, y, 0x8be6, 0x240, 1]), palette: 0x951d, sheet: 0x93fa, energy: 0x200,
    opened: [[0x50, 0x50], [0x60, 0x50]].map(([x, y]) => [x, y, 0x8bec, 0xc4, 0]) },
  8: { cells: [], palette: 0x94ed, sheet: 0x93e6, energy: 0x280, opened: [0x10, 0x20, 0x30, 0x40].map(y => [0xb0, y, 0x8bc6, 0x01, 0]) },
  17: { cells: [[0x40, 0x70], [0x50, 0x70], [0x60, 0x70]].map(([x, y]) => [x, y, 0x8be0, 0x16b, 1]), palette: 0x954d, sheet: 0x940e, energy: 0x300,
    opened: [0x20, 0x30, 0x40].map(y => [0xb0, y, 0x8bc6, 0x16, 0]) },
};
// 1000:6566 after 86A9: start the animation, then replace the tile and the whole type word.
function placeCell(state, x, y, list, tile, type) { const cell = worldCell(state, x, y); startAnimation(state, list, cell); writeCell(state, cell, tile, type); }

// 1000:6030, once per level: aliens are removed while [7B49] is set, the boss palette and sheet replace the aliens',
// a type 0x0C object appears above the objective, and the monster song starts after a stop.
function startBoss(state) {
  if (state.aliensSuppressed || state.bossActive) return;
  state.bossActive = true; state.aliensSuppressed = true;
  const boss = BOSSES[state.level], { x, y } = state.objective;
  if (boss) {
    for (const [dx, dy, list, tile, type] of boss.cells) placeCell(state, x + dx, y + dy, list, tile, type);
    state.alienPalette = boss.palette; state.alienSheet = boss.sheet;
    const record = allocObject(state, 0x0c, s16(x + 0x40), s16(y - 0x40));
    if (record) Object.assign(record, { energy: boss.energy, target: null, countdown: 0, mode: 0, moveMask: 0 });
  }
  state.music = 'monster'; state.musicStop = true; // 1000:2261 then 2286
}

// 1000:6958 (type 0x0C) and 6C10 (type 0x0B), run when a script yields with +0A bit 0x40.
function objectHook(state, r) {
  if (r.type === 0x0c) bossHook(state, r);
  else if (r.type === 0x0b) objectHook0B(state, r);
}  // any other type: nothing (1000:6C10 returns)
// Frames 0xED-0xEF are drawn with colour bank 0x0C, or 0x0E (the flash) in the frame after a hit (descriptor +0D).
const BOSS_FRAMES = [0xed, 0xee, 0xef];
function shotHit(state, r, dx, top, bottom) { // 1000:6C8E / 6CE1: the first shot whose box holds the object
  for (const shot of state.shots) {
    if (!shot.type || r.x < shot.x - dx || r.x > shot.x + dx || r.y > s16(shot.y + bottom) || r.y < s16(shot.y + top)) continue;
    const damage = state.tables.shotDamage[shot.type]; shot.type = 0; return damage;
  }
  return 0;
}
function bossHook(state, r) {
  for (const f of BOSS_FRAMES) state.frameBanks[f] = 0x0c;
  const damage = shotHit(state, r, 0x20, 0x10, 0x10 + 0x7b);
  if (damage) { for (const f of BOSS_FRAMES) state.frameBanks[f] = 0x0e; r.energy = s16(r.energy - damage); state.sounds.push(0x0c); }
  if (r.energy <= 0) { r.energy = 0; state.dyingBoss = r; state.bossDying = true; return; }
  for (const p of state.players) { // 1000:69AF
    if (r.x < p.x - 0x14 || r.x > p.x + 0x14 || r.y < p.y - 0x14 || r.y > p.y + 0x14 || !(r.frame & 1) || p.type === 2) continue;
    p.hurt = true; p.energy = u16(p.energy - 4); state.sounds.push(0x0f);
  }
  bossMove(state, r);
}
// 1000:69EF: chase a player or patrol one of four points above the objective; walls block per axis.
function bossMove(state, r) {
  const t = state.tables;
  // +4F starts at 0, so until the first retarget the "player" is the word pair at DS:0000, the map's first type words.
  const target = () => r.target ?? { x: s16(state.types[0]), y: s16(state.types[1]), type: state.types[7] };
  let goal = { x: target().x, y: target().y };
  r.countdown = s16(r.countdown - 1);
  if (r.countdown <= 0) {
    let retarget = r.mode !== 0;
    if (!retarget) retarget = s16(random(state)) >= ({ 5: 0x5000, 8: 0x4000 }[state.level] ?? 0x6000);
    if (retarget) {
      if (state.playerCount === 2) state.report('Boss target with two players');
      r.target = state.players[0]; state.spawnCounter = (state.spawnCounter + 1) & 0xffff;
      r.mode = 0; r.countdown = state.level === 17 ? 0x80 : 0x60;
    } else { r.mode = (random(state) & 3) + 1; r.countdown = 0x80; }
  }
  if (r.mode) goal = { x: s16(state.objective.x + ((r.mode - 1) & 3) * 64), y: s16(state.objective.y - 0x80) };
  let d = 0;
  if (s16(r.x & 0xfff0) !== s16(goal.x & 0xfff0)) d |= s16(r.x & 0xfff0) > s16(goal.x & 0xfff0) ? 2 : 1;
  if (s16(r.y & 0xfff0) !== s16(goal.y & 0xfff0)) d |= s16(r.y & 0xfff0) > s16(goal.y & 0xfff0) ? 8 : 4;
  r.facing = d; r.oldX = r.x; r.oldY = r.y;
  const step = t.codeWord(0x7b4a + 2 * (state.lag * 16 + target().type));
  const bits = d & r.moveMask; // 1000:5ED7
  if (bits & 1) r.x = s16(r.x + step); if (bits & 2) r.x = s16(r.x - step);
  if (bits & 4) r.y = s16(r.y + step); if (bits & 8) r.y = s16(r.y - step);
  r.moveMask = 0x0f; r.conveyor = 0;
  // The original passes whatever CX holds as the own cell; an occupied cell is treated as blocking (approximation).
  for (const [dx, dy] of [[-0x2c, -0x78], [0x2c, -0x78], [-0x2c, 0x10], [0x2c, 0x10]]) if (wallTest(state, r.x + dx, r.oldY + dy, -1)) r.x = r.oldX;
  for (const [dx, dy] of [[-0x2c, -0x78], [0x2c, -0x78], [-0x2c, 0x10], [0x2c, 0x10]]) if (wallTest(state, r.oldX + dx, r.y + dy, -1)) r.y = r.oldY;
}
function objectHook0B(state, r) { // 1000:6C10
  if (state.selfDestruct) { setObjectType(state, r, 8); state.sounds.push(0x0d); return; }
  const damage = shotHit(state, r, 0x10, 0, 0x20);
  if (damage) { r.energy = s16(r.energy - damage); if (r.energy <= 0) { setObjectType(state, r, 8); state.sounds.push(0x0d); return; } }
  for (const p of state.players) { // 1000:6C53: no hurt flash and no invulnerability check
    if (r.x < p.x - 0x14 || r.x > p.x + 0x14 || r.y < p.y - 0x14 || r.y > p.y + 0x14 || !(r.frame & 1)) continue;
    p.energy = u16(p.energy - 4); state.sounds.push(0x0f);
  }
}
// 1000:3669, the frame after the boss's energy runs out: 20 explosions around it, aliens and their palette and sheet
// return, the self-destruct starts, and level-specific cells open.
function bossDeath(state) {
  const r = state.dyingBoss; setObjectType(state, r, 8);
  const x0 = r.x, y0 = r.y;
  for (let i = 0; i < 20; i++) {
    const x = s16((random(state) & 0x3f) - 0x20 + x0), y = s16((random(state) & 0x7f) - 0x80 + y0);
    createEffect(state, 8 + (random(state) & 1), x, y); state.sounds.push(0x0d);
  }
  state.aliensSuppressed = false; state.alienPalette = null; state.alienSheet = null; // 1000:205F reloads the level's
  startSelfDestruct(state);
  const boss = BOSSES[state.level], { x, y } = state.objective;
  if (boss) for (const [dx, dy, list, tile, type] of boss.opened) placeCell(state, x + dx, y + dy, list, tile, type);
}
