/** Legendary elimination effects (Blossom flower burst, Frosted blizzard) in the real game: an offline Practice match on a real map,
 * confirmed eliminations fed through the DEV-only `__crossfire.deliverElimination` hook (the same path as server events).
 *
 *   node tools/kill-effects-test.mjs [http://127.0.0.1:5181/] [--chromebook] [--shots]      (Vite dev server: the hook is DEV only)
 *
 * Checks: only the two Legendary effect ids draw particles (Rich "money", plain kills and duplicate ids draw none); the burst is placed at
 * the event position (first person, side view, distance view); particle counts stay inside the budget while eliminations stack; every
 * particle is gone after the effect and after clear(); no page errors or asset failures; Chromebook mode uses the reduced pools.
 * Frames go to test-results/kill-effects/<mode>/ (name = effect, camera, burst age in ms). report.json lists the numbers. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const chromebook = process.argv.includes('--chromebook');
const out = `test-results/kill-effects/${chromebook ? 'chromebook' : 'high'}`;
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], report = { mode: chromebook ? 'chromebook' : 'high', frames: [] };
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(base + `?quality=${chromebook ? 'low' : 'high'}&nohud`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Kill FX');
  const visible = (selector) => page.waitForSelector(selector + '.visible', { timeout: 240000 });
  const clickText = (root, label) => page.evaluate(({ root, label }) => {
    const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
    if (!b) throw Error('Missing ' + label); b.click();
  }, { root, label });
  await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
  await page.$eval('#practice-setup input[type=range]', (n) => { n.value = '0'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText('#practice-setup', 'START PRACTICE'); await visible('#weapons');
  await page.click('#weapons [data-weapon="rifle"]');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 180000 });
  if (chromebook) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
  await delay(3000);
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  const info = () => page.evaluate(() => window.__crossfire.killBurstInfo());
  const evt = (id, effect, cosmeticId, at) => ({ id, killerId: 'someone-else', victimId: 'victim', weapon: 'rifle', cosmeticEffect: effect ? { effect, cosmeticId, position: at } : undefined });
  const deliver = (event) => page.evaluate((e) => window.__crossfire.deliverElimination(e), event);
  const shot = async (name) => { const data = await page.screenshot({ type: 'jpeg', quality: 82 }); fs.writeFileSync(`${out}/${name}.jpg`, data); };
  // A spot 4.5 m north of the player, facing it (heading 0 = north).
  const ahead = (d) => ({ x: spot.x, y: spot.y, z: spot.z - d });
  const place = () => page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -2), spot);
  await place(); await delay(800);

  // ---- Which events draw anything.
  await page.evaluate(() => window.__crossfire.clearKillBursts());
  const before = (await info()).emitted;
  await deliver(evt('plain-1', null, null, ahead(4.5)));
  await deliver(evt('money-1', 'money', 'rich-rifle', ahead(4.5)));
  await delay(200);
  let i = await info();
  check(i.emitted === before && i.flowers + i.petals + i.flakes + i.sparkles === 0, 'plain and Rich kills draw no Legendary burst');
  await deliver(evt('blossom-1', 'blossom-flower-burst', 'blossom-rifle', ahead(4.5)));
  await deliver(evt('blossom-1', 'blossom-flower-burst', 'blossom-rifle', ahead(4.5)));
  await delay(120); i = await info();
  check(i.emitted === before + 1, 'a confirmed Blossom kill plays once even when the event is delivered twice');
  check(i.flowers > 0 && i.petals > 0 && i.flakes === 0, 'Blossom draws only flowers and petals');
  report.blossomCounts = { flowers: i.flowers, petals: i.petals, lite: i.lite, blended: i.blended };

  // ---- Frames over the burst's life, three viewpoints. `ahead` is the first-person view; the others use a detached camera.
  const AGES = { 'blossom-flower-burst': [.05, .12, .2, .3, .45, .7, 1, 1.35, 1.7, 2.05], 'frosted-blizzard': [.05, .12, .3, .5, .75, .95, 1.1, 1.25, 1.4] };
  const sequence = async (effect, cosmeticId, tag, camera) => {
    await page.evaluate(() => { window.__crossfire.freezeKillBursts(false); window.__crossfire.clearKillBursts(); }); await delay(150);
    await camera(); await delay(900);
    const at = ahead(4.5), id = `${tag}-${effect}-${Date.now()}`;
    // The effect clock is frozen right after the (real) delivery and stepped to exact ages, so each frame is reproducible.
    await page.evaluate(() => window.__crossfire.freezeKillBursts(true));
    await deliver(evt(id, effect, cosmeticId, at));
    const taken = []; let last = 0;
    for (const age of AGES[effect]) {
      await page.evaluate((d) => window.__crossfire.stepKillBursts(d), age - last); last = age; await delay(120);
      const data = await page.screenshot({ type: 'jpeg', quality: 82 }), state = await info();
      const name = `${effect}-${tag}-${String(Math.round(age * 1000)).padStart(5, '0')}ms`;
      fs.writeFileSync(`${out}/${name}.jpg`, data); taken.push({ name, age, flowers: state.flowers, petals: state.petals, flakes: state.flakes, sparkles: state.sparkles });
    }
    // Past the end of the effect everything must be gone.
    await page.evaluate(() => window.__crossfire.stepKillBursts(.6)); const end = await info();
    report.frames.push(...taken);
    assert.equal(end.flowers + end.petals + end.flakes + end.sparkles, 0, `${effect} ${tag}: particles remain after the effect`);
    await page.evaluate(() => window.__crossfire.freezeKillBursts(false));
    return taken;
  };
  const fp = () => place();
  // Detached cameras stand further down the same lane and look back at the burst (a nearby player 5 m away, a distant one 21 m away).
  const back = (d, h) => page.evaluate(({ p, d, h }) => window.__crossfire.freeCam(p.x, p.y + h, p.z - d, 180, -3), { p: spot, d, h });
  const side = () => back(9.5, 1.6);
  // The furthest candidate whose camera is not inside a solid (the engine's own overlap test).
  const far = async () => { for (const d of [24, 21, 18, 16, 14, 12]) { await back(d, 2); const v = await page.evaluate(() => window.__crossfire.leanView()); if (!v.cameraBlocked) { report.farDistance = d - 4.5; return; } } };
  // First person first: the detached cameras pause the game and hide the gun, so they come last.
  for (const [tag, camera] of [['fp', fp], ['side', side], ['far', far]]) {
    for (const [effect, cosmeticId] of [['blossom-flower-burst', 'blossom-rifle'], ['frosted-blizzard', 'frosted-rifle']]) {
      const taken = await sequence(effect, cosmeticId, tag, camera);
      const peak = Math.max(...taken.map((t) => t.flowers + t.petals + t.flakes + t.sparkles));
      check(peak > 0, `${effect} draws in the ${tag} view (peak ${peak} particles, ${taken.length} frames)`);
    }
  }
  await place();

  // ---- Everything is gone afterwards.
  await delay(2600); i = await info();
  check(i.flowers + i.petals + i.flakes + i.sparkles === 0 && i.bursts === 0 && i.drawn === 0, 'no particle or draw call remains after the effects finish');

  const frameTimes = () => page.evaluate(() => new Promise((resolve) => { const t = []; let last = performance.now(); const step = (now) => { t.push(now - last); last = now; if (t.length < 50) requestAnimationFrame(step); else resolve(t.slice(5)); }; requestAnimationFrame(step); }));
  const stat = (t) => ({ mean: +(t.reduce((x, y) => x + y, 0) / t.length).toFixed(2), worst: +Math.max(...t).toFixed(2) });
  await place(); await delay(1200);
  report.idleFrameMs = stat(await frameTimes()); console.log('idle frame ms', report.idleFrameMs);

  // ---- Budget under stacking: ten quick eliminations of each kind.
  await place();
  for (let n = 0; n < 10; n++) {
    await deliver(evt(`stack-b-${n}`, 'blossom-flower-burst', 'blossom-rifle', ahead(3 + n * .3)));
    await deliver(evt(`stack-f-${n}`, 'frosted-blizzard', 'frosted-rifle', ahead(3 + n * .3)));
  }
  await delay(60); i = await info();
  const cap = i.budget; report.stacking = { ...i };
  check(i.bursts <= cap.bursts * 2, `concurrent bursts stay within the budget (${i.bursts} <= ${cap.bursts * 2})`);
  check(i.flowers <= cap.flowers * cap.bursts && i.petals <= cap.petals * cap.bursts && i.flakes <= cap.flakes * cap.bursts && i.sparkles <= cap.sparkles * cap.bursts,
    `particle pools stay within capacity (flowers ${i.flowers}, petals ${i.petals}, flakes ${i.flakes}, sparkles ${i.sparkles})`);
  await shot('stacked');
  // Frame time while everything is on screen (the page's own rAF clock).
  report.stackedFrameMs = stat(await frameTimes());
  console.log('stacked frame ms', report.stackedFrameMs);
  await page.evaluate(() => window.__crossfire.clearKillBursts()); i = await info();
  check(i.flowers + i.petals + i.flakes + i.sparkles === 0 && i.drawn === 0, 'clear() removes every particle immediately');

  if (chromebook) check(report.blossomCounts.lite && !report.blossomCounts.blended, 'Chromebook mode uses the reduced, opaque pools');
  else check(!report.blossomCounts.lite && report.blossomCounts.blended, 'high quality uses the full, soft-fading pools');
  check(errors.length === 0, 'no page errors, console errors or asset failures' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  console.error('FAIL', e.message); report.failure = String(e.message);
  process.exitCode = 1;
} finally {
  report.checks = checks; report.errors = errors;
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
}
