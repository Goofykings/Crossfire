// Dev helper: mirror sphere above the plaza, camera north of it looking south.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 800, height: 600 }, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('http://localhost:5173/?autoplay&nohud&quality=low&shadows=off', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__crossfire.mirrorSphere(0, 30, 0); window.__crossfire.freeCam(-1.09, 30, 3.0, 20, 0); });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: process.argv[2] });
await browser.close();
