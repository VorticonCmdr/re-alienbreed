// Browser adapter: asset loading, keyboard, fixed-step timing and canvas output. The simulation lives in sim.js.
import { assetSource, entriesFromFileList } from './assets.js';
import { openExe } from './exe.js';
import { decodeMap, buildTileStore, levelMapNames, levelTileSheetNames } from './level.js';
import { buildGamePalette, dacToRgb, alienSheetName, redAlertPalette } from './palette.js';
import { createHud, drawHud, blitPanel } from './hud.js';
import { createFramebuffer, drawMap, drawObjects, drawShots, toRgba, SCREEN_WIDTH } from './render.js';
import { frameDescriptor, drawSprite } from './sprites.js';
import { readTables, startLevel, levelTileset, stepFrame, mainLoopKeys, savePlayer, UnsupportedPath } from './sim.js';
import { bindingsFromSetup, createKeyboard } from './input.js';
import { decompressLzhuf } from '../lzhuf.js';
import { decodeVga, decodePlanar, decodeVoc } from '../formats.js';
import { sampleNames, samplePriorities, createEffectPlayer } from './sound.js';

const $ = id => document.getElementById(id);
const canvas = $('screen'), context = canvas.getContext('2d'), image = context.createImageData(320, 200);
const FRAME_MS = 1000 / 70.086; // one game frame per VGA retrace on a fast machine; lag flag 0 (docs/port/evidence.md)
const PLAYFIELD = 176, NEW_GAME_LEVEL = 1; // 1000:17DE: a new game starts at level index 1 (the attract demo uses 2)
let game = null, assets = null, keyboard = null, audio = null, effects = null, running = false, accumulator = 0, last = 0;

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
  };
}

// 1000:1937-1FC1 for one level: tiles, map, palette, alien sheet, then the level start and its two warm-up frames.
async function loadLevel(level, carried) {
  const { source, exe, tables } = assets;
  const sheetBytes = await Promise.all(levelTileSheetNames(exe, level).map(name => source.read(name)));
  const map = decodeMap(decompressLzhuf(await source.read(assets.mapNames[level])));
  const tileStore = buildTileStore(sheetBytes.map(bytes => decodeVga(bytes)));
  const dac = buildGamePalette(exe, sheetBytes[1], level), palette = dacToRgb(dac), redPalette = dacToRgb(redAlertPalette(dac));
  // Sheets by the DS variable a frame descriptor names: players (B409, PLAYER2 at +0x7D00), explosions (ADD2), aliens (B0B4).
  const aliens = decodePlanar(decompressLzhuf(await source.read(alienSheetName(exe, level)))).pixels;
  const sheets = { 0xb409: assets.players, 0xadd2: assets.explosions, 0xb0b4: [aliens] };
  const state = startLevel({ tables, map, level, tileset: levelTileset(exe, level), strict: !$('preview').checked, saved: carried.player, rng: carried.rng, rngSeed: carried.rngSeed });
  game = { level, state, tileStore, palette, redPalette, sheets, hud: assets.hud, descriptor: assets.descriptor, tables, framebuffer: createFramebuffer() };
  stepFrame(state, 0); stepFrame(state, 0);
}

function render() {
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
  image.data.set(toRgba(fb, state.redAlert ? game.redPalette : game.palette)); context.putImageData(image, 0, 0);
  const p = state.players[0];
  const skipped = [...new Set(state.diagnostics.map(d => d.message.replace(/ at .*| \(.*/, '')))];
  $('preview-banner').hidden = state.strict;
  $('preview-banner').textContent = `Preview mode: not reproduced and skipped so far: ${skipped.join(', ') || 'nothing yet'}. Preview runs are not faithful.`;
  $('debug').textContent = `Keys ${p.keys}  Energy ${p.energy}  Lives ${p.lives}  Ammo ${p.ammo >> 7}+${p.ammo & 127}  Aliens ${state.aliveAliens}  Position ${p.x},${p.y}  Frame ${state.frame}`;
}

function tick(now) {
  if (!running) return;
  accumulator = Math.min(accumulator + now - last, FRAME_MS * 8); last = now;
  try {
    while (accumulator >= FRAME_MS) {
      const state = game.state;
      // Top of the 1000:34E6 pass: keys first, then the level-over tests, then one frame.
      state.sounds = [];
      const key = mainLoopKeys(state, keyboard.lastScancode, assets.abortScancode);
      if (key === 'consumed') keyboard.consumeScancode();
      for (const id of state.sounds) effects.play(id);
      if (key === 'abort' || state.levelOver) { render(); levelOver(key === 'abort' ? 'aborted' : state.levelOver); return; }
      stepFrame(state, keyboard.inputByte(), timerTicks()); accumulator -= FRAME_MS;
      for (const id of state.sounds) effects.play(id);
    }
    render();
    requestAnimationFrame(tick);
  } catch (error) { render(); showDiagnostic(error); }
}

// INT 8 ticks per game frame: a deterministic 96 Hz phase against 70.086 Hz frames (approximate; the original's
// interrupt phase relative to its frame loop is not modelled).
let tickPhase = 0;
function timerTicks() { tickPhase += 96 / 70.086; const n = Math.floor(tickPhase); tickPhase -= n; return n; }

// 1000:1FC4-205C: after an exit the level index advances (index 18 runs the ending, 1000:41A2); otherwise the game
// is over. Between levels the original shows the intermission (1000:44EC), which is not reproduced yet.
async function levelOver(result) {
  running = false;
  const { state, level } = game, box = $('diagnostic');
  if (result !== 'complete') { box.hidden = false; box.textContent = result === 'aborted' ? 'Game abandoned.' : 'Game over.'; $('setup').hidden = false; return; }
  if (level === 18 || level === 0) { box.hidden = false; box.textContent = level === 18 ? 'All levels complete. The ending sequence is not reproduced yet.' : 'Level 0 completion is not reproduced.'; return; }
  try {
    if (state.strict) throw new UnsupportedPath('Intermission screen between levels (1000:44EC)', { frame: state.frame });
    state.diagnostics.push({ frame: state.frame, message: 'Intermission screen between levels (skipped)' });
    const carried = { player: savePlayer(state.players[0]), rng: state.rng };
    const skipped = state.diagnostics;
    status(`Loading level index ${level + 1}…`); await loadLevel(level + 1, carried);
    game.state.diagnostics.unshift(...skipped);
    render(); start();
  } catch (error) { showDiagnostic(error); }
}

function start() {
  audio?.resume(); $('setup').hidden = true; $('diagnostic').hidden = true; running = true; accumulator = 0; last = performance.now();
  canvas.focus(); requestAnimationFrame(tick);
}

// 1000:17FC seeds the generator from [B07A], the high word of the INT 8 tick count since the game started.
const newGameSeed = () => Math.floor(performance.now() / 1000 * 96 / 65536) & 0xffff;
async function newGame(level = NEW_GAME_LEVEL) { await loadLevel(level, { player: null, rng: null, rngSeed: newGameSeed() }); }

let source = null;
// Development aid: ?level=N starts a new game at level index N (0-18); the original only starts at index 1.
function startLevelChoice() { const n = Number(new URLSearchParams(location.search).get('level')); return Number.isInteger(n) && n >= 0 && n <= 18 && new URLSearchParams(location.search).has('level') ? n : NEW_GAME_LEVEL; }
async function begin(label) {
  try { status(`Loading from ${label}…`); await loadCommon(source); await newGame(startLevelChoice()); render(); start(); }
  catch (error) { status(error.message); }
}

addEventListener('keydown', event => {
  if (!keyboard || !game) return;
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

window.__alienBreed = { get state() { return game?.state; }, get framebuffer() { return game?.framebuffer; }, get running() { return running; }, get level() { return game?.level; }, get effectsPlayed() { return effects?.played ?? []; } };
