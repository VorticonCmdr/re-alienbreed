// Browser adapter: asset loading, keyboard, fixed-step timing and canvas output. The simulation lives in sim.js.
import { assetSource, entriesFromFileList } from './assets.js';
import { openExe } from './exe.js';
import { decodeMap, buildTileStore, levelMapNames, levelTileSheetNames } from './level.js';
import { buildGamePalette, dacToRgb, alienSheetName } from './palette.js';
import { createFramebuffer, drawMap, drawObjects, drawShots, toRgba, SCREEN_WIDTH } from './render.js';
import { frameDescriptor, drawSprite } from './sprites.js';
import { readTables, startLevel, levelTileset, stepFrame, UnsupportedPath } from './sim.js';
import { bindingsFromSetup, createKeyboard } from './input.js';
import { decompressLzhuf } from '../lzhuf.js';
import { decodeVga, decodePlanar } from '../formats.js';

const $ = id => document.getElementById(id);
const canvas = $('screen'), context = canvas.getContext('2d'), image = context.createImageData(320, 200);
const FRAME_MS = 1000 / 70.086; // one game frame per VGA retrace on a fast machine; lag flag 0 (docs/port/evidence.md)
const PLAYFIELD = 176, LEVEL = 2;
let game = null, keyboard = null, running = false, accumulator = 0, last = 0;

function status(message) { $('status').textContent = message; }
function showDiagnostic(error) {
  const box = $('diagnostic');
  box.textContent = error instanceof UnsupportedPath
    ? `Stopped: ${error.message} (frame ${game?.state.frame ?? '?'}). This behaviour is not reproduced yet, so strict mode stops instead of guessing.`
    : `Error: ${error.message}`;
  box.hidden = false; running = false;
}

async function load(source) {
  const exe = await openExe(await source.read('ALIEN.EXE'));
  const tables = readTables(exe);
  const sheetBytes = await Promise.all(levelTileSheetNames(exe, LEVEL).map(name => source.read(name)));
  const map = decodeMap(decompressLzhuf(await source.read(levelMapNames(exe)[LEVEL])));
  const tileStore = buildTileStore(sheetBytes.map(bytes => decodeVga(bytes)));
  const palette = dacToRgb(buildGamePalette(exe, sheetBytes[1], LEVEL));
  const sprites = async name => decodePlanar(decompressLzhuf(await source.read(name))).pixels;
  // Sheets by the DS variable a frame descriptor names: players (B409, PLAYER2 at +0x7D00), explosions (ADD2), aliens (B0B4).
  const sheets = { 0xb409: [await sprites('PLAYER1.EHF'), await sprites('PLAYER2.EHF')], 0xadd2: [await sprites('BOOM_NEW.EHF')], 0xb0b4: [await sprites(alienSheetName(exe, LEVEL))] };
  const panel = decodeVga(decompressLzhuf(await source.read('PANEL.VHF')));
  keyboard = createKeyboard(bindingsFromSetup(await source.read('SETUP.DAT')));
  const state = startLevel({ tables, map, level: LEVEL, tileset: levelTileset(exe, LEVEL), strict: !$('preview').checked });
  const frames = new Map(), descriptor = n => { if (!frames.has(n)) frames.set(n, frameDescriptor(exe, n)); return frames.get(n); };
  game = { exe, tables, state, tileStore, palette, sheets, panel, descriptor, framebuffer: createFramebuffer() };
  // The level start runs two complete frames before the main loop (1000:1B70, CALL 37D6 twice).
  stepFrame(state, 0); stepFrame(state, 0);
}

function render() {
  const { state, framebuffer: fb, tileStore, sheets, panel, descriptor, tables } = game, view = state.view;
  fb.fill(0);
  drawMap(fb, state, tileStore, view.tileCamera.x - 16, view.tileCamera.y, 0, PLAYFIELD);
  drawObjects(fb, view, sheets, descriptor, drawSprite, PLAYFIELD);
  drawShots(fb, view, tables, sheets, descriptor, drawSprite, PLAYFIELD);
  // Panel rows 2..21 of PANEL.VHF at screen rows 176..195, recoloured to 0xF0 | p (1000:20C3, 18B2:3BB2).
  for (let y = 0; y < 20; y++) for (let x = 0; x < SCREEN_WIDTH; x++) fb[(PLAYFIELD + y) * SCREEN_WIDTH + x] = 0xf0 | (panel.pixels[(y + 2) * 320 + x] & 15);
  image.data.set(toRgba(fb, game.palette)); context.putImageData(image, 0, 0);
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
    while (accumulator >= FRAME_MS) { stepFrame(game.state, keyboard.inputByte()); accumulator -= FRAME_MS; }
    render(); requestAnimationFrame(tick);
  } catch (error) { render(); showDiagnostic(error); }
}

function start() {
  $('setup').hidden = true; $('diagnostic').hidden = true; running = true; accumulator = 0; last = performance.now();
  canvas.focus(); requestAnimationFrame(tick);
}

let source = null;
async function begin(label) {
  try { status(`Loading from ${label}…`); await load(source); render(); start(); }
  catch (error) { status(error.message); }
}

addEventListener('keydown', event => {
  if (!keyboard || !game) return;
  if (event.code === keyboard.bindings.abort) { running = false; $('setup').hidden = false; keyboard.clear(); return; }
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

window.__alienBreed = { get state() { return game?.state; }, get framebuffer() { return game?.framebuffer; }, get running() { return running; } };
