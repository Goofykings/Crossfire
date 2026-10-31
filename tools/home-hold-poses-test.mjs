/** Check the real home rig, grip contact, guest name and persisted match preference. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 120000,
  defaultViewport: { width: 1200, height: 900 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
fs.mkdirSync('test-results/home-hold-poses', { recursive: true });
try {
  for (const weapon of ['rifle', 'shotgun', 'sniper', 'smg']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (request) => requests.push(request.url()));
    await page.evaluateOnNewDocument((id) => {
      localStorage.setItem('crossfire.guest.v1', JSON.stringify({ guestId: '76a876f1-7a6e-499f-8d03-568b68c889e3', username: 'Test Player' }));
      localStorage.setItem('crossfire.pending-weapon', 'rifle');
      localStorage.setItem('crossfire.last-used-weapon', id);
    }, weapon);
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction((id) => window.__crossfire?.homeCharacter().weapon?.id === id, { timeout: 120000 }, weapon);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await page.evaluate(() => window.__crossfire.homeCharacter());
    const j = state.character.joints, grips = state.weapon.grips;
    assert.ok(distance(j.hand_r, grips[0]) < .03 && distance(j.hand_l, grips[1]) < .03, `${weapon}: hands meet the real grip anchors`);
    assert.ok(j.forearm_r[0] > .15 && j.forearm_l[0] < -.15
      && j.forearm_r[1] < j.upper_arm_r[1] - .08 && j.forearm_l[1] < j.upper_arm_l[1] - .08, `${weapon}: elbows stay below and outside the shoulders`);
    assert.ok(j.hand_r[2] < -.12 && j.hand_l[2] < -.20, `${weapon}: hands remain in front of the torso`);
    assert.equal(state.weapon.instances, 1);
    assert.equal(state.character.clip, 'IDLE');
    await page.mouse.move(1100, 100);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const turned = await page.evaluate(() => window.__crossfire.homeCharacter());
    assert.ok(turned.yaw > .1 && turned.headPitch > .05, `${weapon}: mouse-responsive body and head remain active`);
    assert.ok(distance(turned.character.joints.hand_r, turned.weapon.grips[0]) < .03
      && distance(turned.character.joints.hand_l, turned.weapon.grips[1]) < .03, `${weapon}: hands remain attached while turning`);
    assert.notEqual(turned.character.frame, state.character.frame, `${weapon}: idle animation advances`);
    assert.equal(await page.$eval('.home-character-name', (e) => e.textContent), 'Test Player');
    assert.ok(!requests.some((url) => /\/assets\/models\/(european-town|industrial-complex|modern-city)\//.test(url)), 'preview does not load a map');
    if (weapon === 'rifle') {
      const fps = await page.evaluate(() => new Promise((resolve) => {
        const start = performance.now(); let frames = 0;
        const tick = (now) => { frames++; if (now - start >= 1500) resolve(frames * 1000 / (now - start)); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }));
      assert.ok(fps >= 20, `home preview maintains an interactive frame rate (${fps.toFixed(1)} fps)`);
      console.log(`PASS local home preview frame rate: ${fps.toFixed(1)} fps`);
    }
    for (const [width, height] of [[1200, 900], [390, 844], [320, 568]]) {
      await page.setViewport({ width, height });
      const layout = await page.evaluate(() => {
        const label = document.querySelector('.home-character-name').getBoundingClientRect();
        const canvas = document.querySelector('.home-character').getBoundingClientRect();
        const span = Math.max(1.36, 1.18 / (canvas.width / canvas.height));
        const headTop = canvas.top + canvas.height * (1.91 - 1.8) / span;
        return { left: label.left, right: label.right, top: label.top, bottom: label.bottom, headTop };
      });
      assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom < layout.headTop,
        `${weapon}: name stays visible above head at ${width}x${height}: ${JSON.stringify(layout)}`);
    }
    await page.setViewport({ width: 1200, height: 900 });
    await page.screenshot({ path: `test-results/home-hold-poses/${weapon}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${weapon}: grip contact, elbows, name, framing and saved weapon`);
    await context.close();
  }
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('crossfire.guest.v1', JSON.stringify({ guestId: '76a876f1-7a6e-499f-8d03-568b68c889e3', username: 'Test Player' }));
    localStorage.setItem('crossfire.pending-weapon', 'smg');
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__crossfire?.homeCharacter().weapon?.id === 'smg', { timeout: 120000 });
  console.log('PASS first visit: preview falls back to selected weapon');
  await context.close();
} finally { await browser.close(); }
