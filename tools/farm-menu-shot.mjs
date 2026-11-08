/** Screenshots the Practice setup and the private-room create screen with all four maps (real Chrome).
 *   node tools/farm-menu-shot.mjs [http://127.0.0.1:5181/]   -> test-results/farm/menu-*.png */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
fs.mkdirSync('test-results/farm', { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await page.goto(`${base}?quality=low&nohud`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Menu Shot');
const visible = (selector) => page.waitForSelector(selector + '.visible', { timeout: 60000 });
const clickText = (root, label) => page.evaluate(({ root, label }) => {
  const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
  if (!b) throw Error('Missing ' + label); b.click();
}, { root, label });
await page.click('#menu .home-actions .primary'); await visible('#modes');
await clickText('#modes', 'Practice'); await visible('#practice-setup');
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'test-results/farm/menu-practice.png' });
const maps = await page.$$eval('#practice-setup .room-map', (n) => n.map((b) => [b.dataset.map, b.textContent.trim(), Math.round(b.getBoundingClientRect().width)]));
console.log(JSON.stringify(maps));
await browser.close();
