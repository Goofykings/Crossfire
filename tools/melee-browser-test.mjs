/** Dual-dagger visuals in real Chrome: third-person pose-lab shots on the home preview, then an
 * offline Practice session for first-person clip frames, stepped real transitions (equip, a
 * three-stage chain, return, unequip) and remote/bot daggers. Writes PNGs and contact sheets.
 *   node tools/melee-browser-test.mjs [http://127.0.0.1:5181/]   (a running Vite or serve-dist)
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/melee-browser';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const shots = {};
const keep = (group, label, file) => { (shots[group] ??= []).push({ label, file }); };

/** Labelled grid of screenshots, composed in a blank page. */
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

let page;
try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(base + '?quality=high&nohud', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Dagger Test');
  await page.waitForFunction(() => window.__crossfire.homeCharacter().ready, { timeout: 120000 });

  // ---- Third person: the same rig remote players use, posed at exact clip times.
  const lab = async (file, options) => {
    const result = await page.evaluate((o) => window.__crossfire.characterLab(o), options);
    fs.writeFileSync(file, Buffer.from(result.image.split(',')[1], 'base64'));
    return result.state;
  };
  const views = { front: { heading: 25, pitch: 6, distance: 2.7, height: 1.25 }, side: { heading: 95, pitch: 4, distance: 2.7, height: 1.25 },
    back: { heading: 155, pitch: 10, distance: 2.8, height: 1.3 } };
  const tpTimes = { equip: [0, .12, .2, .3, .5], idle: [0], attack_cross: [.04, .072, .104, .19], attack_forward: [.04, .104, .19], attack_finisher: [.105, .205, .248, .29, .345], unequip: [.08, .16, .3], flourish_r: [.16, .3] };
  let worstGap = 0, worstWrist = 0;
  for (const [clip, times] of Object.entries(tpTimes)) for (const time of times) for (const [view, camera] of Object.entries(views)) {
    if (view !== 'front' && !(clip === 'idle' || (clip === 'attack_cross' && time === .104) || (clip === 'attack_finisher' && (time === .205 || time === .248)) || (clip === 'attack_forward' && time === .104))) continue;
    const file = `${out}/tp-${clip}-${time}-${view}.png`;
    const state = await lab(file, { weapon: 'rifle', melee: { clip, time }, camera, advance: .05 });
    const m = state.weapon && state.character ? state : null;
    keep(view === 'front' ? 'tp-front' : 'tp-angles', `${clip} ${time}s ${view}`, file);
    void m;
  }
  const tpState = await page.evaluate(() => window.__crossfire.characterLab({ weapon: 'smg', melee: { clip: 'attack_cross', time: .104 }, advance: .05 }));
  check(!!tpState, 'third-person pose lab renders the dual daggers');
  for (const id of ['rifle', 'smg', 'shotgun', 'sniper']) {
    const file = `${out}/tp-gun-down-${id}.png`;
    await lab(file, { weapon: id, melee: { clip: 'equip', time: .12 }, camera: views.side, advance: .05 });
    keep('tp-guns', `${id}: equip 0.12s (gun lowering)`, file);
    const back = `${out}/tp-gun-up-${id}.png`;
    await lab(back, { weapon: id, melee: { clip: 'unequip', time: .4 }, camera: views.side, advance: .4 });
    keep('tp-guns', `${id}: after unequip (grip restored)`, back);
  }
  // Grip close-ups (camera aimed at each dagger's grip anchor): the fist must wrap the handle.
  for (const [clip, time] of [['idle', 0], ['attack_cross', .104], ['attack_forward', .104], ['attack_finisher', .248]]) {
    const first = await page.evaluate((o) => window.__crossfire.characterLab(o), { weapon: 'rifle', melee: { clip, time }, advance: .05 });
    for (const hand of [0, 1]) for (const [view, heading, pitch] of [['out', hand ? 60 : -60, 20], ['front', 15, 8]]) {
      const file = `${out}/grip-${clip}-${time}-${hand ? 'L' : 'R'}-${view}.png`;
      await lab(file, { weapon: 'rifle', melee: { clip, time }, advance: .05,
        camera: { heading, pitch, distance: .55, height: 1.3, target: first.state.melee.grips[hand] } });
      keep('grips', `${clip} ${time}s ${hand ? 'left' : 'right'} ${view}`, file);
    }
  }
  await page.evaluate(() => window.__crossfire.characterLab(null));

  // ---- First person in offline Practice (real map, real camera and weapon view).
  const visible = (selector) => page.waitForSelector(selector + '.visible', { timeout: 240000 });
  const clickText = (root, label) => page.evaluate(({ root, label }) => {
    const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
    if (!b) throw Error('Missing ' + label); b.click();
  }, { root, label });
  await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
  // Alone first: bots would interrupt the first-person frames.
  const startPractice = async (bots, weapon) => {
    await page.$eval('#practice-setup input[type=range]', (n, b) => { n.value = String(b); n.dispatchEvent(new Event('input', { bubbles: true })); }, bots);
    await clickText('#practice-setup', 'START PRACTICE'); await visible('#weapons');
    await page.click(`#weapons [data-weapon="${weapon}"]`);
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 180000 });
  };
  await startPractice(0, 'rifle');
  await page.waitForFunction(() => window.__crossfire.meleeInspect()?.ready, { timeout: 60000 });
  await delay(2500);
  // A fixed, lit spot so every frame shares the background (current spawn, facing north).
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  const place = () => page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -4), spot);
  await place();
  const fp = (file) => page.screenshot({ path: file });
  const melee = (...args) => page.evaluate((a) => window.__crossfire.melee(...a), args);

  const before = await page.evaluate(() => window.__crossfire.weapon());
  await fp(`${out}/fp-gun.png`); keep('fp-sequence', 'gun (before)', `${out}/fp-gun.png`);
  // Stepped real transitions at 30 fps: equip -> chain of three -> return -> unequip.
  await melee('pause'); await melee('equip');
  const frames = []; let t = 0;
  const capture = async (label, every = 1 / 30) => {
    await melee('step', every); t += every;
    await place(); await delay(60);
    const file = `${out}/fp-seq-${String(frames.length).padStart(3, '0')}.png`;
    await fp(file); const state = await page.evaluate(() => window.__crossfire.meleeInspect());
    frames.push({ label: `${label} ${state.clip ?? 'hidden'} ${(state.time ?? 0).toFixed(2)}`, file, state });
  };
  for (let i = 0; i < 16; i++) await capture('equip');
  const equipped = frames.at(-1).state;
  check(equipped.state === 'ready' && equipped.daggersVisible.every(Boolean) && !equipped.gunVisible, 'equip ends in the guard with both daggers and the gun put away');
  check(await page.evaluate(() => window.__crossfire.weapon().view.melee) === 1, 'first-person gun fully lowered while the daggers are out');
  await melee('attack');
  for (let i = 0; i < 9; i++) await capture('cross');
  await melee('attack');                                     // buffered -> forward at chainFrom
  for (let i = 0; i < 9; i++) await capture('forward');
  await melee('attack');
  for (let i = 0; i < 25; i++) await capture('finisher');
  for (let i = 0; i < 6; i++) await capture('return', 1 / 15);
  await melee('unequip');
  for (let i = 0; i < 14; i++) await capture('unequip');
  const clips = new Set(frames.map((f) => f.state.clip));
  check(['equip', 'attack_cross', 'attack_forward', 'attack_finisher', 'idle', 'unequip'].every((c) => clips.has(c)), 'stepped sequence played every clip in order');
  check(frames.at(-1).state.state === 'hidden' && frames.at(-1).state.gunVisible, 'unequip returns the gun');
  const wrist = Math.max(...frames.filter((f) => f.state.shown).flatMap((f) => f.state.fit.map((h) => h.wristBend)));
  check(wrist < 35, `first-person wrists stay natural (max ${wrist.toFixed(1)} deg)`);
  // Tips and grips stay in the lower view while ready (no crosshair obstruction): camera space.
  const guard = frames.find((f) => f.state.clip === 'idle')?.state ?? equipped;
  const onScreen = (p) => ({ x: Math.atan2(p[0], -p[2]) * 180 / Math.PI, y: Math.atan2(p[1], -p[2]) * 180 / Math.PI });
  const tipAngles = guard.tips.map(onScreen);
  check(tipAngles.every((a) => Math.hypot(a.x, a.y) > 8), `guard keeps the blades off the crosshair (${tipAngles.map((a) => `${a.x.toFixed(0)},${a.y.toFixed(0)}`).join(' / ')} deg)`);
  for (const f of frames) keep('fp-sequence', f.label, f.file);
  await page.evaluate(() => window.__crossfire.melee('resume'));
  await delay(400);
  const after = await page.evaluate(() => window.__crossfire.weapon());
  check(after.id === before.id && after.ammo === before.ammo, 'gun state machine untouched by the dagger presentation');

  // Frozen key poses, first person (exact times).
  const fpTimes = { equip: [.1, .2, .3, .4], idle: [0, 1.2], attack_cross: [0, .04, .072, .104, .14, .19], attack_forward: [0, .072, .104, .14, .19],
    attack_finisher: [.06, .105, .155, .205, .226, .248, .29, .345], unequip: [.06, .12, .18, .24], flourish_r: [.09, .16, .22, .3], flourish_l: [.16, .22] };
  for (const [clip, times] of Object.entries(fpTimes)) for (const time of times) {
    await melee('freeze', clip, time); await place(); await delay(80);
    const file = `${out}/fp-${clip}-${time}.png`; await fp(file); keep('fp-' + clip, `${clip} ${time}s`, file);
  }
  await melee('freeze'); await melee('reset');

  // ---- Remote players / practice bots: third person in the match.
  await page.evaluate(() => window.__crossfire.networkLeave()); await visible('#menu');
  await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
  await page.click('#practice-setup [data-difficulty="beginner"]');
  await startPractice(2, 'smg');
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb'), { timeout: 120000 });
  // Look at a bot so its rig is posed (off-screen avatars skip IK but keep visibility in sync).
  const aimAtBot = () => page.evaluate(() => { const b = window.__crossfire.practice().bots[0].position; window.__crossfire.aimAt(b.x, b.y + 1.2, b.z); });
  await aimAtBot();
  await page.evaluate(() => window.__crossfire.meleeRemote('equip'));
  // Wait on the real state (slow headless frames advance the clip in bounded steps).
  // Commands are idempotent: re-send so a bot that respawned meanwhile follows too.
  const settle = async (wanted) => {
    for (let i = 0; i < 100; i++) {
      await aimAtBot();
      await page.evaluate((w) => window.__crossfire.meleeRemote(w === 'hidden' ? 'unequip' : 'equip'), wanted);
      const all = Object.values(await page.evaluate(() => window.__crossfire.meleeRemoteInspect())).filter(Boolean);
      if (all.length && all.every((r) => r.state === wanted)) return;
      await delay(100);
    }
  };
  await settle('ready');
  const remote = Object.values(await page.evaluate(() => window.__crossfire.meleeRemoteInspect())).filter(Boolean);
  console.log('bots', JSON.stringify(remote.map((r) => ({ state: r.state, clip: r.clip, gun: r.gunVisible, daggers: r.daggersVisible, hands: r.hands }))));
  check(remote.length > 0 && remote.every((r) => r.daggersVisible?.every(Boolean) && r.gunVisible === false), 'practice bots show both daggers and put their gun away');
  await page.evaluate(() => window.__crossfire.meleeRemote('attack'));
  await aimAtBot();
  const attacking = await (await page.waitForFunction(() => {
    const posed = Object.values(window.__crossfire.meleeRemoteInspect()).filter((r) => r?.fit && r.clip === 'attack_cross' && r.time > .1);
    return posed.length ? posed : false;
  }, { timeout: 10000, polling: 16 })).jsonValue();
  // Daggers hang from the hand bones: each grip anchor must coincide with the enclosed handle
  // centre of the solved fist (distant bots may solve every 2nd/3rd frame; that never detaches).
  const posed = attacking;
  const detach = posed.flatMap((r) => r.fit.map((h, i) => Math.hypot(...h.hand.map((v, k) => v - r.grips[i][k]))));
  console.log('bot grips', JSON.stringify(posed.map((r) => ({ clip: r.clip, time: r.time, gaps: r.fit.map((h) => +h.gap.toFixed(3)) }))));
  check(detach.length > 0 && detach.every((d) => d < .003), `bot daggers stay in the fists mid-attack (max ${Math.max(...detach).toFixed(4)} m)`);
  // In-match third person under the map's lighting: freeCam pauses the local simulation (the
  // bot holds still) and frames it from the front three-quarter; the dagger clip keeps playing.
  await settle('ready');
  // Pick a camera angle with clear line of sight (the renderer's own body-LOS test).
  let framing = null;
  for (const offset of [35, -35, 0, 70, -70, 110, -110, 150, -150, 180]) for (const distance of [1.6, 2.3]) {
    if (framing) break;
    const bot = await page.evaluate(({ offset, distance }) => {
      const bot = window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death);
      const heading = -bot.yaw * 180 / Math.PI + offset, r = heading * Math.PI / 180;
      window.__crossfire.freeCam(bot.x + Math.sin(r) * distance, bot.y + 1.55, bot.z - Math.cos(r) * distance, heading + 180, -8);
      return bot.id;
    }, { offset, distance });
    await delay(250);
    if (await page.evaluate((id) => window.__crossfire.network().rendered.find((p) => p.id === id)?.visible, bot)) framing = { offset, distance };
  }
  console.log('bot framing', JSON.stringify(framing));
  for (const [clip, time] of [['idle', .2], ['attack_cross', .072], ['attack_cross', .104], ['attack_forward', .104], ['attack_finisher', .205], ['attack_finisher', .248]]) {
    await page.evaluate(({ clip, time, framing }) => {
      const bot = window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death);
      const heading = -bot.yaw * 180 / Math.PI + framing.offset, r = heading * Math.PI / 180;
      // Along the bot's facing (turned by the chosen offset), looking back at its chest.
      window.__crossfire.freeCam(bot.x + Math.sin(r) * framing.distance, bot.y + 1.55, bot.z - Math.cos(r) * framing.distance, heading + 180, -8);
      window.__crossfire.meleeRemoteSync(bot.id, clip, time);
    }, { clip, time, framing: framing ?? { offset: 35, distance: 2.3 } });
    await delay(50);
    const file = `${out}/bot-${clip}-${time}.png`;
    await page.screenshot({ path: file }); keep('bots', `bot ${clip} ${time}s (map lighting)`, file);
  }
  await page.evaluate(() => window.__crossfire.meleeRemote('unequip'));
  await settle('hidden');
  const restored = Object.values(await page.evaluate(() => window.__crossfire.meleeRemoteInspect())).filter(Boolean);
  check(restored.every((r) => r.gunVisible && r.daggersVisible.every((v) => !v)), 'bots return to their guns');
  check(errors.length === 0, 'no page errors or missing assets');

  await sheet('sheet-fp-sequence', shots['fp-sequence'].filter((_, i) => i % 2 === 0 || i < 2), 6, [320, 180]);
  for (const clip of ['equip', 'idle', 'attack_cross', 'attack_forward', 'attack_finisher', 'unequip', 'flourish_r', 'flourish_l']) await sheet('sheet-fp-' + clip, shots['fp-' + clip], 4, [400, 225]);
  await sheet('sheet-tp-front', shots['tp-front'], 6, [240, 320]);
  await sheet('sheet-tp-angles', shots['tp-angles'], 4, [240, 320]);
  await sheet('sheet-tp-guns', shots['tp-guns'], 4, [240, 320]);
  await sheet('sheet-grips', shots.grips, 4, [240, 320]);
  if (shots.bots) await sheet('sheet-bots', shots.bots, 3, [480, 270]);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ checks, errors, frames: frames.map((f) => ({ label: f.label, fit: f.state.fit, tips: f.state.tips })) }, null, 1));
} catch (error) {
  if (page) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  fs.writeFileSync(`${out}/failure.json`, JSON.stringify({ error: String(error), stack: error.stack, checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
