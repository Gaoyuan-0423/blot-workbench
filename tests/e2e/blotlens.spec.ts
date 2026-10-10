import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openReviewer(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '截图趋势核对', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入核对截图', exact: true })).toBeEnabled();
  return page.frameLocator('iframe[title="BlotLens 截图趋势核对"]');
}

test('embedded analysis survives navigation and exports a reloadable separate file', async ({ page }) => {
  const child = await openReviewer(page);
  await child.getByRole('button', { name: '先试试合成示例' }).click();
  await expect(child.locator('#measurements tbody tr')).toHaveCount(15);
  const values = await child.locator('#measurements tbody').innerText();
  await child.getByLabel('预览对比度', { exact: true }).fill('150');
  await page.getByRole('button', { name: '项目总览', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(8);
  await expect(page.locator('iframe')).toBeHidden();
  await page.getByRole('button', { name: '截图趋势核对', exact: true }).click();
  await expect(child.getByLabel('预览对比度', { exact: true })).toHaveValue('150');
  expect(await child.locator('#measurements tbody').innerText()).toBe(values);
  await child.getByRole('button', { name: '导出', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await child.getByRole('button', { name: '可复算分析文件 JSON', exact: true }).click();
  const file = await downloading;
  const bytes = await readFile((await file.path())!);
  const saved = JSON.parse(bytes.toString());
  expect(saved.source.dataUrl).toMatch(/^data:image\/png/);
  // Load through the child's normal analysis-file input, not the experiment archive input.
  await child.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: bytes });
  await expect(child.locator('#measurements tbody tr')).toHaveCount(15);
  expect(await child.locator('#measurements tbody').innerText()).toBe(values);
});

test('host imports original pixels without calling AI; invalid and untrusted imports are rejected', async ({ page }) => {
  let calls = 0;
  page.on('request', r => { if (r.url().endsWith('/api/recognize')) calls++; });
  const child = await openReviewer(page);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 120, 80);
    ctx.fillStyle = '#222222'; ctx.fillRect(20, 30, 40, 12);
    return canvas.toDataURL();
  });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  await page.getByLabel('导入工作台核对截图').setInputFiles({ name: 'host-source.png', mimeType: 'image/png', buffer: bytes });
  await expect(child.getByRole('heading', { name: 'host-source.png', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '截图已载入' })).toBeVisible();
  await expect(child.getByText('120 × 80 px')).toBeVisible();
  expect(calls).toBe(0);
  await page.getByLabel('导入工作台核对截图').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('status').filter({ hasText: '请选择不超过' })).toBeVisible();
  // A same-origin sender other than the direct parent must not replace the image.
  const embedded = page.frames().find(f => f.url().includes('/blotlens/index.html'))!;
  await embedded.evaluate(async (dataUrl) => {
    const bytes = await (await fetch(dataUrl)).arrayBuffer();
    window.postMessage({ type: 'blotlens:import-image', version: 1, requestId: 'spoof', name: 'spoof.png', mimeType: 'image/png', bytes }, location.origin);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, dataUrl);
  await expect(child.getByRole('heading', { name: 'host-source.png', exact: true })).toBeVisible();
  await child.getByRole('button', { name: '自动识别', exact: true }).click();
  await expect(child.getByText(/静态.*本机|本机.*服务/).first()).toBeVisible();
  expect(calls).toBe(0);
});
