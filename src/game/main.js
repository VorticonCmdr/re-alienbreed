// Browser adapter: asset loading, keyboard, fixed-step timing and canvas output. The simulation lives in sim.js.
import { assetSource, entriesFromFileList } from './assets.js';
import { openExe } from './exe.js';
import { decodeMap, buildTileStore, levelMapNames, levelTileSheetNames } from './level.js';
import { buildGamePalette, dacToRgb, alienSheetName, redAlertPalette, levelStartPalette } from './palette.js';
import { createHud, drawHud, blitPanel } from './hud.js';
import { createFramebuffer, drawMap, drawObjects, drawShots, toRgba, SCREEN_WIDTH } from './render.js';
import { frameDescriptor, drawSprite } from './sprites.js';
import { readTables, startLevel, levelTileset, stepFrame, mainLoopKeys, mapRequested, nextStage, savePlayer, carriedGlobals, timerTick, UnsupportedPath } from './sim.js';
import { createDisplay, cutFont, createTextState, fadeIn, fadeOut } from './screens.js';
import { intermission, intermissionPicture, deckmanSheetName } from './intermission.js';
import { gameOver, ending, gameOverFiles, endingPictures } from './endings.js';
import { titleLoop, titleFiles } from './title.js';
import { intro, introFiles } from './intro.js';
import { passcode } from './passcode.js';
import { intexSession, mapSession, intexFiles, createIntexMemory } from './intex.js';
import { createTimer, setReload, advanceRetrace, RELOAD, GAME_OPEN_SHARE, RETRACE_HZ } from './timing.js';
import { createFmDriver, createMusic, songFile, SONGS } from './fmdriver.js';
import { createOpl, OPL_RATE } from './opl2.js';
import { bindingsFromSetup, createKeyboard } from './input.js';
import { decompressLzhuf } from '../lzhuf.js';
import { decodeVga, decodePlanar, decodeVoc } from '../formats.js';
import { sampleNames, samplePriorities, createEffectPlayer } from './sound.js';

const $ = id => document.getElementById(id);
const canvas = $('screen'), context = canvas.getContext('2d'), image = context.createImageData(320, 200);
const FRAME_MS = 1000 / 70.086; // one game frame per VGA retrace on a fast machine; lag flag 0 (docs/port/evidence.md)
const PLAYFIELD = 176, NEW_GAME_LEVEL = 1; // 1000:17DE: a new game starts at level index 1 (the attract demo uses 2)
let game = null, assets = null, keyboard = null, audio = null, effects = null, running = false, accumulator = 0, last = 0, session = null;
const display = createDisplay(), timer = createTimer();

function status(message) { $('status').textContent = message; }
function showDiagnostic(error) {
  const box = $('diagnostic');
  box.textContent = error instanceof UnsupportedPath
    ? `Stopped: ${error.message} (level ${game?.level}, frame ${game?.state.frame ?? '?'}). This behaviour is not reproduced yet, so strict mode stops instead of guessing.`
    : `Error: ${error.message}`;
  box.hidden = false; running = false;
}

// Everything that does not change between levels: executable tables, samples, panel, player sheets, key bindings.
async function loadCommon(source) {
  const exe = await openExe(await source.read('ALIEN.EXE'));
  const sprites = async name => decodePlanar(decompressLzhuf(await source.read(name))).pixels;
  const setup = await source.read('SETUP.DAT');
  // Samples are decoded once per page; the AudioContext starts on the Play click (a user gesture).
  audio ??= new AudioContext(); const names = sampleNames(exe);
  const buffers = await Promise.all(names.map(async name => {
    const { samples, sampleRate } = decodeVoc(await source.read(name));
    const buffer = audio.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0); return buffer;
  }));
  effects?.stop(); effects = createEffectPlayer(audio, audio.destination, buffers, samplePriorities(exe, names.length));
  keyboard = createKeyboard(bindingsFromSetup(setup));
  const frames = new Map(), descriptor = n => { if (!frames.has(n)) frames.set(n, frameDescriptor(exe, n)); return frames.get(n); };
  assets = {
    source, exe, tables: readTables(exe), descriptor, abortScancode: setup[0x65], mapNames: levelMapNames(exe),
    players: [await sprites('PLAYER1.EHF'), await sprites('PLAYER2.EHF')], explosions: [await sprites('BOOM_NEW.EHF')],
    hud: createHud(decodeVga(decompressLzhuf(await source.read('PANEL.VHF'))).pixels),
    font: cutFont(decompressLzhuf(await source.read(exe.string(0x2041, 0x9a8c + 8))).subarray(0, 64000)), text: createTextState(),
    deckman: await sprites(deckmanSheetName(exe)),
    // Boss sheets (records 2041:93FA, 93E6, 940E; the file name follows each 8-byte record), swapped in by 1000:6030.
    bossSheets: Object.fromEntries(await Promise.all([0x93fa, 0x93e6, 0x940e].map(async record => [record, await sprites(exe.string(0x2041, record + 8))]))),
    gameOverSample: await decodeSample(await source.read(gameOverFiles(exe).sample)),
    demo: await source.read('DEMO.DAT'), options: { players: assets?.options?.players ?? 0, share: assets?.options?.share ?? 0 },
    songs: Object.fromEntries(await Promise.all(Object.keys(SONGS).map(async song => [song, await source.read(songFile(exe, song))]))),
  };
  const intex = intexFiles(exe);
  assets.computerPicture = await loadPicture(intex.computer); assets.mapPicture = await loadPicture(intex.map);
  assets.weaponSheet = await sprites(intex.weapons); assets.intexMemory ??= createIntexMemory(exe);
  const introAssets = introFiles(exe);
  assets.logos = await Promise.all(introAssets.logos.map(async logo => ({ ...logo, ...await loadPicture(logo.name) })));
  assets.logoSample = await decodeSample(await source.read(introAssets.sample));
  assets.titlePicture = await loadPicture(titleFiles(exe).title); assets.storyPicture = await loadPicture(titleFiles(exe).story);
  // The FM driver programs the PIT itself (fn 4, fn 6, fn 7), which sets the INT 8 rate.
  opl = createOpl();
  music = createMusic(createFmDriver(await source.read('AVMFM.BIN'), opl.write, reload => setReload(timer, reload)));
  musicOut?.disconnect(); musicOut = audio.createGain(); musicOut.gain.value = 0.6; musicOut.connect(audio.destination);
  musicClock = 0;
}

// 1000:1937-1FC1 for one level: tiles, map, palette, alien sheet, then the level start and its two warm-up frames.
async function loadLevel(level, carried, demoMode = 0) {
  const { source, exe, tables } = assets;
  const sheetBytes = await Promise.all(levelTileSheetNames(exe, level).map(name => source.read(name)));
  const map = decodeMap(decompressLzhuf(await source.read(assets.mapNames[level])));
  const tileStore = buildTileStore(sheetBytes.map(bytes => decodeVga(bytes)));
  const dac = levelStartPalette(exe, buildGamePalette(exe, sheetBytes[1], level), level), redDac = redAlertPalette(dac);
  // Sheets by the DS variable a frame descriptor names: players (B409, PLAYER2 at +0x7D00), explosions (ADD2), aliens (B0B4).
  const aliens = decodePlanar(decompressLzhuf(await source.read(alienSheetName(exe, level)))).pixels;
  const sheets = { 0xb409: assets.players, 0xadd2: assets.explosions, 0xb0b4: [aliens] }, levelAliens = [aliens];
  const state = startLevel({ tables, map, level, tileset: levelTileset(exe, level), strict: !$('preview').checked, saved: carried.player, globals: carried.globals, rngSeed: carried.rngSeed, demoMode });
  state.playerCount = assets.options.players + 1; state.shareCredits = !!assets.options.share; // [B09A] from cs:1117, cs:1118
  if (state.playerCount === 2) state.report('Two players');
  game = { level, state, tileStore, dac, redDac, levelDac: dac, levelAliens, alienPalette: null, sheets, hud: assets.hud, descriptor: assets.descriptor, tables, framebuffer: createFramebuffer() };
}

function renderGame() {
  const { state, framebuffer: fb, tileStore, sheets, hud, descriptor, tables } = game, view = state.view;
  fb.fill(0);
  drawMap(fb, state, tileStore, view.tileCamera.x - 16, view.tileCamera.y, 0, PLAYFIELD);
  drawObjects(fb, view, sheets, descriptor, drawSprite, PLAYFIELD);
  drawShots(fb, view, tables, sheets, descriptor, drawSprite, PLAYFIELD);
  if (view.timerDigits !== null) [view.timerDigits >> 4, view.timerDigits & 15].forEach((digit, i) => {
    const d = descriptor(0xd3 + digit); drawSprite(fb, d, sheets[d.sheetVariable], 32 + 16 * i + d.adjustX, 32 + d.adjustY, false, 0, PLAYFIELD);
  });
  for (const p of state.players) if (p.alive) drawHud(hud, p);
  blitPanel(fb, hud);
  display.frame.set(fb);
}
// 1000:6030 copies a boss palette to bank 0xC0 and swaps the alien sheet; 205F restores both after the boss.
function bossPalette(state) {
  game.alienPalette = state.alienPalette;
  const dac = Uint8Array.from(game.levelDac);
  if (state.alienPalette !== null) dac.set(assets.exe.bytes(0x2041, state.alienPalette, 48), 0xc0 * 3);
  game.dac = dac; game.redDac = redAlertPalette(dac);
  game.sheets[0xb0b4] = state.alienSheet !== null ? [assets.bossSheets[state.alienSheet]] : game.levelAliens;
  display.dac.set(state.redAlert ? game.redDac : game.dac);
}
function present() {
  image.data.set(toRgba(display.frame, dacToRgb(display.dac))); context.putImageData(image, 0, 0);
  const state = game?.state; if (!state) return;
  if (state.demoSaved) { offerDemo(state.demoSaved); state.demoSaved = null; }
  const p = state.players[0];
  const skipped = [...new Set(state.diagnostics.map(d => d.message.replace(/ at .*| \(.*/, '')))];
  $('preview-banner').hidden = state.strict;
  $('preview-banner').textContent = `Preview mode: not reproduced and skipped so far: ${skipped.join(', ') || 'nothing yet'}. Preview runs are not faithful.`;
  $('debug').textContent = `Level ${game.level}  Keys ${p.keys}  Energy ${p.energy}  Lives ${p.lives}  Ammo ${p.ammo >> 7}+${p.ammo & 127}  Weapon ${p.weapon}  Aliens ${state.aliveAliens}  Frame ${state.frame}`;
}

// The whole game as one generator: every `yield` is one vertical retrace; yielding a promise waits for loading.
// `retrace` holds this retrace's INT 8 runs (and music ticks), computed by the driver below.
let retrace = { ticks: 0, music: [] }, inGame = false;
const intTicks = state => { for (let i = 0; i < retrace.ticks; i++) timerTick(state); }; // INT 8 work outside game frames
function* idle(generator, state) { for (const _ of generator) { if (state) intTicks(state); yield; } }

// The program after start-up (1000:0831): title music, then the title loop, games and attract demos for ever.
function* program(devLevel) {
  if (devLevel !== null) return yield* gameSession(devLevel, false);
  if ($('passcode').checked) { // ALIEN.EX_ 1000:03C1-0493; the supplied ALIEN.EXE jumps over the comparison
    phase = 'passcode'; typedChars = []; canvas.hidden = true;
    const ok = yield* passcode({ exe: assets.exe, show: text => { $('dos').textContent = text; $('dos').hidden = false; },
      pick: () => Math.floor(Math.random() * 256), // the game's RNG low byte [B038]; how the RNG is seeded this early is not established
      takeChar: () => typedChars.length ? typedChars.shift() : null,
      log: e => console.info(`Alien Breed code for Table-${e.table} Row-${e.row} Column-${e.column}: ${e.code}`) });
    typedChars = null; $('dos').hidden = true; canvas.hidden = false;
    if (!ok) throw new ProgramExit(); // 0490: three wrong codes jump to the program exit (7B0F)
  }
  phase = 'intro'; yield* intro({ display, logos: assets.logos, playSample: () => effects.playBuffer(assets.logoSample) }); // 1000:0761-0767
  phase = 'title'; music.start('title', assets.songs.title, { stopFirst: false }); // 1000:0BAD
  for (;;) {
    const input = () => keyboard.inputByte();
    const choice = yield* titleLoop({ exe: assets.exe, display, font: assets.font, text: assets.text, title: assets.titlePicture, story: assets.storyPicture,
      input, ticks: () => retrace.ticks, options: assets.options, report: strictReport });
    lastResult = yield* gameSession(choice === 'start' ? NEW_GAME_LEVEL : DEMO_LEVEL, choice === 'demo');
    music.start('title', assets.songs.title, { stopFirst: true }); // 1000:204E / 2053 (the music was stopped at 2017)
  }
}
let lastResult = null, phase = null, typedChars = null; // typedChars: INT 21h/01 input while the code prompt waits

// The Intex (1000:2588) or the M screen (33C6), then their common way back (28B3 / 3465): a frame end that sees all
// the ticks since the last one (so a lag frame follows), two game frames on a black palette, the fade-in, and for
// the Intex the in-game song from its beginning, whatever played before.
function* terminal(state, player, kind) {
  inGame = false;
  const common = { exe: assets.exe, display, font: assets.font, text: assets.text, memory: assets.intexMemory, player, state,
    input: () => keyboard.inputByte(), ticks: () => retrace.ticks, report: state.report };
  if (kind === 'intex') {
    yield* idle(intexSession({ ...common, pictures: { computer: assets.computerPicture }, weaponSheet: assets.weaponSheet, descriptor: assets.descriptor,
      scancode: () => keyboard.lastScancode, consumeScancode: () => keyboard.consumeScancode(), sound: id => effects.play(id), exitProgram: () => { throw new ProgramExit(); },
      music: { start: song => music.start(song, assets.songs[song], { stopFirst: false }), stop: () => music.stop() } }), state);
  } else yield* idle(mapSession({ ...common, picture: assets.mapPicture }), state);
  intTicks(state); yield; // 3000:01B0
  state.lag = !state.demoMode && !state.demoRecord && state.frameTicks >= 5 ? 1 : 0; state.frameTicks = 0;
  inGame = true;
  for (let i = 0; i < 2; i++) { // 37D6 twice
    state.sounds = []; stepFrame(state, keyboard.inputByte(), retrace.ticks);
    for (const id of state.sounds) effects.play(id);
    renderGame(); yield;
  }
  inGame = false;
  yield* idle(fadeIn(display, state.redAlert ? game.redDac : game.dac), state);
  if (kind === 'intex') { music.start('ingame', assets.songs.ingame, { stopFirst: false }); state.music = 'ingame'; state.musicStop = false; } // 2402
  state.countdownFrozen = false; inGame = true;
}
const DEMO_LEVEL = 2;

function* gameSession(firstLevel, demo) {
  let carried = { player: null, globals: null, rngSeed: newGameSeed() };
  for (let level = firstLevel; ;) {
    music.stop(); // 1000:1949 (2261): fn 7, which also sets the PIT back to 0x438C
    const previous = game?.state;
    if (!demo && (level !== firstLevel || level === NEW_GAME_LEVEL)) { // 1000:198E, not in demo mode
      const picture = yield loadPicture(intermissionPicture(assets.exe, level));
      yield* idle(intermission(level, { exe: assets.exe, display, font: assets.font, text: assets.text, picture, deckman: assets.deckman, tables: assets.tables,
        descriptor: assets.descriptor, input: () => keyboard.inputByte(), report: message => previous ? previous.report?.(message) : strictReport(message), exitTaken: previous?.exitTaken }), previous);
    }
    yield loadLevel(level, carried, demo ? 2 : 0);
    let demoFrame = 0;
    const state = game.state;
    stepFrame(state, 0, retrace.ticks); yield; stepFrame(state, 0, retrace.ticks); yield; // two warm-up passes of 37D6 (1000:1F8D)
    renderGame(); yield* idle(fadeIn(display, game.dac), state); // 1000:1FB9
    music.start('ingame', assets.songs.ingame, { stopFirst: false }); // 1000:1FBE (2402); the driver sets 120 Hz
    inGame = true;
    let result = null;
    for (;;) { // 1000:34E6
      state.sounds = [];
      const key = mainLoopKeys(state, keyboard.lastScancode, assets.abortScancode, assets.intexMemory.cheats);
      if (key === 'consumed') keyboard.consumeScancode();
      for (const id of state.sounds) effects.play(id);
      if (key === 'previous') { result = 'previous'; break; }
      if (key === 'abort' || state.levelOver) { result = key === 'abort' ? 'aborted' : state.levelOver; break; }
      if (demo) { const end = demoFrame === 0x3ff; stepFrame(state, assets.demo[demoFrame++], retrace.ticks, { demoEnd: end }); }
      else stepFrame(state, keyboard.inputByte(), retrace.ticks);
      for (const id of state.sounds) effects.play(id);
      // 1000:5FBD starts the alarm song without stopping the in-game one (docs/port/avmfm.md 2.4); the boss stops first.
      if (state.music !== music.song) { music.start(state.music, assets.songs[state.music], { stopFirst: state.musicStop }); state.musicStop = false; }
      if (state.alienPalette !== game.alienPalette) bossPalette(state);
      renderGame(); display.dac.set(state.redAlert ? game.redDac : game.dac);
      if (state.intexRequest) { const player = state.intexRequest; state.intexRequest = null; yield* terminal(state, player, 'intex'); continue; } // 1000:35E0
      const map = mapRequested(state, keyboard.lastScancode); // 1000:35F2
      if (map.consumed) keyboard.consumeScancode();
      if (map.player) { yield* terminal(state, map.player, 'map'); continue; }
      // 1000:364A: R (make code 0x13, not consumed) after the recording cheat starts recording from index 0, again on every
      // pass while it is the last scancode; the bytes overwrite the buffer the attract demo plays.
      if (keyboard.lastScancode === 0x13 && assets.intexMemory.recordArmed) state.demoRecord = { buffer: assets.demo, index: 0 };
      yield;
    }
    inGame = false;
    const next = nextStage(level, result, state.levelCode);
    if (result === 'previous' && state.demoRecord) throw new UnsupportedPath('Level change while recording a demo (1000:1E9D skips the player restore)', {});
    if (result === 'previous') { // 1000:3526: back one level; the fade runs with the music still playing
      yield* idle(fadeOut(display), state);
      carried = { player: savePlayer(state.players[0]), globals: carriedGlobals(state) };
      if (next.level < 0) throw new UnsupportedPath('Level index below 0', {});
      level = next.level; continue;
    }
    if (state.demoRecord && result !== 'gameover' && result !== 'aborted') throw new UnsupportedPath('Level change while recording a demo (1000:1E9D skips the player restore)', {});
    music.stop(); // 1000:1FDB
    yield* idle(fadeOut(display), state); // 1000:1FDE
    if (next.kind === 'level') {
      carried = { player: savePlayer(state.players[0]), globals: carriedGlobals(state) };
      level = next.level; continue;
    }
    const input = () => keyboard.inputByte();
    if (next.kind === 'ending') { // 1000:41A2
      const pictures = []; for (const name of endingPictures(assets.exe)) pictures.push(yield loadPicture(name));
      yield* idle(ending({ exe: assets.exe, display, font: assets.font, text: assets.text, pictures, input, report: state.report }), state);
    } else if (next.kind === 'level0') { // index 0: 1000:44EC with the exit taken shows text page 0x13
      const picture = yield loadPicture(intermissionPicture(assets.exe, 0));
      yield* idle(intermission(0, { exe: assets.exe, display, font: assets.font, text: assets.text, picture, deckman: assets.deckman, tables: assets.tables,
        descriptor: assets.descriptor, input, report: state.report, exitTaken: true }), state);
    }
    if (demo) return 'demo';
    if (state.demoRecord) return 'Recording interrupted: game over.'; // 1000:2043: no game-over screen while cs:8716 is set
    const picture = yield loadPicture(gameOverFiles(assets.exe).picture); // 1000:4109, then the title
    yield* idle(gameOver({ display, picture, input, playSample: () => effects.playBuffer(assets.gameOverSample) }), state);
    return result === 'aborted' ? 'Game abandoned.' : result === 'complete' ? 'Game complete.' : 'Game over.';
  }
}
// 1000:3956-3981 creates demo.dat in the current directory and writes the 0x400 bytes. A page cannot write into the
// game folder, so the file is offered as a download; the attract demo already plays it (the buffer is shared).
function offerDemo(bytes) {
  const link = $('demo-file'); URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' })); link.hidden = false;
}
const strictReport = message => { if (!$('preview').checked) throw new UnsupportedPath(message, {}); };
async function decodeSample(bytes) { const { samples, sampleRate } = decodeVoc(bytes), b = audio.createBuffer(1, samples.length, sampleRate); b.copyToChannel(samples, 0); return b; }
async function loadPicture(name) { const bytes = decompressLzhuf(await assets.source.read(name)); return { pixels: bytes.subarray(0, 64000), palette: bytes.subarray(64000, 64768) }; }

let waiting = false, resumeWith;
// Music: the OPL output for one retrace, with driver ticks at the IRQ times inside it, queued as Web Audio chunks.
let opl = null, music = null, musicOut = null, musicClock = 0, samplePhase = 0, chunk = [];
const CHUNK = 2048;
function renderMusic() {
  samplePhase += OPL_RATE / RETRACE_HZ;
  const total = Math.floor(samplePhase); samplePhase -= total;
  const out = new Float32Array(total); let done = 0;
  for (const t of retrace.music) {
    const at = Math.min(total, Math.round(t * OPL_RATE));
    opl.render(out, done, at - done); done = at; music.irq();
  }
  opl.render(out, done, total - done);
  chunk.push(out);
  if (chunk.reduce((n, c) => n + c.length, 0) < CHUNK) return;
  const length = chunk.reduce((n, c) => n + c.length, 0), buffer = audio.createBuffer(1, length, OPL_RATE), data = buffer.getChannelData(0);
  let at = 0; for (const c of chunk) { data.set(c, at); at += c.length; } chunk = [];
  const node = audio.createBufferSource(); node.buffer = buffer; node.connect(musicOut);
  if (musicClock < audio.currentTime + 0.02) musicClock = audio.currentTime + 0.08; // (re)start with a little latency
  node.start(musicClock); musicClock += length / OPL_RATE;
}
function tick(now) {
  if (!running) return;
  accumulator = Math.min(accumulator + now - last, FRAME_MS * 8); last = now;
  try {
    while (accumulator >= FRAME_MS && !waiting) {
      retrace = advanceRetrace(timer, inGame ? GAME_OPEN_SHARE : 1);
      const step = session.next(resumeWith); resumeWith = undefined;
      if (opl) renderMusic();
      accumulator -= FRAME_MS;
      if (step.done) { present(); finish(step.value); return; }
      if (step.value instanceof Promise) {
        waiting = true;
        step.value.then(result => { waiting = false; resumeWith = result; last = performance.now(); accumulator = 0; },
          error => { waiting = false; showDiagnostic(error); });
      }
    }
    present();
    requestAnimationFrame(tick);
  } catch (error) { present(); if (error instanceof ProgramExit) exitToDos(); else showDiagnostic(error); }
}
// 1000:7ABF: music stopped (driver functions 7, 8, 3), the voice driver and the timer reset, text mode 2, then INT 21h/09
// prints the '$'-terminated text at DS:5BBA ([5A00] = 0 on this path) and 4Ch ends the program. The page shows that text
// in a plain block instead of an 80x25 text screen.
class ProgramExit extends Error {}
function exitToDos() {
  music.stop(); effects.stop(); running = false; inGame = false;
  let text = ''; for (let p = 0x5bba, n = 0; assets.exe.u8(0x2041, p) !== 0x24 && n < 512; p++, n++) { const c = assets.exe.u8(0x2041, p); if (c >= 0x20 || c === 10) text += String.fromCharCode(c); }
  $('dos').textContent = text; $('dos').hidden = false; canvas.hidden = true; $('setup').hidden = false;
}
function finish(message) {
  running = false;
  const box = $('diagnostic'); box.hidden = false; box.textContent = message; $('setup').hidden = false;
}

function start() {
  audio?.resume(); $('setup').hidden = true; $('diagnostic').hidden = true; $('dos').hidden = true; canvas.hidden = false; running = true; accumulator = 0; last = performance.now();
  canvas.focus(); requestAnimationFrame(tick);
}

// 1000:17FC seeds the generator from [B07A], the high word of the INT 8 tick count since the game started.
const newGameSeed = () => Math.floor(performance.now() / 1000 * 69 / 65536) & 0xffff;

let source = null;
// Development aid: ?level=N skips the title and starts a new game at level index N (0-18).
function startLevelChoice() { const query = new URLSearchParams(location.search), n = Number(query.get('level')); return query.has('level') && Number.isInteger(n) && n >= 0 && n <= 18 ? n : null; }
async function begin(label) {
  try { status(`Loading from ${label}…`); await loadCommon(source); game = null; session = program(startLevelChoice()); start(); }
  catch (error) { status(error.message); }
}

addEventListener('keydown', event => {
  if (typedChars && running) { // DOS character input for the code prompt
    const c = event.key.length === 1 ? event.key : { Enter: '\r', Backspace: '\b', Escape: '\x1b', Tab: '\t' }[event.key];
    if (c !== undefined) { event.preventDefault(); typedChars.push(c); } return;
  }
  if (!keyboard) return;
  if (keyboard.handles(event)) { event.preventDefault(); keyboard.down(event); }
});
addEventListener('keyup', event => { if (keyboard?.handles(event)) { event.preventDefault(); keyboard.up(event); } });
addEventListener('blur', () => keyboard?.clear());
$('choose-folder').addEventListener('click', () => $('folder-input').click());
$('folder-input').addEventListener('change', event => { source = assetSource(entriesFromFileList(event.target.files)); begin('the selected folder'); });
$('play').addEventListener('click', () => begin('game/'));

if (import.meta.env.DEV) {
  try {
    const response = await fetch('./__game_catalog'); const files = response.ok ? await response.json() : [];
    if (files.length) { source = assetSource(files); $('play').hidden = false; status('Original files found in game/.'); }
    else status('Place your original files in game/ or open the game folder.');
  } catch { status('Open your original game folder to start.'); }
} else status('Open your original game folder to start. Files are read in your browser and not uploaded.');

window.__alienBreed = { get state() { return game?.state; }, get framebuffer() { return game?.framebuffer; }, get display() { return display; }, get running() { return running; }, get level() { return game?.level; }, get effectsPlayed() { return effects?.played ?? []; }, get music() { return { song: music?.song, scheduled: musicClock } }, get timer() { return { ...timer }; }, get phase() { return phase; }, get recordArmed() { return !!assets?.intexMemory?.recordArmed; } };
