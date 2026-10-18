// Browser adapter: asset loading, keyboard, fixed-step timing and canvas output. The simulation lives in sim.js.
import { assetSource, entriesFromFileList } from './assets.js';
import { openExe } from './exe.js';
import { decodeMap, buildTileStore, levelMapNames, levelTileSheetNames } from './level.js';
import { buildGamePalette, dacToRgb, alienSheetName, redAlertPalette, levelStartPalette } from './palette.js';
import { createHud, drawHud, blitPanel } from './hud.js';
import { createFramebuffer, drawMap, drawObjects, drawShots, toRgba, SCREEN_WIDTH } from './render.js';
import { frameDescriptor, drawSprite } from './sprites.js';
import { readTables, startLevel, levelTileset, stepFrame, mainLoopKeys, savePlayer, carriedGlobals, timerTick, UnsupportedPath } from './sim.js';
import { createDisplay, cutFont, createTextState, fadeIn, fadeOut } from './screens.js';
import { intermission, intermissionPicture, deckmanSheetName } from './intermission.js';
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
    songs: Object.fromEntries(await Promise.all(Object.keys(SONGS).map(async song => [song, await source.read(songFile(exe, song))]))),
  };
  // The FM driver programs the PIT itself (fn 4, fn 6, fn 7), which sets the INT 8 rate.
  opl = createOpl();
  music = createMusic(createFmDriver(await source.read('AVMFM.BIN'), opl.write, reload => setReload(timer, reload)));
  musicOut?.disconnect(); musicOut = audio.createGain(); musicOut.gain.value = 0.6; musicOut.connect(audio.destination);
  musicClock = 0;
}

// 1000:1937-1FC1 for one level: tiles, map, palette, alien sheet, then the level start and its two warm-up frames.
async function loadLevel(level, carried) {
  const { source, exe, tables } = assets;
  const sheetBytes = await Promise.all(levelTileSheetNames(exe, level).map(name => source.read(name)));
  const map = decodeMap(decompressLzhuf(await source.read(assets.mapNames[level])));
  const tileStore = buildTileStore(sheetBytes.map(bytes => decodeVga(bytes)));
  const dac = levelStartPalette(exe, buildGamePalette(exe, sheetBytes[1], level), level), redDac = redAlertPalette(dac);
  // Sheets by the DS variable a frame descriptor names: players (B409, PLAYER2 at +0x7D00), explosions (ADD2), aliens (B0B4).
  const aliens = decodePlanar(decompressLzhuf(await source.read(alienSheetName(exe, level)))).pixels;
  const sheets = { 0xb409: assets.players, 0xadd2: assets.explosions, 0xb0b4: [aliens] };
  const state = startLevel({ tables, map, level, tileset: levelTileset(exe, level), strict: !$('preview').checked, saved: carried.player, globals: carried.globals, rngSeed: carried.rngSeed });
  game = { level, state, tileStore, dac, redDac, sheets, hud: assets.hud, descriptor: assets.descriptor, tables, framebuffer: createFramebuffer() };
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
function present() {
  image.data.set(toRgba(display.frame, dacToRgb(display.dac))); context.putImageData(image, 0, 0);
  const state = game?.state; if (!state) return;
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

function* gameSession(firstLevel) {
  let carried = { player: null, globals: null, rngSeed: newGameSeed() };
  for (let level = firstLevel; ;) {
    music.stop(); // 1000:1949 (2261): fn 7, which also sets the PIT back to 0x438C
    const previous = game?.state;
    if (level !== firstLevel || level === NEW_GAME_LEVEL) { // 1000:198E, not in demo mode
      const picture = yield loadPicture(intermissionPicture(assets.exe, level));
      yield* idle(intermission(level, { exe: assets.exe, display, font: assets.font, text: assets.text, picture, deckman: assets.deckman, tables: assets.tables,
        descriptor: assets.descriptor, input: () => keyboard.inputByte(), report: message => previous ? previous.report?.(message) : strictReport(message), exitTaken: previous?.exitTaken }), previous);
    }
    yield loadLevel(level, carried);
    const state = game.state;
    stepFrame(state, 0, retrace.ticks); yield; stepFrame(state, 0, retrace.ticks); yield; // two warm-up passes of 37D6 (1000:1F8D)
    renderGame(); yield* idle(fadeIn(display, game.dac), state); // 1000:1FB9
    music.start('ingame', assets.songs.ingame, { stopFirst: false }); // 1000:1FBE (2402); the driver sets 120 Hz
    inGame = true;
    let result = null;
    for (;;) { // 1000:34E6
      state.sounds = [];
      const key = mainLoopKeys(state, keyboard.lastScancode, assets.abortScancode);
      if (key === 'consumed') keyboard.consumeScancode();
      for (const id of state.sounds) effects.play(id);
      if (key === 'abort' || state.levelOver) { result = key === 'abort' ? 'aborted' : state.levelOver; break; }
      stepFrame(state, keyboard.inputByte(), retrace.ticks);
      for (const id of state.sounds) effects.play(id);
      // 1000:5FBD starts the alarm song without stopping the in-game one (see docs/port/avmfm.md 2.4).
      if (state.music !== music.song) music.start(state.music, assets.songs[state.music], { stopFirst: false });
      renderGame(); display.dac.set(state.redAlert ? game.redDac : game.dac);
      yield;
    }
    inGame = false;
    music.stop(); // 1000:1FDB
    yield* idle(fadeOut(display), state); // 1000:1FDE
    if (result !== 'complete') return result === 'aborted' ? 'Game abandoned.' : 'Game over.'; // 4109 game-over picture not reproduced yet
    if (level === 18) return 'All levels complete. The ending sequence (1000:41A2) is not reproduced yet.';
    if (level === 0) return 'Level index 0 was completed; what follows (1000:44EC) is not reproduced.';
    carried = { player: savePlayer(state.players[0]), globals: carriedGlobals(state) };
    level++;
  }
}
const strictReport = message => { if (!$('preview').checked) throw new UnsupportedPath(message, {}); };
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
  } catch (error) { present(); showDiagnostic(error); }
}
function finish(message) {
  running = false;
  const box = $('diagnostic'); box.hidden = false; box.textContent = message; $('setup').hidden = false;
}

function start() {
  audio?.resume(); $('setup').hidden = true; $('diagnostic').hidden = true; running = true; accumulator = 0; last = performance.now();
  canvas.focus(); requestAnimationFrame(tick);
}

// 1000:17FC seeds the generator from [B07A], the high word of the INT 8 tick count since the game started.
const newGameSeed = () => Math.floor(performance.now() / 1000 * 69 / 65536) & 0xffff;

let source = null;
// Development aid: ?level=N starts a new game at level index N (0-18); the original only starts at index 1.
function startLevelChoice() { const n = Number(new URLSearchParams(location.search).get('level')); return Number.isInteger(n) && n >= 0 && n <= 18 && new URLSearchParams(location.search).has('level') ? n : NEW_GAME_LEVEL; }
async function begin(label) {
  try { status(`Loading from ${label}…`); await loadCommon(source); game = null; session = gameSession(startLevelChoice()); start(); }
  catch (error) { status(error.message); }
}

addEventListener('keydown', event => {
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

window.__alienBreed = { get state() { return game?.state; }, get framebuffer() { return game?.framebuffer; }, get display() { return display; }, get running() { return running; }, get level() { return game?.level; }, get effectsPlayed() { return effects?.played ?? []; }, get music() { return { song: music?.song, scheduled: musicClock } }, get timer() { return { ...timer }; } };
