/** Repeatable multi-angle inspection of every weapon in the real Locker preview (src/ui/CosmeticPreview.ts) in real Chrome.
 *
 *   node tools/review-weapon-angles.mjs [http://127.0.0.1:5181/] [--ids default-rifle,frosted-smg] [--diagnose] [--low] [--name sheet]
 *
 * For each cosmetic it renders the ten required angles (front, back, left, right, top, bottom and the four three-quarter views) plus
 * intermediate angles of a continuous rotation, writes one contact sheet per cosmetic to test-results/weapon-angles/ and a report.json.
 * `--diagnose` renders every angle twice, with back-face culling on and off, and reports the pixels that differ: on a correct closed
 * model a back face is always hidden behind its own front face, so a difference means a missing or flipped face (shown in red in the
 * sheet). Needs the Vite dev server (the lab page is tools/preview-lab.html). Exit code 1 on page errors or, with --diagnose, when a
 * weapon shows more than `--budget` differing pixels at any angle. */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const diagnose = process.argv.includes('--diagnose'), budget = Number(arg('budget', 60));
const WEAPONS = ['rifle', 'smg', 'sniper', 'shotgun', 'semi-sniper', 'melee'];
const ids = (arg('ids', '') || WEAPONS.map((w) => `default-${w}`).join(',')).split(',');
// azimuth 0 = from the weapon's right side (+x); the camera sits at +z (behind the stock) at 90, at -x at 180 and at -z (in front of the muzzle) at 270.
const ANGLES = [['right', 0, 0], ['back', 90, 0], ['left', 180, 0], ['front', 270, 0], ['top', 0, 88], ['bottom', 0, -88],
  ['rear-right', 45, 15], ['rear-left', 135, 15], ['front-left', 225, 15], ['front-right', 315, 15]];
const SWEEP = [20, 65, 110, 155, 200, 245, 290, 335].map((a) => [`sweep-${a}`, a, 25]);
const out = 'test-results/weapon-angles';
fs.mkdirSync(out, { recursive: true });
const errors = [], report = [], perAngle = {};
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(new URL('tools/preview-lab.html', base).href, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => window.__previewLab, { timeout: 240000 });
  for (const id of ids) {
    await page.evaluate((id) => window.__previewLab.open(id), id);
    const tiles = [], worst = { angle: '', changed: 0 };
    for (const [label, az, el] of [...ANGLES, ...(process.argv.includes('--sweep') ? SWEEP : [])]) {
      const r = await page.evaluate(({ az, el, diagnose }) => window.__previewLab.shot(az, el, diagnose), { az, el, diagnose });
      if (process.argv.includes('--full')) fs.writeFileSync(`${out}/${arg('name', 'sheet')}-${id}-${label}.png`, Buffer.from(r.image.split(',')[1], 'base64'));
      tiles.push({ label: `${id} ${label}${diagnose ? ' ' + r.changed + ' px' : ''}`, image: diagnose ? r.diff : r.image, plain: r.image });
      if (diagnose && r.changed > worst.changed) { worst.changed = r.changed; worst.angle = label; worst.meshes = r.meshes; worst.tris = r.tris; }
      if (diagnose) (perAngle[id] ??= []).push({ angle: label, changed: r.changed, meshes: r.meshes, tris: r.tris });
    }
    const nodes = await page.evaluate(() => window.__previewLab.nodes());
    report.push({ id, worst, nodes: nodes.length, hiddenNodes: nodes.filter((n) => !n.enabled).map((n) => n.name) });
    if (diagnose && worst.changed > budget) { failed = true; console.log('FAIL', id, worst.angle, worst.changed, 'px differ with culling off', JSON.stringify(worst.meshes), JSON.stringify((worst.tris ?? []).slice(0, 6))); } else console.log('PASS', id, diagnose ? `worst ${worst.angle} ${worst.changed} px` : '');
    const cols = 5;
    const sheet = await page.evaluate(async ({ tiles, cols, diagnose }) => {
      const w = 384, h = 216, rows = Math.ceil(tiles.length / cols), c = document.createElement('canvas');
      c.width = w * cols; c.height = h * rows * (diagnose ? 2 : 1); const g = c.getContext('2d');
      for (const [i, t] of tiles.entries()) {
        for (const [layer, src] of (diagnose ? [[0, t.plain], [1, t.image]] : [[0, t.image]])) {
          const img = new Image(); img.src = src; await img.decode();
          const x = (i % cols) * w, y = (Math.floor(i / cols) * (diagnose ? 2 : 1) + layer) * h; g.drawImage(img, x, y, w, h);
          if (!layer) { g.font = '14px system-ui'; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y, g.measureText(t.label).width + 12, 22); g.fillStyle = '#fff'; g.fillText(t.label, x + 6, y + 16); }
        }
      }
      return c.toDataURL('image/jpeg', .9);
    }, { tiles, cols, diagnose });
    fs.writeFileSync(`${out}/${arg('name', 'sheet')}-${id}.jpg`, Buffer.from(sheet.split(',')[1], 'base64'));
    await page.evaluate(() => window.__previewLab.close());
  }
  if (errors.length) { failed = true; console.log('ERRORS', errors.slice(0, 5)); }
  fs.writeFileSync(`${out}/${arg('name', 'sheet')}-report.json`, JSON.stringify({ report, perAngle, errors }, null, 2));
} catch (error) {
  failed = true;
  console.error(error, errors);
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
