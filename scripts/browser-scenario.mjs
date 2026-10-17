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
  await page.goto(url);
  await page.locator('#play').waitFor({ state: 'visible', timeout: 15000 });
  await page.click('#play');
  await page.waitForFunction(() => window.__alienBreed?.running && window.__alienBreed.state?.frame > 10, null, { timeout: 15000 });
  const start = await page.evaluate(() => { const s = window.__alienBreed.state; return { x: s.players[0].x, y: s.players[0].y, frame: s.frame, cam: { ...s.camera } }; });
  check('level 1 starts at the original spawn point', () => assert.deepEqual([start.x, start.y], [960, 784]));

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

  const ammoBefore = await page.evaluate(() => window.__alienBreed.state.players[0].ammo);
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(40); await page.keyboard.up('KeyZ');
  await page.locator('#diagnostic').waitFor({ state: 'visible', timeout: 5000 });
  const fired = await page.evaluate(() => window.__alienBreed.state.players[0].ammo);
  const text = await page.textContent('#diagnostic');
  check('pressing Z fires one round', () => assert.equal(ammoBefore - fired, 1));
  check('the shot reaching unreproduced behaviour stops strict mode visibly', () => assert.match(text, /Stopped: (Effect object|Alien spawn)/));
  check('no uncaught page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); await server.close();
}
console.log(`browser scenario: ${results.length} checks passed`);
