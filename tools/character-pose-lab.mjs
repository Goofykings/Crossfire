/** Render contact sheets of the shared third-person weapon rig (home preview scene, no map).
 * node tools/character-pose-lab.mjs [url] [--weapons rifle,smg] [--poses ready,ads] [--out dir]
 * Each sheet: one row per pose, one column per view (front, side, three-quarter, back three-quarter). */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4199/';
const weapons = flag('weapons', 'rifle,shotgun,sniper,smg').split(',');
const out = path.resolve(flag('out', 'test-results/character-poses'));
const still = { velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 };
const POSES = {
  ready: { ads: 0, motion: still, advance: .8 },
  ads: { ads: 1, motion: still, advance: .8 },
  crouch: { ads: 0, motion: { ...still, crouch: 1 }, advance: .8 },
  crouchAds: { ads: 1, motion: { ...still, crouch: 1 }, advance: .8 },
  fire: { ads: 0, motion: still, advance: .82, fire: 1, settle: .045 },
  adsFire: { ads: 1, motion: still, advance: .82, fire: 1, settle: .045 },
  lookUp: { ads: 1, pitch: .6, motion: still, advance: .8 },
  lookDown: { ads: 0, pitch: -.7, motion: still, advance: .8 },
  run: { ads: 0, motion: { ...still, velocity: { x: 0, y: 0, z: -4.7 } }, advance: .55 },
  slide: { ads: 0, motion: { ...still, velocity: { x: 0, y: 0, z: -6 }, slideRemaining: .6, crouch: .6 }, advance: .4 },
  jump: { ads: 0, motion: { ...still, grounded: false, velocity: { x: 0, y: 1, z: 0 } }, advance: .5 },
  walk: { ads: 0, motion: { ...still, velocity: { x: 0, y: 0, z: -2.2 } }, advance: .7 },
  walkAds: { ads: 1, motion: { ...still, velocity: { x: 0, y: 0, z: -2.2 } }, advance: .7 },
  act1: { ads: 0, motion: still, advance: .8, act: 0 },
  act2: { ads: 0, motion: still, advance: .8, act: 1 },
  act3: { ads: 0, motion: still, advance: .8, act: 2 },
  crouchAct: { ads: 0, motion: { ...still, crouch: 1 }, advance: .8, act: 1 },
};
// Gameplay actions held at a progress fraction: what other players see during reloads,
// pump strokes and bolt cycles (the action keys follow the weapon's own cue timing).
const ACTIONS = {
  rifle: [['reload', .27], ['reload', .45], ['reload', .6]], smg: [['reload', .27], ['reload', .45], ['reload', .6]],
  sniper: [['cycle', .28], ['cycle', .5], ['reload', .3]], shotgun: [['cycle', .4], ['shell', .3], ['shell', .7]],
};
const poses = flag('poses', 'ready,ads,crouch,crouchAds,fire').split(',');
const viewNames = flag('views', 'front,side,quarter,rear').split(',');
const views = flag('views', 'front,side,quarter,rear').split(',').map((v) => ({
  front: { heading: 0, pitch: 4, distance: 2.6, height: 1.2 }, side: { heading: 90, pitch: 2, distance: 2.6, height: 1.2 },
  quarter: { heading: 40, pitch: 6, distance: 2.6, height: 1.2 }, rear: { heading: 145, pitch: 8, distance: 2.6, height: 1.2 },
  left: { heading: -90, pitch: 2, distance: 2.6, height: 1.2 }, top: { heading: 20, pitch: 60, distance: 2.4, height: 1.1 },
  closeR: { heading: 70, pitch: 10, distance: 1.5, height: 1.3 }, closeL: { heading: -60, pitch: 15, distance: 1.5, height: 1.3 },
  handR: { heading: 80, pitch: 10, distance: .5, height: 0, focus: 'grip_r' },
  handRB: { heading: 150, pitch: 30, distance: .5, height: 0, focus: 'grip_r' },
  handL: { heading: -60, pitch: 15, distance: .5, height: 0, focus: 'grip_l' },
  handLU: { heading: 0, pitch: -40, distance: .5, height: 0, focus: 'grip_l' },
  closeF: { heading: 15, pitch: 5, distance: 1.5, height: 1.3 }, closeB: { heading: 150, pitch: 25, distance: 1.5, height: 1.3 },
})[v]);
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 300000,
  defaultViewport: { width: 1200, height: 900 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const report = {};
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => localStorage.setItem('crossfire.guest.v1',
    JSON.stringify({ guestId: '76a876f1-7a6e-499f-8d03-568b68c889e3', username: 'Pose Lab' })));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__crossfire?.homeCharacter().weapon, { timeout: 120000 });
  // Warm up shaders for every weapon before the first capture.
  for (const weapon of weapons) await page.evaluate((w) => window.__crossfire.characterLab({ weapon: w, advance: 1 }), weapon);
  for (const weapon of weapons) {
    const tiles = [];
    report[weapon] = {};
    for (const pose of poses) {
      const spec = POSES[pose];
      for (const [column, view] of views.entries()) {
        // Low stances are framed lower so the weapon stays in view.
        const drop = spec.motion.crouch > .5 ? (view.distance < 2 ? .35 : .3) : 0;
        const camera = { ...view, height: view.height - drop, ...(view.target ? { target: [view.target[0], view.target[1] - drop, view.target[2]] } : {}) };
        // Settle: hold the base pose, then fire and capture shortly after the impulse.
        const [action, progress] = spec.act === undefined ? ['idle', 0] : ACTIONS[weapon][spec.act];
        const result = await page.evaluate(async (o) => {
          const lab = window.__crossfire.characterLab;
          o.spec = { ...o.spec, motion: o.spec.motion };
          if (o.spec.fire) {
            await lab({ weapon: o.weapon, ads: o.spec.ads, pitch: o.spec.pitch, motion: o.spec.motion, camera: o.camera, advance: o.spec.advance });
            return lab({ weapon: o.weapon, ads: o.spec.ads, pitch: o.spec.pitch, motion: o.spec.motion, camera: o.camera, advance: o.spec.settle, fire: 1 });
          }
          return lab({ weapon: o.weapon, ads: o.spec.ads, pitch: o.spec.pitch, motion: o.spec.motion, camera: o.camera, advance: o.spec.advance,
            action: o.action, progress: o.progress });
        }, { weapon, spec, camera, action, progress });
        tiles.push({ image: result.image, label: `${weapon} ${pose}${action !== 'idle' ? ` (${action} ${progress})` : ''} ${viewNames[column]}` });
        if (column === 0 && pose === poses[0] && weapon === weapons[0]) console.log('rest axes', JSON.stringify(result.state.weapon.hands.map((h) => h.rest)));
        if (column === 0) report[weapon][`${pose}:geometry`] = { butt: result.state.weapon.butt, shoulder: result.state.weapon.shoulder,
          eye: result.state.weapon.eye, sight: result.state.weapon.sight, weld: result.state.weapon.weld, triggerGap: result.state.weapon.triggerGap,
          clavicles: result.state.weapon.clavicles, gaps: result.state.weapon.hands.map((h) => +h.gap.toFixed(4)) };
        if (column === 0) report[weapon][pose] = result.state.weapon.hands.map((h) => ({ reach: +h.reach.toFixed(3),
          wristDeg: +(h.wristBend * 57.3).toFixed(0), elbowDeg: +(h.elbowBend * 57.3).toFixed(0),
          forearm: h.forearmInWeapon.map((v) => +v.toFixed(2)) }));
      }
    }
    const sheet = await page.evaluate(async (tiles, columns) => {
      const w = 240, h = 320, canvas = document.createElement('canvas');
      canvas.width = w * columns; canvas.height = h * Math.ceil(tiles.length / columns);
      const g = canvas.getContext('2d'); g.fillStyle = '#5a6270'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (const [i, tile] of tiles.entries()) {
        const img = new Image(); img.src = tile.image; await img.decode();
        const x = (i % columns) * w, y = Math.floor(i / columns) * h;
        g.drawImage(img, x, y, w, h);
        g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.fillText(tile.label, x + 6, y + 16);
        g.strokeStyle = '#0006'; g.strokeRect(x, y, w, h);
      }
      return canvas.toDataURL('image/png');
    }, tiles, views.length);
    const file = path.join(out, `${weapon}.png`);
    fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log('wrote', file);
  }
  await page.evaluate(() => window.__crossfire.characterLab(null));
  console.log(JSON.stringify(report));
  if (errors.length) { console.error(errors); process.exitCode = 1; }
} finally { await browser.close(); }
