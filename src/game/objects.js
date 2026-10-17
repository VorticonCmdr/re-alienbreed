// Object records (players, aliens, effects) and the original's object script interpreter (1000:6874), which runs
// the bytecode in segment 3AD0 of the user's executable. Unmodelled opcodes and hooks are reported, not guessed.
export const PLAYER_RECORDS = 2, OBJECT_SLOTS = 48; // records BE1C, BE88, then 48 slots from BEF4
const SCRIPT_SEGMENT = 0x3ad0, SCRIPT_TABLE = 0xe756, DATA = 0x2041;

export function scriptTables(exe) {
  return { scriptWord: ptr => exe.u16(SCRIPT_SEGMENT, ptr & 0xffff), scriptStart: type => exe.u16(DATA, SCRIPT_TABLE + 2 * type) };
}

export function emptyRecord() {
  return { active: false, flags0A: 0, flags0B: 0, type: 0, script: 0, delay: 0, loopCount: 0, loopAddress: 0, returnAddress: 0,
    x: 0, y: 0, z: 0, oldX: 0, oldY: 0, oldZ: 0, frame: 0, priority: 0, energy: 0, ticks: 0 };
}

// Fields 1000:7376 sets on allocation (it does not set the displayed frame).
function initRecord(state, record, type, x, y) {
  Object.assign(record, emptyRecord(), { active: true, flags0A: 0x80, flags0B: 0x40, type, script: state.tables.scriptStart(type), x, y, oldX: x, oldY: y, priority: 8 });
}

// 1000:7376: the first free slot after the player records. The original writes into a stale record when none is free.
export function allocObject(state, type, x, y) {
  const record = state.objects.slice(PLAYER_RECORDS).find(r => !r.active);
  if (!record) { state.report('No free object record'); return null; }
  initRecord(state, record, type, x, y); state.objectCount++;
  return record;
}
export function initPlayerRecord(state, record, x, y) { initRecord(state, record, 1, x, y); state.objectCount++; }

// 1000:665C: switch to another animation type.
export function setObjectType(state, record, type) { record.type = type; record.script = state.tables.scriptStart(type); }

function freeRecord(state, record) {
  if (record.parent) state.report('Freeing a child object');
  Object.assign(record, emptyRecord()); state.objectCount--;
}

const s16 = v => (v << 16) >> 16;
// One script step (1000:68E7).
function stepScript(state, record) {
  const word = state.tables.scriptWord;
  if (record.delay) { record.delay--; if (record.delay) yieldHook(state, record); return; }
  let ptr = record.script, guard = 0;
  const arg = () => { const v = word(ptr); ptr = (ptr + 2) & 0xffff; return v; };
  for (;;) {
    if (++guard > 1000) { state.report(`Object script at 3AD0:${record.script.toString(16)} does not yield`); return; }
    const op = arg();
    switch (op) {
      case 0x00: freeRecord(state, record); return;
      case 0x02: record.script = ptr; yieldHook(state, record); return;
      case 0x04: record.frame = arg(); record.script = ptr; yieldHook(state, record); return;
      case 0x06: record.x = s16(arg()); record.y = s16(arg()); record.z = s16(arg()); break;
      case 0x08: record.x = s16(record.x + arg()); record.y = s16(record.y + arg()); record.z = s16(record.z + arg()); break;
      case 0x0a: ptr = arg(); break;
      case 0x0c: record.delay = arg(); record.script = ptr; yieldHook(state, record); return;
      case 0x0e: record.x = s16(arg()); break;
      case 0x10: record.y = s16(arg()); break;
      case 0x2c: record.z = s16(arg()); break;
      case 0x12: record.x = s16(record.x + arg()); break;
      case 0x14: record.y = s16(record.y + arg()); break;
      case 0x2e: record.z = s16(record.z + arg()); break;
      case 0x16: record.loopCount = arg(); record.loopAddress = ptr; break;
      case 0x18: record.loopCount = (record.loopCount - 1) & 0xffff; if (record.loopCount) ptr = record.loopAddress; break;
      case 0x1a: record.flags0B &= ~0x80; break;
      case 0x1c: record.flags0B |= 0x80; break;
      case 0x1e: record.returnAddress = (ptr + 2) & 0xffff; ptr = arg(); break;
      case 0x20: ptr = record.returnAddress; record.returnAddress = 0; break;
      case 0x26: record.flags0B = (record.flags0B & ~3) | (arg() & 3); break;
      case 0x30: setObjectType(state, record, arg()); ptr = record.script; break;
      case 0x48: record.flags0B &= ~0x40; break;
      case 0x4a: record.flags0B |= 0x10; break;
      case 0x4c: record.flags0B &= ~0x10; break;
      case 0x50: record.flags0B |= 0x08; break;
      case 0x52: record.flags0B &= ~0x08; break;
      case 0x54: { const d = arg(); record.x = s16(record.flags0B & 1 ? record.x - d : record.x + d); break; }
      case 0x6c: record.flags0B ^= 1; break;
      case 0x72: state.sounds.push(arg()); break;
      case 0x78: record.priority = s16(arg()); break;
      case 0x7c: record.flags0B |= 0x04; break;
      case 0x7e: record.flags0B &= ~0x04; break;
      case 0x80: record.x = record.safeX; record.y = record.safeY; break;
      case 0x5a: case 0x5c: case 0x60: case 0x6e: case 0x74: break;
      default:
        state.report(`Object script opcode 0x${op.toString(16)} (type ${record.type}, 3AD0:${((ptr - 2) & 0xffff).toString(16)})`);
        record.script = ptr; return;
    }
  }
}
// 1000:6918: the per-type hook only runs with +0A bit 0x40 (bosses and type 0x0B); not modelled yet.
function yieldHook(state, record) { if (record.flags0A & 0x40) state.report(`Object hook for type 0x${record.type.toString(16)}`); }

// 1000:6874: all active records in order, counted down from the active total.
export function runScripts(state) {
  let remaining = state.objectCount - 1;
  for (const record of state.objects) {
    if (remaining < 0) break;
    if (!record.active) continue;
    if (record.parent) state.report('Child object');
    else { stepScript(state, record); record.ticks = (record.ticks + 1) & 0xff; }
    remaining--;
  }
}

// 1000:6764: visible records (+0B bit 0x80) in a stable ascending order of draw priority (+58).
export function drawList(state) {
  return state.objects.filter(r => r.active && r.flags0B & 0x80).map((r, order) => ({ r, order }))
    .sort((a, b) => a.r.priority - b.r.priority || a.order - b.order)
    .map(({ r }) => ({ x: r.x, y: r.y, z: r.z, frame: r.frame, flip: r.flags0B & 1, player2: r === state.objects[1] }));
}
