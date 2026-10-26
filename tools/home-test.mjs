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
  await page.waitForFunction(() => window.__crossfire?.stats().mapId && document.querySelector('#menu.visible'), { timeout: 240000 });
  check(await page.$eval('#menu', (e) => /^CROSSFIRE PLAY SETTINGS (Offline|\d+ Players? Online)$/.test(e.innerText.trim().split(/\s+/).join(' '))), 'home contains title, two buttons and subtle real presence status');
  check((await page.$$('#menu button')).length === 2 && !(await page.$('#map-list')), 'home has exactly two buttons and no map selector');

  for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 600], [390, 844], [320, 568]]) {
    await page.setViewport({ width, height });
    const layout = await page.evaluate(() => {
      const title = document.querySelector('#menu h1');
      const t = title.getBoundingClientRect();
      const play = document.querySelector('#menu .btn.primary').getBoundingClientRect();
      const settings = document.querySelector('#menu .btn:not(.primary)').getBoundingClientRect();
      return t.left >= 0 && t.top >= 0 && t.right <= innerWidth && title.scrollWidth <= title.clientWidth + 1
        && play.top > t.bottom && settings.top > play.bottom && settings.bottom <= innerHeight
        && play.height > settings.height && document.querySelector('#menu').scrollWidth <= innerWidth;
    });
    check(layout, `${width}x${height}: full title, stacked buttons and no clipping`);
    await page.screenshot({ path: `test-results/home/${width}-minimal.png` });
  }
  await page.setViewport({ width: 1600, height: 900 });
  await page.click('#menu .menu-buttons > .btn:last-child');
  check(await page.$('#settings.visible'), 'settings opens from redesigned home');
  await page.evaluate(() => [...document.querySelectorAll('#settings .settings-foot .btn')].find((b) => b.textContent.trim() === 'Back').click());
  check(await page.$('#menu.visible'), 'Back returns to home');
  await page.click('#menu .btn.primary');
  await page.waitForSelector('#start.visible', { timeout: 240000 });
  check(await page.$eval('#start .prespawn', (e) => e.innerText.includes('SWITCH GUN') && e.innerText.includes('SPAWN')), 'Play connects and opens the pre-spawn menu');
  check(!requests.some((url) => url.endsWith('/hands.glb')), 'first-person hand/arm asset is never requested');
  console.log(`WebSocket URLs observed (Vite HMR may appear in development): ${JSON.stringify(sockets)}`);
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
}
