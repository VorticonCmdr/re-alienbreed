// Browser acceptance: real key events through the page's keyboard adapter, asset loading from game/, canvas output
// and the strict-mode stop. Uses the installed Chrome through Playwright's 'chrome' channel.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

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
  const newGame = await page.evaluate(() => ({ level: window.__alienBreed.level, players: window.__alienBreed.state.players.length }));
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
  check('no uncaught page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); await server.close();
}
console.log(`browser scenario: ${results.length} checks passed`);
