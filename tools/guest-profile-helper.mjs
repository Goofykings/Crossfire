/** Complete the real first-visit UI rather than bypassing it in browser tools. */
export async function completeGuestProfile(page, username = 'Test Guest') {
  await page.waitForFunction(() => window.__crossfire && document.querySelector('#guest-profile'), { timeout: 240000 });
  if (await page.$('#guest-profile[open]')) {
    await page.type('#guest-username', username);
    await page.click('#guest-profile button');
    await page.waitForFunction(() => !document.querySelector('#guest-profile')?.open);
  }
}
