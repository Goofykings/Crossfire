// Dev helper: node tools/dev-map-load.mjs <map> [url] -- loads a map in local practice mode and prints
// console errors, failed or pending requests, the loading label and visible text until it is ready.
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const map = process.argv[2] ?? 'european-town';
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5173/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 600)));
  const pending = new Map();
  page.on('request', (r) => pending.set(r, r.url()));
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => { console.log('FAILED', r.url(), r.failure()?.errorText); pending.delete(r); });
  page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
  const t0 = Date.now();
  await page.goto(`${base}?practice&autoplay&nohud&map=${map}`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page, 'Debug');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await page.evaluate(() => ({ state: window.__crossfire?.state?.(), ready: window.__crossfire?.ready?.(),
      status: document.querySelector('.loading-status')?.textContent }));
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
    if (s.ready) break;
    if (i >= 4) {
      console.log('PENDING', [...pending.values()].filter((u) => !u.startsWith('data:')).slice(0, 10));
      console.log('TEXT', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600));
      break;
    }
  }
} finally { await browser.close(); }
