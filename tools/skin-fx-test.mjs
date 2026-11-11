/** Measured checks of the shared skin shader in the isolated review lab (real Locker loader, controlled clock).
 *
 *   node tools/skin-fx-test.mjs [http://127.0.0.1:4210/]      (Vite dev server)
 *
 * Hydro Dip: the pattern moves, moves by the same small amount across every offset wrap-around (no loop jump), and the
 * weapon's silhouette is identical in every frame (colour only, no geometry). Checked for the full and the lite shader.
 * Frosted: snow and ice both present, icicle mesh attached. Darkness: nearly black, every mesh still drawn, readable on
 * a dark and on a bright backdrop, daggers included. Writes test-results/skins/fx-report.json. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4210/';
const out = 'test-results/skins';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], report = {};
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(new URL('tools/cosmetic-asset-lab.html?game', base).href, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__cosmeticLab, { timeout: 240000 });
  // The page keeps decoded frames; only numbers cross the wire.
  await page.evaluate(() => {
    const lab = window.__cosmeticLab, frames = new Map();
    window.__fx = {
      async frame(key, id, { low = false, time = null, background = null, context = 'locker' } = {}) {
        lab.review.time = time; lab.review.background = background;
        const r = await lab.capture(id, context, low); lab.review.time = null; lab.review.background = null;
        const img = new Image(); img.src = r.image; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        frames.set(key, g.getImageData(0, 0, c.width, c.height).data);
        return { inspect: r.inspect, drawCalls: r.drawCalls, cpu: r.renderCpuMedianMs };
      },
      /** Pixels that differ from the backdrop (first pixel) are the weapon. */
      mask(key) { const d = frames.get(key), m = new Uint8Array(d.length / 4); for (let i = 0; i < m.length; i++) m[i] = Math.abs(d[i * 4] - d[0]) + Math.abs(d[i * 4 + 1] - d[1]) + Math.abs(d[i * 4 + 2] - d[2]) > 12 ? 1 : 0; return m; },
      /** Mean absolute channel difference over the weapon, and how many pixels enter or leave the silhouette. */
      compare(a, b) { const x = frames.get(a), y = frames.get(b), ma = this.mask(a), mb = this.mask(b); let sum = 0, n = 0, flips = 0;
        for (let i = 0; i < ma.length; i++) { if (ma[i] !== mb[i]) flips++; if (!ma[i]) continue; n++; sum += Math.abs(x[i * 4] - y[i * 4]) + Math.abs(x[i * 4 + 1] - y[i * 4 + 1]) + Math.abs(x[i * 4 + 2] - y[i * 4 + 2]); }
        return { diff: sum / n / 3, flips, pixels: n }; },
      /** Statistics of frame `key` over the silhouette taken from frame `maskKey` (same camera). */
      stats(key, maskKey = key) { const d = frames.get(key), m = this.mask(maskKey); let n = 0, lum = 0, white = 0, blue = 0, contrast = 0;
        for (let i = 0; i < m.length; i++) { if (!m[i]) continue; n++; const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; lum += (.2126 * r + .7152 * g + .0722 * b) / 255;
          if (r > 200 && g > 205 && b > 215) white++; if (b > 150 && b > r * 1.6 && b > g * 1.1) blue++;
          contrast += (Math.abs(r - d[0]) + Math.abs(g - d[1]) + Math.abs(b - d[2])) / 3; }
        return { pixels: n, luminance: lum / n, white: white / n, blue: blue / n, contrast: contrast / n }; },
    };
  });
  const frame = (key, id, options) => page.evaluate(({ key, id, options }) => window.__fx.frame(key, id, options), { key, id, options });
  const compare = (a, b) => page.evaluate(({ a, b }) => window.__fx.compare(a, b), { a, b });
  const stats = (key, maskKey) => page.evaluate(({ key, maskKey }) => window.__fx.stats(key, maskKey), { key, maskKey });

  // ---- Hydro Dip: continuity across every wrap of the shader's offsets (periods are 1 / rate seconds).
  const RATES = [.013, .008, .009, .011, .006, .0045, .012], STEP = .05;
  report.flow = {};
  for (const [id, low] of [['hydro-nebula-rifle', false], ['hydro-inferno-smg', false], ['hydro-abyss-shotgun', false], ['hydro-nebula-rifle', true]]) {
    const tag = id + (low ? ' (lite)' : '');
    // A mid-grey backdrop: no ramp colour comes near it, so the silhouette mask is exact.
    const G = [.5, .5, .5], at = (time) => ({ low, time, background: G });
    await frame('a', id, at(10)); await frame('n', id, at(10)); await frame('b', id, at(10 + STEP)); await frame('c', id, at(16));
    const noise = await compare('a', 'n'), small = await compare('a', 'b'), far = await compare('a', 'c');
    const wraps = [];
    for (const rate of RATES) { const t = 1 / rate; await frame('w0', id, at(t - STEP / 2)); await frame('w1', id, at(t + STEP / 2)); wraps.push({ rate, ...(await compare('w0', 'w1')) }); }
    report.flow[tag] = { noise, small, far, wraps };
    check(noise.diff === 0, `${tag}: a frozen clock renders identical frames (no flicker)`);
    check(small.diff > 0 && far.diff > small.diff * 6, `${tag}: the colours flow (${small.diff.toFixed(3)} per 50 ms, ${far.diff.toFixed(2)} after 6 s)`);
    check(far.diff < 45, `${tag}: subtle motion, no flashing (mean change ${far.diff.toFixed(1)} of 255 after 6 s)`);
    const worst = Math.max(...wraps.map((w) => w.diff));
    check(worst < small.diff * 3 + .15, `${tag}: no jump at any wrap-around (worst ${worst.toFixed(3)} vs ${small.diff.toFixed(3)} for an ordinary 50 ms step)`);
    // Anti-aliased outline pixels change colour with the pattern; a handful may cross the mask threshold.
    const flips = Math.max(far.flips, ...wraps.map((w) => w.flips));
    check(flips <= far.pixels * .0005, `${tag}: silhouette unchanged in every frame (${far.pixels} weapon pixels, at most ${flips} outline pixels differ)`);
  }

  // ---- Frosted: ice and snow on every firearm, icicles attached; Chromebook path keeps the look.
  report.frosted = {};
  for (const weapon of ['rifle', 'smg', 'sniper', 'shotgun', 'semi-sniper']) for (const low of [false, true]) {
    const plain = await frame('d', `default-${weapon}`, { low }), frost = await frame('f', `frosted-${weapon}`, { low, background: [.9, .1, .9] }), s = await stats('f');
    report.frosted[`${weapon}${low ? ' (lite)' : ''}`] = { ...s, meshes: frost.inspect.meshes, defaultMeshes: plain.inspect.meshes, drawCalls: frost.drawCalls };
    check(s.white > .12 && s.blue > .12, `frosted-${weapon}${low ? ' (lite)' : ''}: snow ${(s.white * 100).toFixed(0)}% and ice ${(s.blue * 100).toFixed(0)}% of the gun`);
    check(frost.inspect.meshes === plain.inspect.meshes + 1, `frosted-${weapon}${low ? ' (lite)' : ''}: one icicle mesh on top of the default gun's ${plain.inspect.meshes}`);
  }

  // ---- Darkness: nearly black, complete, and readable on dark and bright backdrops.
  report.darkness = {};
  for (const weapon of ['rifle', 'smg', 'sniper', 'shotgun', 'semi-sniper', 'melee']) {
    const plain = await frame('d', `default-${weapon}`), bright = await frame('b', `darkness-${weapon}`, { background: [.85, .85, .8] }), s = await stats('b');
    const dark = await frame('k', `darkness-${weapon}`), onDark = await stats('k', 'b'), shape = await compare('b', 'd');
    report.darkness[weapon] = { bright: s, dark: onDark, meshes: bright.inspect.meshes };
    check(bright.inspect.meshes === plain.inspect.meshes && dark.inspect.meshes === plain.inspect.meshes, `darkness-${weapon}: all ${plain.inspect.meshes} meshes drawn`);
    check(s.luminance < .1, `darkness-${weapon}: nearly black (mean luminance ${(s.luminance * 100).toFixed(1)}%)`);
    check(onDark.contrast > 3, `darkness-${weapon}: still readable on the dark backdrop (mean contrast ${onDark.contrast.toFixed(1)} of 255)`);
    void shape;
  }
  report.shader = await page.evaluate(() => window.__cosmeticLab.skinFx());
  assert.deepEqual(errors, [], 'no shader, asset or page errors');
  fs.writeFileSync(`${out}/fx-report.json`, JSON.stringify({ checks, report, errors }, null, 2));
  console.log('COMPLETE', checks.length, 'checks');
} catch (error) {
  fs.writeFileSync(`${out}/fx-failure.json`, JSON.stringify({ error: String(error), errors, checks, report }, null, 2));
  console.error(error, errors);
  process.exitCode = 1;
} finally { await browser.close(); }
