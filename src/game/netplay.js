// Network play for two players (a port addition). Both browsers run the whole program from their own game files and
// advance it in lockstep, one vertical retrace at a time: a retrace runs only when both sides' input for it is known.
// The host is the PC: its keyboard is the game's keyboard (player 1, the menus, cheat words, pause). The guest is player 2
// on joystick 2 ([B42C]), and its other keys are forwarded to the same keyboard. Inputs are sent DELAY retraces ahead.
export const DELAY = 3, HASH_EVERY = 120;

// `transport`: { send(message), onMessage(fn), onClose(fn), close() }. Messages: { t: 'in', n, keys: [[code, down]], joy }
// for retrace n, { t: 'hash', n, h } every HASH_EVERY retraces, { t: 'start', settings } and { t: 'bye', reason }.
export function createLockstep(role, transport, events = {}) {
  const remote = new Map(), local = new Map(), hashes = new Map();
  let closed = false;
  const reset = () => { remote.clear(); local.clear(); hashes.clear(); for (let n = 0; n < DELAY; n++) { remote.set(n, { keys: [], joy: 0 }); local.set(n, { keys: [], joy: 0 }); } };
  reset();
  transport.onMessage(message => {
    if (message.t === 'in') remote.set(message.n, { keys: message.keys, joy: message.joy });
    else if (message.t === 'hash') compare(message.n, message.h, 'remote');
    else if (message.t === 'start') { reset(); events.start?.(message.settings); }
    else if (message.t === 'bye') { closed = true; events.closed?.(message.reason || 'The other player left.'); }
  });
  transport.onClose(() => { if (!closed) { closed = true; events.closed?.('The connection was lost.'); } });
  function compare(n, h, from) {
    const entry = hashes.get(n) ?? {}; entry[from] = h; hashes.set(n, entry);
    if (entry.local !== undefined && entry.remote !== undefined) {
      hashes.delete(n);
      if (entry.local !== entry.remote) events.desync?.(n);
    }
  }
  return {
    role,
    // Both inputs for retrace n are known.
    ready: n => remote.has(n) && local.has(n),
    // This side's input for retrace n + DELAY, sent when retrace n runs.
    queue(n, keys, joy) { const data = { keys, joy }; local.set(n + DELAY, data); transport.send({ t: 'in', n: n + DELAY, ...data }); },
    // The host's and the guest's input for retrace n, then forgotten.
    take(n) {
      const mine = local.get(n), theirs = remote.get(n); local.delete(n); remote.delete(n);
      return role === 'host' ? { host: mine, guest: theirs } : { host: theirs, guest: mine };
    },
    hash(n, h) { transport.send({ t: 'hash', n, h }); compare(n, h, 'local'); },
    start(settings) { reset(); transport.send({ t: 'start', settings }); }, // both sides restart the retrace count
    close(reason) { if (!closed) { closed = true; transport.send({ t: 'bye', reason }); transport.close(); } },
    get closed() { return closed; },
  };
}

// A small state hash for the desync check: FNV-1a over the values that drive the game.
export function stateHash(state, extra = []) {
  let h = 0x811c9dc5;
  const mix = v => { h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0; h = Math.imul(h ^ (v >>> 16 & 0xffff), 0x01000193) >>> 0; };
  for (const v of extra) mix(v | 0);
  if (state) {
    mix(state.frameCounter); mix(state.rng.s); mix(state.rng.c); mix(state.aliveAliens); mix(state.playerCount);
    for (const p of state.players) { mix(p.x); mix(p.y); mix(p.energy); mix(p.ammo); mix(p.lives); }
    for (const o of state.objects) if (o.active) { mix(o.type); mix(o.x); mix(o.y); mix(o.frame); }
  }
  return h;
}

// Two tabs of one browser (development and tests): a BroadcastChannel named after the room.
export function broadcastTransport(room, role) {
  const channel = new BroadcastChannel(`alien-breed-${room}`), handlers = [], closers = [];
  channel.onmessage = event => { if (event.data.from !== role) for (const fn of handlers) fn(event.data.message); };
  return { send: message => channel.postMessage({ from: role, message }), onMessage: fn => handlers.push(fn), onClose: fn => closers.push(fn), close: () => channel.close() };
}

// PeerJS: the host opens a peer and waits; the guest connects to the host's id. The id is brokered by PeerJS's public
// server unless `options` names another one; the game data never leaves the browsers, only the inputs do.
export async function peerTransport(role, hostId, options = {}) {
  const { Peer } = await import('peerjs');
  const peer = new Peer(options);
  const id = await new Promise((resolve, reject) => { peer.on('open', resolve); peer.on('error', reject); });
  const connection = await new Promise((resolve, reject) => {
    peer.on('error', reject);
    if (role === 'host') { options.onId?.(id); peer.on('connection', c => c.on('open', () => resolve(c))); }
    else { const c = peer.connect(hostId, { reliable: true }); c.on('open', () => resolve(c)); c.on('error', reject); }
  });
  return {
    id, send: message => connection.send(message), onMessage: fn => connection.on('data', fn),
    onClose: fn => { connection.on('close', fn); peer.on('disconnected', fn); }, close: () => { connection.close(); peer.destroy(); },
  };
}
