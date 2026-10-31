/** Run against Vite configured with custom provider: missing or scaffold mode. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5175/';
const mode = process.argv[3] ?? 'missing';
assert.ok(['missing', 'scaffold'].includes(mode));
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((testMode) => {
    const OriginalSocket = window.WebSocket, originalFetch = window.fetch;
    window.__backendRequests = { sockets: [], cloudflareFetches: [] };
    window.WebSocket = class extends OriginalSocket {
      constructor(url, protocols) {
        if (new URL(String(url), location.href).pathname === '/ws') {
          window.__backendRequests.sockets.push(String(url));
          if (testMode === 'missing') throw new Error('Unexpected socket for invalid configuration');
        }
        super(url, protocols);
      }
    };
    window.fetch = (input, init) => {
      const url = new URL(String(input), location.href);
      if (url.hostname.endsWith('.workers.dev')) {
        window.__backendRequests.cloudflareFetches.push(url.origin);
        return Promise.reject(new Error('Unexpected Cloudflare request'));
      }
      return originalFetch(input, init);
    };
  }, mode);
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await completeGuestProfile(page, 'Config Test');
  await page.waitForSelector('#menu.visible .home-actions .primary', { timeout: 120000 });
  await page.click('#menu .home-actions .primary');
  await page.waitForSelector('#error.visible', { timeout: 30000 });
  const message = await page.$eval('#error p', (el) => el.textContent);
  const requests = await page.evaluate(() => window.__backendRequests);
  if (mode === 'missing') {
    assert.match(message, /VITE_CUSTOM_MULTIPLAYER_URL/);
    assert.deepEqual(requests.sockets, []);
  } else {
    assert.match(message, /incomplete/i);
    assert.equal(requests.sockets.length, 1);
    assert.equal(new URL(requests.sockets[0]).host, '127.0.0.1:8788');
  }
  assert.deepEqual(requests.cloudflareFetches, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.$eval('#error .menu-buttons', (el) => !el.hidden && el.children.length === 2), true);
  console.log(`PASS ${mode}: clear error, Retry/Back, no Cloudflare fallback`);
} finally { await browser.close(); }
