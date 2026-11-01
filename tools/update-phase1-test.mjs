/** Local Worker with real browser viewers and real WebSocket shooters. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const out = 'test-results/update-phase1'; fs.mkdirSync(out, { recursive: true });
const check = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); };
const until = async (fn, label, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(40); }
  throw new Error(`Timed out: ${label}`);
};
const state = (p) => p.evaluate(() => window.__crossfire.network());
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'update-phase1',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/update-phase1-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser; const sockets = [], timers = [], errors = [];
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM'), room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest(); while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000, protocolTimeout: 240000,
    defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  async function openBrowser(name) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.evaluateOnNewDocument((backend) => {
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket { constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); } };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.playerId = (await state(page)).selfId;
    await until(() => page.evaluate(() => window.__crossfire.spatialAudio().loaded >= 4), 'weapon audio decoded');
    return page;
  }
  const victim = await openBrowser('Spectator'), observer = await openBrowser('Audio Observer');
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(victim.playerId, arena.center, 0);
  await room.placeForCombatTest(observer.playerId, arena.observer, 0);
  for (const [width, height] of [[1280, 720], [1024, 600], [800, 600], [1920, 1080]]) {
    await victim.setViewport({ width, height });
    const geometry = await victim.evaluate(() => {
      const health = document.querySelector('.health').getBoundingClientRect(), hint = document.querySelector('.chat-hint').getBoundingClientRect();
      return { healthBottom: health.bottom, hintTop: hint.top, hintBottom: hint.bottom, healthTop: health.top };
    });
    check(geometry.hintBottom < geometry.healthTop, `chat prompt clears health at ${width}x${height}`);
  }
  await victim.setViewport({ width: 1280, height: 720 });
  await victim.evaluate(() => window.__crossfire.pause()); await victim.waitForSelector('#pause.visible');
  await victim.mouse.move(2, 2); await delay(250);
  const buttons = await victim.evaluate(() => {
    const a = document.querySelector('#pause .primary'), b = document.querySelector('#pause .leave-match');
    return { a: getComputedStyle(a).backgroundColor, b: getComputedStyle(b).backgroundColor,
      ah: a.getBoundingClientRect().height, bh: b.getBoundingClientRect().height };
  });
  check(buttons.a === 'rgb(36, 100, 186)' && buttons.b === 'rgb(165, 53, 61)' && Math.abs(buttons.ah - buttons.bh) < 1, `pause buttons have matching dimensions and blue/red colors: ${JSON.stringify(buttons)}`);
  await victim.click('#pause .primary'); await victim.waitForFunction(() => window.__crossfire.ready());

  // Render actual Web Audio spatialization offline; no audio devices or fake game events.
  const levels = await observer.evaluate(async () => {
    async function render(x, z) {
      const context = new OfflineAudioContext(2, 9600, 48000), osc = context.createOscillator(), p = context.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.refDistance = 3; p.maxDistance = 70; p.rolloffFactor = 1;
      p.positionX.value = x; p.positionZ.value = z;
      osc.connect(p); p.connect(context.destination); osc.start(); osc.stop(.2);
      const buffer = await context.startRendering();
      return [0, 1].map((channel) => Math.sqrt(buffer.getChannelData(channel).reduce((s, v) => s + v * v, 0) / buffer.length));
    }
    return { left: await render(-8, -5), right: await render(8, -5), near: await render(0, -4), far: await render(0, -50) };
  });
  check(levels.left[0] > levels.left[1] && levels.right[1] > levels.right[0], `Web Audio pans left and right: ${JSON.stringify(levels)}`);
  check(levels.near[0] > levels.far[0] * 2, 'Web Audio smoothly attenuates distant gunshots');

  async function shooter(weapon) {
    const ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin }); sockets.push(ws);
    const c = { ws, messages: [], snapshot: null, seq: 0 };
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.messages.push(m); if (m.snapshot) c.snapshot = m.snapshot; }); ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    c.send = (m) => ws.send(JSON.stringify({ v: 12, ...m })); c.send({ type: 'join', name: `Actual ${weapon}` });
    const welcome = await until(() => c.messages.find((m) => m.type === 'welcome'), 'shooter joins'); c.id = welcome.selfId;
    const timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) c.send({ type: 'ping', at: Date.now() }); }, 500); timers.push(timer);
    c.send({ type: 'spawn', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion, weapon, requestId: `phase1-${weapon}` });
    await until(() => c.messages.find((m) => m.type === 'spawned'), 'server approves real shooter');
    return c;
  }
  {
    const c = await shooter('rifle');
    await room.placeForCombatTest(victim.playerId, arena.observer, 0);
    await room.placeForCombatTest(observer.playerId, arena.center, 0);
    await observer.evaluate(() => window.__crossfire.look(0, 0)); await delay(500);
    c.send({ type: 'chat', text: 'A real room message' });
    await until(() => victim.$eval('.chat-feed', (e) => e.textContent.includes('A real room message')), 'real chat appears');
    await victim.keyboard.press('Enter'); await victim.waitForSelector('.match-chat:not([hidden])');
    check(await victim.$eval('.chat-hint', (e) => getComputedStyle(e).visibility) === 'hidden', 'opening bound chat hides the overlapping prompt');
    await victim.keyboard.press('Escape');
    const positions = [arena.sources.left, arena.sources.right];
    async function fireAt(position) {
      await room.placeForCombatTest(c.id, position, 0); await delay(450);
      const previous = c.messages.filter((m) => m.type === 'shot').length;
      const previousAudio = (await observer.evaluate(() => window.__crossfire.spatialAudio())).started;
      for (let i = 0; i < 18; i++) {
        c.send({ type: 'input', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion,
          frames: Array.from({ length: 6 }, (_, n) => ({ seq: ++c.seq, yaw: 0, pitch: 0,
            intent: { x: 0, z: 0, slide: false, aim: false, jumpPressed: false }, combat: { trigger: i >= 8 && n === 0, reload: false } })) });
        await delay(100);
        if (c.messages.filter((m) => m.type === 'shot').length > previous) break;
      }
      await until(async () => (await observer.evaluate(() => window.__crossfire.spatialAudio())).started > previousAudio, 'real spatial shot playback');
      return (await observer.evaluate(() => window.__crossfire.spatialSounds())).at(-1);
    }
    const left = await fireAt(positions[0]), right = await fireAt(positions[1]);
    check(left.x < -.5 && right.x > .5, `real shooter positions pan to opposite sides (${left.x.toFixed(1)}, ${right.x.toFixed(1)})`);
    const far = await room.distantArenaForTest();
    await room.placeForCombatTest(observer.playerId, far.pair[0], 0); await delay(500);
    const distant = await fireAt(far.pair[1]);
    check(distant.distance > left.distance + 10, `real distant shooter has a larger attenuation distance (${left.distance.toFixed(1)} vs ${distant.distance.toFixed(1)})`);
    c.send({ type: 'leave' }); wsClose(c.ws);
    await room.placeForCombatTest(victim.playerId, arena.center, 0); await room.placeForCombatTest(observer.playerId, arena.observer, 0);
  }
  for (const weapon of ['rifle', 'shotgun', 'sniper', 'smg']) {
    const c = await shooter(weapon), source = arena.sources.front, target = arena.center;
    await room.placeForCombatTest(victim.playerId, target, 0); await room.placeForCombatTest(c.id, source, 180);
    await delay(300);
    const yaw = Math.atan2(-(target[0] - source[0]), -(target[2] - source[2]));
    const pitch = Math.atan2((target[1] + 1.6) - source[1] - 1.64, Math.hypot(target[0] - source[0], target[2] - source[2]));
    const sendInput = (aim, trigger = false, aimYaw = yaw, aimPitch = pitch) => {
      if (c.seq - c.snapshot.players.find((p) => p.id === c.id).ack > 12) return;
      c.send({ type: 'input', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion,
        frames: Array.from({ length: 6 }, (_, i) => ({ seq: ++c.seq, yaw: aimYaw, pitch: aimPitch,
          intent: { x: 0, z: 0, slide: false, aim, jumpPressed: false }, combat: { trigger: trigger && i === 0, reload: false } })) });
    };
    for (let i = 0; i < 10; i++) { sendInput(true); await delay(100); }
    const audioBefore = await observer.evaluate(() => window.__crossfire.spatialAudio());
    for (let i = 0; i < 35; i++) {
      if (!c.snapshot.players.find((p) => p.id === victim.playerId)?.alive) break;
      sendInput(true, true); await delay(110);
    }
    await victim.waitForSelector('#spectate.visible', { timeout: 20000 });
    await until(async () => (await victim.evaluate(() => window.__crossfire.spectate())).weapon === weapon, `actual ${weapon} spectator view`);
    const view = await victim.evaluate(() => window.__crossfire.spectate());
    check(view.weapon === weapon && view.viewWeapon === weapon && (weapon === 'sniper' || view.viewVisible), `${weapon}: actual shooter weapon uses the existing first-person rig`);
    const after = await observer.evaluate(() => window.__crossfire.spatialAudio());
    check(after.started > audioBefore.started && after.recent.some((s) => s.name === `${weapon}_shot`), `${weapon}: another browser starts server-confirmed 3D gunshot audio`);
    for (let i = 0; i < 8; i++) { sendInput(false); await delay(100); }
    await until(async () => (await victim.evaluate(() => window.__crossfire.spectate())).ads < .12, `${weapon} exits ADS`);
    const hip = await victim.evaluate(() => window.__crossfire.spectate());
    await victim.screenshot({ path: `${out}/spectate-${weapon}-hip.png` });
    for (let i = 0; i < 8; i++) { sendInput(true); await delay(100); }
    await until(async () => (await victim.evaluate(() => window.__crossfire.spectate())).ads > .9, `${weapon} enters ADS`);
    const aimed = await victim.evaluate(() => window.__crossfire.spectate());
    check(aimed.fov < hip.fov - 3, `${weapon}: observed ADS smoothly changes spectator FOV`);
    if (weapon === 'sniper') {
      check(await victim.$eval('#spectate .scope', (e) => e.classList.contains('visible')), 'sniper: actual scoped overlay appears');
      check(await victim.$eval('.remote-player-labels', (e) => e.classList.contains('spectator-scoped') && getComputedStyle(e).clipPath !== 'none'), 'sniper: remote labels are clipped to the scope opening');
    }
    const changedYaw = Math.atan2(Math.sin(yaw + .35), Math.cos(yaw + .35));
    for (let i = 0; i < 6; i++) { sendInput(true, false, changedYaw, .12); await delay(100); }
    const turned = await victim.evaluate(() => window.__crossfire.spectate());
    check(Math.hypot(...turned.rotation.map((v, i) => v - aimed.rotation[i])) > .05, `${weapon}: spectator follows the real player's changed look direction`);
    check(await victim.$eval('.spectate-name', (e, name) => e.textContent.includes(name), weapon === 'rifle' ? 'Assault Rifle' : weapon === 'smg' ? 'SMG' : weapon === 'sniper' ? 'Sniper Rifle' : 'Shotgun'), `${weapon}: spectator label identifies the observed weapon`);
    await victim.screenshot({ path: `${out}/spectate-${weapon}.png` });
    for (let i = 0; i < 8; i++) { sendInput(false); await delay(100); }
    await until(async () => (await victim.evaluate(() => window.__crossfire.spectate())).ads < .12, `${weapon} releases ADS`);
    const released = await victim.evaluate(() => window.__crossfire.spectate());
    check(released.fov > aimed.fov + 3 && released.viewVisible, `${weapon}: releasing ADS restores normal zoom and the weapon`);
    if (weapon === 'sniper') check(!await victim.$eval('#spectate .scope', (e) => e.classList.contains('visible')), 'sniper: releasing ADS removes scope overlay');
    if (weapon === 'sniper') check(!await victim.$eval('.remote-player-labels', (e) => e.classList.contains('spectator-scoped')), 'sniper: releasing ADS restores full-view labels');
    const shotMark = c.messages.filter((m) => m.type === 'shot').length;
    const heardBefore = (await victim.evaluate(() => window.__crossfire.spatialAudio())).started;
    for (let i = 0; i < 18 && c.messages.filter((m) => m.type === 'shot').length === shotMark; i++) { sendInput(false, true); await delay(120); }
    await until(async () => (await victim.evaluate(() => window.__crossfire.spatialAudio())).started > heardBefore, `${weapon} gunshot while spectating`);
    const heard = (await victim.evaluate(() => window.__crossfire.spatialSounds())).at(-1);
    check(heard.name === `${weapon}_shot` && heard.distance === 0, `${weapon}: the spectator hears the watched shooter at the camera`);
    c.send({ type: 'leave' }); wsClose(c.ws);
    await until(async () => { const view = await victim.evaluate(() => window.__crossfire.spectate()); return view.weapon === null && !view.viewVisible; }, 'missing target clears spectator weapon');
    await victim.waitForFunction(() => !document.querySelector('#spectate .respawn-button')?.disabled, { timeout: 20000 });
    await victim.click('#spectate .respawn-button'); await victim.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
  }
  const end = await room.setRemainingForTest(12500);
  await victim.waitForFunction(() => document.querySelector('.match-final')?.textContent === '10' && !document.querySelector('.match-final').hidden, { timeout: 15000 });
  const before = Number(await victim.$eval('.match-final', (e) => e.textContent));
  await victim.evaluate(() => {
    const element = document.querySelector('.match-final'); window.__countdownSeen = [Number(element.textContent)];
    new MutationObserver(() => { const n = Number(element.textContent); if (n) window.__countdownSeen.push(n); }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  check(await victim.evaluate(() => document.querySelector('.match-final').getBoundingClientRect().top >= document.querySelector('.match-clock strong').getBoundingClientRect().bottom), 'countdown does not cover the main timer');
  await victim.screenshot({ path: `${out}/countdown.png` });
  await victim.evaluate(() => window.__crossfire.networkReconnect());
  await until(async () => (await state(victim)).state === 'connected', 'countdown reconnect');
  const after = Number(await victim.$eval('.match-final', (e) => e.textContent));
  check(after > 0 && after <= before && (await state(victim)).snapshot.match.endsAt === end, 'reconnect retains the server deadline and does not restart countdown');
  const seen = new Set([before, after]);
  while (Date.now() < end) {
    const number = await victim.$eval('.match-final', (e) => e.hidden ? null : Number(e.textContent));
    if (number) seen.add(number);
    await delay(80);
  }
  await until(async () => victim.$eval('.match-final', (e) => e.hidden).catch(() => true), 'countdown stops at round end');
  for (const value of await victim.evaluate(() => window.__countdownSeen)) seen.add(value);
  check([...Array(10)].every((_, i) => seen.has(i + 1)), `visible server countdown includes 10 through 1 (${[...seen].sort((a, b) => b - a).join(', ')})`);
  check(errors.length === 0, `no uncaught browser errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ buttons, errors, end }, null, 2));
} finally {
  for (const timer of timers) clearInterval(timer);
  for (const ws of sockets) wsClose(ws);
  await browser?.close(); await fixture.dispose();
}
function wsClose(ws) { if (ws.readyState !== WebSocket.CLOSED) ws.terminate(); }
