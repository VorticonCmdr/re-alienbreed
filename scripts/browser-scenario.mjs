// Browser acceptance: real key events through the page's keyboard adapter, asset loading from game/, canvas output
// and the strict-mode stop. Uses the installed Chrome through Playwright's 'chrome' channel.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openExe } from '../src/game/exe.js';

// The recording and exit cheat words (handlers 1000:7FDA and 801C in the table at cs:7EF4), read from the user's executable.
const exe = await openExe(new Uint8Array(await readFile(new URL('../game/ALIEN.EXE', import.meta.url))));
const cheatWord = handler => { for (let e = 0x7ef4; exe.u16(0x1000, e) !== 0xffff; e += 4) if (exe.u16(0x1000, e + 2) === handler) {
  let w = ''; for (let q = exe.u16(0x1000, e); exe.u8(0x1000, q) !== 0xff; q++) w += String.fromCharCode(exe.u8(0x1000, q)); return w; } throw new Error(`no cheat ${handler}`); };

const server = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname, server: { port: 0, open: false }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}game.html`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log(`ok - ${name}`); };
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const play = async query => {
    await page.goto(url + query);
    await page.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
    await page.click('#play');
    await page.waitForFunction(() => window.__alienBreed?.running && window.__alienBreed.state?.frame > 10, null, { timeout: 15000 });
  };
  // A new game opens with the intermission (CARGOBAY and the level 1 briefing); fire skips each page.
  await page.goto(url);
  await page.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
  await page.click('#play');
  await page.waitForFunction(() => window.__alienBreed?.running && window.__alienBreed.display.dac.some(v => v), null, { timeout: 15000 });
  const logo = await page.evaluate(() => ({ phase: window.__alienBreed.phase, song: window.__alienBreed.music.song ?? null }));
  check('start-up shows the logos first, without music', () => assert.deepEqual(logo, { phase: 'intro', song: null }));
  await page.waitForFunction(() => window.__alienBreed.phase === 'title', null, { timeout: 20000 }); // 787 retraces of logos
  await page.waitForFunction(() => window.__alienBreed.display.dac.some(v => v), null, { timeout: 5000 });
  await page.waitForTimeout(1200); // the title's 64-step fade
  const title = await page.evaluate(() => ({ ...window.__alienBreed.music, reload: window.__alienBreed.timer.reload, state: !!window.__alienBreed.state }));
  check('start-up shows the title with the title song at 96 Hz', () => { assert.equal(title.song, 'title'); assert.equal(title.reload, 0x308c); assert.equal(title.state, false); });
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(80); await page.keyboard.up('KeyZ'); // fire on START GAME (the default line)
  await page.waitForFunction(() => window.__alienBreed.music.song !== 'title', null, { timeout: 5000 });
  await page.waitForFunction(() => window.__alienBreed.display.dac.some(v => v), null, { timeout: 15000 });
  const textPixels = () => window.__alienBreed.display.frame.filter(v => v === 0xfd).length;
  const before = await page.evaluate(textPixels);
  await page.waitForTimeout(1500); // the 64-step fade, then the briefing is drawn every frame
  const briefing = await page.evaluate(() => ({ level: window.__alienBreed.level, lit: window.__alienBreed.display.frame.filter(v => v === 0xfd).length }));
  await page.screenshot({ path: '.work/browser-intermission.png' }).catch(() => {});
  check('a new game shows the intermission briefing before level index 1', () => { assert.equal(briefing.level, undefined); assert.ok(briefing.lit > before + 1000, `text pixels ${before} -> ${briefing.lit}`); });
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__alienBreed.state?.frame > 10)); i++) {
    await page.keyboard.down('KeyZ'); await page.waitForTimeout(60); await page.keyboard.up('KeyZ'); await page.waitForTimeout(250);
  }
  const text = await page.evaluate(() => window.__alienBreed.display.frame.length);
  check('fire skips the intermission into the level', () => assert.ok(text > 0));
  const newGame = await page.evaluate(() => ({ level: window.__alienBreed.level, players: window.__alienBreed.state.playerCount }));
  check('a new game starts at level index 1 (L0MZ), as 1000:17DE sets', () => assert.deepEqual(newGame, { level: 1, players: 1 }));
  // The remaining checks use level index 2 (LBMZ), the attract demo's level, whose start is verified against the original.
  await play('?level=2');
  const start = await page.evaluate(() => { const s = window.__alienBreed.state; return { x: s.players[0].x, y: s.players[0].y, frame: s.frame, cam: { ...s.camera } }; });
  check('level index 2 starts at the original spawn point', () => assert.deepEqual([start.x, start.y], [960, 784]));

  // About 25 frames: walking further right reaches an alien spawn at frame 47, which strict mode stops on until aliens exist.
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(100);
  const moved = await page.evaluate(() => { const s = window.__alienBreed.state; return { x: s.players[0].x, y: s.players[0].y, frame: s.frame, cam: { ...s.camera }, diagnostic: !document.getElementById('diagnostic').hidden }; });
  check('holding Right moves the player in 3-pixel steps', () => { assert.ok(moved.x > start.x, `x ${moved.x} > ${start.x}`); assert.equal((moved.x - start.x) % 3, 0); assert.equal(moved.y, start.y); });
  check('the simulation advances at roughly 70 frames per second', () => { const rate = (moved.frame - start.frame) / 0.45; assert.ok(rate > 40 && rate < 90, `rate ${rate}`); });
  check('the camera follows to the right', () => assert.ok(moved.cam.x >= start.cam.x));
  const diagnosticText = await page.textContent('#diagnostic');
  check('no diagnostic was raised while walking', () => assert.equal(moved.diagnostic, false, diagnosticText));

  const pixels = await page.evaluate(() => { const fb = window.__alienBreed.framebuffer; let lit = 0; for (let i = 0; i < 176 * 320; i++) if (fb[i]) lit++; return lit; });
  check('the playfield renders map tiles', () => assert.ok(pixels > 176 * 320 * 0.5, `lit ${pixels}`));
  const panel = await page.evaluate(() => { const fb = window.__alienBreed.framebuffer; let bank = 0; for (let i = 176 * 320; i < 196 * 320; i++) if (fb[i] >= 0xf0) bank++; return { bank, energyRow: Array.from(fb.subarray(176 * 320 + 32, 176 * 320 + 96)) }; });
  check('the status panel is drawn from PANEL.VHF in the panel bank', () => assert.ok(panel.bank > 20 * 320 * 0.9, `panel-bank pixels ${panel.bank}`));
  check('the energy bar is full at the start', () => assert.ok(panel.energyRow.every(v => v >= 0xf0)));

  const ammoBefore = await page.evaluate(() => window.__alienBreed.state.players[0].ammo), playedBefore = await page.evaluate(() => window.__alienBreed.effectsPlayed.length);
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(40); await page.keyboard.up('KeyZ');
  await page.waitForTimeout(400);
  const afterShot = await page.evaluate(() => ({ ammo: window.__alienBreed.state.players[0].ammo, diagnostic: document.getElementById('diagnostic').hidden ? '' : document.getElementById('diagnostic').textContent }));
  check('pressing Z fires one round and the impact plays without a stop', () => { assert.equal(ammoBefore - afterShot.ammo, 1); assert.equal(afterShot.diagnostic, ''); });
  const played = await page.evaluate(() => window.__alienBreed.effectsPlayed);
  check('firing starts the weapon sample through Web Audio', () => assert.ok(played.length > playedBefore, `played ${JSON.stringify(played)}`));

  // The first spawn point (type 3, an egg) enters range after about 47 frames of walking right.
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(900); await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => window.__alienBreed.state.aliveAliens > 0, null, { timeout: 5000 });
  // The alien hatches just off the right edge and then chases the player onto the screen.
  const alienPixelsOnScreen = () => { const fb = window.__alienBreed.framebuffer; let n = 0; for (let i = 0; i < 176 * 320; i++) if (fb[i] >= 0xc0 && fb[i] <= 0xcf) n++; return n > 20; };
  await page.waitForFunction(alienPixelsOnScreen, null, { timeout: 5000 }).catch(() => {});
  const alien = await page.evaluate(() => {
    const fb = window.__alienBreed.framebuffer; let alienPixels = 0;
    for (let i = 0; i < 176 * 320; i++) if (fb[i] >= 0xc0 && fb[i] <= 0xcf) alienPixels++;
    return { alive: window.__alienBreed.state.aliveAliens, alienPixels, diagnostic: document.getElementById('diagnostic').hidden ? '' : document.getElementById('diagnostic').textContent };
  });
  check('walking right spawns the first alien', () => assert.ok(alien.alive >= 1));
  check('the alien is drawn from the alien sheet and palette bank', () => assert.ok(alien.alienPixels > 20, `alien-bank pixels ${alien.alienPixels}`));
  check('no strict stop so far', () => assert.equal(alien.diagnostic, ''));
  const musicState = await page.evaluate(() => ({ ...window.__alienBreed.music, reload: window.__alienBreed.timer.reload }));
  check('in-game music plays through the FM driver at the 120 Hz PIT rate', () => { assert.equal(musicState.song, 'ingame'); assert.ok(musicState.scheduled > 0); assert.equal(musicState.reload, 0x26d7); });
  // An Intex terminal (cell 0x17): stand on it, press action; skip the boot text, go up to ABORT (the cursor starts on
  // the first line), fire; the game resumes with the in-game song from its start.
  await page.evaluate(() => {
    const s = window.__alienBreed.state, cell = [...s.types].findIndex(t => (t & 0xff) === 0x17), p = s.players[0];
    p.x = (cell % 120) * 16 + 24; p.y = Math.floor(cell / 120) * 16 + 24; p.invulnerable = 400;
  });
  const tap = async (key, hold = 80) => { await page.keyboard.down(key); await page.waitForTimeout(hold); await page.keyboard.up(key); await page.waitForTimeout(150); };
  await page.waitForTimeout(200);
  await tap('KeyX');
  await page.waitForFunction(() => window.__alienBreed.music.song === 'intex', null, { timeout: 8000 });
  const intex = await page.evaluate(() => window.__alienBreed.timer.reload);
  check('the action key on a terminal opens the Intex with its song at 96 Hz', () => assert.equal(intex, 0x308c));
  await page.waitForTimeout(1500); await tap('KeyZ'); await page.waitForTimeout(400); await tap('KeyZ'); await page.waitForTimeout(2500); // boot text, menu typing
  await tap('ArrowUp'); await page.waitForTimeout(300); await tap('KeyZ');
  await page.waitForFunction(() => window.__alienBreed.music.song === 'ingame', null, { timeout: 10000 });
  const back = await page.evaluate(() => ({ frame: window.__alienBreed.state.frame, diagnostic: document.getElementById('diagnostic').hidden }));
  check('leaving the Intex resumes the level with the in-game song', () => assert.ok(back.diagnostic, 'no diagnostic'));
  // The recording cheat typed in the Intex menu, then R in the level: 0x400 frames are recorded and offered as DEMO.DAT.
  const typeWord = async word => { for (const c of word) await tap(c === ' ' ? 'Space' : `Key${c}`, 60); };
  const openIntex = async () => { await tap('KeyX'); await page.waitForFunction(() => window.__alienBreed.music.song === 'intex', null, { timeout: 8000 });
    await page.waitForTimeout(1500); await tap('KeyZ'); await page.waitForTimeout(400); await tap('KeyZ'); await page.waitForTimeout(2500); };
  await openIntex(); await typeWord(cheatWord(0x7fda));
  const armed = await page.evaluate(() => window.__alienBreed.recordArmed);
  check('the recording cheat word arms recording', () => assert.equal(armed, true));
  await tap('KeyZ'); // the cursor is still on ABORT from the last visit (it persists in the code segment)
  await page.waitForFunction(() => window.__alienBreed.music.song === 'ingame', null, { timeout: 10000 });
  await page.waitForTimeout(300); await tap('KeyR'); await page.waitForTimeout(500);
  const rec = await page.evaluate(() => ({ index: window.__alienBreed.state.demoRecord?.index ?? -1, lag: window.__alienBreed.state.lag }));
  check('R starts recording the input bytes with the lag flag at 0', () => { assert.ok(rec.index > 10, `index ${rec.index}`); assert.equal(rec.lag, 0); });
  await page.locator('#demo-file').waitFor({ state: 'visible', timeout: 25000 });
  check('after 0x400 frames the recording is offered as DEMO.DAT', () => {});
  // The exit cheat word: the program ends with the original's text and no music.
  await openIntex(); await typeWord(cheatWord(0x801c));
  await page.locator('#dos').waitFor({ state: 'visible', timeout: 5000 });
  const dos = await page.evaluate(() => ({ text: document.getElementById('dos').textContent.trim().length, canvas: document.getElementById('screen').hidden, running: window.__alienBreed.running }));
  check('the exit cheat word ends the program with the text-mode message', () => assert.deepEqual([dos.text > 10, dos.canvas, dos.running], [true, true, false]));
  // Two players: TWO on the title, player 2 on joystick 2 fed from W A S D (the page option); player 2 starts at camera
  // + (0xC0, 0x78), moves with D while player 1 stays, and its half of the panel is drawn.
  await page.goto(url); await page.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
  await page.selectOption('#p2-controls', 'keys'); await page.click('#play');
  await page.waitForFunction(() => window.__alienBreed.phase === 'title', null, { timeout: 25000 }); await page.waitForTimeout(1500);
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowDown']) await tap(key, 80);
  await tap('KeyZ');
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__alienBreed.state?.frame > 10)); i++) await tap('KeyZ', 60);
  const two = await page.evaluate(() => { const s = window.__alienBreed.state, [p1, p2] = s.players; return { count: s.playerCount, alive: [p1.alive, p2.alive], offset: [p2.x - p1.x, p2.y - p1.y], p1: [p1.x, p1.y], p2x: p2.x }; });
  check('TWO starts a game with both players, player 2 next to player 1', () => { assert.equal(two.count, 2); assert.deepEqual(two.alive, [true, true]); assert.deepEqual(two.offset, [0x10, 0x10]); });
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD'); await page.waitForTimeout(100);
  const moved2 = await page.evaluate(() => { const [p1, p2] = window.__alienBreed.state.players; return { p1: [p1.x, p1.y], p2x: p2.x, panel: Array.from(window.__alienBreed.framebuffer.subarray(178 * 320 + 160 + 32, 178 * 320 + 160 + 96)) }; });
  check('D moves player 2 (joystick 2), player 1 stays', () => { assert.ok(moved2.p2x > two.p2x, `${two.p2x} -> ${moved2.p2x}`); assert.deepEqual(moved2.p1, two.p1); });
  check("player 2's energy bar is drawn in the right half of the panel", () => assert.ok(moved2.panel.every(v => v >= 0xf0)));
  // The optional code check of the unpatched program: the prompt in text mode, the answer from the console log.
  const logs = []; page.on('console', m => logs.push(m.text()));
  await page.goto(url); await page.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
  await page.check('#passcode'); await page.click('#play');
  await page.waitForFunction(() => window.__alienBreed?.phase === 'passcode' && document.getElementById('dos').textContent.length > 50, null, { timeout: 10000 });
  const logged = logs.find(t => t.startsWith('Alien Breed code for')), answer = logged?.split(': ')[1];
  const prompt = await page.evaluate(() => ({ text: document.getElementById('dos').textContent, canvas: document.getElementById('screen').hidden }));
  check('the code option shows the prompt in place of the game and logs its answer', () => {
    assert.ok(answer?.length === 3, logged); assert.equal(prompt.canvas, true);
    const [, table, row, column] = logged.match(/Table-(.) Row-(..) Column-(.)/); assert.ok(prompt.text.includes(`Table-${table}`) && prompt.text.includes(`Row-${row}`) && prompt.text.includes(`Column-${column}`));
  });
  await page.keyboard.type(answer, { delay: 60 });
  await page.waitForFunction(() => window.__alienBreed.phase === 'intro', null, { timeout: 5000 });
  const after = await page.evaluate(() => ({ dos: document.getElementById('dos').hidden, canvas: document.getElementById('screen').hidden }));
  check('the right code continues to the logos', () => assert.deepEqual(after, { dos: true, canvas: false }));
  check('no uncaught page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); await server.close();
}
console.log(`browser scenario: ${results.length} checks passed`);
