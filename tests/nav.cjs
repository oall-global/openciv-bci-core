// Open a page from the left column: every page is named there.
async function go(page, name) {
  await setUp(page);
  if (name === '数据') name = '脑电数据库';
  await page.locator('.sb .sb-nav').getByRole('button', { name, exact: true }).click();
}

// A fresh profile shows only 设备 (no sidebar) until a device has been connected once: tests that
// navigate before connecting start as a user who has connected a device before.
async function setUp(page) {
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !!window.neuro);
  const onboarded = await page.evaluate(async () => (await window.neuro.preferences()).onboarded);
  if (onboarded) return page.getByRole('button', { name: '开源文明 BCI-001 首页' }).waitFor();
  await page.evaluate(() => window.neuro.preferences({ onboarded: true }));
  await page.reload();
  await page.getByRole('button', { name: '开源文明 BCI-001 首页' }).waitFor();
}

module.exports = { go, setUp };
