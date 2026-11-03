/** Third-person character performance in real Chrome (home preview scene, no map):
 * 1, 3 and 6 armed characters in mixed states (ADS, walking, firing, reload).
 *   node tools/character-perf-test.mjs [vite url] [--throttle 4]
 * --throttle applies DevTools CPU throttling (an approximation of a low-end CPU, not a real
 * device measurement). Uncapped frame rate flags as in perf-test.mjs. Writes
 * test-results/character-perf-browser.json. */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4199/';
const throttle = Number(args[args.indexOf('--throttle') + 1] ?? 0) || (args.includes('--throttle') ? 4 : 1);
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 600000,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit',
    '--enable-precise-memory-info'] });
const results = [];
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => localStorage.setItem('crossfire.guest.v1',
    JSON.stringify({ guestId: '76a876f1-7a6e-499f-8d03-568b68c889e3', username: 'Perf Probe' })));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const session = await page.createCDPSession();
  if (throttle > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  for (const count of [1, 3, 6]) {
    await page.waitForFunction(() => window.__crossfire?.homeCharacter().weapon, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 1500));
    const result = await page.evaluate((n) => window.__crossfire.characterPerf(n, 300), count);
    if (!result) throw new Error(`characterPerf(${count}) returned nothing`);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.mkdirSync('test-results', { recursive: true });
  const file = `test-results/character-perf-browser${throttle > 1 ? `-throttle${throttle}` : ''}.json`;
  fs.writeFileSync(file, JSON.stringify({ gpu, cpuThrottle: throttle, results }, null, 2));
  console.log('GPU', gpu, 'CPU throttle', throttle, 'wrote', file);
  if (errors.length) { console.error(errors); process.exitCode = 1; }
} finally { await browser.close(); }
