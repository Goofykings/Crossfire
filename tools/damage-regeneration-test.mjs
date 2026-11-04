import { PROTOCOL_VERSION } from './protocol-version.mjs';
/** Real Worker, real shooter socket and production-browser victim/HUD.
 * Fixture RPC only places server-approved players; hits and health are real.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const at = process.argv.indexOf('--url'), base = at < 0 ? 'http://127.0.0.1:4198/crossfire/' : process.argv[at + 1];
const out = 'test-results/health-browser'; fs.mkdirSync(out, { recursive: true });
const results = [], errors = [];
const check = (ok, text) => { assert.ok(ok, text); console.log(`PASS ${text}`); };
async function until(fn, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const x = await fn(); if (x) return x; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'damage-regeneration-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/health-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR),
}));
let browser, ws, heartbeat, page;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000, protocolTimeout: 240000,
    defaultViewport: { width: 800, height: 600 },
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.createBrowserContext(); page = await context.newPage();
  await page.evaluateOnNewDocument((backend) => {
    // Bound test rendering cost; production physics and transport use real elapsed time.
    const raf = requestAnimationFrame.bind(window), caf = cancelAnimationFrame.bind(window), pending = new Map(); let frame = 0;
    window.requestAnimationFrame = (cb) => {
      const id = ++frame, p = { timer: 0, frame: 0 };
      p.timer = setTimeout(() => { p.frame = raf((time) => { pending.delete(id); cb(time); }); }, 1000 / 30);
      pending.set(id, p); return id;
    };
    window.cancelAnimationFrame = (id) => { const p = pending.get(id); if (p) { clearTimeout(p.timer); caf(p.frame); pending.delete(id); } };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url, protocols) {
        super(new URL('/ws', backend).href.replace('http:', 'ws:'), protocols);
        this.addEventListener('message', (e) => {
          const m = JSON.parse(e.data), c = window.__damageCase;
          const hit = m.shot?.hits.find((h) => h.id === window.__crossfire?.network().selfId);
          if (!c || !hit) return;
          c.hitAt = performance.now(); c.shots.push({ hit, at: c.hitAt });
          if (c.name === 'right' && c.shots.length === 1) setTimeout(() => window.__crossfire.look(90, 0), 180);
        });
      }
    };
    const actualFetch = window.fetch;
    window.fetch = (input, init) => actualFetch(['/presence','/profile'].includes(new URL(String(input), location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, backend) : input, init);
    setInterval(() => {
      const c = window.__damageCase, e = document.querySelector('.damage-edges');
      if (!c || !e || !c.shots.length || performance.now() - c.hitAt > 900) return;
      c.samples.push({ age: performance.now() - c.hitAt, hit: c.shots.length, opacity: Number(e.style.opacity), css: e.style.cssText,
        weights: Object.fromEntries(['left', 'right', 'top', 'bottom'].map((k) => [k, Number(e.style.getPropertyValue(`--edge-${k}`))])) });
    }, 16);
  }, backend);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Health viewer');
  await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#start.visible .btn.primary:not(:disabled)') || document.querySelector('#error.visible'), { timeout: 240000 });
  const loadError = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : ''); check(!loadError, `browser loaded (${loadError})`);
  if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
  const victimId = await page.evaluate(() => window.__crossfire.network().selfId);
  ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin });
  const messages = []; let snapshot, id, seq = 0;
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); messages.push(m); if (m.snapshot) snapshot = m.snapshot; }); ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (m) => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...m }));
  send({ type: 'join', name: 'Actual health shooter' });
  const welcome = await until(() => messages.find((m) => m.type === 'welcome'), 'actual shooter join'); id = welcome.selfId;
  heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) send({ type: 'ping', at: Date.now() }); }, 500);
  send({ type: 'spawn', requestId: crypto.randomUUID(), weapon: 'smg', roundId: snapshot.roundId, mapVersion: snapshot.mapVersion });
  await until(() => messages.find((m) => m.type === 'spawned'), 'actual shooter spawn');
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(victimId, arena.center);
  async function shoot(source, aiming = true) {
    const target = arena.center, yaw = Math.atan2(-(target[0] - source[0]), -(target[2] - source[2]));
    const pitch = Math.atan2(target[1] + .9 - source[1] - 1.64, Math.hypot(target[0] - source[0], target[2] - source[2]));
    const batch = (trigger) => send({ type: 'input', roundId: snapshot.roundId, mapVersion: snapshot.mapVersion,
      frames: Array.from({ length: 6 }, (_, k) => ({ seq: ++seq, yaw, pitch,
        intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger: trigger && k === 0, reload: false } })) });
    if (aiming) for (let k = 0; k < 12; k++) { batch(false); await delay(50); }
    await until(() => snapshot.players.find((p) => p.id === id).ack >= seq, 'real shooter controls acknowledged');
    const mark = messages.length; batch(true);
    const shot = await until(() => messages.slice(mark).find((m) => m.type === 'shot' && m.shot.shooterId === id), 'actual shot');
    check(shot.shot.hits.some((h) => h.id === victimId && h.amount === 11), 'server-confirmed SMG hit on browser victim');
  }
  for (const name of ['right', 'left', 'front', 'behind']) {
    await page.evaluate((name) => { window.__crossfire.look(0, 0); window.__damageCase = { name, shots: [], samples: [] }; }, name);
    const source = arena.sources[name]; await room.placeForCombatTest(id, source);
    await shoot(source);
    if (name === 'right') { await delay(100); await page.screenshot({path:`${out}/damage-gameplay.png`}); }
    if (name === 'left') { await delay(200); await shoot(source, false); }
    await delay(900);
    const data = await page.evaluate(() => window.__damageCase); results.push(data);
    const peak = data.samples.filter((s) => s.hit === 1 && s.age < 160).sort((a, b) => b.opacity - a.opacity)[0];
    check(peak?.opacity > .2 && peak.opacity <= .9, `${name}: quick, bounded actual-hit effect`);
    check(data.samples.filter((s) => s.age >= 700).every((s) => s.opacity === 0), `${name}: fades completely in 625ms`);
    if (name === 'right') check(data.samples.some((s) => s.age > 200 && s.age < 450 && s.weights.top > s.weights.right), 'turning current camera moves the real-hit haze to the front');
    if (name === 'left') check(data.shots.length === 2 && data.samples.every((s) => s.opacity <= .9), 'consecutive confirmed hits refresh without excess brightness');
    // Freeze only a clone of the real recorded HUD style for deterministic CSS
    // pixel inspection; this never calls hit(), supplies packets or changes health.
    await page.evaluate((css) => {
      const panel = document.createElement('div'); panel.id = 'damage-css-probe'; panel.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000';
      const edge = document.createElement('div'); edge.className = 'damage-edges'; edge.style.cssText = css; panel.append(edge); document.body.append(panel);
    }, peak.css);
    await delay(100);
    const pixels = Buffer.from(await page.screenshot({ path: `${out}/${name}.png` })).toString('base64');
    data.pixels = await page.evaluate(async (png) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const sample = (x, y, w = 12, h = 12) => { const p = ctx.getImageData(x, y, w, h).data; let red = 0; for (let k = 0; k < p.length; k += 4) red += Math.max(0, p[k] - p[k + 1]); return red / (p.length / 4); };
      // Irregular lobes intentionally leave gaps; sample the edge band rather
      // than assuming the old uniform gradient is brightest at its midpoint.
      const positions = [.15,.3,.5,.7,.85], mean = values => values.reduce((a,b)=>a+b,0)/values.length;
      return { left: mean(positions.map(t=>sample(0,588*t))), right: mean(positions.map(t=>sample(788,588*t))),
        top: mean(positions.map(t=>sample(788*t,0))), bottom: mean(positions.map(t=>sample(788*t,588))), center: sample(394,294) };
    }, pixels);
    const p = data.pixels;
    check(p.center === 0, `${name}: center pixels remain completely clear`);
    check(name === 'right' ? p.right > p.left + 10 : name === 'left' ? p.left > p.right + 10
      : name === 'front' ? p.top > p.bottom + 10 : p.bottom > p.top && p.left > 3 && p.right > 3, `${name}: actual CSS gradient pixels match attack direction`);
    await page.evaluate(() => document.querySelector('#damage-css-probe').remove());
  }
  await page.evaluate(() => {
    window.__damageCase = null; window.__healingSamples = [];
    window.__healthSampler = setInterval(() => {
      const n = window.__crossfire.network(), self = n.snapshot?.players.find(p => p.id === n.selfId);
      if (!self) return;
      const nodes = [...document.querySelectorAll('.healing-plus')].filter(e => Number(e.style.opacity) > 0);
      const edge = document.querySelector('.healing-edges');
      window.__healingSamples.push({ at: performance.now(), serverTime: n.snapshot.serverTime, health: self.health,
        opacity: Number(edge.style.opacity), css: edge.style.cssText, symbols: nodes.map(e => ({left:e.style.left,top:e.style.top,transform:e.style.transform,opacity:e.style.opacity})) });
    }, 20);
  });
  await shoot(arena.sources.behind, false);
  const damaged = await room.healthForTest(victimId);
  check(damaged.health > 0 && damaged.health < 100 && damaged.regenAt !== null, 'real damaged life has a server regeneration deadline');
  const hp = damaged.health;
  await page.waitForFunction((hp) => Number(document.querySelector('.health .value').textContent) > Math.ceil(hp), { timeout: 10000 }, hp);
  const network = await page.evaluate(() => ({ network: window.__crossfire.network(), hud: Number(document.querySelector('.health .value').textContent) }));
  const self = network.network.snapshot.players.find((p) => p.id === victimId);
  check(network.hud === Math.ceil(self.health) && self.health > hp, 'existing HUD displays authoritative regenerated health');
  const peer = await until(() => messages.findLast((m) => m.type === 'snapshot' && m.snapshot.serverTime === network.network.snapshot.serverTime), 'matching peer health snapshot');
  check(peer.snapshot.players.find((p) => p.id === victimId).health === self.health, 'real peer and browser receive identical regenerated health');
  await page.waitForFunction(() => window.__crossfire.damageFeedback().healing > .1, {timeout:3000});
  await delay(700);
  const healing = await page.evaluate(() => ({ feedback:window.__crossfire.damageFeedback(), samples:window.__healingSamples,
    css:document.querySelector('.healing-edges').style.cssText,
    inputs:[...document.querySelectorAll('.damage-edges,.healing-edges,.healing-plus')].every(e=>getComputedStyle(e).pointerEvents==='none') }));
  await page.screenshot({path:`${out}/healing-gameplay.png`});
  check(healing.feedback.healing > 0 && healing.feedback.symbols > 0, 'confirmed regeneration shows green haze and floating symbols');
  check(healing.inputs, 'all effect layers ignore gameplay input');
  check(healing.samples.filter(s=>s.opacity>0).every(s=>s.health<100), 'no green at maximum health');
  check(await page.$$eval('.healing-plus',nodes=>nodes.length===6), 'six reused symbol nodes');
  for(const size of [[800,600],[1280,720],[640,480]]){
    await page.setViewport({width:size[0],height:size[1]});
    await page.evaluate(css=>{
      const panel=document.createElement('div');panel.id='healing-css-probe';panel.style.cssText='position:fixed;inset:0;z-index:999999;background:#000';
      const e=document.createElement('div');e.className='healing-edges';e.style.cssText=css;panel.append(e);document.body.append(panel);
    },healing.css);
    const png=Buffer.from(await page.screenshot({path:`${out}/healing-${size.join('x')}.png`})).toString('base64');
    const pixels=await page.evaluate(async png=>{
      const image=new Image();image.src=`data:image/png;base64,${png}`;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const sample=(x,y)=>{const d=ctx.getImageData(x,y,1,1).data;return Math.max(0,d[1]-d[0]);};
      return {center:sample(c.width/2,c.height/2),edge:sample(5,c.height*.3),mask:getComputedStyle(document.querySelector('.healing-edges')).maskImage};
    },png);
    check(pixels.center===0&&pixels.edge>5&&pixels.mask!=='none', `green irregular CSS pixels retain clear center at ${size.join('x')}`);
    await page.evaluate(()=>document.querySelector('#healing-css-probe').remove());
  }
  await page.setViewport({width:800,height:600});
  await shoot(arena.sources.behind,false);
  await page.waitForFunction(()=>window.__crossfire.damageFeedback().edges>0,{timeout:3000});
  check(await page.evaluate(()=>{const d=window.__crossfire.damageFeedback();return d.healing===0&&d.symbols===0;}), 'real damage immediately cancels green haze and symbols');
  await delay(800);check(await page.evaluate(()=>window.__crossfire.damageFeedback().healing===0),'no green during real regeneration delay');
  await page.waitForFunction(()=>window.__crossfire.damageFeedback().healing>.1,{timeout:8000});
  check(true,'green resumes only after real regeneration restarts');
  await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).health===100;},{timeout:15000});
  await page.waitForFunction(()=>window.__crossfire.damageFeedback().healing===0&&window.__crossfire.damageFeedback().symbols===0,{timeout:1000});
  check(true,'maximum health clears haze and symbols');
  results.push({healing});
  await page.evaluate(()=>clearInterval(window.__healthSampler));
  await page.evaluate(() => window.__crossfire.networkLeave()); send({ type: 'leave' });
  check(errors.length === 0, `no uncaught browser/asset errors: ${errors.join('; ')}`);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
  clearInterval(heartbeat); ws?.terminate(); await browser?.close(); await fixture.dispose();
}
