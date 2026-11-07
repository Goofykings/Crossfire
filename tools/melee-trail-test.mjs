/** Dagger blade trails in real Chrome (offline Practice): first-person trails for all three attacks, stepped
 * at 120 and 30 FPS so a frame never covers more than the strip's own smoothing can bridge, the
 * newest sample sitting on the real blade, and a bot's simplified third-person trail.
 *   node tools/melee-trail-test.mjs [http://127.0.0.1:5181/]
 * Writes PNGs and contact sheets to test-results/melee-trail/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/melee-trail';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });

async function sheet(name, items, columns, cell = [480, 270]) {
  const page = await browser.newPage();
  const images = items.map((i) => ({ label: i.label, src: 'data:image/png;base64,' + fs.readFileSync(i.file).toString('base64') }));
  const rows = Math.ceil(images.length / columns);
  await page.setViewport({ width: columns * cell[0], height: rows * (cell[1] + 22) });
  await page.setContent(`<body style="margin:0;background:#111;font:13px sans-serif;color:#eee;display:grid;grid-template-columns:repeat(${columns},${cell[0]}px)">${
    images.map((i) => `<figure style="margin:0"><img src="${i.src}" style="width:${cell[0]}px;height:${cell[1]}px;object-fit:cover;display:block"><figcaption style="height:22px;line-height:22px;padding:0 6px">${i.label}</figcaption></figure>`).join('')}</body>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

const visible = (page, selector) => page.waitForSelector(selector + '.visible', { timeout: 240000 });
const clickText = (page, root, label) => page.evaluate(({ root, label }) => {
  const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
  if (!b) throw Error('Missing ' + label); b.click();
}, { root, label });
async function startPractice(page, bots, weapon) {
  await page.click('#menu .home-actions .primary'); await visible(page, '#modes'); await clickText(page, '#modes', 'Practice'); await visible(page, '#practice-setup');
  await page.$eval('#practice-setup input[type=range]', (n, b) => { n.value = String(b); n.dispatchEvent(new Event('input', { bubbles: true })); }, bots);
  await clickText(page, '#practice-setup', 'START PRACTICE'); await visible(page, '#weapons');
  await page.click(`#weapons [data-weapon="${weapon}"]`);
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 180000 });
}

let page;
try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '?quality=high&nohud', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Trail Test');
  await page.waitForFunction(() => window.__crossfire.homeCharacter().ready, { timeout: 120000 });
  await startPractice(page, 0, 'rifle');
  await page.waitForFunction(() => window.__crossfire.meleeInspect()?.ready, { timeout: 60000 });
  await delay(2500);
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  const place = () => page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -4), spot);
  const melee = (...args) => page.evaluate((a) => window.__crossfire.melee(...a), args);
  const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const inspect = () => page.evaluate(() => window.__crossfire.meleeInspect());
  await melee('pause'); await melee('equip'); for (let i = 0; i < 40; i++) await melee('step', 1 / 30);
  check((await inspect()).trail?.live === 0, 'no trail while the daggers are idle');

  const sheets = [];
  const run = async (fps, plan) => {
    const dt = 1 / fps, shots = [];
    for (const [clip, stage, marks] of plan) {
      await melee('reset'); await melee('equip'); for (let i = 0; i < 40; i++) await melee('step', 1 / 30);
      await melee('attack', stage);
      let t = 0, next = 0, peak = 0, worstOffset = 0;
      while (t < marks.at(-1) + 1e-6) {
        await melee('step', dt); t += dt;
        const s = await inspect();
        peak = Math.max(peak, s.trail.live); worstOffset = Math.max(worstOffset, ...s.trail.offsets);
        if (next < marks.length && t >= marks[next] - 1e-6) {
          await place(); await frames(3);
          const file = `${out}/fp-${fps}-${clip}-${Math.round(marks[next] * 1000)}.png`; await page.screenshot({ path: file });
          shots.push({ label: `${clip} ${Math.round(marks[next] * 1000)} ms @${fps}`, file }); next++;
        }
      }
      check(peak >= 6, `${clip} @${fps} FPS leaves a trail (${peak} samples)`);
      // The stepped head correction keeps the socket-based samples on the real blade.
      check(worstOffset < .02, `${clip} @${fps} FPS: sampled tip within 2 cm of the real blade (${worstOffset.toFixed(4)} m)`);
    }
    return shots;
  };
  const plan = [['attack_cross', 1, [.05, .08, .11, .16]], ['attack_forward', 2, [.08, .11, .16]], ['attack_finisher', 3, [.1, .23, .25, .3, .36]]];
  sheets.push(...await run(120, plan));
  const slow = await run(30, [['attack_cross', 1, [.1, .16]], ['attack_finisher', 3, [.25, .33]]]);
  sheets.push(...slow);
  await sheet('sheet-first-person', sheets, 3);

  // The trail fades out and the meshes switch off.
  await melee('reset'); await melee('equip'); for (let i = 0; i < 40; i++) await melee('step', 1 / 30);
  await melee('attack', 3); for (let i = 0; i < 90; i++) await melee('step', 1 / 120);
  for (let i = 0; i < 60; i++) await melee('step', 1 / 60);
  const done = await inspect();
  check(done.trail.drawCalls === 0 && done.trail.vertices === 0, `the trail has faded and drawn nothing after the attack (${JSON.stringify(done.trail)})`);

  // Chromebook mode: one layer.
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
  await melee('reset'); await melee('equip'); for (let i = 0; i < 40; i++) await melee('step', 1 / 30);
  await melee('attack', 3); for (let i = 0; i < 40; i++) await melee('step', 1 / 120);
  const reduced = await inspect();
  check(reduced.trail.reduced && reduced.trail.layers === 1, 'Chromebook mode draws a one-layer trail');
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: false }));
  await melee('resume'); await melee('reset');

  // Third person: a bot swinging in front of the free camera.
  await page.evaluate(() => window.__crossfire.networkLeave()); await visible(page, '#menu');
  await startPractice(page, 2, 'smg');
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb'), { timeout: 120000 });
  await page.evaluate(() => window.__crossfire.meleeRemote('equip'));
  await delay(1500);
  const botId = await page.evaluate(() => window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death).id);
  for (const offset of [90, -90, 60, -60, 120, -120, 30, -30]) {
    await page.evaluate(({ offset, id }) => {
      const bot = window.__crossfire.network().rendered.find((p) => p.id === id);
      const heading = -bot.yaw * 180 / Math.PI + offset, r = heading * Math.PI / 180;
      window.__crossfire.freeCam(bot.x + Math.sin(r) * 2.8, bot.y + 1.3, bot.z - Math.cos(r) * 2.8, heading + 180, -8);
    }, { offset, id: botId });
    await delay(120);
    if (await page.evaluate((id) => window.__crossfire.network().rendered.find((p) => p.id === id)?.visible, botId)) break;
  }
  const tp = [];
  for (const [clip, wait] of [['attack_cross', 70], ['attack_finisher', 200]]) {
    await page.evaluate(({ id, clip }) => window.__crossfire.meleeRemoteSync(id, clip, 0), { id: botId, clip });
    await delay(wait);
    const file = `${out}/tp-${clip}.png`; await page.screenshot({ path: file }); tp.push({ label: `bot ${clip}`, file });
    const state = await page.evaluate((id) => window.__crossfire.meleeRemoteInspect(id), botId);
    const trail = Object.values(state)[0]?.trail;
    check(trail && trail.live >= 2, `a bot's ${clip} leaves a third-person trail (${JSON.stringify(trail)})`);
    await delay(500);
  }
  await sheet('sheet-third-person', tp, 2, [640, 360]);
  check(errors.length === 0, `no console or page errors (${errors.slice(0, 3).join(' | ')})`);
  console.log(`${checks.length} checks passed`);
} finally { await browser.close(); }
