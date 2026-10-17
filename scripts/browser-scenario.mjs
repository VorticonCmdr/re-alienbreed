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
  await page.waitForTimeout(400);
  const afterShot = await page.evaluate(() => ({ ammo: window.__alienBreed.state.players[0].ammo, diagnostic: document.getElementById('diagnostic').hidden ? '' : document.getElementById('diagnostic').textContent }));
  check('pressing Z fires one round and the impact plays without a stop', () => { assert.equal(ammoBefore - afterShot.ammo, 1); assert.equal(afterShot.diagnostic, ''); });

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
  check('no uncaught page errors', () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); await server.close();
}
console.log(`browser scenario: ${results.length} checks passed`);
