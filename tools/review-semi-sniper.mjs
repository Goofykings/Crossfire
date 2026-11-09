/** Real game rigs (WeaponView, CharacterWeapon, Locker loader) for the semi-auto sniper model, in the isolated
 * development lab with ?semi: the model is staged in memory on the AR presets; nothing is registered or granted.
 * node tools/review-semi-sniper.mjs [url]   (Vite dev server; default http://127.0.0.1:4210/) */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4210/';
const out = 'test-results/semi-sniper/browser';
fs.mkdirSync(out, { recursive: true });
const results = [], errors = [];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(new URL('tools/cosmetic-asset-lab.html?semi', base).href, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__cosmeticLab, { timeout: 240000 });
  const id = (await page.evaluate(() => window.__cosmeticLab.items))[0];
  const contexts = ['locker', 'side', 'front', 'fp', 'ads', 'reload', 'recoil', 'walk', 'third', 'third-side', 'third-ads'];
  for (const context of contexts) {
    const { image, ...data } = await page.evaluate(({ id, context }) => window.__cosmeticLab.capture(id, context), { id, context });
    assert.equal(data.engineCount, 1);
    if (context.startsWith('third')) for (const hand of data.inspect.hands) assert.ok(hand.gap < .01, `${context} hand contact ${JSON.stringify(hand)}`);
    fs.writeFileSync(`${out}/semi-${context}.png`, Buffer.from(image.split(',')[1], 'base64'));
    results.push({ context, ...data });
    console.log('PASS', context, 'draws', data.drawCalls, 'cpu ms', data.renderCpuMedianMs.toFixed(2));
  }
  const low = await page.evaluate((id) => window.__cosmeticLab.capture(id, 'locker', true), id);
  fs.writeFileSync(`${out}/semi-low.png`, Buffer.from(low.image.split(',')[1], 'base64'));
  for (const context of ['fp', 'ads', 'third-side']) {
    const d = await page.evaluate((context) => window.__cosmeticLab.capture('default-rifle', context), context);
    fs.writeFileSync(`${out}/default-rifle-${context}.png`, Buffer.from(d.image.split(',')[1], 'base64'));
    results.push({ id: 'default-rifle', context, drawCalls: d.drawCalls, renderCpuMedianMs: d.renderCpuMedianMs });
  }
  assert.deepEqual(errors, [], 'no missing assets, shaders or page errors');
  fs.writeFileSync(out + '/report.json', JSON.stringify({ results, errors }, null, 2));
  console.log('COMPLETE', results.length);
} catch (error) {
  fs.writeFileSync(out + '/failure.json', JSON.stringify({ error: String(error), errors, results }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
