/** Verify the actual preview and its public metadata under a supplied Vite base URL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((path) => fs.existsSync(path));
assert.ok(executablePath, 'Chrome or Edge is required');
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 120000,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage(), responses = new Map(), errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => responses.set(response.url(), response.status()));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await completeGuestProfile(page, 'Preview Tester');
  await page.waitForFunction(() => window.__crossfire?.homeCharacter().ready && window.__crossfire.homeCharacter().weapon, { timeout: 120000 });
  const preview = await page.evaluate(() => window.__crossfire.homeCharacter());
  assert.equal(preview.skin, 'assets/characters/player.glb');
  assert.equal(preview.character.clip, 'IDLE');
  for (const asset of ['assets/characters/player.json', 'assets/characters/player.glb']) {
    const url = new URL(asset, base).href;
    assert.equal(responses.get(url), 200, `${url} is served successfully`);
  }
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS ${base}: metadata, GLB and animated home preview`);
} finally { await browser.close(); }
