// Dev helper: node tools/dev-freecam.mjs x,y,z,heading,pitch out.png [query]
import puppeteer from 'puppeteer-core';
const [cam, out, query = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 }, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(`http://localhost:5173/?autoplay&nohud&${query}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
const v = cam.split(',').map(Number);
await page.evaluate((v) => window.__crossfire.freeCam(...v), v);
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: out });
await browser.close();
