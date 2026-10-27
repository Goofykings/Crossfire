import { completeGuestProfile } from './guest-profile-helper.mjs';
// Dev helper: node tools/dev-shot.mjs "<query>" x,y,z,heading,pitch out.png
import puppeteer from 'puppeteer-core';
const [query, cam, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 }, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300)); });
await page.goto(`http://localhost:5173/?autoplay&nohud&${query}`, { waitUntil: 'domcontentloaded' });
await completeGuestProfile(page);
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
const v = cam.split(',').map(Number);
await page.evaluate((v) => window.__crossfire.teleport(v[0], v[1], v[2], v[3], v[4]), v);
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: out });
console.log('saved', out, JSON.stringify(await page.evaluate(() => window.__crossfire.stats())).slice(0, 200));
await browser.close();
