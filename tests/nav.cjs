// Open a page from the left column: every page is named there.
async function go(page, name) {
  await setUp(page);
  if (name === '数据') name = '脑电数据库';
  await page.locator('.sb .sb-nav').getByRole('button', { name, exact: true }).click();
}

// The window waits for the preferences; tests that navigate before connecting start as a user
// who has connected a device before (a fresh profile opens on 设备).
async function setUp(page) {
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !!window.neuro);
  await page.getByRole('button', { name: '开源文明 BCI-001 首页' }).waitFor();
  const onboarded = await page.evaluate(async () => (await window.neuro.preferences()).onboarded);
  if (onboarded) return;
  await page.evaluate(() => window.neuro.preferences({ onboarded: true }));
  await page.reload();
  await page.getByRole('button', { name: '开源文明 BCI-001 首页' }).waitFor();
}

module.exports = { go, setUp };
