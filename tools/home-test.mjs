import { completeGuestProfile } from './guest-profile-helper.mjs';
/** Real-browser home screen checks. Needs npm run dev (or a production preview).
 * node tools/home-test.mjs [--url http://localhost:5173/]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const urlIndex = process.argv.indexOf('--url');
const base = urlIndex < 0 ? 'http://localhost:5173/' : process.argv[urlIndex + 1];
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .filter(Boolean).find((p) => fs.existsSync(p));
assert.ok(executablePath, 'Chrome/Edge required; set CHROME_PATH');
fs.mkdirSync('test-results/home', { recursive: true });
const browser = await puppeteer.launch({
  executablePath, headless: true, pipe: true, dumpio: Boolean(process.env.DEBUG_BROWSER), defaultViewport: { width: 1600, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl'],
});
const errors = [];
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS  ${message}`); };
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const sockets = [];
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', (event) => sockets.push(event.url));
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page);
  await page.waitForFunction(() => window.__crossfire && document.querySelector('#menu.visible'), { timeout: 240000 });
  check(await page.$eval('.logo', (e) => e.getAttribute('aria-label') === 'CROSSFIRE' && e.querySelectorAll('svg').length === 1), 'original CROSS / crossed rifles / FIRE logo has an accessible full title');
  check(await page.evaluate(() => window.__crossfire.stats().mapId == null), 'home loads no playable map');
  await page.waitForFunction(() => window.__crossfire.homeCharacter().ready, { timeout: 60000 });
  const preview = await page.evaluate(() => window.__crossfire.homeCharacter());
  check(preview.skin === 'assets/characters/player.glb' && preview.character.bones === 18 && preview.character.clip === 'IDLE',
    'home previews the actual multiplayer skin and its idle clip');
  check(!preview.platformVisible && await page.$eval('.home-character', (e) => getComputedStyle(e).maskImage.includes('linear-gradient')),
    'preview hides the platform and fades the character canvas');
  await page.mouse.move(1590, 20); await new Promise((r) => setTimeout(r, 450));
  const turned = await page.evaluate(() => window.__crossfire.homeCharacter());
  const headOffset = (state) => 2 * Math.acos(Math.min(1, Math.abs(state.headRotation.reduce((sum, n, i) => sum + n * state.animatedHeadRotation[i], 0))));
  check(turned.yaw > .18 && turned.yaw < Math.PI / 12 && turned.pitch > .02
    && turned.headYaw > .08 && turned.headPitch > .1 && headOffset(turned) > .12
    && turned.character.frame !== preview.character.frame,
    'idle advances while the body and actual head rig turn toward the upper-right cursor');
  await page.screenshot({ path: 'test-results/home/look-right-up.png' });
  await new Promise((r) => setTimeout(r, 800));
  const held = await page.evaluate(() => window.__crossfire.homeCharacter());
  check(Math.abs(headOffset(held) - headOffset(turned)) < .04,
    'holding the cursor does not accumulate head rotation over the idle animation');
  await page.mouse.move(10, 880); await new Promise((r) => setTimeout(r, 500));
  const opposite = await page.evaluate(() => window.__crossfire.homeCharacter());
  check(opposite.yaw < -.18 && opposite.pitch < -.02 && opposite.headYaw < -.08 && opposite.headPitch < -.1
    && headOffset(opposite) > .12, 'body and actual head rig follow the lower-left cursor');
  await page.screenshot({ path: 'test-results/home/look-left-down.png' });
  await page.mouse.move(800, 450); await new Promise((r) => setTimeout(r, 400));
  const neutral = await page.evaluate(() => window.__crossfire.homeCharacter());
  check(Math.abs(neutral.yaw) < .02 && Math.abs(neutral.headYaw) < .02 && Math.abs(neutral.headPitch) < .02 && headOffset(neutral) < .03,
    'center cursor restores the neutral body and head without accumulated rotation');
  check(!requests.some((u) => /\/assets\/(models|env|textures)\//.test(u)), 'home requests no map/weapon geometry, environment or material textures');
  check(await page.$eval('.home-backdrop', (e) => e.complete && e.naturalWidth > 0 && parseFloat(getComputedStyle(e).filter.match(/blur\(([^p]+)/)?.[1]) > 0), 'existing lightweight map image forms the blurred background');
  check((await page.$$('#menu button, .home-nav button')).length === 3 && !(await page.$('#map-list')), 'home has two navigation tabs, one main action and no map selector');
  check(await page.$eval('.home-nav', (e) => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'
    && [...e.querySelectorAll('button')].every((b) => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)')), 'home tabs are text-only without filled button backgrounds');
  check(await page.$eval('.home-header', (e) => getComputedStyle(e, '::before').backgroundImage.includes('linear-gradient')
    && parseFloat(getComputedStyle(e, '::before').bottom) < 0), 'dark title/navigation backdrop fades out below the tabs');
  check(fs.statSync('public/assets/ui/town-plaza.webp').size < 200 * 1024, 'actual in-map plaza background is under 200 KiB');
  const motion = await page.$eval('.home-backdrop', (e) => ({
    duration: getComputedStyle(e).animationDuration,
    frames: e.getAnimations()[0]?.effect.getKeyframes().map((f) => f.transform),
  }));
  check(motion.duration === '22s' && motion.frames.join(' ').includes('1.04') && motion.frames.join(' ').includes('1.01'), 'background uses a gentle 3% transform cycle over 22 seconds');
  check(await page.$eval('#menu .primary', (e) => {
    const s = getComputedStyle(e); const rgb = s.backgroundColor.match(/[\d.]+/g).map(Number);
    return rgb[2] > rgb[0] * 2 && s.color === 'rgb(255, 255, 255)' && e.firstElementChild.scrollWidth < e.clientWidth - 50;
  }), 'main Play is rich blue with white text and generous padding');

  for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 600], [390, 844], [320, 568]]) {
    await page.setViewport({ width, height });
    const layout = await page.evaluate(() => {
      const title = document.querySelector('.logo');
      const t = title.getBoundingClientRect();
      const play = document.querySelector('#menu .btn.primary').getBoundingClientRect();
      const settings = document.querySelector('.home-nav button:last-of-type').getBoundingClientRect();
      return t.left >= 0 && t.top >= 0 && t.right <= innerWidth && title.scrollWidth <= title.clientWidth + 1
        && play.top > innerHeight * 0.6 && settings.top > t.bottom && settings.bottom < play.top && play.bottom <= innerHeight
        && Math.abs(play.left + play.width / 2 - innerWidth / 2) < 2 && play.height > settings.height && document.querySelector('#menu').scrollWidth <= innerWidth;
    });
    await page.screenshot({ path: `test-results/home/${width}-minimal.png` });
    if (!layout) console.log('Layout diagnostic', await page.evaluate(() => Object.fromEntries(['.logo', '#menu .primary', '.home-nav button:last-of-type', '#menu'].map((selector) => {
      const e = document.querySelector(selector); return [selector, { rect: e.getBoundingClientRect().toJSON(), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }];
    }))));
    check(layout, `${width}x${height}: full title, upper navigation and bottom-centered Play without clipping`);
    check(await page.$eval('.home-character', (e) => { const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= document.querySelector('.home-nav').getBoundingClientRect().bottom
        && r.bottom <= document.querySelector('.home-actions').getBoundingClientRect().top && r.left >= -1 && r.right <= innerWidth + 1;
    }), `${width}x${height}: character viewport stays between navigation and Play`);
  }
  await page.setViewport({ width: 1600, height: 900 });
  await page.mouse.move(0, 0);
  const playBefore = await page.$eval('#menu .primary', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.hover('#menu .primary');
  await new Promise((r) => setTimeout(r, 200));
  check(await page.$eval('#menu .primary', (e, before) => {
    const r = e.getBoundingClientRect(); const scale = Number(getComputedStyle(e).transform.match(/matrix\(([^,]+)/)?.[1]);
    return scale > 1.03 && scale < 1.05 && Math.abs(r.x + r.width / 2 - before[0]) < 1 && Math.abs(r.y + r.height / 2 - before[1]) < 1;
  }, playBefore), 'hover scales Play around its original center without shifting layout');
  check(await page.evaluate(() => !window.__crossfire.sounds().includes('ui_hover')), 'hovering buttons requests no hover sound');
  const playUnderline = await page.$eval('.nav-indicator', (e) => parseFloat(getComputedStyle(e, '::after').width));
  check(await page.$eval('.home-nav button:first-of-type span', (e, width) => Math.abs(width - e.offsetWidth - 24) < 1, playUnderline), 'Play underline extends 12 pixels beyond each side of its word');
  const navBefore = await page.$eval('.home-nav', (e) => e.getBoundingClientRect().toJSON());
  const indicatorBefore = await page.$eval('.nav-indicator', (e) => e.getBoundingClientRect().x);
  await page.hover('.home-nav button:last-of-type');
  await new Promise((resolve) => setTimeout(resolve, 180));
  check(await page.$eval('.nav-hover-indicator', (e) => {
    const s = getComputedStyle(e); const line = getComputedStyle(e, '::after');
    const text = document.querySelector('.home-nav button:last-of-type span');
    return s.opacity === '1' && Math.abs(parseFloat(line.width) - text.offsetWidth - 24) < 1
      && line.height === getComputedStyle(document.querySelector('.nav-indicator'), '::after').height
      && line.backgroundColor === 'rgba(255, 255, 255, 0.25)'
      && document.querySelector('.home-nav button:first-of-type').hasAttribute('aria-current');
  }), 'hover shows a faint word-sized preview bar without changing the selected page');
  await page.screenshot({ path: 'test-results/home/tab-hover.png' });
  await page.click('.home-nav button:last-of-type');
  check(await page.$('#settings.visible'), 'settings opens from redesigned home');
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 240));
  check(await page.$eval('.nav-hover-indicator', (e) => getComputedStyle(e).opacity === '0'), 'hover preview fades away when the pointer leaves the tabs');
  check(await page.$eval('#settings', (e) => {
    const r = e.getBoundingClientRect(); const c = e.querySelector('.settings-card').getBoundingClientRect();
    const tabs = e.querySelector('.settings-tabs').getBoundingClientRect(); const content = e.querySelector('.settings-panels').getBoundingClientRect();
    return r.width === innerWidth && r.height === innerHeight && c.width > innerWidth * 0.85 && tabs.right < content.left;
  }), 'home Settings fills the viewport with categories on the left');
  check(await page.$eval('#settings .btn.primary', (e) => getComputedStyle(e).backgroundColor === 'rgb(36, 100, 186)'
    && getComputedStyle(e).color === 'rgb(255, 255, 255)'), 'Settings Apply uses the blue primary-button style');
  check(await page.$eval('#settings .tab.selected', (e) => getComputedStyle(e).backgroundColor === 'rgba(78, 141, 255, 0.1)'), 'selected settings category uses blue instead of orange');
  check(await page.$eval('.home-nav', (e, before) => { const r = e.getBoundingClientRect(); return r.x === before.x && r.y === before.y; }, navBefore), 'navigation position remains fixed across pages');
  check(await page.$eval('.nav-indicator', (e, before) => {
    const s = getComputedStyle(e); const fade = getComputedStyle(e, '::before');
    return e.getBoundingClientRect().x > before + 100 && s.transitionDuration === '0.14s' && s.transitionTimingFunction.includes('cubic-bezier')
      && fade.backgroundImage.includes('linear-gradient') && getComputedStyle(e, '::after').backgroundColor === 'rgb(255, 255, 255)';
  }, indicatorBefore), 'white underline and subtle upward fade slide together with smooth 140ms easing');
  check(await page.$eval('.nav-indicator', (e, width) => {
    const label = document.querySelector('.home-nav button[aria-current] span');
    const bar = parseFloat(getComputedStyle(e, '::after').width);
    return bar > width && Math.abs(bar - label.offsetWidth - 24) < 1 && getComputedStyle(e, '::before').width === getComputedStyle(e, '::after').width;
  }, playUnderline), 'Settings underline grows to fit the longer word and its fade matches');
  check(await page.evaluate(() => window.__crossfire.sounds().includes('ui_click') && !window.__crossfire.sounds().includes('ui_hover')), 'click sound remains and navigation hover sounds are removed');
  await page.screenshot({ path: 'test-results/home/settings-fullscreen.png' });
  await page.setViewport({ width: 390, height: 844 });
  check(await page.$eval('.home-settings .settings-tabs', (e) => e.getBoundingClientRect().right < document.querySelector('.settings-panels').getBoundingClientRect().left), 'small home Settings keeps the category sidebar on the left');
  await page.screenshot({ path: 'test-results/home/settings-narrow.png' });
  await page.setViewport({ width: 1600, height: 900 });
  const originalFov = await page.evaluate(() => window.__crossfire.settings().fov);
  await page.focus('#set-fov'); await page.keyboard.press('End');
  await page.click('.home-nav button:first-of-type');
  check(await page.evaluate((fov) => window.__crossfire.settings().fov === fov && document.body.dataset.homePage === 'play', originalFov), 'Play navigation uses Back behavior and discards unapplied settings');
  await page.click('.home-nav button:last-of-type');
  await page.evaluate(() => [...document.querySelectorAll('#settings .settings-foot .btn')].find((b) => b.textContent.trim() === 'Back').click());
  check(await page.$('#menu.visible'), 'Back returns to home');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  check(await page.$eval('.home-backdrop', (e) => getComputedStyle(e).animationName === 'none'), 'reduced-motion preference disables background motion');
  await page.waitForFunction(() => window.__crossfire.homeCharacter().ready);
  await new Promise((r) => setTimeout(r, 200));
  const reducedFrame = (await page.evaluate(() => window.__crossfire.homeCharacter())).character.frame;
  await page.mouse.move(1590, 450); await new Promise((r) => setTimeout(r, 400));
  const reducedPreview = await page.evaluate(() => window.__crossfire.homeCharacter());
  check(reducedPreview.reducedMotion && reducedPreview.character.frame === reducedFrame && Math.abs(reducedPreview.yaw) < .001
    && Math.abs(reducedPreview.headYaw) < .001 && Math.abs(reducedPreview.headPitch) < .001,
    'reduced motion freezes the preview idle and cursor response');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  check(errors.length === 0, 'no browser errors during appearance checks');
  if (!process.argv.includes('--appearance-only')) {
    // Hold actual asset requests so the loading screen can be checked before completion.
    let hold = true;
    const pending = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (hold && request.url().includes('/assets/models/')) pending.push(request);
      else void request.continue();
    });
    await page.click('#menu .btn.primary');
    await page.waitForSelector('#loading.visible');
    check(!(await page.evaluate(() => window.__crossfire.homeCharacter())).active && !(await page.$('.home-character')),
      'entering a match releases the preview scene, canvas and rig');
    check(await page.$eval('#loading', (e) => e.querySelector('.loading-word')?.textContent === 'LOADING' && e.querySelector('.loading-back')?.textContent.trim() === 'Back'
      && e.querySelector('.loading-spinner') && getComputedStyle(e).backgroundColor === 'rgb(41, 44, 49)'), 'join shows centered LOADING, spinner and Back on an opaque dark-gray screen');
    await page.screenshot({ path: 'test-results/home/loading.png' });
    hold = false;
    await Promise.all(pending.splice(0).map((r) => r.continue()));
    await page.waitForSelector('#start.visible', { timeout: 240000 });
    check(await page.$eval('#start .prespawn', (e) => e.innerText.includes('SWITCH GUN') && e.innerText.includes('SPAWN')), 'Play connects and opens the pre-spawn menu');
    check(!requests.some((url) => url.endsWith('/hands.glb')), 'first-person hand/arm asset is never requested');
    console.log(`WebSocket URLs observed (Vite HMR may appear in development): ${JSON.stringify(sockets)}`);
    check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
    // Exercise failure against the real HTTP endpoint; never invent a roster or response.
    const observer = await browser.newPage();
    observer.on('pageerror', (error) => errors.push(String(error)));
    await observer.goto(base, { waitUntil: 'domcontentloaded' });
    await completeGuestProfile(observer);
    await observer.waitForFunction(() => document.querySelector('.online-count')?.dataset.available === 'true');
    await observer.setOfflineMode(true);
    await observer.waitForFunction(() => document.querySelector('.online-count')?.dataset.available === 'false'
      && document.querySelector('.online-count')?.textContent === '0 Players Online', { timeout: 10000 });
    check(true, 'unavailable presence renders zero while preserving its unavailable state');
    await observer.setOfflineMode(false);
    await observer.waitForFunction(() => document.querySelector('.online-count')?.dataset.available === 'true', { timeout: 10000 });
    check(await observer.$eval('.online-count', (e) => /^\d+ Players? Online$/.test(e.textContent)), 'presence recovers to a confirmed real server count');
    check(errors.length === 0, 'no uncaught JavaScript errors during presence failure/recovery');
  }
} finally {
  await browser.close();
}
