// Dev helper: screenshots of the sky at the sun's elevation for each heading (analyse with Python).
import puppeteer from 'puppeteer-core';
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 480, height: 270 }, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('http://localhost:5173/?autoplay&nohud&quality=low&shadows=off', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
for (let h = 0; h < 360; h += 15) {
  await page.evaluate((h) => window.__crossfire.freeCam(0, 60, 0, h, 48), h);
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `${out}/h${String(h).padStart(3, '0')}.png` });
}
await browser.close();
