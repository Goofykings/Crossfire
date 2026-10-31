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
const outAt = process.argv.indexOf('--out');
const out = outAt < 0 ? 'test-results/combat-visibility' : process.argv[outAt + 1];
fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS ${message}`); };
const errors = [];
console.log('Browser launched; starting real multiplayer visibility verification');
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
    console.log(`${mode}: local Worker ready`);
    const ns = await fixture.getDurableObjectNamespace('ROOM');
    const stub = ns.get(ns.idFromName('public-main'));
    let round = await stub.advanceMapForTest();
    while (round.mapId !== 'european-town') round = await stub.advanceMapForTest();
    async function openNode(name, spawn = true) {
      const ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin });
      const c = { ws, messages: [], snapshot: null, id: '', seq: 0, position: null }; sockets.push(c);
      ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.messages.push(m); if (m.snapshot) c.snapshot = m.snapshot; }); ws.on('error', () => {});
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      c.send = (m) => ws.send(JSON.stringify({ v: 9, ...m }));
      c.send({ type: 'join', name });
      const welcome = await until(() => c.messages.find((m) => m.type === 'welcome'), 'Node join');
      c.id = welcome.selfId;
      c.timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) c.send({ type: 'ping', at: Date.now() }); }, 500);
      ws.once('close', (code, reason) => { clearInterval(c.timer); console.log(`${mode}: ${name} socket closed ${code} ${reason}`); });
      if (spawn) {
        c.send({ type: 'spawn', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion, weapon: 'sniper', requestId: 'test-life' });
        await until(() => c.messages.find((m) => m.type === 'spawned'), 'Node spawn');
      }
      return c;
    }
    async function openBrowser(name) {
      const context = await browser.createBrowserContext(); contexts.push(context);
      const page = await context.newPage();
      await page.evaluateOnNewDocument((backend, dropAck) => {
        // Exercise a real saved loadout preference; bolt timing makes one physical
        // mouse press deterministic even when the test machine pauses a frame.
        localStorage.setItem('crossfire.pending-weapon', 'sniper');
        const Socket = window.WebSocket;
        let drop = dropAck;
        window.WebSocket = class extends Socket { constructor(url, protocols) {
          super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols);
          // Fault-inject a lost actual acknowledgement, never invented server data.
          this.addEventListener('message', (event) => {
            if (drop && JSON.parse(event.data).type === 'spawned') {
              drop = false; window.__droppedSpawnAck = true; event.stopImmediatePropagation();
            }
          });
        } };
        const fetchActual = window.fetch;
        window.fetch = (input, init) => fetchActual(new URL(String(input), location.href).pathname === '/presence'
          ? new URL('/presence', backend) : input, init);
      }, backend, name === 'Actual viewer');
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('response', (response) => {
        if (response.status() >= 400 && new URL(response.url()).pathname.includes('/assets/')) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`${base}?multiplayer&autoplay&quality=medium&shadows=low`, { waitUntil: 'domcontentloaded' });
      console.log(`${mode}: ${name} page loaded`);
      await completeGuestProfile(page, name);
      console.log(`${mode}: ${name} guest profile ready`);
      await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
        || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
      assert.equal(await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : null), null);
      // A reconnect while the headless context loads may leave the honest pre-spawn
      // UI open. Use its actual Spawn button, rather than assuming debug autoplay.
      await delay(120);
      if (!await page.evaluate(() => window.__crossfire.ready()) && await page.$('#start.visible .btn.primary:not(:disabled)')) {
        await page.click('#start .btn.primary');
      }
      await page.waitForFunction(() => window.__crossfire.ready() || (document.querySelector('#start.visible .btn.primary:not(:disabled)')
        && window.__crossfire.network().snapshot?.players.find((p) => p.id === window.__crossfire.network().selfId)?.alive), { timeout: 30000 });
      if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
      await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 15000 });
      if (name === 'Actual viewer') check(await page.evaluate(() => window.__droppedSpawnAck),
        'Retry enters the actual server-approved life after a lost spawn acknowledgement');
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
      const send = (trigger) => {
        if (c.seq - c.snapshot.players.find((p) => p.id === c.id).ack > 12) return false;
        c.send({ type: 'input', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion,
          frames: Array.from({ length: 6 }, (_, i) => ({ seq: ++c.seq, yaw, pitch,
            intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger: trigger && i === 0, reload: false } })) });
        return true;
      };
      for (let k = 0; k < 12; k++) { send(false); await delay(50); }
      await until(async () => {
        const self = c.snapshot.players.find((p) => p.id === c.id);
        if (self.combat.gun?.action === 'idle' && self.combat.gun.ads > .95 && c.seq - self.ack <= 6) return true;
        send(false); await delay(50); return false;
      }, 'actual server weapon ready');
      const mark = c.messages.length; send(true);
      return until(() => c.messages.slice(mark).find((m) => m.type === 'shot'), 'real Node shot');
    }
    try {
      const a = await openNode('Actual shooter');
      const b = await openBrowser('Actual viewer');
      await openNode('Actual pre-spawn guest', false);
      const qualityOnly = process.argv.includes('--quality-only');
      const peerName = qualityOnly ? 'Actual quality peer' : 'Second actual browser';
      const d = qualityOnly ? await openNode(peerName) : await openBrowser(peerName);
      await b.bringToFront();
      // Restore the full input surface after clipped pixel captures in headless Chrome.
      await b.setViewport({ width: 1280, height: 720 });
      const bs = await state(b), ds = qualityOnly ? { snapshot: d.snapshot } : await state(d);
      check(bs.snapshot.players.length === 4 && bs.snapshot.players.filter((p) => p.alive).length === 3, `${mode}: four actual sessions, including one real unspawned guest`);
      if (mode === 'teams') check(bs.snapshot.players.find((p) => p.id === b.id).team === 'red'
        && ds.snapshot.players.find((p) => p.id === d.id).team === 'red', 'viewer and peer are authoritative Red Team members');
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]]);
      await place(d.id, [-1.4, 0, -1.7], [-3, 0, 2]);
      await until(async () => (await avatar(b, a.id))?.labelVisible && (await avatar(b, d.id))?.labelVisible, 'visible labels');
      check((await avatar(b, a.id)).outline && !(await avatar(b, a.id)).friendly, 'visible opponent has a real body outline and enemy label');
      check((await avatar(b, d.id)).friendly === (mode === 'teams'), 'relationship uses the local team, not a fixed server color');
      const labels = await b.$$eval('.remote-player-label:not([hidden])', (els) => els.map((e) => ({ name: e.textContent, relationship: e.dataset.relationship, color: getComputedStyle(e).color })));
      check(labels.some((e) => e.name === 'Actual shooter' && e.relationship === 'opponent' && e.color === 'rgb(255, 102, 96)'), 'actual opponent name is red');
      check(labels.some((e) => e.name === peerName && e.color === (mode === 'teams' ? 'rgb(114, 173, 255)' : 'rgb(255, 102, 96)')), 'actual peer name uses the correct relative color');
      const asset = await b.evaluate(() => window.__crossfire.characterAsset());
      check(asset.state === 'ready' && asset.bones === 18 && asset.loads === 1
        && ['IDLE', 'RUN', 'JUMP_START', 'JUMP_LOOP', 'JUMP_LAND', 'SLIDE'].every((clip) => asset.clips.includes(clip))
        && (await state(b)).rendered.every((p) => p.source === 'glb'), 'actual exported humanoid rig and all six clips load once, without placeholder bodies');
      const sharedA = (await avatar(b, a.id)).animation, sharedD = (await avatar(b, d.id)).animation;
      check(JSON.stringify(sharedA.geometry) === JSON.stringify(sharedD.geometry)
        && JSON.stringify(sharedA.materials) === JSON.stringify(sharedD.materials) && sharedA.rig !== sharedD.rig,
        'multiple characters share geometry/materials and have independent copies of the same rig');
      check((await state(b)).rendered.filter((p) => p.id === a.id).length === 1, 'no duplicate remote bodies');
      const hideLabels = await b.addStyleTag({ content: '.remote-player-labels { visibility: hidden !important; }' });
      await b.evaluate(() => window.__crossfire.remoteOutlines(false)); await delay(80);
      const off = await pixels(b);
      await b.screenshot({ path: `${out}/${mode}-unoutlined.png` });
      const allyOff = mode === 'teams' ? await pixels(b, { x: 800, y: 160, width: 360, height: 400 }) : null;
      await b.evaluate(() => window.__crossfire.remoteOutlines(true)); await delay(100);
      const on = await pixels(b);
      check(on.red > off.red + 15, `visible silhouette contributes red outline pixels (${off.red} -> ${on.red})`);
      const interior = await b.evaluate(() => window.__crossfire.silhouetteInterior());
      const shot = Buffer.from(await b.screenshot()).toString('base64');
      const internalRed = await b.evaluate(async (data, interior) => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const p = ctx.getImageData(0, 0, c.width, c.height).data;
        return interior.filter(({ x, y }) => { const i = (y * c.width + x) * 4;
          return p[i] > 170 && p[i + 1] < 105 && p[i + 2] < 105; }).length;
      }, shot, interior);
      check(interior.length > 40 && internalRed <= Math.max(2, interior.length * .015),
        `GPU union mask has no internal red seams (${internalRed}/${interior.length} interior samples)`);
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
      // Rebuilding quality effects must keep bloom/AA before the sharp contour.
      await b.bringToFront();
      await b.evaluate(() => window.__crossfire.setSetting({ graphicsQuality: 'high' }));
      await until(() => b.evaluate(() => window.__crossfire.silhouetteStats().last), 'High quality pipeline settles after shader compilation', 30000);
      check(await b.evaluate(() => window.__crossfire.silhouetteStats().last), 'quality changes retain the contour after bloom and antialiasing');
      await b.evaluate(() => window.__crossfire.setSetting({ graphicsQuality: 'medium' }));
      await until(() => b.evaluate(() => window.__crossfire.silhouetteStats().last), 'Medium quality pipeline settles after rebuilding', 30000);
      check(await b.evaluate(() => window.__crossfire.silhouetteStats().last), 'returning to Medium retains sharp silhouettes');
      if (process.argv.includes('--quality-only')) continue;
      // Drive real, bounded WebSocket controller inputs and inspect actual groups/bones.
      // Fixture RPC only resets the real actor to a clear start between movements.
      async function drive(intent, ms, during) {
        await delay(80);
        const yaw = a.snapshot.players.find((p) => p.id === a.id).motion.yaw;
        let first = true;
        const send = () => {
          const self = a.snapshot.players.find((p) => p.id === a.id);
          // Keep at most a few unacknowledged frames on this co-hosted GPU/Worker
          // test machine. The production real-time queue limits stay unchanged.
          if (a.seq - self.ack > 8) return;
          a.send({ type: 'input', roundId: a.snapshot.roundId, mapVersion: a.snapshot.mapVersion,
            frames: Array.from({ length: 4 }, () => ({ seq: ++a.seq, yaw, pitch: 0,
              intent: { x: 0, z: 0, aim: false, slide: false, ...intent,
                jumpPressed: first ? (first = false, !!intent.jumpPressed) : false }, combat: { trigger: false, reload: false } })) });
        };
        send(); const timer = setInterval(send, 75);
        try { await Promise.all([delay(ms), during?.()]); }
        finally { clearInterval(timer); }
      }
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]]);
      const idle = await avatar(b, a.id);
      await delay(180);
      check((await avatar(b, a.id)).animation.starts === idle.animation.starts, 'idle animation is not restarted each frame');
      await drive({ z: -1 }, 650, async () => {
        await until(async () => (await avatar(b, a.id))?.animation.clip === 'RUN', 'actual remote run animation');
        const run = (await avatar(b, a.id)).animation;
        check((await avatar(b, d.id)).animation.clip === 'IDLE', 'running one player never drives another rig');
        await delay(100);
        check((await avatar(b, a.id)).animation.frame !== run.frame, 'run group advances actual animation frames');
        await b.screenshot({ path: `${out}/${mode}-run.png` });
      });
      await drive({}, 250);
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]]);
      const jumpMessages = a.messages.length;
      await drive({ jumpPressed: true }, 1200, async () => {
        await until(async () => (await avatar(b, a.id))?.animation.history.includes('JUMP_START'), 'real jump start');
        await until(async () => (await avatar(b, a.id))?.animation.clip === 'JUMP_LOOP', 'real airborne loop');
        check(a.messages.slice(jumpMessages).some((m) => m.snapshot?.players.some((p) => p.id === a.id && !p.motion.grounded && p.motion.position.y > .2)),
          'jump height comes from actual authoritative snapshots');
        await delay(120);
        await b.screenshot({ path: `${out}/${mode}-jump.png` });
        await until(async () => {
          const h = (await avatar(b, a.id))?.animation.history ?? [];
          return h.lastIndexOf('JUMP_LAND') > h.lastIndexOf('JUMP_START');
        }, 'real landing recovery');
      });
      const history = (await avatar(b, a.id)).animation.history;
      check(['JUMP_START', 'JUMP_LOOP', 'JUMP_LAND'].every((clip) => history.includes(clip)), 'real server jump plays start, airborne and landing clips');
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 6]], .8);
      await drive({ z: 1, slide: true }, 600, async () => {
        await until(async () => (await avatar(b, a.id))?.animation.clip === 'SLIDE', 'actual remote slide animation');
        await delay(150);
        const actor = await avatar(b, a.id);
        check(actor.animation.joints.head[1] - actor.y < 1.15, 'actual skinned slide lowers the head without compressing the model or moving the root');
        check(actor.outline, 'animated sliding silhouette keeps its depth-tested outline');
        await b.screenshot({ path: `${out}/${mode}-slide.png` });
      });
      await drive({}, 650);
      await until(async () => (await avatar(b, a.id))?.animation.clip === 'IDLE', 'slide returns to idle');
      // Verify normal frontend keyboard/network flow as well as deterministic
      // WebSocket controls, including the acknowledgement-based sending window.
      await place(a.id, [-1.4, 0, -1.7], [-3, 0, 2]);
      await arrange(b, d, [[-3, 0, -2], [-3, 0, 2]]);
      await d.evaluate(() => window.__crossfire.look(0, 0));
      const keyboardStarts = (await avatar(b, d.id)).animation.starts;
      await d.bringToFront();
      await d.keyboard.down('w');
      try { await delay(350); } finally { await d.keyboard.up('w'); }
      await until(async () => {
        const actor = await avatar(b, d.id);
        return actor?.animation.starts > keyboardStarts && actor.animation.history.includes('RUN');
      }, 'actual browser keyboard drives a remote run');
      check(await d.evaluate(() => window.__crossfire.network().state === 'connected' && !document.querySelector('#error.visible')),
        'real browser movement stays connected with the bounded sending window');
      await b.bringToFront();
      await arrange(b, a, [[-3, 0, -2], [-3, 0, 2]]);
      await place(d.id, [-1.4, 0, -1.7], [-3, 0, 2]);
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
      // All four real incoming directions, actual server damage/elimination only.
      const arena = await stub.directionalArenaForTest();
      for (const [side, arrow] of [['front', 0], ['left', -1], ['right', 1], ['behind', 1]]) {
        const source = arena.sources[side];
        await place(b.id, arena.center, arena.sources.front);
        await b.evaluate(() => window.__crossfire.look(0, 0));
        await place(a.id, source, arena.center); a.position = source; b.position = arena.center;
        await place(d.id, arena.observer, arena.center);
        await d.evaluate(() => window.__crossfire.look(-45, -6));
        await delay(240);
        await fireNode(a, b);
        await until(async () => (await b.evaluate(() => window.__crossfire.damageFeedback())).edges > .03, `${side} damage edges`);
        const feedback = await b.evaluate(() => window.__crossfire.damageFeedback());
        check(arrow === 0 ? feedback.arrow === 0 : feedback.arrow > 0 && feedback.direction === (arrow < 0 ? 'left' : 'right'),
          `${mode}: ${side} confirmed hit gives correct shortest-turn arrow`);
        await b.screenshot({ path: `${out}/${mode}-damage-${side}.png` });
        await delay(550);
        check((await b.evaluate(() => window.__crossfire.damageFeedback())).edges === 0, 'damage edges clear within half a second');
        await d.bringToFront();
        await d.evaluate((id) => {
          window.__deathSamples = [];
          window.__deathTimer = setInterval(() => {
            const a = window.__crossfire.network().rendered.find((p) => p.id === id);
            window.__deathSamples.push({ at: performance.now(), death: a?.death ?? null });
          }, 16);
        }, b.id);
        const result = await fireNode(a, b, true);
        check(result.shot.hits.some((h) => h.id === b.id && h.killed), `${side} real lethal shot`);
        // Capture a real intermediate pose if Chrome delivers the screenshot before completion.
        await until(async () => (await d.evaluate(() => window.__deathSamples)).some((s) => s.death), `${side} confirmed fall begins`);
        await d.screenshot({ path: `${out}/${mode}-death-${side}.png` });
        await delay(550);
        const samples = await d.evaluate(() => { clearInterval(window.__deathTimer); return window.__deathSamples; });
        const poses = samples.filter((s) => s.death), last = poses.at(-1);
        const firstGone = samples.find((s) => last && s.at > last.at && !s.death);
        const dir = result.shot.hits[0].direction;
        fs.writeFileSync(`${out}/${mode}-death-${side}.json`, JSON.stringify({ dir, samples }, null, 2));
        console.log(`${mode} ${side} death timing`, { poses: poses.length, first: poses[0]?.death, last: last?.death,
          duration: firstGone && firstGone.at - poses[0].at });
        check(poses.length >= 2 && poses.every((s) => s.death.fall.x * dir.x + s.death.fall.z * dir.z > .8)
          && poses.some((s) => s.death.alpha < .85 && s.death.tip > .3)
          && firstGone && firstGone.at - poses[0].at < 650,
          `${mode}: ${side} world-space fall fades and fully disposes in approximately 0.5s`);
        await b.waitForSelector('#start.visible .btn.primary:not(:disabled)');
        await b.click('#start .btn.primary');
        await b.waitForFunction(() => window.__crossfire.ready());
        await until(async () => (await avatar(d, b.id))?.source === 'glb' && !(await avatar(d, b.id)).death,
          'respawn restores normal character');
        check((await avatar(d, b.id)).animation.textures.every((t) => t.ready), 'respawn retains the original ready skin');
      }
      const beforeDispose = await b.evaluate(() => window.__crossfire.memory());
      const remainingBefore = (await avatar(b, a.id)).animation;
      const poseTextures = (await avatar(b, d.id)).animation.poseTextures;
      await d.evaluate(() => window.__crossfire.networkLeave());
      await until(async () => !(await state(b)).rendered.some((p) => p.id === d.id), 'disconnected tag/body removal');
      check(true, 'disconnected players leave no name tag or duplicate body');
      check((await state(b)).rendered.length === 1 && (await avatar(b, a.id)).source === 'glb', 'disconnection disposes one rig and preserves the remaining character');
      const afterDispose = await b.evaluate(() => window.__crossfire.memory());
      const remainingAfter = (await avatar(b, a.id)).animation;
      const textureIds = await b.evaluate(() => window.__crossfire.sceneTextureIds());
      console.log(`${mode} rig disposal`, { skeletons: [beforeDispose.skeletons, afterDispose.skeletons],
        groups: [beforeDispose.animationGroups, afterDispose.animationGroups], privatePoseTextures: poseTextures.length });
      check(afterDispose.skeletons === beforeDispose.skeletons - 1 && afterDispose.animationGroups === beforeDispose.animationGroups - 6
        && poseTextures.every((id) => !textureIds.includes(id))
        && JSON.stringify(remainingBefore.geometry) === JSON.stringify(remainingAfter.geometry)
        && JSON.stringify(remainingBefore.materials) === JSON.stringify(remainingAfter.materials)
        && JSON.stringify(remainingBefore.textures) === JSON.stringify(remainingAfter.textures)
        && remainingAfter.textures.every((t) => t.ready), 'disconnection frees the actual rig/groups/private GPU pose textures and preserves shared assets');
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
              state: window.__crossfire.state(), loading: window.__crossfire.loadingState(), spawn: document.querySelector('#start .btn.primary')?.textContent,
              roster: n.snapshot?.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, health: p.health, ammo: p.combat.gun?.ammo, trigger: p.combat.triggerHeld })),
              rendered: n.rendered.map((p) => ({ id: p.id, z: p.z, animation: p.animation?.clip, history: p.animation?.history })),
              mouseEvents: window.testMouseEvents,
              silhouettes: window.__crossfire.silhouetteStats(),
              mouseTarget: document.elementFromPoint(640, 360)?.outerHTML.slice(0, 180) };
          }));
          await page.screenshot({ path: `${out}/${mode}-failure-${page.id}.png` });
        } catch {}
      }
      for (const c of sockets) console.log('Actual server shot/error diagnostics', c.messages.filter((m) => m.type === 'shot' || m.type === 'error').slice(-6));
      throw error;
    } finally {
      for (const c of sockets) { clearInterval(c.timer); c.ws.terminate(); }
      for (const c of contexts) await c.close();
      stub[Symbol.dispose]?.(); await fixture.dispose();
    }
  }
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); }
