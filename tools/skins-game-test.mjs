/** The 2026-11-10 skins in the real game: an offline Practice match (real map, HDR sky, first-person WeaponView and
 * MeleeView), shown through the DEV-only `__crossfire.previewSkin` hook. Nothing is owned, equipped, saved or sent.
 *
 *   node tools/skins-game-test.mjs [http://127.0.0.1:4210/]      (Vite dev server: the hook is DEV only)
 *
 * Checks: every family renders on the first-person gun without shader or asset errors; Hydro Dip moves between
 * frames while the gun's silhouette does not; Frosted spawns a bounded flurry when firing and none while aiming;
 * Darkness covers the dual daggers; Chromebook mode switches the shared shader to its lite path, cuts the flakes
 * and keeps rendering. Screenshots and report.json go to test-results/skins-game/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4210/';
const out = 'test-results/skins-game';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], report = {};
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(base + '?quality=high&nohud', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Skin Test');
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
  await page.waitForFunction(() => window.__crossfire.meleeInspect()?.ready, { timeout: 60000 });
  await delay(2500);
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  const place = () => page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -4), spot);
  const skin = async (id) => { assert.equal(await page.evaluate((id) => window.__crossfire.previewSkin(id), id), true, 'DEV preview hook: ' + id); await place();
    // Meshes whose shaders are still compiling are skipped by the renderer: wait for the new skin's variants.
    await page.waitForFunction(() => window.__crossfire.renderScene().meshes.filter((m) => m.renderingGroupId === 1 && m.isEnabled() && m.getTotalVertices() > 0).every((m) => m.isReady(true)), { timeout: 60000 });
    await delay(500); };
  /** The lower right quarter of the frame, where the first-person gun sits: [mean absolute difference, changed share]. */
  const diff = (a, b) => page.evaluate(async ({ a, b }) => {
    const load = async (src) => { const i = new Image(); i.src = 'data:image/png;base64,' + src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(i.width / 2, i.height / 2, i.width / 2, i.height / 2).data; };
    const [x, y] = await Promise.all([load(a), load(b)]); let sum = 0, changed = 0;
    for (let i = 0; i < x.length; i += 4) { const d = Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]); sum += d; if (d > 24) changed++; }
    return [sum / (x.length / 4) / 3, changed / (x.length / 4)];
  }, { a, b });
  const shot = async (name) => { const data = await page.screenshot({ encoding: 'base64' }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64')); return data; };

  // ---- Every family on the first-person rifle, real map lighting.
  const shots = {};
  for (const id of ['default-rifle', 'carbon-fiber-rifle', 'hydro-nebula-rifle', 'hydro-inferno-rifle', 'hydro-abyss-rifle', 'blossom-rifle', 'frosted-rifle', 'darkness-rifle']) {
    await skin(id); shots[id] = await shot('fp-' + id);
    const view = await page.evaluate(() => window.__crossfire.weapon().view);
    check(view && errors.length === 0, `${id} renders on the first-person gun without errors`);
    if (id !== 'default-rifle') check((await diff(shots['default-rifle'], shots[id]))[1] > .02, `${id} visibly changes the gun`);
  }
  const fx = await page.evaluate(() => window.__crossfire.skinFx());
  report.skinFx = fx;
  check(fx.lite === false && fx.materials > 0, 'the shared skin shader runs in its full mode on High');

  // ---- Hydro Dip: the colours flow, the gun does not move.
  await skin('hydro-nebula-rifle');
  const flowA = await shot('flow-a'); await delay(2500); await place(); await delay(120); const flowB = await shot('flow-b');
  await skin('carbon-fiber-rifle');
  const stillA = await shot('still-a'); await delay(2500); await place(); await delay(120); const stillB = await shot('still-b');
  const moving = await diff(flowA, flowB), still = await diff(stillA, stillB);
  report.flow = { moving, still };
  // The idle sway moves any gun a little; the flowing colours must add clearly to that. Frame-exact continuity and
  // silhouette checks run in the lab with a controlled clock (tools/skin-fx-test.mjs).
  check(moving[0] > still[0] * 1.4, `Hydro Dip animates in the match (${moving[0].toFixed(2)} vs ${still[0].toFixed(2)} for a static skin over 2.5 s)`);

  // ---- Frosted: snowflakes when firing from the hip, a bounded count, gone afterwards, none while aiming.
  await skin('frosted-rifle');
  await page.evaluate(() => window.__crossfire.hold('fire', true)); await delay(450);
  const firing = await page.evaluate(() => window.__crossfire.skinFx().snow); await shot('frosted-firing');
  report.ammoWhileFiring = await page.evaluate(() => window.__crossfire.weapon().ammo);
  await page.evaluate(() => window.__crossfire.hold('fire', false)); await delay(1400);
  const after = await page.evaluate(() => window.__crossfire.skinFx().snow);
  report.snow = { firing, after };
  check(firing.active > 0 && firing.active <= firing.capacity && firing.capacity <= 72, `Frosted emits a bounded flurry (${firing.active}/${firing.capacity} flakes)`);
  check(after.active === 0, 'the flakes are gone 1.4 s after the last shot');
  await page.evaluate(() => window.__crossfire.hold('reload', true)); await delay(100); await page.evaluate(() => window.__crossfire.hold('reload', false)); await delay(3200);
  await page.evaluate(() => window.__crossfire.hold('aim', true)); await delay(700);
  await page.evaluate(() => window.__crossfire.hold('fire', true)); await delay(350);
  const aimed = await page.evaluate(() => window.__crossfire.skinFx().snow); await shot('frosted-aimed');
  await page.evaluate(() => { window.__crossfire.hold('fire', false); window.__crossfire.hold('aim', false); }); await delay(900);
  report.snow.aimed = aimed;
  check(aimed.active === 0, 'no flakes in the shooter\'s own sight picture while aiming');

  // ---- Darkness on the dual daggers (real first-person melee view).
  await skin('darkness-melee'); await skin('darkness-rifle');
  await page.evaluate(() => window.__crossfire.melee('equip')); await delay(900); await place(); await delay(200);
  const melee = await page.evaluate(() => window.__crossfire.meleeInspect());
  await shot('darkness-daggers');
  check(melee.cosmeticId === 'darkness-melee' && melee.daggersVisible.every(Boolean), 'Darkness is applied to both daggers in the first-person melee view');
  await page.evaluate(() => window.__crossfire.melee('attack')); await delay(140); await shot('darkness-daggers-attack');
  await delay(900); await page.evaluate(() => window.__crossfire.melee('unequip')); await delay(900);

  // ---- Chromebook mode: lite shader, fewer opaque flakes, everything still renders.
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true })); await delay(2500);
  const lite = await page.evaluate(() => window.__crossfire.skinFx());
  check(lite.lite === true, 'Chromebook mode switches the shared skin shader to its lite path live');
  for (const id of ['hydro-abyss-rifle', 'darkness-rifle', 'frosted-rifle']) { await skin(id); await shot('chromebook-' + id); }
  await page.evaluate(() => window.__crossfire.hold('fire', true)); await delay(450);
  const liteSnow = await page.evaluate(() => window.__crossfire.skinFx().snow); await shot('chromebook-frosted-firing');
  await page.evaluate(() => window.__crossfire.hold('fire', false));
  report.snow.chromebook = liteSnow;
  check(liteSnow.active > 0 && liteSnow.capacity === 20 && liteSnow.blended === false, `Chromebook mode: at most 20 opaque flakes (${liteSnow.active} live)`);
  const stats = await page.evaluate(() => window.__crossfire.stats());
  report.chromebookStats = { fps: stats.fps, drawCalls: stats.drawCalls, missingMaterials: stats.missingMaterials };
  check(!(stats.missingMaterials ?? []).length, 'no missing (magenta) materials');
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: false })); await delay(1500);
  check((await page.evaluate(() => window.__crossfire.skinFx())).lite === false, 'leaving Chromebook mode restores the full shader');
  assert.deepEqual(errors, [], 'no page, shader or asset errors');
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ checks, report, errors }, null, 2));
  console.log('COMPLETE', checks.length, 'checks');
} catch (error) {
  fs.writeFileSync(`${out}/failure.json`, JSON.stringify({ error: String(error), errors, checks, report }, null, 2));
  console.error(error, errors);
  process.exitCode = 1;
} finally { await browser.close(); }
