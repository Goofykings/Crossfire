/** Stage A: production rendering + actual two-browser Worker slide synchronization.
 * node tools/stage-a-test.mjs --url http://127.0.0.1:4176/crossfire/
 * Requires a completed frontend build and server dry-run build; does not deploy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const at = process.argv.indexOf('--url');
const base = at < 0 ? 'http://127.0.0.1:4176/crossfire/' : process.argv[at + 1];
const out = 'test-results/stage-a';
fs.mkdirSync(out, { recursive: true });
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'crossfire-slide-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/slide-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin }, log: new Log(LogLevel.ERROR),
}));
const backend = (await fixture.ready).href;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS ${message}`); };
async function open(practice, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.evaluateOnNewDocument((backend) => {
    const RealSocket = window.WebSocket;
    window.WebSocket = class extends RealSocket {
      constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws'
        ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); }
    };
    const realFetch = window.fetch;
    window.fetch = (input, init) => realFetch(new URL(String(input), location.href).pathname === '/presence'
      ? new URL('/presence', backend) : input, init);
  }, backend);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?${practice ? 'practice' : 'multiplayer'}&autoplay&quality=medium&shadows=low`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page, name);
  await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible'), { timeout: 240000 });
  const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : null);
  assert.equal(error, null);
  return page;
}
async function view(page, file, pos, target) {
  const dx = target[0] - pos[0], dz = target[2] - pos[2];
  await page.evaluate((p, h, pitch) => window.__crossfire.freeCam(...p, h, pitch), pos,
    Math.atan2(dx, -dz) * 180 / Math.PI, Math.atan2(target[1] - pos[1], Math.hypot(dx, dz)) * 180 / Math.PI);
  await delay(180);
  await page.screenshot({ path: `${out}/${file}.jpg`, quality: 82 });
}
try {
  if (!process.argv.includes('--render-only')) {
  const a = await open(false, 'Slide test A'), b = await open(false, 'Slide test B');
  await b.waitForFunction(() => window.__crossfire.network().rendered.length === 1);
  const id = await a.evaluate(() => window.__crossfire.network().selfId);
  await a.evaluate(() => {
    window.slideSamples = [];
    const sample = () => { window.slideSamples.push({ at: performance.now(), ...window.__crossfire.motion() });
      if (window.slideSamples.length < 600) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await a.bringToFront();
  await a.keyboard.down('KeyW');
  await delay(300);
  await a.keyboard.down('ShiftLeft');
  await b.waitForFunction((id) => window.__crossfire.network().snapshot.players.some((p) => p.id === id && p.motion.slideRemaining > 0), {}, id);
  await b.waitForFunction((id) => window.__crossfire.network().rendered.some((p) => p.id === id && p.height < 1.3), {}, id);
  check(true, 'real Shift press starts an authoritative slide and lowers the other browser’s avatar');
  await delay(2450);
  const samples = await a.evaluate(() => window.slideSamples);
  const active = samples.filter((s) => s.slideRemaining > 0);
  check(active.length > 3 && active.at(-1).at - active[0].at > 700 && active.at(-1).at - active[0].at < 1250, 'slide lasts approximately one second');
  check(active.some((s) => s.eyeHeight < 1.1) && active.some((s) => s.eyeHeight > 1.2 && s.eyeHeight < 1.6), 'camera lowers through intermediate heights');
  check(samples.some((s) => s.slideCooldown > .8) && samples.at(-1).slideRemaining === 0 && samples.at(-1).crouch === 0, 'post-slide cooldown and smooth standing return work while Shift stays held');
  const firstSlide = samples.findIndex((s) => s.slideRemaining > 0);
  const firstEnd = samples.findIndex((s, k) => k > firstSlide && s.slideRemaining === 0);
  check(firstEnd > firstSlide && samples.slice(firstEnd).every((s) => s.slideRemaining === 0), 'held Shift cannot restart the slide');
  check(samples.every((s) => Math.hypot(s.velocity.x, s.velocity.z) <= 7.801), 'client prediction stays within the shared speed bound');
  check(samples.every((s, k) => !k || s.at - samples[k - 1].at > 50
    || Math.abs((s.cameraY - s.position.y) - (samples[k - 1].cameraY - samples[k - 1].position.y)) < .4),
  'camera lowers and returns without a height teleport');
  await a.keyboard.up('ShiftLeft');
  await a.keyboard.down('ShiftLeft');
  await a.waitForFunction(() => window.__crossfire.motion().slideRemaining > 0);
  check(true, 'release and a fresh Shift press permit another slide after cooldown');
  await a.keyboard.up('KeyW');
  await delay(2300); // Let the second slide and cooldown finish, with Shift still held.
  await a.keyboard.up('ShiftLeft');
  await b.waitForFunction((id) => window.__crossfire.network().snapshot.players.some((p) => p.id === id && !p.motion.slideHeld), {}, id);
  check(true, 'releasing Shift while fully idle reaches the authoritative server');
  await a.keyboard.down('KeyW'); await a.keyboard.down('ShiftLeft');
  await b.waitForFunction((id) => window.__crossfire.network().snapshot.players.some((p) => p.id === id && p.motion.slideRemaining > 0), {}, id);
  check(true, 'a fresh press after an idle release starts a real server slide');
  await a.keyboard.up('ShiftLeft'); await a.keyboard.up('KeyW');
  await delay(1300);
  await a.keyboard.down('ControlLeft'); await delay(200); await a.keyboard.up('ControlLeft');
  check(await a.evaluate(() => window.__crossfire.motion().crouch === 0), 'Ctrl no longer crouches');
  await a.keyboard.down('Tab');
  const decoration = await a.$eval('.scoreboard', (e) => ({ visible: !e.hidden,
    background: getComputedStyle(e, '::before').backgroundImage, textOpacity: getComputedStyle(e.querySelector('table')).opacity,
    text: e.innerText }));
  check(decoration.visible && decoration.text.includes('Slide test A') && decoration.text.includes('Slide test B')
    && decoration.textOpacity === '1' && decoration.background.includes('92%'), 'real leaderboard stays readable; only the decorative background fades near the outer edges');
  await a.screenshot({ path: `${out}/leaderboard.jpg`, quality: 85 });
  await a.keyboard.up('Tab');
  await a.evaluate(() => window.__crossfire.networkReconnect());
  await a.waitForFunction(() => window.__crossfire.network().state === 'connected', { timeout: 15000 });
  check(await a.evaluate(() => window.__crossfire.network().selfId) === id, 'real reconnect retains the authoritative session with the new movement state');
  await a.evaluate(() => window.__crossfire.networkLeave());
  await b.evaluate(() => window.__crossfire.networkLeave());
  await a.browserContext().close(); await b.browserContext().close();
  fs.writeFileSync(`${out}/slide-samples.json`, JSON.stringify(samples, null, 2));
  }

  const p = await open(true, 'Rendering test');
  await p.addStyleTag({ content: '#hud, #crosshair { visibility: hidden !important; }' });
  await p.evaluate(() => window.__crossfire.loadMap('european-town'));
  await delay(3000);
  for (let angle = 0; angle < 360; angle += 45) {
    const r = angle * Math.PI / 180;
    await view(p, `well-${angle}`, [Math.sin(r) * 3.4, 1.64, -Math.cos(r) * 3.4], [0, 1.15, 0]);
  }
  await view(p, 'well-rim', [2.5, 2.5, -2.5], [0, .85, 0]);
  for (const [k, [x, y, z], hd] of [[0, [-2.6, 0, -4.15], 180], [1, [2.6, 0, 4.15], 0],
    [2, [25, .54, -31.15], 180], [3, [-25, .54, 31.15], 0]]) {
    const r = hd * Math.PI / 180;
    await view(p, `canopy-${k}`, [x + Math.sin(r) * .7, y + 1.4, z - Math.cos(r) * .7], [x, y + 2.5, z]);
  }
  for (const map of ['european-town', 'industrial-complex', 'modern-city']) {
    await p.evaluate((map) => window.__crossfire.loadMap(map), map);
    await delay(1500);
    const layout = JSON.parse(fs.readFileSync(`src/maps/${map}/layout.json`, 'utf8'));
    let n = 0;
    for (const bench of layout.props.filter((q) => ['bench', 'bench_modern'].includes(q.type))) {
      const [x, y, z] = bench.pos, r = bench.heading * Math.PI / 180;
      const pos = map === 'european-town' && Math.abs(x) > 20
        ? [x + Math.sign(x) * 1.25, y + 1.6, z + Math.sign(x) * 1.2]
        : [x + Math.sin(r) * 2.6 + Math.cos(r), y + 1.5, z - Math.cos(r) * 2.6 + Math.sin(r)];
      await view(p, `${map}-bench-${n++}`, pos, [x, y + .5, z]);
    }
    check((await p.evaluate(() => window.__crossfire.stats())).missingMaterials.length === 0, `${map}: no missing materials, ${n} bench views captured`);
  }
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
  console.log(`Rendering captures saved to ${out}; inspect them before claiming visual verification.`);
} finally { await browser.close(); await fixture.dispose(); }
