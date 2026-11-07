/** Fast dagger attacks, combo transitions, idle flourish and loose-joint deaths in real Chrome.
 * First person in offline Practice (stepped transitions at exact times and frame rates), then
 * Practice bots for the third-person flourish and deaths while standing and running. Writes PNGs
 * and labelled contact sheets to test-results/melee-anim/.
 *   node tools/melee-anim-test.mjs [http://127.0.0.1:5181/]   (a running Vite or serve-dist)
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/melee-anim';
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  timeout: 120000, protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const shots = {};
const keep = (group, label, file) => { (shots[group] ??= []).push({ label, file }); };

async function sheet(name, items, columns, cell = [480, 270]) {
  const page = await browser.newPage();
  const images = items.map((i) => ({ label: i.label, src: `data:image/${i.file.endsWith('.jpg') ? 'jpeg' : 'png'};base64,` + fs.readFileSync(i.file).toString('base64') }));
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
  await completeGuestProfile(page, 'Anim Test');
  await page.waitForFunction(() => window.__crossfire.homeCharacter().ready, { timeout: 120000 });

  // ------------------------------------------------------------------ third person (pose lab, same rig as remote players)
  const lab = async (file, options) => {
    const result = await page.evaluate((o) => window.__crossfire.characterLab(o), options);
    fs.writeFileSync(file, Buffer.from(result.image.split(',')[1], 'base64'));
  };
  const front = { heading: 25, pitch: 6, distance: 2.7, height: 1.25 };
  for (const [clip, times] of Object.entries({ attack_cross: [.04, .072, .104, .14], attack_forward: [.072, .104], attack_finisher: [.105, .205, .226, .248, .29],
    flourish_r: [.09, .16, .22, .3], flourish_l: [.16, .22] })) for (const time of times) {
    const file = `${out}/tp-${clip}-${time}.png`;
    await lab(file, { weapon: 'rifle', melee: { clip, time }, camera: front, advance: .05 });
    keep('tp', `${clip} ${time * 1000 | 0} ms`, file);
  }
  await page.evaluate(() => window.__crossfire.characterLab(null));

  const visible = (selector) => page.waitForSelector(selector + '.visible', { timeout: 240000 });
  const clickText = (root, label) => page.evaluate(({ root, label }) => {
    const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
    if (!b) throw Error('Missing ' + label); b.click();
  }, { root, label });
  const startPractice = async (bots, weapon, difficulty) => {
    await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
    if (difficulty) await page.click(`#practice-setup [data-difficulty="${difficulty}"]`);
    await page.$eval('#practice-setup input[type=range]', (n, b) => { n.value = String(b); n.dispatchEvent(new Event('input', { bubbles: true })); }, bots);
    await clickText('#practice-setup', 'START PRACTICE'); await visible('#weapons');
    await page.click(`#weapons [data-weapon="${weapon}"]`);
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 180000 });
  };

  // ------------------------------------------------------------------ first person
  await startPractice(0, 'rifle');
  await page.waitForFunction(() => window.__crossfire.meleeInspect()?.ready, { timeout: 60000 });
  await delay(2500);
  const spot = await page.evaluate(() => window.__crossfire.network().snapshot.players[0].motion.position);
  const place = () => page.evaluate((p) => window.__crossfire.teleport(p.x, p.y, p.z, 0, -4), spot);
  await place();
  const fp = (file) => page.screenshot({ path: file });
  const melee = (...args) => page.evaluate((a) => window.__crossfire.melee(...a), args);
  const inspect = () => page.evaluate(() => window.__crossfire.meleeInspect());
  await melee('pause'); await melee('equip');
  for (let i = 0; i < 40; i++) await melee('step', 1 / 30);
  check((await inspect()).state === 'ready', 'daggers equipped and in the guard');

  // Frozen key poses: start and follow-through of each attack, the crossed hold and the release.
  const keys = {
    'attack_cross': { label: 'Attack 1 (right diagonal)', times: [0, .04, .072, .104, .14, .19] },
    'attack_forward': { label: 'Attack 2 (left diagonal)', times: [0, .04, .072, .104, .14, .19] },
    'attack_finisher': { label: 'Attack 3 (crossover)', times: [.06, .105, .155, .205, .226, .248, .29, .345] },
    'flourish_r': { label: 'Idle flourish (right)', times: [0, .09, .16, .22, .3, .4] },
    'flourish_l': { label: 'Idle flourish (left)', times: [0, .09, .16, .22, .3, .4] },
  };
  const wristMax = [];
  for (const [clip, { label, times }] of Object.entries(keys)) for (const time of times) {
    await melee('freeze', clip, time); await place(); await delay(90);
    const file = `${out}/fp-${clip}-${time}.png`; await fp(file); keep('fp-' + clip, `${label} ${time * 1000 | 0} ms`, file);
    const s = await inspect(); wristMax.push(...s.fit.map((h) => h.wristBend));
  }
  check(Math.max(...wristMax) < 34, `first-person wrists stay natural in every key pose (max ${Math.max(...wristMax).toFixed(1)} deg)`);

  // Combo transitions, one rendered frame at a time at 60 FPS: attack 1 -> 2 -> 3, mashed.
  await melee('freeze'); await melee('pause'); await melee('reset'); await melee('equip');
  for (let i = 0; i < 40; i++) await melee('step', 1 / 60);
  const comboFrames = [], tipsLog = [];
  const frame = async (label) => {
    await melee('step', 1 / 60); await place(); await delay(45);
    const file = `${out}/fp-combo-${String(comboFrames.length).padStart(3, '0')}.png`; await fp(file);
    const s = await inspect(); comboFrames.push({ label: `${label} ${s.clip} ${(s.time * 1000) | 0} ms`, file, s }); tipsLog.push(s.grips.flat());
  };
  await melee('attack');
  await frame('1');
  await melee('attack');                         // pressed during attack 1: buffered
  for (let i = 0; i < 26; i++) { await frame('combo'); if (i === 12) await melee('attack'); }  // pressed again during attack 2
  const clipsSeen = comboFrames.map((f) => f.s.clip);
  console.log('combo clips', clipsSeen.join(','));
  check(['attack_cross', 'attack_forward', 'attack_finisher'].every((c) => clipsSeen.includes(c)), 'mashed input chains attack 1 -> 2 -> 3');
  check(!clipsSeen.slice(clipsSeen.indexOf('attack_cross'), clipsSeen.lastIndexOf('attack_finisher')).includes('idle'), 'the combo never returns to idle between attacks');
  // Pose continuity between rendered frames: no frame-to-frame jump of a grip beyond the strike speed.
  let worstStep = 0, worstAt = '';
  for (let i = 1; i < tipsLog.length; i++) for (const hand of [0, 1]) {
    const a = tipsLog[i - 1].slice(hand * 3, hand * 3 + 3), b = tipsLog[i].slice(hand * 3, hand * 3 + 3);
    const d = Math.hypot(...a.map((v, k) => v - b[k])); if (d > worstStep) { worstStep = d; worstAt = comboFrames[i].label; }
  }
  console.log('worst grip step per frame', worstStep.toFixed(3), worstAt);
  check(worstStep < .3, `no snapping between combo frames (worst grip step ${worstStep.toFixed(3)} m at ${worstAt})`);
  for (const f of comboFrames) keep('fp-combo', f.label, f.file);

  // Real flourish, then an attack that interrupts it.
  await melee('reset'); await melee('equip');
  for (let i = 0; i < 70; i++) await melee('step', 1 / 60);
  await melee('flourish', 'r');
  const flourishFrames = [];
  for (let i = 0; i < 26; i++) {
    await melee('step', 1 / 60); if (i % 2) continue; await place(); await delay(45);
    const file = `${out}/fp-flourish-${flourishFrames.length}.png`; await fp(file);
    const s = await inspect(); flourishFrames.push({ label: `flourish ${s.clip} ${(s.time * 1000) | 0} ms`, file, s }); keep('fp-flourish-run', flourishFrames.at(-1).label, file);
  }
  check(flourishFrames.some((f) => f.s.clip === 'flourish_r'), 'a real flourish plays on the animator');
  await melee('flourish', 'l');
  for (let i = 0; i < 13; i++) await melee('step', 1 / 60);
  const interrupt = [];
  await melee('attack');
  for (let i = 0; i < 12; i++) {
    await melee('step', 1 / 60); await place(); await delay(45);
    const file = `${out}/fp-interrupt-${i}.png`; await fp(file);
    const s = await inspect(); interrupt.push(s); keep('fp-interrupt', `spin cancelled by attack: ${s.clip} ${(s.time * 1000) | 0} ms (blend ${s.fade})`, file);
  }
  check(interrupt[0].clip === 'attack_cross', 'an attack immediately cancels the flourish');

  // Frame-rate independence in the real renderer: the same elapsed time gives the same grips.
  const gripsAt = async (dt, seconds) => {
    await melee('reset'); await melee('equip');
    for (let i = 0; i < 40; i++) await melee('step', 1 / 60);
    await melee('attack');
    const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) await melee('step', dt);
    await place(); await delay(90); const s = await inspect(); return s.grips.flat();
  };
  const g30 = await gripsAt(1 / 30, .1), g60 = await gripsAt(1 / 60, .1), g144 = await gripsAt(1 / 144, 0.0972222);
  const spread = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
  console.log('frame-rate spread', spread(g30, g60).toFixed(3), spread(g60, g144).toFixed(3));
  check(spread(g60, g144) < .09 && spread(g30, g60) < .2, `strike pose is frame-rate independent (30 / 60 / 144 FPS steps: ${spread(g30, g60).toFixed(3)} / ${spread(g60, g144).toFixed(3)} m)`);
  await melee('resume'); await melee('reset');

  // ------------------------------------------------------------------ third person: bots
  await page.evaluate(() => window.__crossfire.networkLeave()); await visible('#menu');
  await startPractice(2, 'smg', 'beginner');
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb'), { timeout: 120000 });

  /** Aim the free camera at a bot from an angle with a clear line of sight (the renderer's own
   * visibility test). The camera pauses the simulation: avatars time out after ~4 s, so stay quick. */
  const clearFraming = async (id, distance, height, pitch) => {
    for (const offset of [90, -90, 60, -60, 120, -120, 30, -30, 150, -150]) for (const d of [distance, distance - .7]) {
      await page.evaluate(({ offset, d, id, height, pitch }) => {
        const bot = window.__crossfire.network().rendered.find((p) => p.id === id);
        const heading = -bot.yaw * 180 / Math.PI + offset, r = heading * Math.PI / 180;
        window.__crossfire.freeCam(bot.x + Math.sin(r) * d, bot.y + height, bot.z - Math.cos(r) * d, heading + 180, pitch);
      }, { offset, d, id, height, pitch });
      await delay(110);
      if (await page.evaluate((id) => window.__crossfire.network().rendered.find((p) => p.id === id)?.visible, id)) return { offset, distance: d };
    }
    return null;
  };
  /** Free camera beside a bot, looking at its torso. */
  const frameBot = async (distance = 3, side = 90) => {
    await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb' && !p.death), { timeout: 30000 })
      .catch(async (e) => { console.log('rendered', JSON.stringify(await page.evaluate(() => ({ r: window.__crossfire.network().rendered.map((p) => ({ id: p.id, src: p.source, death: !!p.death, vis: p.visible })), practice: window.__crossfire.practice()?.bots?.map((b) => [b.alive, b.health]), screen: document.querySelector('.screen.visible, #hud')?.id })))); throw e; });
    return page.evaluate(({ distance, side }) => {
    const bot = window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death);
    const heading = -bot.yaw * 180 / Math.PI + side, r = heading * Math.PI / 180;
    window.__crossfire.freeCam(bot.x + Math.sin(r) * distance, bot.y + 1.0, bot.z - Math.cos(r) * distance, heading + 180, -6);
    return bot.id;
  }, { distance, side });
  };

  // Idle flourish on a bot (third person): equip, then wait for a real flourish and shoot frames.
  await page.evaluate(() => window.__crossfire.meleeRemote('equip'));
  await delay(1500);
  // The free camera pauses the simulation and avatars without snapshots vanish after 4 s: stay short.
  const botId = await page.evaluate(() => window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death).id);
  await clearFraming(botId, 2.4, 1.3, -8);
  const botFlourish = [];
  for (const t of [0, .09, .16, .22, .3, .42]) {
    await page.evaluate(({ id, t }) => window.__crossfire.meleeRemoteSync(id, 'flourish_r', t), { id: botId, t });
    await delay(55);
    const file = `${out}/bot-flourish-${botFlourish.length}.jpg`; await page.screenshot({ path: file, type: 'jpeg', quality: 80 }); botFlourish.push(file);
    keep('bot-flourish', `bot flourish_r ${t * 1000 | 0} ms`, file);
  }
  check(botFlourish.length === 6, 'captured the bot flourish');

  // The free camera leaves the session paused (avatars time out): each scene gets a fresh session.
  await page.evaluate(() => window.__crossfire.networkLeave()); await visible('#menu');
  await startPractice(2, 'smg', 'beginner');
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb'), { timeout: 120000 });

  /** With the bot frozen by the free camera, find an angle with a clear line of sight (<= ~2.5 s:
   * avatars time out after 4 s without snapshots), then eliminate it and photograph the fall. */
  const deathScene = async (name, label, id, extra = null) => {
    const framing = await clearFraming(id, 3.2, 1.15, -10);
    console.log(name, 'framing', JSON.stringify(framing));
    // A shot from the front: the incoming ray points along the victim's back, so it falls backward.
    const dir = await page.evaluate(({ id }) => {
      const bot = window.__crossfire.network().rendered.find((p) => p.id === id);
      return { x: Math.sin(bot.yaw), z: Math.cos(bot.yaw), y0: bot.y };
    }, { id });
    await page.evaluate(({ id, dir }) => window.__crossfire.eliminateRemote(id, dir.x, dir.z), { id, dir });
    const t0 = Date.now(), series = [];
    let extras = 0;
    for (let i = 0; i < 40; i++) {
      const elapsed = (Date.now() - t0) / 1000; if (elapsed > 1.7) break;
      // Once settled, look at the resting pose from three more angles (above, front, behind).
      if (elapsed > 1.0 && extras < 3 && extra) {
        const [offset, distance, height, pitch] = extra[extras++];
        await page.evaluate(({ id, offset, distance, height, pitch }) => {
          const bot = window.__crossfire.network().rendered.find((p) => p.id === id);
          const heading = -bot.yaw * 180 / Math.PI + offset, r = heading * Math.PI / 180;
          window.__crossfire.freeCam(bot.x + Math.sin(r) * distance, bot.y + height, bot.z - Math.cos(r) * distance, heading + 180, pitch);
        }, { id, offset, distance, height, pitch });
        await delay(60);
      }
      const file = `${out}/death-${name}-${String(i).padStart(2, '0')}.jpg`; await page.screenshot({ path: file, type: 'jpeg', quality: 72 });
      const state = await page.evaluate(() => { const p = window.__crossfire.network().rendered.find((q) => q.death); return p ? { ...p.death, joints: p.animation?.joints ?? null } : null; });
      series.push({ file, state }); keep('death-' + name, `${label} ${(state?.elapsed ?? elapsed).toFixed(2)} s`, file);
    }
    return { files: series.map((f) => f.file), states: series.map((f) => f.state).filter(Boolean), ground: dir.y0 };
  };
  /** Resting pose: nothing sunk through the floor, nothing hovering above it. */
  const restingOk = (r) => {
    const late = r.states.filter((s) => s.elapsed > 1.0 && s.joints);
    if (!late.length) return false;
    const ys = late.flatMap((s) => Object.values(s.joints).map((p) => p[1] - r.ground));
    const last = late.at(-1); console.log('last joints', last.elapsed.toFixed(2), JSON.stringify(Object.fromEntries(Object.entries(last.joints).map(([k, p]) => [k, p.map((v) => +v.toFixed(2))]))), 'ground', r.ground.toFixed(2));
    console.log('resting joint heights above the start floor', Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2));
    return Math.min(...ys) > -.15 && Math.min(...ys) < .3 && Math.max(...ys) < .75;
  };
  // Death while standing (the free camera pauses the simulation, so the bot stands still).
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb' && !p.death), { timeout: 60000 });
  const standing = await deathScene('standing', 'death standing', await page.evaluate(() => window.__crossfire.network().rendered.find((p) => p.source === 'glb' && !p.death).id), [[150, 2.6, 2.4, -38], [0, 2.8, 1.4, -14], [180, 2.8, 1.4, -14]]);
  check(standing.files.length >= 4, 'captured the standing death sequence');
  check(restingOk(standing), 'standing death settles on the floor: no clipping, no hovering');
  await page.evaluate(() => window.__crossfire.networkLeave()); await visible('#menu');

  // Death while running: find a bot mid-stride in the real simulation, freeze it there and eliminate it.
  await startPractice(3, 'smg', 'absurd');
  await page.waitForFunction(() => window.__crossfire.network().rendered.some((p) => p.source === 'glb'), { timeout: 120000 });
  let running = null;
  for (let i = 0; i < 200 && !running; i++) {
    const a = await page.evaluate(() => window.__crossfire.network().rendered.filter((p) => p.source === 'glb').map((p) => ({ id: p.id, x: p.x, z: p.z })));
    await delay(120);
    const b = await page.evaluate(() => window.__crossfire.network().rendered.filter((p) => p.source === 'glb').map((p) => ({ id: p.id, x: p.x, z: p.z })));
    for (const p of b) { const q = a.find((v) => v.id === p.id); if (q && Math.hypot(p.x - q.x, p.z - q.z) / .12 > 3.5) running = p.id; }
  }
  check(!!running, 'found a bot running in the simulation');
  const runDeath = await deathScene('running', 'death running', running);
  check(runDeath.files.length >= 4, 'captured the running death sequence');
  check(restingOk(runDeath), 'running death settles on the floor: no clipping, no hovering');
  check(errors.length === 0, 'no page errors or missing assets');

  for (const key of Object.keys(keys)) await sheet('sheet-fp-' + key, shots['fp-' + key], 4, [400, 225]);
  await sheet('sheet-tp', shots.tp, 6, [240, 320]);
  await sheet('sheet-fp-combo', shots['fp-combo'].filter((_, i) => i % 1 === 0), 6, [320, 180]);
  await sheet('sheet-fp-flourish-run', shots['fp-flourish-run'], 5, [320, 180]);
  await sheet('sheet-fp-interrupt', shots['fp-interrupt'], 4, [400, 225]);
  await sheet('sheet-bot-flourish', shots['bot-flourish'], 3, [480, 270]);
  await sheet('sheet-death-standing', shots['death-standing'], 4, [480, 270]);
  await sheet('sheet-death-running', shots['death-running'], 4, [480, 270]);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ checks, errors, worstStep, worstAt }, null, 1));
} catch (error) {
  if (page) await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  fs.writeFileSync(`${out}/failure.json`, JSON.stringify({ error: String(error), stack: error.stack, checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
