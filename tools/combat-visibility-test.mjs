/** Production browser + real Worker/TCP WebSocket tests. No mocked roster, hits or teams.
 * Test-only RPC places already-spawned actual sessions in real map sightlines.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const index = process.argv.indexOf('--url');
const base = index < 0 ? 'http://127.0.0.1:4176/crossfire/' : process.argv[index + 1];
const out = 'test-results/combat-visibility';
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS ${message}`); };
const errors = [];
const state = (page) => page.evaluate(() => window.__crossfire.network());
async function until(predicate, message, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20); }
  throw new Error(`Timed out: ${message}`);
}
async function pixels(page, clip = { x: 460, y: 160, width: 360, height: 400 }) {
  const data = Buffer.from(await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 170 && pixels[i + 1] < 105 && pixels[i + 2] < 105) red++;
      if (pixels[i + 2] > 170 && pixels[i] < 120 && pixels[i + 1] < 170) blue++;
    }
    return { red, blue };
  }, data);
}
try {
  const modeAt = process.argv.indexOf('--mode');
  for (const mode of (modeAt < 0 ? ['ffa', 'teams'] : [process.argv[modeAt + 1]])) {
    const fixture = new Miniflare(convertV4MiniflareOptions({ name: `visibility-${mode}`,
      modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
        { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
      compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
      resourcePersistencePath: fs.mkdtempSync('server/.wrangler/visibility-'),
      durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
      bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: mode }, log: new Log(LogLevel.ERROR),
    }));
    const backend = (await fixture.ready).href, sockets = [], contexts = [];
    const ns = await fixture.getDurableObjectNamespace('ROOM');
    const stub = ns.get(ns.idFromName('public-main'));
    let round = await stub.advanceMapForTest();
    while (round.mapId !== 'european-town') round = await stub.advanceMapForTest();
    async function openNode(name, spawn = true) {
      const ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin });
      const c = { ws, messages: [], snapshot: null, id: '', seq: 0, position: null }; sockets.push(c);
      ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.messages.push(m); if (m.snapshot) c.snapshot = m.snapshot; }); ws.on('error', () => {});
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      c.send = (m) => ws.send(JSON.stringify({ v: 5, ...m }));
      c.send({ type: 'join', name });
      const welcome = await until(() => c.messages.find((m) => m.type === 'welcome'), 'Node join');
      c.id = welcome.selfId;
      c.timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) c.send({ type: 'ping', at: Date.now() }); }, 500);
      ws.once('close', () => clearInterval(c.timer));
      if (spawn) {
        c.send({ type: 'spawn', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion, weapon: 'sniper', requestId: 'test-life' });
        await until(() => c.messages.find((m) => m.type === 'spawned'), 'Node spawn');
      }
      return c;
    }
    async function openBrowser(name) {
      const context = await browser.createBrowserContext(); contexts.push(context);
      const page = await context.newPage();
      await page.evaluateOnNewDocument((backend) => {
        // Exercise a real saved loadout preference; bolt timing makes one physical
        // mouse press deterministic even when the test machine pauses a frame.
        localStorage.setItem('crossfire.pending-weapon', 'sniper');
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket { constructor(url, protocols) {
          super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols);
        } };
        const fetchActual = window.fetch;
        window.fetch = (input, init) => fetchActual(new URL(String(input), location.href).pathname === '/presence'
          ? new URL('/presence', backend) : input, init);
      }, backend);
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${base}?multiplayer&autoplay&quality=medium&shadows=low`, { waitUntil: 'domcontentloaded' });
      await completeGuestProfile(page, name);
      await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible'), { timeout: 240000 });
      assert.equal(await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : null), null);
      page.id = (await state(page)).selfId;
      return page;
    }
    async function place(id, p, target) {
      const heading = Math.atan2(target[0] - p[0], -(target[2] - p[2])) * 180 / Math.PI;
      return stub.placeForCombatTest(id, p, heading);
    }
    async function arrange(viewer, target, pair, targetY = 1) {
      await place(target.id, pair[0], pair[1]); await place(viewer.id, pair[1], pair[0]);
      const p = pair[1], q = pair[0];
      await viewer.evaluate((h, pitch) => window.__crossfire.look(h, pitch), Math.atan2(q[0] - p[0], -(q[2] - p[2])) * 180 / Math.PI,
        Math.atan2(q[1] + targetY - p[1] - 1.64, Math.hypot(q[0] - p[0], q[2] - p[2])) * 180 / Math.PI);
      target.position = pair[0]; viewer.position = pair[1];
      await delay(400);
    }
    const avatar = async (page, id) => (await state(page)).rendered.find((p) => p.id === id);
    async function fireNode(c, target, head = false) {
      const p = c.position, q = target.position, dy = (q[1] + (head ? 1.6 : .9)) - p[1] - 1.64;
      const yaw = Math.atan2(-(q[0] - p[0]), -(q[2] - p[2]));
      const pitch = Math.atan2(dy, Math.hypot(q[0] - p[0], q[2] - p[2]));
      const send = (trigger) => c.send({ type: 'input', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion,
        frames: Array.from({ length: 6 }, (_, i) => ({ seq: ++c.seq, yaw, pitch,
          intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger: trigger && i === 0, reload: false } })) });
      for (let k = 0; k < 12; k++) { send(false); await delay(50); }
      const mark = c.messages.length; send(true);
      return until(() => c.messages.slice(mark).find((m) => m.type === 'shot'), 'real Node shot');
    }
    try {
      const a = await openNode('Actual shooter');
      const b = await openBrowser('Actual viewer');
      await openNode('Actual pre-spawn guest', false);
      const d = await openBrowser('Second actual browser');
      await b.bringToFront();
      // Restore the full input surface after clipped pixel captures in headless Chrome.
      await b.setViewport({ width: 1280, height: 720 });
      const bs = await state(b), ds = await state(d);
      check(bs.snapshot.players.length === 4 && bs.snapshot.players.filter((p) => p.alive).length === 3, `${mode}: four actual sessions, including one real unspawned guest`);
      if (mode === 'teams') check(bs.snapshot.players.find((p) => p.id === b.id).team === 'red'
        && ds.snapshot.players.find((p) => p.id === d.id).team === 'red', 'both browser teammates are authoritative Red Team members');
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]]);
      await place(d.id, [-1.4, 0, -1.7], [-3, 0, 2]);
      await until(async () => (await avatar(b, a.id))?.labelVisible && (await avatar(b, d.id))?.labelVisible, 'visible labels');
      check((await avatar(b, a.id)).outline && !(await avatar(b, a.id)).friendly, 'visible opponent has a real body outline and enemy label');
      check((await avatar(b, d.id)).friendly === (mode === 'teams'), 'relationship uses the local team, not a fixed server color');
      const labels = await b.$$eval('.remote-player-label:not([hidden])', (els) => els.map((e) => ({ name: e.textContent, relationship: e.dataset.relationship, color: getComputedStyle(e).color })));
      check(labels.some((e) => e.name === 'Actual shooter' && e.relationship === 'opponent' && e.color === 'rgb(255, 102, 96)'), 'actual opponent name is red');
      check(labels.some((e) => e.name === 'Second actual browser' && e.color === (mode === 'teams' ? 'rgb(114, 173, 255)' : 'rgb(255, 102, 96)')), 'actual second browser name uses the correct relative color');
      const asset = await b.evaluate(() => window.__crossfire.characterAsset());
      check(asset.state === 'missing' && asset.clips.length === 0 && (await state(b)).rendered.every((p) => p.source === 'placeholder'), 'unfinished character export remains an honest placeholder, with no invented clips');
      check((await state(b)).rendered.filter((p) => p.id === a.id).length === 1, 'no duplicate remote bodies');
      const hideLabels = await b.addStyleTag({ content: '.remote-player-labels { visibility: hidden !important; }' });
      await b.evaluate(() => window.__crossfire.remoteOutlines(false)); await delay(80);
      const off = await pixels(b);
      const allyOff = mode === 'teams' ? await pixels(b, { x: 800, y: 160, width: 360, height: 400 }) : null;
      await b.evaluate(() => window.__crossfire.remoteOutlines(true)); await delay(100);
      const on = await pixels(b);
      check(on.red > off.red + 15, `visible silhouette contributes red outline pixels (${off.red} -> ${on.red})`);
      if (mode === 'teams') {
        const allyOn = await pixels(b, { x: 800, y: 160, width: 360, height: 400 });
        check(allyOn.blue > allyOff.blue + 15, `Red Team teammate silhouette is blue (${allyOff.blue} -> ${allyOn.blue})`);
      }
      await hideLabels.evaluate((e) => e.remove());
      await b.evaluate(() => window.__crossfire.remoteOutlines(false)); await delay(1400);
      const plainFps = await b.evaluate(() => window.__crossfire.stats().fps);
      await b.evaluate(() => window.__crossfire.remoteOutlines(true)); await delay(1400);
      const outlineFps = await b.evaluate(() => window.__crossfire.stats().fps);
      check(outlineFps >= plainFps * .7, `${mode}: local outline on/off comparison ${outlineFps.toFixed(1)}/${plainFps.toFixed(1)} FPS`);
      await b.screenshot({ path: `${out}/${mode}-visible.png` });
      const wall = await stub.wallArenaForTest();
      await arrange(b, a, wall.pair);
      await place(d.id, wall.pair[0].map((v, k) => k === 0 ? v + .5 : v), wall.pair[1]);
      await until(async () => !(await avatar(b, a.id))?.visible, 'opponent hidden by real wall');
      check(!(await avatar(b, a.id)).outline && !(await avatar(b, a.id)).labelVisible, 'fully occluded enemy has neither outline nor name tag');
      const ally = await avatar(b, d.id);
      check(!ally.outline && ally.labelVisible === (mode === 'teams'), 'occluded teammate keeps only a blue label; FFA keeps no hidden label');
      await b.screenshot({ path: `${out}/${mode}-wall.png` });
      if (wall.edgePair) {
        const dx = wall.edgePair[0][0] - wall.pair[0][0], dz = wall.edgePair[0][2] - wall.pair[0][2];
        const length = Math.hypot(dx, dz);
        let exposed = false;
        for (const offset of [0, .08, .16, .24, .32, .4]) {
          const pair = wall.edgePair.map(([x, y, z]) => [x + dx / length * offset, y, z + dz / length * offset]);
          try { await arrange(b, a, pair); } catch { continue; }
          if ((await avatar(b, a.id))?.visible) { exposed = true; break; }
        }
        await b.screenshot({ path: `${out}/${mode}-partial.png` });
        check(exposed, 'opponent becomes partially exposed at the actual rendered wall edge');
        check((await avatar(b, a.id)).outline, 'partially exposed body has a depth-tested outline');
        await b.screenshot({ path: `${out}/${mode}-partial.png` });
      }
      const far = await stub.distantArenaForTest();
      await arrange(b, a, far.pair, 1.3);
      await until(async () => (await avatar(b, a.id))?.labelVisible, 'distant visible opponent');
      const font = await b.$eval(`.remote-player-label[data-player-id="${a.id}"]`, (e) => parseFloat(getComputedStyle(e).fontSize));
      check(font >= 11 && font <= 14, `distant label stays bounded (${far.distance.toFixed(1)} m, ${font.toFixed(1)} px)`);
      await b.screenshot({ path: `${out}/${mode}-distance.png` });
      const away = Math.atan2(far.pair[0][0] - far.pair[1][0], -(far.pair[0][2] - far.pair[1][2])) * 180 / Math.PI + 180;
      await b.evaluate((heading) => window.__crossfire.look(heading, 0), away); await delay(300);
      check(!(await avatar(b, a.id)).labelVisible, 'players outside the camera view have no label');

      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]], .9);
      await place(d.id, [-1.4, 0, -1.7], [-3, 0, 2]);
      const hit = await fireNode(a, b);
      check(hit.shot.hits[0]?.amount === 75, 'actual server sniper body shot deals the configured 75 damage');
      await b.waitForFunction(() => document.querySelector('.health .value').textContent === '25');
      await until(async () => (await state(d)).snapshot.players.find((p) => p.id === b.id).health === 25, 'other browser health synchronization');
      check(true, 'both real browsers receive the new health and the victim HUD shows 25');
      await b.screenshot({ path: `${out}/${mode}-health.png` });
      await b.evaluate(() => { window.__crossfire.hold('aim', true); }); await delay(650);
      check((await avatar(b, a.id)).outline, 'a scoped visible torso stays outlined even if its name anchor is outside the viewport');
      await b.bringToFront();
      await b.evaluate(() => {
        window.testMouseEvents = [];
        for (const type of ['mousedown', 'mouseup', 'blur', 'pointerlockchange']) window.addEventListener(type, (e) => {
          window.testMouseEvents.push({ type: e.type, button: e.button, target: e.target?.id, focus: document.hasFocus() });
        }, true);
      });
      // Dispatch through the real canvas/window input handlers. Native CDP mouse
      // delivery is unreliable across isolated headless contexts after captures;
      // no hit, health, roster or server state is fabricated here.
      await b.evaluate(() => document.querySelector('#game').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })));
      try {
        await until(() => a.messages.find((m) => m.type === 'shot' && m.shot.shooterId === b.id && m.shot.hits.some((h) => h.id === a.id)), 'browser input deals real player damage');
      } finally { await b.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }))); }
      await b.evaluate(() => window.__crossfire.hold('aim', false));
      check(true, 'frontend weapon input reaches the Worker and damages the other actual player');
      await delay(500);
      const lethal = await fireNode(a, b, true);
      check(lethal.shot.hits.some((h) => h.id === b.id && h.killed), 'real lethal headshot eliminates the browser player');
      await b.waitForSelector('#start.visible');
      await until(async () => !(await state(d)).rendered.some((p) => p.id === b.id), 'eliminated body removal');
      await until(async () => (await state(b)).snapshot.players.find((p) => p.id === b.id).deaths === 1, 'authoritative death count');
      check(await b.$eval('#start .btn.primary', (e) => /RESPAWN/i.test(e.textContent)), 'eliminated player sees a real Respawn action');
      await b.click('#start .btn.primary');
      await b.waitForFunction(() => window.__crossfire.ready() && window.__crossfire.network().snapshot.players.find((p) => p.id === window.__crossfire.network().selfId)?.life === 2);
      check(await b.$eval('.health .value', (e) => e.textContent === '100'), 'approved respawn restores 100 health');
      await d.evaluate(() => window.__crossfire.networkLeave());
      await until(async () => !(await state(b)).rendered.some((p) => p.id === d.id), 'disconnected tag/body removal');
      check(true, 'disconnected players leave no name tag or duplicate body');
      console.log(`${mode} browser render stats`, await b.evaluate(() => {
        const s = window.__crossfire.stats(); return { fps: s.fps, frameMs: s.frameMs, drawCalls: s.drawCalls,
          visibility: window.__crossfire.visibilityStats() };
      }));
      await b.evaluate(() => window.__crossfire.networkLeave());
    } catch (error) {
      for (const context of contexts) for (const page of await context.pages()) {
        try {
          console.log('Browser failure diagnostic', await page.evaluate(() => {
            const n = window.__crossfire.network();
            return { self: n.selfId, player: window.__crossfire.motion(), weapon: window.__crossfire.weapon(), lastShot: window.__crossfire.lastShot(),
              roster: n.snapshot?.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, health: p.health, ammo: p.combat.gun?.ammo, trigger: p.combat.triggerHeld })),
              mouseEvents: window.testMouseEvents,
              mouseTarget: document.elementFromPoint(640, 360)?.outerHTML.slice(0, 180) };
          }));
          await page.screenshot({ path: `${out}/${mode}-failure-${page.id}.png` });
        } catch {}
      }
      for (const c of sockets) console.log('Actual server shot diagnostics', c.messages.filter((m) => m.type === 'shot').slice(-6));
      throw error;
    } finally {
      for (const c of sockets) { clearInterval(c.timer); c.ws.terminate(); }
      for (const c of contexts) await c.close();
      stub[Symbol.dispose]?.(); await fixture.dispose();
    }
  }
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); }
