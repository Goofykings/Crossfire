// Dev helper: capture the menu, settings, start card and HUD screens.
//   node tools/dev-ui-shots.mjs [outDir] [width] [height]
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? 'test-results';
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 900);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width, height },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('ERR', m.text().slice(0, 200)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('.status-line')?.textContent?.startsWith('Ready'), { timeout: 180000, polling: 500 });
await wait(1500);
await page.screenshot({ path: `${out}/ui_menu_${width}.png` });
await page.click('#menu .btn:nth-of-type(2)'); // map list
await wait(300);
await page.screenshot({ path: `${out}/ui_maps_${width}.png` });
const buttons = await page.$$('#menu .menu-buttons > .btn');
await buttons[buttons.length - 1].click(); // settings
await wait(400);
await page.screenshot({ path: `${out}/ui_settings_${width}.png` });
await page.click('#settings .settings-actions .btn.primary'); // back
await wait(200);
await page.click('#menu .btn.primary'); // play
await wait(800);
await page.screenshot({ path: `${out}/ui_start_${width}.png` });

// HUD in autoplay mode
await page.goto('http://localhost:5173/?autoplay&cam=-12,0,-3,95,0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
await wait(1500);
await page.screenshot({ path: `${out}/ui_hud_${width}.png` });
// fire at a wall for impact decals, then aim down sights
await page.evaluate(() => window.__crossfire.teleport(-9, 0, -8, 0, 4));
await wait(300);
await page.evaluate(() => window.__crossfire.hold('fire', true));
await wait(650);
await page.evaluate(() => window.__crossfire.hold('fire', false));
await wait(30);
await page.screenshot({ path: `${out}/ui_fire_${width}.png` });
await page.evaluate(() => window.__crossfire.hold('aim', true));
await wait(500);
await page.screenshot({ path: `${out}/ui_ads_${width}.png` });
await page.evaluate(() => window.__crossfire.hold('aim', false));
// inside the safe zone
await page.evaluate(() => window.__crossfire.teleport(-29, 0, -1, 90, 0));
await wait(800);
await page.screenshot({ path: `${out}/ui_safezone_${width}.png` });
await browser.close();
console.log('ui screenshots written to', out);
