/** Blossom (victim becomes flowers, no fall) and Frosted (double snowflakes + curved trails) with REAL remote avatars: offline Practice on a
 * real map with Practice bots, eliminations through the DEV-only `__crossfire.eliminateRemoteWith` hook (the same calls as network.onElimination).
 *
 *   node tools/kill-effects-upgrade-test.mjs [http://localhost:5181/] [--chromebook]       (Vite dev server, use localhost: Vite listens on IPv6)
 *
 * Checks: a Blossom kill hides the victim's model on the first frame and never plays the falling pose; a plain kill and a Frosted kill still
 * fall normally; the bursts are drawn at the victim; Frosted draws ribbons only in the swirl, none after; particle counts match the budgets;
 * everything is cleaned up; frame cost of an update with stacked bursts. Frames (frozen, exact ages) go to test-results/kill-effects-upgrade/<mode>/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5181/';
const chromebook = process.argv.includes('--chromebook');
const out = `test-results/kill-effects-upgrade/${chromebook ? 'chromebook' : 'high'}`;
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
  const startPractice = async () => {
    await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
    await page.click('#practice-setup [data-difficulty="beginner"]');
    await page.$eval('#practice-setup input[type=range]', (n) => { n.value = '3'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickText('#practice-setup', 'START PRACTICE'); await visible('#weapons');
    await page.click('#weapons [data-weapon="rifle"]');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 180000 });
    if (chromebook) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
    await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb' && !p.death), { timeout: 120000 });
  };
  const info = () => page.evaluate(() => window.__crossfire.killBurstInfo());
  const rendered = () => page.evaluate(() => window.__crossfire.network().rendered);
  const shot = async (name) => { const data = await page.screenshot({ type: 'jpeg', quality: 84 }); fs.writeFileSync(`${out}/${name}.jpg`, data); };
  /** A free camera with a clear line of sight to the bot (the renderer's own visibility flag). The camera pauses the sim: stay quick. */
  const frame = async (id, distance, height, pitch) => {
    for (const offset of [90, -90, 60, -60, 120, -120]) for (const d of [distance, distance - 1.2]) {
      await page.evaluate(({ offset, d, id, height, pitch }) => {
        const bot = window.__crossfire.network().rendered.find((p) => p.id === id);
        const heading = -bot.yaw * 180 / Math.PI + offset, r = heading * Math.PI / 180;
        window.__crossfire.freeCam(bot.x + Math.sin(r) * d, bot.y + height, bot.z - Math.cos(r) * d, heading + 180, pitch);
      }, { offset, d, id, height, pitch });
      await delay(80);
      if (await page.evaluate((i) => window.__crossfire.network().rendered.find((p) => p.id === i)?.visible, id)) return { offset, d };
    }
    return null;
  };
  const AGES = { blossom: [0, .03, .08, .15, .25, .4, .6, .9, 1.25, 1.6, 1.95], frosted: [.1, .25, .45, .65, .85, 1.0, 1.15, 1.3] };
  const frameTimes = () => page.evaluate(() => new Promise((resolve) => { const t = []; let last = performance.now(); const step = (now) => { t.push(now - last); last = now; if (t.length < 50) requestAnimationFrame(step); else resolve(t.slice(5)); }; requestAnimationFrame(step); }));
  const stat = (t) => ({ mean: +(t.reduce((x, y) => x + y, 0) / t.length).toFixed(2), worst: +Math.max(...t).toFixed(2) });

  await startPractice();
  report.idleFrameMs = stat(await frameTimes()); console.log('idle frame ms', report.idleFrameMs);

  // One scene per kill: the free camera pauses the simulation (live avatars time out after ~4 s), so each starts from a fresh session.
  const scene = async (kind, view) => {
    await page.evaluate(() => { window.__crossfire.freezeKillBursts(false); window.__crossfire.clearKillBursts(); });
    const bots = (await rendered()).filter((p) => p.source === 'glb' && !p.death);
    assert.ok(bots.length, 'no live bot to eliminate');
    const id = bots[0].id;
    const distance = view === 'wide' ? 6.5 : 3.6, height = view === 'wide' ? 1.9 : 1.3;
    const framing = await frame(id, distance, height, view === 'wide' ? -12 : -6);
    // The plain kill is only a control for the pose state: a missing view does not matter there.
    if (kind !== 'plain') assert.ok(framing, `${kind}/${view}: no clear view of the bot`);
    const bot = (await rendered()).find((p) => p.id === id);
    const effect = kind === 'blossom' ? 'blossom-flower-burst' : kind === 'frosted' ? 'frosted-blizzard' : null;
    const dir = { x: Math.sin(bot.yaw), z: Math.cos(bot.yaw) };
    await shot(`${kind}-${view}-before`);
    await page.evaluate(() => window.__crossfire.freezeKillBursts(true));
    const victim = await page.evaluate(({ effect, id, dir }) => window.__crossfire.eliminateRemoteWith(effect, id, dir.x, dir.z), { effect, id, dir });
    assert.equal(victim, id);
    const first = (await rendered()).find((p) => p.id === id);
    report[`${kind}-${view}-first`] = { shown: first.shown, vanish: first.death?.vanish, alpha: first.death?.alpha };
    const taken = []; let last = 0;
    for (const age of (kind === 'blossom' ? AGES.blossom : kind === 'frosted' ? AGES.frosted : [0.05, 0.3, 0.6, 1.0])) {
      await page.evaluate((d) => window.__crossfire.stepKillBursts(d), age - last); last = age; await delay(100);
      const state = await info(), r = (await rendered()).find((p) => p.id === id);
      const name = `${kind}-${view}-${String(Math.round(age * 1000)).padStart(5, '0')}ms`;
      await shot(name);
      taken.push({ name, age, flowers: state.flowers, petals: state.petals, flakes: state.flakes, sparkles: state.sparkles, trails: state.trails, shown: r ? r.shown : null });
    }
    report.frames.push(...taken);
    return { id, taken, effect };
  };
  const newSession = async () => { await page.evaluate(() => window.__crossfire.networkLeave()); await visible('#menu'); await startPractice(); };

  for (const view of ['near', 'wide']) {
    for (const kind of ['blossom', 'frosted', 'plain']) {
      // The free camera pauses the simulation and live avatars time out after ~4 s: a bot behind a wall can vanish while framing, so retry on a fresh session.
      let result = null;
      for (let attempt = 0; attempt < 4 && !result; attempt++) {
        try { result = await scene(kind, view); } catch (e) { console.log(`retry ${kind}/${view}:`, e.message); await newSession(); }
      }
      assert.ok(result, `${kind}/${view}: no scene after retries`);
      const { id, taken } = result;
      const first = report[`${kind}-${view}-first`];
      if (kind === 'blossom') {
        check(first.shown === false && first.vanish === true, `blossom/${view}: the victim model is hidden on the first frame (no fall)`);
        check(taken.every((t) => t.shown !== true), `blossom/${view}: the model stays hidden for the whole effect`);
        const early = taken.find((t) => t.age >= .08);
        const full = chromebook ? { flowers: 14, petals: 20 } : { flowers: 39, petals: 66 };
        check(early.flowers === full.flowers && early.petals === full.petals && early.flakes === 0, `blossom/${view}: ${full.flowers} flowers + ${full.petals} petals`);
        const end = taken.at(-1); check(end.flowers + end.petals <= 2 || end.age >= 1.9, `blossom/${view}: fading out by ${end.age}s`);
      } else {
        check(first.shown === true && first.vanish === false, `${kind}/${view}: the victim keeps the normal falling death`);
        if (kind === 'frosted') {
          const mid = taken.find((t) => t.age >= .45);
          const full = chromebook ? { flakes: 30, trails: 6 } : { flakes: 108, trails: 28 };
          check(mid.flakes === full.flakes && mid.trails === full.trails, `frosted/${view}: ${full.flakes} flakes, ${full.trails} with a trail`);
          check(taken.at(-1).trails === 0 && taken.at(-1).age > 1.2, `frosted/${view}: trails are gone once the flakes disperse`);
        }
      }
      void id;
      await newSession();
    }
  }

  // Cleanup and cost: stack six bursts (3 of each) from a live session and time the effect update.
  await page.evaluate(() => { window.__crossfire.freezeKillBursts(false); window.__crossfire.clearKillBursts(); });
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  await page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -2), spot); await delay(700);
  for (let n = 0; n < 3; n++) await page.evaluate(({ p, n }) => {
    window.__crossfire.emitKillBurst('blossom-flower-burst', p.x + n * .5, p.y, p.z - 4 - n);
    window.__crossfire.emitKillBurst('frosted-blizzard', p.x - n * .5, p.y, p.z - 4 - n);
  }, { p: spot, n });
  await delay(260); let i = await info();
  report.stacked = { ...i };
  check(i.bursts <= i.budget.bursts * 2, `stacked bursts stay inside the budget (${i.bursts})`);
  check(i.trails <= i.trailCapacity, `trail ribbons stay inside capacity (${i.trails} <= ${i.trailCapacity})`);
  await shot('stacked');
  report.stackedFrameMs = stat(await frameTimes()); console.log('stacked frame ms', report.stackedFrameMs, 'update ms', (await info()).updateMs);
  await delay(2800); i = await info();
  check(i.flowers + i.petals + i.flakes + i.sparkles === 0 && i.trails === 0 && i.drawn === 0 && i.bursts === 0, 'no particle, trail ribbon or draw call remains afterwards');
  check(errors.length === 0, 'no page errors, console errors or asset failures' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  console.error('FAIL', e.message); report.failure = String(e.message);
  process.exitCode = 1;
} finally {
  report.checks = checks; report.errors = errors;
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
}
