/** Weapon skin review in the isolated development lab (tools/cosmetic-asset-lab.html): the real Locker loader,
 * WeaponView and CharacterWeapon rigs. Never contacts inventory APIs and grants nothing.
 *
 *   node tools/review-skins.mjs [url] [--ids a,b] [--contexts locker,fp] [--low] [--name sheet] [--cols 3]
 *
 * Needs the Vite dev server (default http://127.0.0.1:4210/). `--low` renders the Chromebook path (no environment
 * reflections, lite skin shaders). Writes one PNG per capture plus a labelled contact sheet to test-results/skins/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4210/';
const low = process.argv.includes('--low'), cols = Number(arg('cols', 3)), name = arg('name', low ? 'sheet-low' : 'sheet');
const GUNS = ['rifle', 'smg', 'sniper', 'shotgun', 'semi-sniper'];
const NEW = ['carbon-fiber', 'hydro-nebula', 'hydro-inferno', 'hydro-abyss', 'blossom', 'frosted', 'darkness'];
const ids = (arg('ids', '') || [...NEW.flatMap((c) => GUNS.map((w) => `${c}-${w}`)), 'darkness-melee'].join(',')).split(',');
const contexts = arg('contexts', 'locker').split(',');
const out = 'test-results/skins';
fs.mkdirSync(out, { recursive: true });
const results = [], errors = [], tiles = [];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(new URL('tools/cosmetic-asset-lab.html?game', base).href, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__cosmeticLab, { timeout: 240000 });
  for (const id of ids) for (const context of contexts) {
    const { image, ...data } = await page.evaluate(({ id, context, low }) => window.__cosmeticLab.capture(id, context, low), { id, context, low });
    assert.equal(data.engineCount, 1);
    fs.writeFileSync(`${out}/${id}-${context}${low ? '-low' : ''}.png`, Buffer.from(image.split(',')[1], 'base64'));
    results.push({ id, context, low, ...data });
    tiles.push({ label: `${id} · ${context}${low ? ' · low' : ''}`, image });
    console.log('PASS', id, context, 'draws', data.drawCalls, 'cpu ms', data.renderCpuMedianMs.toFixed(2));
  }
  // Contact sheet, composed in the page (no image library needed).
  const sheet = await page.evaluate(async ({ tiles, cols }) => {
    const w = 480, h = 270, rows = Math.ceil(tiles.length / cols), c = document.createElement('canvas');
    c.width = w * cols; c.height = h * rows; const g = c.getContext('2d');
    for (const [i, t] of tiles.entries()) {
      const img = new Image(); img.src = t.image; await img.decode();
      const x = (i % cols) * w, y = Math.floor(i / cols) * h; g.drawImage(img, x, y, w, h);
      g.font = '14px system-ui'; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y, g.measureText(t.label).width + 12, 22); g.fillStyle = '#fff'; g.fillText(t.label, x + 6, y + 16);
    }
    return c.toDataURL('image/jpeg', .9);
  }, { tiles, cols });
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(sheet.split(',')[1], 'base64'));
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, [], 'no missing assets, shader or page errors');
  console.log('COMPLETE', results.length, `${out}/${name}.jpg`);
} catch (error) {
  fs.writeFileSync(`${out}/${name}-failure.json`, JSON.stringify({ error: String(error), errors, results }, null, 2));
  console.error(error, errors);
  process.exitCode = 1;
} finally { await browser.close(); }
