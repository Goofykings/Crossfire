import { completeGuestProfile } from './guest-profile-helper.mjs';
/** Capture the existing Town plaza at eye level; no geometry or generated map assets are changed.
 * Start Vite, then: node tools/capture-home-background.mjs --url http://127.0.0.1:5180/
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const index = process.argv.indexOf('--url');
const base = index < 0 ? 'http://127.0.0.1:5180/' : process.argv[index + 1];
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1600, height: 900 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage();
  await page.goto(`${base}?practice&autoplay&nohud&map=european-town&quality=high`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page);
  await page.waitForFunction(() => window.__crossfire?.ready(), { timeout: 240000 });
  // This map has a well, not a fountain. Frame the actual landmark and surrounding facades.
  await page.evaluate(() => window.__crossfire.freeCam(-3.7, 1.9, 2.8, 54, 0));
  await new Promise((resolve) => setTimeout(resolve, 4500));
  const missing = await page.evaluate(() => window.__crossfire.stats().missingMaterials);
  if (missing.length) throw new Error(`Missing map materials: ${missing.join(', ')}`);
  fs.mkdirSync('public/assets/ui', { recursive: true });
  await page.screenshot({ path: 'public/assets/ui/town-plaza.webp', type: 'webp', quality: 68 });
  console.log('Captured public/assets/ui/town-plaza.webp from the existing Town map at 1600x900.');
} finally { await browser.close(); }
