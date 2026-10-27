/**
 * Settings menu test: drives the real UI (mouse and keyboard) in headless Chrome.
 *
 *   node tools/settings-test.mjs [--url http://localhost:5173/] [--out test-results/settings]
 *
 * Covers the theme (no native selects, no light backgrounds), categories keeping draft edits, Apply / Back semantics,
 * persistence across a reload, and both entry points (main menu and pause menu). Exit code is non-zero on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt('url', 'http://localhost:5173/');
const OUT = opt('out', 'test-results/settings');
fs.mkdirSync(OUT, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .filter(Boolean)
  .find((p) => fs.existsSync(p));

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  defaultViewport: { width: 1600, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl'],
});
const errors = [];
const KEY = 'crossfire.settings.v1';

async function open(query = '') {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}${query ? query + '&practice' : '?practice'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__crossfire, { timeout: 120000 });
  return page;
}
const applied = (page) => page.evaluate(() => window.__crossfire.settings());
const live = (page) => page.evaluate(() => window.__crossfire.live());
const stored = (page, key = KEY) => page.evaluate((k) => localStorage.getItem(k), key);
const screenVisible = (page, id) => page.evaluate((i) => getComputedStyle(document.getElementById(i)).display !== 'none', id);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const footButton = (page, label) =>
  page.evaluateHandle((l) => [...document.querySelectorAll('#settings .settings-foot .btn')].find((b) => b.textContent.trim() === l), label);
const clickFoot = async (page, label) => (await footButton(page, label)).asElement().click();
const applyEnabled = (page) => page.$eval('#settings .btn.primary', (b) => b.getAttribute('aria-disabled') !== 'true');
const pillVisible = (page) => page.$eval('#settings .pill', (e) => !e.hidden);
const sliderValue = (page, id) => page.$eval(id, (e) => Number(e.value));
const dropdownText = (page, id) => text(page, id);
const luminance = (rgb) => {
  const m = rgb.match(/[\d.]+/g).map(Number);
  return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
};

try {
  // ---------------------------------------------------------------- main menu entry
  let page = await open();
  await page.waitForFunction(() => window.__crossfire && document.querySelector('#menu.visible'), { timeout: 180000, polling: 500 });
  const start = await applied(page);
  check(start.fov === 90 && start.masterVolume === 0.7 && start.shadowQuality === 'medium', `defaults loaded (fov ${start.fov}, volume ${start.masterVolume}, shadows ${start.shadowQuality})`);
  check((await stored(page)) === null, 'nothing is saved just by starting the game');

  const buttons = await page.$$('.home-header .home-nav .btn');
  await buttons[buttons.length - 1].click(); // Settings
  await wait(250);
  check(await screenVisible(page, 'settings'), 'Settings opens from the main menu');
  check((await stored(page)) === null, 'opening Settings does not write to localStorage');
  check(!(await applyEnabled(page)) && !(await pillVisible(page)), 'Apply is inactive and no "unapplied" marker while nothing is edited');
  await page.screenshot({ path: path.join(OUT, '1_gameplay.png') });

  // theme: no native controls, nothing light
  const theme = await page.evaluate(() => {
    const lum = (rgb) => {
      const m = rgb.match(/[\d.]+/g).map(Number);
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    };
    const out = { nativeSelects: document.querySelectorAll('#settings select').length };
    const sw = document.querySelector('#set-invertY');
    out.switchAppearance = getComputedStyle(sw).appearance;
    out.rangeAppearance = getComputedStyle(document.querySelector('#set-fov')).appearance;
    out.fonts = new Set([...document.querySelectorAll('#settings *')].map((e) => getComputedStyle(e).fontFamily.split(',')[0])).size;
    // no visible element may have a light, neutral (white/grey) opaque background; accent-coloured dots are fine
    out.lightBackgrounds = [...document.querySelectorAll('#settings *')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => getComputedStyle(e).backgroundColor.match(/[\d.]+/g).map(Number))
      .filter(([r, g, b, a = 1]) => a >= 0.5 && lum(`rgb(${r}, ${g}, ${b})`) > 0.35 && Math.max(r, g, b) - Math.min(r, g, b) < 40).length;
    return out;
  });
  check(theme.nativeSelects === 0, 'no native <select> in the settings menu');
  check(theme.switchAppearance === 'none' && theme.rangeAppearance === 'none', 'switches and sliders use custom styling (appearance: none)');
  check(theme.lightBackgrounds === 0, `no light/white control backgrounds (${theme.lightBackgrounds} found)`);

  // ---------------------------------------------------------------- the example from the brief
  // Gameplay: FOV 90 -> 95 (mouse-free: keyboard on the slider)
  await page.focus('#set-fov');
  await page.keyboard.press('Home'); // 70
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight'); // 95
  check((await sliderValue(page, '#set-fov')) === 95 && (await text(page, '#set-fov + output')) === '95°', 'FOV slider shows the draft value (95°)');
  // Sound: volume 70% -> 30%
  await page.click('#tab-sound');
  await page.focus('#set-masterVolume');
  await page.keyboard.press('Home'); // 0
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // 30%
  // Graphics: shadows -> Low (mouse on the custom dropdown)
  await page.click('#tab-graphics');
  await page.click('#set-shadowQuality');
  check(await page.$eval('#set-shadowQuality', (b) => b.getAttribute('aria-expanded') === 'true'), 'dropdown opens on click');
  await page.screenshot({ path: path.join(OUT, '2_dropdown_open.png') });
  const listTheme = await page.$eval('.dropdown.open .dropdown-list', (l) => getComputedStyle(l).backgroundColor);
  check(luminance(listTheme) < 0.2, `dropdown list is dark (${listTheme})`);
  await page.click('.dropdown.open .dropdown-option[data-value="low"]');
  check((await dropdownText(page, '#set-shadowQuality')) === 'Low', 'dropdown option chosen with the mouse');

  const mid = await applied(page);
  const midLive = await live(page);
  check(mid.fov === 90 && mid.masterVolume === 0.7 && mid.shadowQuality === 'medium', 'applied settings are untouched while editing');
  check(midLive.volume === 0.7, `the audio system still runs at the applied volume (${midLive.volume})`);
  check((await stored(page)) === null, 'nothing is saved while editing');
  check((await applyEnabled(page)) && (await pillVisible(page)), 'Apply becomes active and the "unapplied changes" marker appears');
  const dots = await page.$$eval('.tab.changed', (t) => t.map((x) => x.id));
  check(dots.length === 3, `all three tabs are flagged as changed (${dots.join(', ')})`);
  await page.screenshot({ path: path.join(OUT, '3_graphics_dirty.png') });

  // switching categories keeps the edits
  await page.click('#tab-gameplay');
  check((await sliderValue(page, '#set-fov')) === 95, 'switching categories keeps the FOV edit');
  await page.click('#tab-sound');
  check((await sliderValue(page, '#set-masterVolume')) === 0.3, 'switching categories keeps the volume edit');
  await page.click('#tab-graphics');
  check((await dropdownText(page, '#set-shadowQuality')) === 'Low', 'switching categories keeps the shadow edit');

  // Back discards
  await clickFoot(page, 'Back');
  await wait(200);
  check(!(await screenVisible(page, 'settings')) && (await screenVisible(page, 'menu')), 'Back returns to the main menu');
  const afterBack = await applied(page);
  check(afterBack.fov === 90 && afterBack.masterVolume === 0.7 && afterBack.shadowQuality === 'medium', 'Back: nothing was applied');
  check((await stored(page)) === null, 'Back: nothing was saved');
  await (await page.$$('.home-header .home-nav .btn')).at(-1).click();
  await wait(200);
  check(
    (await sliderValue(page, '#set-fov')) === 90 && !(await applyEnabled(page)) && !(await pillVisible(page)),
    'reopening Settings shows the applied values again (FOV 90) and no pending changes',
  );
  await page.click('#tab-sound');
  check((await sliderValue(page, '#set-masterVolume')) === 0.7, 'volume control shows the applied 70%');
  await page.click('#tab-graphics');
  check((await dropdownText(page, '#set-shadowQuality')) === 'Medium', 'shadow dropdown shows the applied Medium');

  // ---------------------------------------------------------------- keyboard-only edit, then Apply
  await page.click('#tab-gameplay');
  await page.focus('#tab-gameplay');
  await page.keyboard.press('ArrowDown'); // roving tab: Sound
  check(await page.$eval('#tab-sound', (t) => t.getAttribute('aria-selected') === 'true' && document.activeElement === t), 'arrow keys move between category tabs');
  await page.keyboard.press('ArrowDown'); // Graphics
  await page.keyboard.press('ArrowUp'); // back to Sound
  await page.keyboard.press('Home'); // Gameplay
  await page.focus('#set-fov');
  await page.keyboard.press('Home');
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight'); // 95
  await page.click('#tab-sound');
  await page.focus('#set-masterVolume');
  await page.keyboard.press('Home');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight'); // 30%
  await page.click('#tab-graphics');
  await page.focus('#set-shadowQuality');
  await page.keyboard.press('Enter'); // open
  await page.keyboard.press('ArrowDown'); // Medium -> High
  await page.keyboard.press('ArrowUp'); // -> Medium
  await page.keyboard.press('ArrowUp'); // -> Low
  await page.keyboard.press('Enter'); // choose
  check((await dropdownText(page, '#set-shadowQuality')) === 'Low', 'dropdown works from the keyboard (Enter, arrows, Enter)');
  // a switch toggles with Space and shows its state
  await page.focus('#set-showFps');
  const fpsBefore = await text(page, '#set-showFps ~ output');
  await page.keyboard.press('Space');
  check((await text(page, '#set-showFps ~ output')) !== fpsBefore, 'switch toggles with the Space key');
  await page.keyboard.press('Space'); // back to the applied state
  // Escape closes an open dropdown without leaving the screen
  await page.focus('#set-graphicsQuality');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  check((await screenVisible(page, 'settings')) && (await page.$eval('#set-graphicsQuality', (b) => b.getAttribute('aria-expanded') === 'false')), 'Escape closes an open dropdown only');
  await page.screenshot({ path: path.join(OUT, '4_before_apply.png') });

  await clickFoot(page, 'Apply');
  await wait(250);
  const after = await applied(page);
  const afterLive = await live(page);
  check(after.fov === 95 && after.masterVolume === 0.3 && after.shadowQuality === 'low', `Apply updates the applied settings (fov ${after.fov}, volume ${after.masterVolume}, shadows ${after.shadowQuality})`);
  check(Math.abs(afterLive.volume - 0.3) < 1e-9, `Apply reaches the audio system (${afterLive.volume})`);
  const saved = JSON.parse(await stored(page));
  check(saved.fov === 95 && saved.masterVolume === 0.3 && saved.shadowQuality === 'low', 'Apply saves the values to localStorage');
  check(await screenVisible(page, 'settings'), 'the menu stays open after Apply');
  check(!(await applyEnabled(page)) && !(await pillVisible(page)), 'Apply goes inactive again and the marker disappears');
  check((await text(page, '.settings-status')).startsWith('Applied'), `confirmation shown ("${await text(page, '.settings-status')}")`);
  await page.screenshot({ path: path.join(OUT, '5_applied.png') });

  // further edits are uncommitted again
  await page.click('#tab-gameplay');
  await page.focus('#set-fov');
  await page.keyboard.press('ArrowLeft');
  check((await applyEnabled(page)) && (await applied(page)).fov === 95, 'a new edit after Apply is a draft again (not applied)');
  check(JSON.parse(await stored(page)).fov === 95, 'and is not saved');
  await page.keyboard.press('Escape'); // Esc = Back
  await wait(200);
  check(!(await screenVisible(page, 'settings')) && (await applied(page)).fov === 95, 'Escape acts as Back and discards the draft');
  await page.close();

  // ---------------------------------------------------------------- refresh restores saved settings
  page = await open();
  const reloaded = await applied(page);
  check(reloaded.fov === 95 && reloaded.masterVolume === 0.3 && reloaded.shadowQuality === 'low', 'after a refresh the saved settings are restored');
  await page.waitForFunction(() => window.__crossfire && document.querySelector('#menu.visible'), { timeout: 180000, polling: 500 });
  await (await page.$$('.home-header .home-nav .btn')).at(-1).click();
  await wait(200);
  check((await sliderValue(page, '#set-fov')) === 95 && !(await applyEnabled(page)), 'the menu shows the restored values');
  await page.close();

  // ---------------------------------------------------------------- pause menu entry (keeps the saved profile)
  page = await open('?autoplay');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 240000, polling: 500 });
  await page.evaluate(() => window.__crossfire.pause());
  await wait(300);
  check(await screenVisible(page, 'pause'), 'pause menu is showing');
  await page.click('#pause .menu-buttons > .btn:nth-child(2)');
  await wait(250);
  check(await screenVisible(page, 'settings'), 'Settings opens from the pause menu');
  check((await sliderValue(page, '#set-fov')) === 95, 'pause-menu Settings shows the applied values');
  const fovLiveBefore = (await live(page)).fovDeg;
  await page.focus('#set-fov');
  await page.keyboard.press('End'); // 110
  await wait(300);
  check(Math.abs((await live(page)).fovDeg - fovLiveBefore) < 0.01, 'the live field of view does not change before Apply');
  await clickFoot(page, 'Back');
  await wait(200);
  check(await screenVisible(page, 'pause'), 'Back returns to the pause menu');
  check((await applied(page)).fov === 95 && JSON.parse(await stored(page)).fov === 95, 'pause menu Back discards the edit');
  await page.click('#pause .menu-buttons > .btn:nth-child(2)');
  await wait(250);
  await page.focus('#set-fov');
  await page.keyboard.press('End');
  await clickFoot(page, 'Apply');
  await wait(400);
  const pausedLive = await live(page);
  check((await applied(page)).fov === 110 && Math.abs(pausedLive.fovDeg - 110) < 0.01, `Apply from the pause menu changes the live field of view (${pausedLive.fovDeg.toFixed(1)}°)`);
  check(JSON.parse(await stored(page)).fov === 110, 'and saves it');
  // FPS counter (Graphics) applied live
  await page.click('#tab-graphics');
  await page.click('#set-showFps');
  check((await live(page)).fpsVisible !== undefined && (await applied(page)).showFps === true, 'FPS switch edit is a draft until Apply');
  await clickFoot(page, 'Apply');
  await wait(300);
  check((await applied(page)).showFps === false && (await live(page)).fpsVisible === false, 'Apply hides the FPS counter live');
  await page.close();

  // ---------------------------------------------------------------- corrupted storage falls back to defaults
  page = await open();
  await page.evaluate((k) => localStorage.setItem(k, '{"fov":9999,"shadowQuality":"ultra","masterVolume":"loud"}'), KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__crossfire, { timeout: 120000 });
  const fixed = await applied(page);
  check(fixed.fov === 110 && fixed.shadowQuality === 'medium' && fixed.masterVolume === 0.7, 'invalid saved values are clamped or replaced by defaults');
  await page.close();

  check(errors.length === 0, `no console errors (${errors.length})`);
  for (const e of errors.slice(0, 8)) console.log('   ', e.slice(0, 300));
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall settings checks passed');
