import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type()==='error' || m.type()==='warn') console.log(m.type(), m.text().slice(0,200)); });
await page.goto('http://localhost:5173/?autoplay&nohud', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
for (const mat of process.argv.slice(2)) {
  const info = await page.evaluate((m) => window.__crossfire.inspectBatch(m), mat);
  console.log(mat, JSON.stringify(info.slice(0, 3)));
}
await browser.close();
