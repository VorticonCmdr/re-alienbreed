// Browser adapter: asset loading, keyboard, fixed-step timing and canvas output. The simulation lives in sim.js.
import { validate as validateEditorMap, pack as packEditorMap } from '../editor/model.js';
import { assetSource, entriesFromFileList } from './assets.js';
import { openExe } from './exe.js';
import { decodeMap, buildTileStore, levelMapNames, levelTileSheetNames } from './level.js';
import { buildGamePalette, dacToRgb, alienSheetName, redAlertPalette, levelStartPalette } from './palette.js';
import { createHud, drawHud, blitPanel } from './hud.js';
import { createFramebuffer, drawMap, drawObjects, drawShots, toRgba, SCREEN_WIDTH } from './render.js';
import { frameDescriptor, drawSprite } from './sprites.js';
import { readTables, startLevel, levelTileset, stepFrame, mainLoopKeys, mapRequested, nextStage, savePlayer, carriedGlobals, partyOf, timerTick, UnsupportedPath } from './sim.js';
import { createDisplay, cutFont, createTextState, fadeIn, fadeOut } from './screens.js';
import { intermission, intermissionPicture, deckmanSheetName } from './intermission.js';
import { gameOver, ending, gameOverFiles, endingPictures } from './endings.js';
import { titleLoop, titleFiles } from './title.js';
import { intro, introFiles } from './intro.js';
import { passcode } from './passcode.js';
import { seedFromClock, nextRandom } from './rng.js';
import { createLockstep, stateHash, broadcastTransport, peerTransport, HASH_EVERY } from './netplay.js';
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
  keyboard = createKeyboard(bindingsFromSetup(setup)); joystick = [0, 0]; joyTicks = 0;
  const frames = new Map(), descriptor = n => { if (!frames.has(n)) frames.set(n, frameDescriptor(exe, n)); return frames.get(n); };
  assets = {
    source, exe, tables: readTables(exe), descriptor, setup, abortScancode: setup[0x65], mapNames: levelMapNames(exe),
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
async function loadLevel(level, carried, demoMode = 0, record = null) {
  const { source, exe, tables } = assets;
  const sheetBytes = await Promise.all(levelTileSheetNames(exe, level).map(name => source.read(name)));
  let map = decodeMap(decompressLzhuf(await source.read(assets.mapNames[level])));
  if (new URLSearchParams(location.search).get('editor') === '1') {
    const saved = sessionStorage.getItem('alien-breed-playtest');
    if (!saved) throw new Error('Editor playtest data is missing. Open playtest again from level.html.');
    const custom = validateEditorMap(JSON.parse(saved));
    if (custom.level === level) map = decodeMap(packEditorMap(custom));
  }
  const tileStore = buildTileStore(sheetBytes.map(bytes => decodeVga(bytes)));
  const dac = levelStartPalette(exe, buildGamePalette(exe, sheetBytes[1], level), level), redDac = redAlertPalette(dac);
  // Sheets by the DS variable a frame descriptor names: players (B409, PLAYER2 at +0x7D00), explosions (ADD2), aliens (B0B4).
  const aliens = decodePlanar(decompressLzhuf(await source.read(alienSheetName(exe, level)))).pixels;
  const sheets = { 0xb409: assets.players, 0xadd2: assets.explosions, 0xb0b4: [aliens] }, levelAliens = [aliens];
  const state = startLevel({ tables, map, level, tileset: levelTileset(exe, level), strict: !$('preview').checked, party: carried.party, globals: carried.from ? carriedGlobals(carried.from) : null, rngSeed: carried.rngSeed, demoMode, recording: !!record });
  state.demoRecord = record; // cs:8716 = 1 and the index cs:8717 carry into the next level
  state.shareCredits = !!assets.options.share; // cs:1118
  game = { level, state, tileStore, dac, redDac, levelDac: dac, levelAliens, alienPalette: null, sheets, hud: assets.hud, descriptor: assets.descriptor, tables, framebuffer: createFramebuffer() };
  redrawPanels(state);
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
  state.players.forEach((p, i) => { if (p.alive && !p.ghost) drawHud(hud, p, i * 0xa0); }); // 18B2:17B9: players still in the game
  blitPanel(fb, hud);
  display.frame.set(fb);
}
// 18B2:17F6 / 17FA at the level start, after the Intex or the map and when a boss starts or dies: both halves of the panel
// from both records, whether or not the player is in the game (a missing player 2 shows the cleared record).
const NOBODY = { energy: 0, lives: 0, ammo: 0, keys: 0 };
function redrawPanels(state) {
  [state.players[0], state.players[1] ?? NOBODY].forEach((p, i) => {
    if ((p.lives & 0xff) === 0xff) state.report('Panel redraw for a player who is out (lives 0xFF; 18B2:292C not read)');
    drawHud(game.hud, p, i * 0xa0);
  });
}
// SETUP.DAT byte 0 ([E770]): player 1 on the keyboard if non-zero, player 2 as well if 2; byte 2 ([E772]): bit 0 puts
// player 1 on joystick 1, bit 1 player 2 on joystick 2 (1000:1779-17AA). A player without a controller reads the word at
// DS:0000 ([B094] = 0), the first type word of the map. The page option can give player 2 joystick 2, fed from a second
// key set or a gamepad (a port addition: the original reads a PC joystick there).
let joystick = [0, 0], joyTicks = 0;
const P2_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: 'KeyF', action: 'KeyG' };
function controllers() {
  if (net) return ['keys', 'joystick']; // network play: the host's keyboard, the guest on joystick 2
  const s = assets.setup, choice = $('p2-controls').value;
  return [s[2] & 1 ? 'joystick' : s[0] ? 'keys' : 'none', choice !== 'setup' ? 'joystick' : s[2] & 2 ? 'joystick' : s[0] === 2 ? 'keys' : 'none'];
}
function inputFor(index) {
  const c = controllers()[index];
  return c === 'keys' ? keyboard.inputByte() : c === 'joystick' ? joystick[index] : game?.state ? game.state.types[0] : 0;
}
const anyInput = () => keyboard.inputByte() | joystick[0] | joystick[1]; // [B42E] for the menus
const leadInput = players => () => inputFor(players[0] ? 0 : 1); // 45EF-4757: player 1's input, or player 2's once player 1 is out
// 1000:782E, every 4th INT 8 tick: the joystick words. Gamepads use the standard mapping (d-pad or left stick, A fires, B acts).
function pollJoysticks() {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean), word = pad => {
    if (!pad) return 0; const b = i => pad.buttons[i]?.pressed, [ax, ay] = pad.axes;
    return (b(15) || ax > 0.5 ? 1 : 0) | (b(14) || ax < -0.5 ? 2 : 0) | (b(13) || ay > 0.5 ? 4 : 0) | (b(12) || ay < -0.5 ? 8 : 0) | (b(0) ? 0x10 : 0) | (b(1) ? 0x20 : 0);
  };
  if (net) { joystick[0] = 0; joystick[1] = guestJoy; return; } // the guest's word, as it arrived for this retrace
  const [c1] = controllers(), choice = $('p2-controls').value;
  joystick[0] = c1 === 'joystick' ? word(pads[0]) : 0;
  joystick[1] = choice === 'keys' ? keyboard.inputFrom(P2_KEYS) : word(pads[c1 === 'joystick' ? 1 : 0]);
}
const newParty = () => ({ count: assets.options.players + 1, inGame: [true, assets.options.players === 1], saved: [null, null] }); // 1000:1951
// 1000:6030 copies a boss palette to bank 0xC0 and swaps the alien sheet; 205F restores both after the boss.
function bossPalette(state) {
  game.alienPalette = state.alienPalette;
  const dac = Uint8Array.from(game.levelDac);
  if (state.alienPalette !== null) dac.set(assets.exe.bytes(0x2041, state.alienPalette, 48), 0xc0 * 3);
  game.dac = dac; game.redDac = redAlertPalette(dac);
  game.sheets[0xb0b4] = state.alienSheet !== null ? [assets.bossSheets[state.alienSheet]] : game.levelAliens;
  display.dac.set(state.redAlert ? game.redDac : game.dac);
  redrawPanels(state);
}
function present() {
  image.data.set(toRgba(display.frame, dacToRgb(display.dac))); context.putImageData(image, 0, 0);
  const state = game?.state; if (!state) return;
  if (state.demoSaved) { offerDemo(state.demoSaved); state.demoSaved = null; }
  const skipped = [...new Set(state.diagnostics.map(d => d.message.replace(/ at .*| \(.*/, '')))];
  $('preview-banner').hidden = state.strict;
  $('preview-banner').textContent = `Preview mode: not reproduced and skipped so far: ${skipped.join(', ') || 'nothing yet'}. Preview runs are not faithful.`;
  const line = (p, n) => `P${n} keys ${p.keys} energy ${p.energy} lives ${p.lives} ammo ${p.ammo >> 7}+${p.ammo & 127} weapon ${p.weapon}`;
  $('debug').textContent = `Level ${game.level}  ${state.players.map((q, i) => q.alive ? line(q, i + 1) : `P${i + 1} out`).join('  ')}  Aliens ${state.aliveAliens}  Frame ${state.frame}`;
}

// The whole game as one generator: every `yield` is one vertical retrace; yielding a promise waits for loading.
// `retrace` holds this retrace's INT 8 runs (and music ticks), computed by the driver below.
let retrace = { ticks: 0, music: [] }, inGame = false;
const intTicks = state => { for (let i = 0; i < retrace.ticks; i++) timerTick(state); }; // INT 8 work outside game frames
function* idle(generator, state) { for (const _ of generator) { if (state) intTicks(state); yield; } }

// The program after start-up (1000:0831): title music, then the title loop, games and attract demos for ever.
function* program(devLevel) {
  const bootRng = seedFromClock(new Date()); // 1000:027D: the RNG is seeded from the clock at start-up
  if (devLevel !== null) return yield* gameSession(devLevel, false);
  if ($('passcode').checked && !net) { // ALIEN.EX_ 1000:03C1-0493; the supplied ALIEN.EXE jumps over the comparison
    phase = 'passcode'; typedChars = []; canvas.hidden = true;
    const ok = yield* passcode({ exe: assets.exe, show: text => { $('dos').textContent = text; $('dos').hidden = false; },
      pick: () => nextRandom(bootRng), // 03D5: one RNG step per prompt; the entry is the low six bits of [B038]
      takeChar: () => typedChars.length ? typedChars.shift() : null,
      log: e => console.info(`Alien Breed code for Table-${e.table} Row-${e.row} Column-${e.column}: ${e.code}`) });
    typedChars = null; $('dos').hidden = true; canvas.hidden = false;
    if (!ok) throw new ProgramExit(); // 0490: three wrong codes jump to the program exit (7B0F)
  }
  phase = 'intro'; yield* intro({ display, logos: assets.logos, playSample: () => effects.playBuffer(assets.logoSample) }); // 1000:0761-0767
  phase = 'title'; music.start('title', assets.songs.title, { stopFirst: false }); // 1000:0BAD
  for (;;) {
    const input = anyInput;
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
    input: () => inputFor(player.index ?? 0), ticks: () => retrace.ticks, report: state.report }; // [817E]: the owner's input word
  if (kind === 'intex') {
    yield* idle(intexSession({ ...common, pictures: { computer: assets.computerPicture }, weaponSheet: assets.weaponSheet, descriptor: assets.descriptor,
      scancode: () => keyboard.lastScancode, consumeScancode: () => keyboard.consumeScancode(), sound: id => effects.play(id), exitProgram: () => { throw new ProgramExit(); },
      music: { start: song => music.start(song, assets.songs[song], { stopFirst: false }), stop: () => music.stop() } }), state);
  } else yield* idle(mapSession({ ...common, picture: assets.mapPicture }), state);
  intTicks(state); yield; // 3000:01B0
  state.lag = !state.demoMode && !state.demoRecord && state.frameTicks >= 5 ? 1 : 0; state.frameTicks = 0;
  inGame = true;
  for (let i = 0; i < 2; i++) { // 37D6 twice
    state.sounds = []; stepFrame(state, [inputFor(0), inputFor(1)], retrace.ticks);
    for (const id of state.sounds) effects.play(id);
    renderGame(); yield* pauseCheck(state); yield;
  }
  inGame = false;
  redrawPanels(state);
  yield* idle(fadeIn(display, state.redAlert ? game.redDac : game.dac), state);
  if (kind === 'intex') { music.start('ingame', assets.songs.ingame, { stopFirst: false }); state.music = 'ingame'; state.musicStop = false; } // 2402
  state.countdownFrozen = false; inGame = true;
}
const DEMO_LEVEL = 2;

// 1000:3A98-3AC5, at the end of every pass of 37D6: with the pause key (SETUP.DAT 0x64) as the last scancode [B086] the
// game busy-waits for its release, then with the countdown frozen (cs:37D3) for a second press and its release. No
// frames run and the screen keeps the last flip; INT 8 (music, timer, [8184]) goes on, so a lag frame follows.
// The delay loop after it (3ACB, SETUP.DAT 0x0A) is CPU time and not modelled.
function* pauseCheck(state) {
  const key = assets.setup[0x64];
  if (keyboard.lastScancode !== key) return;
  const wait = function* (code) { while (keyboard.lastScancode !== code) { intTicks(state); yield; } };
  inGame = false;
  yield* wait(key | 0x80); state.countdownFrozen = true;
  yield* wait(key); yield* wait(key | 0x80);
  state.countdownFrozen = false; inGame = true;
}

function* gameSession(firstLevel, demo) {
  let carried = { party: newParty(), globals: null, rngSeed: newGameSeed() }, demoFrame = 0, recording = null; // cs:8717 is reset only when a demo starts (0A42)
  for (let level = firstLevel; ;) {
    music.stop(); // 1000:1949 (2261): fn 7, which also sets the PIT back to 0x438C
    const previous = game?.state;
    if (!demo && !recording && (level !== firstLevel || level === NEW_GAME_LEVEL)) { // 1000:1986: no intermission while cs:8716 is set
      const picture = yield loadPicture(intermissionPicture(assets.exe, level));
      yield* idle(intermission(level, { exe: assets.exe, display, font: assets.font, text: assets.text, picture, deckman: assets.deckman, tables: assets.tables,
        descriptor: assets.descriptor, input: leadInput(carried.party.inGame), report: message => previous ? previous.report?.(message) : strictReport(message), exitTaken: previous?.exitTaken }), previous);
    }
    yield loadLevel(level, carried, demo ? 2 : 0, recording);
    const state = game.state;
    stepFrame(state, [0, inputFor(1)], retrace.ticks); yield; stepFrame(state, [0, inputFor(1)], retrace.ticks); yield; // two warm-up passes of 37D6 (1000:1F8D)
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
      if (demo) { const end = demoFrame === 0x3ff; stepFrame(state, [assets.demo[demoFrame++], inputFor(1)], retrace.ticks, { demoEnd: end }); }
      else stepFrame(state, [inputFor(0), inputFor(1)], retrace.ticks);
      for (const id of state.sounds) effects.play(id);
      // 1000:5FBD starts the alarm song without stopping the in-game one (docs/port/avmfm.md 2.4); the boss stops first.
      if (state.music !== music.song) { music.start(state.music, assets.songs[state.music], { stopFirst: state.musicStop }); state.musicStop = false; }
      if (state.alienPalette !== game.alienPalette) bossPalette(state);
      renderGame(); display.dac.set(state.redAlert ? game.redDac : game.dac);
      yield* pauseCheck(state);
      if (state.intexRequest) { const player = state.intexRequest; state.intexRequest = null; yield* terminal(state, player, 'intex'); continue; } // 1000:35E0
      const map = mapRequested(state, keyboard.lastScancode); // 1000:35F2
      if (map.consumed) keyboard.consumeScancode();
      if (map.player) { yield* terminal(state, map.player, 'map'); continue; }
      // 1000:364A: R (make code 0x13, not consumed) after the recording cheat starts recording from index 0, again on every
      // pass while it is the last scancode; the bytes overwrite the buffer the attract demo plays.
      if (keyboard.lastScancode === 0x13 && assets.intexMemory.recordArmed) state.demoRecord = { buffer: assets.demo, index: 0 };
      yield;
    }
    inGame = false; recording = state.demoRecord ?? null;
    const next = nextStage(level, result, state.levelCode);
    if (result === 'previous') { // 1000:3526: back one level; the fade runs with the music still playing
      yield* idle(fadeOut(display), state);
      carried = { party: partyOf(state), from: state }; // the globals are taken when the next level loads, after the intermission's INT 8 ticks
      if (next.level < 0) throw new UnsupportedPath('Level index below 0', {});
      level = next.level; continue;
    }
    music.stop(); // 1000:1FDB
    yield* idle(fadeOut(display), state); // 1000:1FDE
    if (next.kind === 'level') {
      carried = { party: partyOf(state), from: state }; // the globals are taken when the next level loads, after the intermission's INT 8 ticks
      level = next.level; continue;
    }
    const input = leadInput(state.players.map(p => p.alive));
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
      if (net) { // lockstep: this retrace runs once both sides' input for it is here
        if (!net.ready(retraceIndex)) { accumulator = Math.min(accumulator, FRAME_MS); break; }
        net.queue(retraceIndex, localKeys.splice(0), net.role === 'guest' ? guestKeys.inputByte() : 0);
        const { host, guest } = net.take(retraceIndex);
        for (const [code, down] of [...host.keys, ...guest.keys]) down ? keyboard.down({ code }) : keyboard.up({ code });
        guestJoy = guest.joy;
      }
      retrace = advanceRetrace(timer, inGame ? GAME_OPEN_SHARE : 1); totalTicks += retrace.ticks;
      if (assets) for (joyTicks += retrace.ticks; joyTicks >= 4; joyTicks -= 4) pollJoysticks(); // [B425] (cs:3AEB / 7871 gating not modelled)
      const step = session.next(resumeWith); resumeWith = undefined;
      if (opl) renderMusic();
      if (net && retraceIndex % HASH_EVERY === 0) net.hash(retraceIndex, stateHash(game?.state, [totalTicks, retraceIndex]));
      retraceIndex++;
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

// 1000:17FC seeds the generator from [B07A], the high word of the INT 8 tick count since the program started.
const newGameSeed = () => (totalTicks >>> 16) & 0xffff;

let source = null;
// Development aid: ?level=N skips the title and starts a new game at level index N (0-18).
function startLevelChoice() { const query = new URLSearchParams(location.search), n = Number(query.get('level')); return query.has('level') && Number.isInteger(n) && n >= 0 && n <= 18 ? n : null; }
async function begin(label, devLevel = startLevelChoice()) {
  try {
    status(`Loading from ${label}…`); await loadCommon(source); game = null;
    retraceIndex = 0; totalTicks = 0; guestJoy = 0; localKeys = []; guestKeys = net ? createKeyboard(keyboard.bindings) : null;
    session = program(devLevel); start();
  } catch (error) { status(error.message); }
}

// Network play (netplay.js): Host waits for a guest (PeerJS id, or ?net=local&role=host for two tabs); Play then starts
// both. The settings that change the game are the host's.
let net = null, transport = null, retraceIndex = 0, totalTicks = 0, guestJoy = 0, localKeys = [], guestKeys = null;
const netStatus = text => { $('net-status').textContent = text; };
function connect(role, t) {
  transport = t;
  net = createLockstep(role, t, {
    start: settings => { $('preview').checked = settings.preview; netStatus('The host started the game.'); begin('game files', settings.devLevel); },
    closed: reason => { netStatus(reason); if (running) { running = false; showDiagnostic(new Error(`Network play ended: ${reason}`)); } net = null; },
    desync: n => { running = false; showDiagnostic(new Error(`Network play went out of step at retrace ${n}: the two games differ (different game files or a port bug).`)); },
  });
  let answered = false; // both sides greet on connecting and answer the other's first greeting once
  t.onMessage(message => {
    if (message.t !== 'hello') return;
    netStatus(role === 'host' ? 'Player 2 is connected. Press Play to start.' : 'Connected. Waiting for the host to press Play.');
    if (!answered) { answered = true; t.send({ t: 'hello' }); }
  });
  t.send({ t: 'hello' });
}
async function host() {
  netStatus('Opening a connection…');
  try { connect('host', await peerTransport('host', null, { onId: id => netStatus(`Your code: ${id}. Waiting for player 2…`) })); }
  catch (error) { netStatus(`Network play failed: ${error.message ?? error}`); }
}
async function join() {
  const code = $('net-code').value.trim(); if (!code) return netStatus('Enter the host\'s code.');
  netStatus('Connecting…');
  try { connect('guest', await peerTransport('guest', code)); } catch (error) { netStatus(`Network play failed: ${error.message ?? error}`); }
}
$('net-host').addEventListener('click', host);
$('net-join').addEventListener('click', join);
{ // two tabs of one browser: ?net=local&room=name&role=host|guest
  const query = new URLSearchParams(location.search);
  if (query.get('net') === 'local') connect(query.get('role') === 'guest' ? 'guest' : 'host', broadcastTransport(query.get('room') ?? 'local', query.get('role') ?? 'host'));
}

addEventListener('keydown', event => {
  if (typedChars && running) { // DOS character input for the code prompt
    const c = event.key.length === 1 ? event.key : { Enter: '\r', Backspace: '\b', Escape: '\x1b', Tab: '\t' }[event.key];
    if (c !== undefined) { event.preventDefault(); typedChars.push(c); } return;
  }
  if (!keyboard) return;
  if (keyboard.handles(event)) { event.preventDefault(); if (net && running) netKey(event, true); else keyboard.down(event); }
});
addEventListener('keyup', event => { if (keyboard?.handles(event)) { event.preventDefault(); if (net && running) netKey(event, false); else keyboard.up(event); } });
// In network play keys are sent ahead instead of changing the keyboard now. The guest's own movement, fire and action keys
// (its SETUP.DAT bindings) make up joystick 2's word; its other keys go to the shared keyboard like the host's.
function netKey(event, down) {
  if (net.role === 'guest' && Object.entries(guestKeys.bindings).some(([name, code]) => ['up', 'down', 'left', 'right', 'fire', 'action'].includes(name) && code === event.code)) {
    down ? guestKeys.down(event) : guestKeys.up(event); return;
  }
  localKeys.push([event.code, down]);
}
addEventListener('blur', () => { if (net && running) guestKeys?.clear(); else keyboard?.clear(); }); // the shared keyboard changes only through sent keys
$('choose-folder').addEventListener('click', () => $('folder-input').click());
$('folder-input').addEventListener('change', event => { source = assetSource(entriesFromFileList(event.target.files)); if (net?.role === 'guest') netStatus('Game folder selected. Waiting for the host to press Play.'); else begin('the selected folder'); });
$('play').addEventListener('click', () => { if (net?.role === 'guest') return netStatus('The host starts the game.'); if (net) net.start({ preview: $('preview').checked, devLevel: startLevelChoice() }); begin('game/'); });

if (import.meta.env.DEV) {
  try {
    const response = await fetch('./__game_catalog'); const files = response.ok ? await response.json() : [];
    if (files.length) { source = assetSource(files); $('play').hidden = false; status('Original files found in game/.'); }
    else status('Place your original files in game/ or open the game folder.');
  } catch { status('Open your original game folder to start.'); }
} else status('Open your original game folder to start. Files are read in your browser and not uploaded.');

window.__alienBreed = { get state() { return game?.state; }, get framebuffer() { return game?.framebuffer; }, get display() { return display; }, get running() { return running; }, get level() { return game?.level; }, get effectsPlayed() { return effects?.played ?? []; }, get music() { return { song: music?.song, scheduled: musicClock } }, get timer() { return { ...timer }; }, get phase() { return phase; }, get recordArmed() { return !!assets?.intexMemory?.recordArmed; }, get net() { return net && { role: net.role, retrace: retraceIndex }; } };
