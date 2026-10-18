// Keyboard adapter: builds the per-frame input byte like the INT 9 handler (1000:79D4) with the SETUP.DAT bindings.
// Each key owns its bit, so opposite directions can be held together, as in the original.
import { INPUT } from './sim.js';

// Browser KeyboardEvent.code for the PC scancodes SETUP.DAT can name (set 1). Unknown codes are reported.
const SCANCODE_KEYS = {
  0x01: 'Escape', 0x10: 'KeyQ', 0x11: 'KeyW', 0x12: 'KeyE', 0x13: 'KeyR', 0x14: 'KeyT', 0x15: 'KeyY', 0x16: 'KeyU', 0x17: 'KeyI', 0x18: 'KeyO', 0x19: 'KeyP',
  0x1c: 'Enter', 0x1d: 'ControlLeft', 0x1e: 'KeyA', 0x1f: 'KeyS', 0x20: 'KeyD', 0x21: 'KeyF', 0x22: 'KeyG', 0x23: 'KeyH', 0x24: 'KeyJ', 0x25: 'KeyK', 0x26: 'KeyL',
  0x2a: 'ShiftLeft', 0x2c: 'KeyZ', 0x2d: 'KeyX', 0x2e: 'KeyC', 0x2f: 'KeyV', 0x30: 'KeyB', 0x31: 'KeyN', 0x32: 'KeyM', 0x35: 'Slash', 0x36: 'ShiftRight',
  0x38: 'AltLeft', 0x39: 'Space', 0x48: 'ArrowUp', 0x4b: 'ArrowLeft', 0x4d: 'ArrowRight', 0x50: 'ArrowDown',
  0x02: 'Digit1', 0x03: 'Digit2', 0x04: 'Digit3', 0x05: 'Digit4', 0x06: 'Digit5', 0x07: 'Digit6', 0x08: 'Digit7', 0x09: 'Digit8',
  0x0a: 'Digit9', 0x0b: 'Digit0', 0x0c: 'Minus', 0x0d: 'Equal',
};
const SCANCODES = new Map(Object.entries(SCANCODE_KEYS).map(([scancode, code]) => [code, Number(scancode)]));
// SETUP.DAT offsets 0x5E-0x66 (copied at 1000:0259-027A): up, down, left, right, fire, action, pause, abort, quit.
export function bindingsFromSetup(setup) {
  if (setup.length < 0x67) throw new Error('SETUP.DAT is shorter than the 103 bytes this port expects');
  const names = ['up', 'down', 'left', 'right', 'fire', 'action', 'pause', 'abort', 'quit'], bindings = {};
  names.forEach((name, i) => {
    const code = SCANCODE_KEYS[setup[0x5e + i]];
    if (!code) throw new Error(`SETUP.DAT binds ${name} to scancode 0x${setup[0x5e + i].toString(16)}, which this port cannot map yet`);
    bindings[name] = code;
  });
  return bindings;
}

const BITS = { up: INPUT.UP, down: INPUT.DOWN, left: INPUT.LEFT, right: INPUT.RIGHT, fire: INPUT.FIRE, action: INPUT.ACTION };
// Numpad arrows send the same scancodes as the grey arrow keys in the original (no E0 handling).
const ALIASES = { Numpad8: 'ArrowUp', Numpad2: 'ArrowDown', Numpad4: 'ArrowLeft', Numpad6: 'ArrowRight' };
export function createKeyboard(bindings) {
  const held = new Set(), bitForCode = new Map();
  for (const [name, bit] of Object.entries(BITS)) bitForCode.set(bindings[name], bit);
  const code = event => ALIASES[event.code] || event.code;
  // [B086]: the last make or break (0x80 | make) scancode the INT 9 handler saw; the main loop consumes some of them.
  let lastScancode = 0;
  const note = (event, release) => { const scancode = SCANCODES.get(code(event)); if (scancode) lastScancode = scancode | (release ? 0x80 : 0); };
  return {
    bindings,
    handles: event => SCANCODES.has(code(event)),
    down(event) { held.add(code(event)); note(event, false); },
    up(event) { held.delete(code(event)); note(event, true); },
    clear() { held.clear(); },
    get lastScancode() { return lastScancode; },
    consumeScancode() { lastScancode = 0; },
    pressed: name => held.has(bindings[name]),
    inputByte() { let bits = 0; for (const c of held) bits |= bitForCode.get(c) || 0; return bits; },
  };
}
