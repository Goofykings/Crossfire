/** Actual input, view-model samples and captures against a running dev/preview server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const out = 'test-results/polish-phase1'; fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling'] });
const errors = [], results = [];
const check = (v, label) => { assert.ok(v, label); console.log(`PASS ${label}`); };
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`); });
const hold = (key, held) => page.evaluate((key, held) => window.__crossfire.hold(key, held), key, held);
const weapon = () => page.evaluate(() => window.__crossfire.weapon());
const reset = async (heading = 90) => {
  await page.evaluate((heading) => {
    for (const key of ['forward', 'back', 'left', 'right', 'aim', 'fire', 'slide', 'jump', 'leanLeft', 'leanRight']) window.__crossfire.hold(key, false);
    window.__crossfire.teleport(4, 0, 4, heading, 0);
  }, heading);
  await delay(180);
};
async function sample(ms) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const samples = [], start = performance.now();
    const tick = () => {
      samples.push({ at: performance.now() - start, w: window.__crossfire.weapon(),
        body: window.__crossfire.motion(), view: window.__crossfire.leanView() });
      if (performance.now() - start >= ms) resolve(samples); else requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  }), ms);
}
try {
  await page.goto(`${base}?practice&autoplay&quality=medium&shadows=low&scale=.8`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Polish Tester');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 240000 });
  for (const [slot, id] of (process.argv.includes('--transitions-only') ? [] : ['rifle', 'shotgun', 'sniper', 'smg']).entries()) {
    await reset();
    await page.evaluate((slot) => window.__crossfire.selectWeapon(slot), slot);
    await page.waitForFunction((id) => { const w = window.__crossfire.weapon(); return w.id === id && w.action === 'idle'; }, { timeout: 15000 }, id);
    const resting = await sample(900);
    const xs = resting.map((s) => s.w.view.transform.x);
    check(Math.max(...xs) - Math.min(...xs) > .0004, `${id}: subtle continuous idle motion`);
    await page.screenshot({ path: `${out}/${id}-idle.png` });
    const before = await weapon();
    await hold('fire', true);
    const firing = await sample(160);
    await hold('fire', false);
    const fired = await weapon();
    const shotCount = fired.view.motion.shots - before.view.motion.shots;
    check(shotCount > 0 && shotCount === before.ammo - fired.ammo, `${id}: one recoil impulse per actual shot`);
    check(firing.some((s) => s.w.view.transform.z > .004), `${id}: entire weapon recoils backwards`);
    await page.screenshot({ path: `${out}/${id}-firing.png` });
    await delay(1200);
    check(Math.abs((await weapon()).view.transform.z) < .0001, `${id}: recoil settles without accumulation`);
    await hold('aim', true); await delay(700);
    const aimed = await weapon();
    check(aimed.ads > .99, `${id}: ADS completes`);
    const beforeAds = aimed.view.pivot;
    await hold('fire', true); const adsFire = await sample(120); await hold('fire', false);
    check(adsFire.some((s) => s.w.view.motion.recoil > .004), `${id}: ADS firing moves the full rig`);
    // Bolt/pump action poses can intentionally interrupt ADS; check the recovered pose.
    await page.waitForFunction(() => { const w = window.__crossfire.weapon(); return w.action === 'idle' && w.ads > .99; }, { timeout: 10000 });
    await delay(600);
    const recovered = await weapon();
    check(recovered.ads > .99 && Math.abs(recovered.view.pivot[0] - beforeAds[0]) < .0001
      && Math.abs(recovered.view.pivot[1] - beforeAds[1]) < .0001, `${id}: original ADS sight alignment restored`);
    await page.screenshot({ path: `${out}/${id}-ads.png` });
    await hold('aim', false); await delay(400);
    await hold('forward', true);
    const approach = await sample(2600);
    await hold('forward', false);
    check(approach.every((s) => s.view.weaponPullback === 0), `${id}: no wall-driven gun retraction`);
    check(approach.every((s) => !s.view.muzzleBlocked), `${id}: approaching actual map cover keeps muzzle clear`);
    results.push({ id, shotCount, idleRange: Math.max(...xs) - Math.min(...xs),
      recoilMax: Math.max(...firing.map((s) => s.w.view.transform.z)), finalBody: approach.at(-1).body });
  }
  await reset(0);
  await hold('forward', true); await delay(350); await hold('slide', true);
  const sliding = await sample(200);
  check(sliding.some((s) => s.body.slideRemaining > 0 && s.w.view.motion.slide > .5), 'running movement blends into slide posture');
  const lines = await page.$eval('.slide-lines', (e) => {
    const frames = e.firstElementChild.getAnimations()[0]?.effect.getKeyframes();
    return { count: e.children.length, active: e.classList.contains('active'), mask: getComputedStyle(e).maskImage,
      radii: frames.map((f) => { const m = new DOMMatrix(f.transform); return Math.hypot(m.m41, m.m42); }) };
  });
  check(lines.count === 28 && lines.active && lines.mask.includes('radial-gradient'), 'fixed streak set leaves crosshair center clear');
  check(lines.radii[0] < 180 && lines.radii.at(-1) > lines.radii[0] * 3, 'streaks animate from near center outward');
  await page.screenshot({ path: `${out}/sliding.png` });
  // Screenshot encoding can outlast a one-second slide. Begin a fresh slide
  // before testing jump cancellation, without an intervening capture.
  await reset(0); await hold('forward', true); await delay(100); await hold('slide', true);
  const jumpStart = await sample(120);
  const momentum = Math.hypot(jumpStart.at(-1).body.velocity.x, jumpStart.at(-1).body.velocity.z);
  await hold('jump', true); const jumping = await sample(100); await hold('jump', false);
  check(jumping.some((s) => !s.body.grounded && s.body.slideRemaining === 0
    && Math.hypot(s.body.velocity.x, s.body.velocity.z) > momentum - .5), 'jump cancels slide while retaining momentum');
  await hold('forward', false); await hold('slide', false);
  const landing = await sample(1600);
  check(landing.some((s) => s.w.view.motion.landing > .003), 'actual jump landing triggers a downward weapon response');
  check(!await page.$eval('.slide-lines', (e) => e.classList.contains('active')), 'slide cancellation fades speed lines');
  await reset(); await hold('forward', true); await delay(100); await hold('slide', true); await delay(200);
  await hold('forward', false); await hold('slide', false); await hold('aim', true);
  const crouchAim = await sample(200);
  check(crouchAim.some((s) => s.body.crouch > .5 && s.w.ads > .9
    && Math.abs(s.w.view.transform.roll) < .001), 'crouched ADS blends out posture rotation');
  await reset();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await delay(300);
  check((await weapon()).view.motion.idle < .13, 'system reduced-motion preference reduces decorative weapon motion');
  check(await page.$eval('.slide-lines i', (e) => getComputedStyle(e).animationName === 'none'), 'reduced motion stops speed streak animation');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const layout = JSON.parse(fs.readFileSync('src/maps/european-town/layout.json', 'utf8'));
  for (const reverse of [false, true]) {
    const points = reverse ? [...layout.navigation.upperRoutes[0].waypoints].reverse() : layout.navigation.upperRoutes[0].waypoints;
    const start = points[0], end = points.at(-1), dx = end[0] - start[0], dz = end[2] - start[2], len = Math.hypot(dx, dz);
    await reset();
    await page.evaluate((start, heading) => window.__crossfire.teleport(...start, heading, 0), start, Math.atan2(dx, -dz) * 180 / Math.PI);
    await hold('forward', true);
    const stairs = await page.evaluate((start, dx, dz, len) => new Promise((resolve) => {
      const samples = [], began = performance.now();
      const tick = () => {
        const body = window.__crossfire.motion(); samples.push({ at: performance.now() - began, body });
        const progress = ((body.position.x - start[0]) * dx + (body.position.z - start[2]) * dz) / len;
        if (progress >= len - .2 || performance.now() - began > 12000) { window.__crossfire.hold('forward', false); resolve({ samples, progress }); }
        else requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    }), start, dx, dz, len);
    check(stairs.progress >= len - .3 && Math.max(...stairs.samples.map((s) => s.body.position.y)) > 2.7,
      `actual map stairs traverse in the ${reverse ? 'reverse' : 'forward'} direction`);
    check(stairs.samples.every((s) => s.body.position.y >= -.01), 'stair smoothing preserves physical ground collision');
    results.push({ stairs: reverse ? 'reverse' : 'forward', ...stairs });
  }
  check(errors.length === 0, `no browser errors or missing assets (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, lines, errors }, null, 2));
} finally { await browser.close(); }
