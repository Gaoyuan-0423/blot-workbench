import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createQuickExample, createQuickReferenceExample } from '../../src/quick/image';
import { importSingleProject } from '../../src/cloud-project';

// Explicit opt-in only: actual local Vite + PocketBase, synthetic accounts/data, no mocks.
test.skip(process.env.WISPLAB_LIVE_CLOUD !== '1', 'Set WISPLAB_LIVE_CLOUD=1 with dev UI :5173 and isolated cloud :8090 explicitly started with WISPLAB_PROJECT_STORAGE=cloud.');
test.setTimeout(180_000);
const dev = 'http://127.0.0.1:5173/?mode=single&lang=zh&cloudApi=local';
const cloud = (page: Page) => page.locator('wisplab-platform');
const button = (page: Page, name: RegExp) => cloud(page).getByRole('button', { name });
const password = 'synthetic-only-password-2026';
const source = createQuickExample();
const source2 = createQuickReferenceExample();
const file = (image: typeof source, name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from(image.original!.bytes) });

async function localPackage(page: Page) {
  await button(page, /^(本地项目|Local project)$/).click();
  const download = page.waitForEvent('download');
  await button(page, /^(下载当前项目|Download current project)$/).click();
  const downloaded = await download;
  const bytes = await readFile((await downloaded.path())!);
  await button(page, /^(返回分析 ×|Back to analysis ×)$/).click();
  return { bytes, project: (await importSingleProject(new Blob([bytes]))).project, filename: downloaded.suggestedFilename() };
}

async function signIn(page: Page, username: string, register: boolean) {
  await button(page, /^(登录 \/ 注册|Sign in \/ Register)$/).click();
  if (register) await button(page, /^(还没有账号？创建账号|New here\? Create an account)$/).click();
  await cloud(page).getByLabel(/^(用户名|Username)$/).fill(username);
  await cloud(page).getByLabel(/^(密码|Password)$/).fill(password);
  if (register) await cloud(page).getByLabel(/^(再次输入密码|Confirm password)$/).fill(password);
  await button(page, register ? /^(注册并登录|Register and sign in)$/ : /^(登录|Sign in)$/).click();
  await expect(cloud(page).getByRole('heading', { name: /^(云端项目|Cloud projects)$/ })).toBeVisible();
  await expect(button(page, /^(保存当前分析到云端|Save current analysis to cloud)$/)).toBeEnabled();
}

async function prepareSave(page: Page, title?: string) {
  if (!(await cloud(page).getByRole('dialog').count())) await button(page, /^(云端项目|Cloud projects)$/).click();
  await button(page, /^(保存当前分析到云端|Save current analysis to cloud)$/).click();
  await expect(cloud(page).getByRole('heading', { name: /^(确认保存项目|Save this project)$/ })).toBeVisible();
  if (title) await cloud(page).getByLabel(/^(项目名称|Project name)$/).fill(title);
  await expect(button(page, /^(确认上传|Upload project)$/)).toBeEnabled();
}

async function upload(page: Page, expectedStatus = 201) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/wisplab\/projects\/[^/]+\/snapshots$/.test(new URL(response.url()).pathname));
  await button(page, /^(确认上传|Upload project)$/).click();
  const result = await response;
  expect(result.status()).toBe(expectedStatus);
  const body = await result.json();
  if (expectedStatus === 201) await expect(cloud(page).getByRole('heading', { name: /^(云端项目|Cloud projects)$/ })).toBeVisible();
  return body;
}

async function openVersion(page: Page, title: string, revision = 1) {
  const row = cloud(page).locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await row.getByRole('button', { name: /^(版本记录 \/ 打开|Versions \/ Open)$/ }).click();
  const version = cloud(page).locator('article').filter({ has: page.getByRole('heading', { name: new RegExp(`^(版本 |Version )${revision}$`) }) });
  if(revision===2)await expect(cloud(page).getByRole('heading',{name:/^(版本 |Version )1$/})).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await version.getByRole('button', { name: /^(打开此版本|Open this version)$/ }).click();
  await expect(cloud(page).getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
}

async function evidence(page: Page, dir: string, state: string, info: TestInfo) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const language of ['zh', 'en']) {
      await button(page, language === 'zh' ? /^中文$/ : /^EN$/).click();
      await expect(cloud(page).getByRole('button', { name: language === 'zh' ? '中文' : 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if(state==='save')await expect(cloud(page).getByText(language==='zh'?'保留原图、多曝光、校直裁剪、手动取样框和显示设置。':'Preserves originals, exposures, geometry, manual sampling boxes and display settings.',{exact:true})).toBeVisible();
      const filename = `${state}-${width}-${language}.png`, destination = path.join(dir, filename);
      await page.screenshot({ path: destination, fullPage: false });
      await info.attach(filename, { path: destination, contentType: 'image/png' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await button(page, /^中文$/).click();
}

test('real local cloud: single-strip snapshots restore exactly across contexts, preserve history, reject conflicts and isolate accounts', async ({ browser }, info) => {
  const run = Date.now().toString(36), username = 'live_' + run, other = 'other_' + run, title = 'Synthetic WB acceptance ' + run;
  const dir = path.resolve('.release/cloud-acceptance/' + run); await mkdir(dir, { recursive: true });
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
  const pageErrors: string[] = []; for (const page of [a,b,c]) page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await a.goto(dev);
    await a.getByLabel('导入单排条带图片', { exact: true }).setInputFiles([file(source, 'synthetic-exposure-a.png'), file(source2, 'synthetic-exposure-b.png')]);
    await expect(a.getByTestId(/^single-relative-/)).toHaveCount(6);
    await a.getByRole('button', { name: '显示调整', exact: true }).click();
    await a.getByRole('slider', { name: '显示亮度' }).press('End');
    await a.getByText('识别不准？调整取样', { exact: true }).click();
    await a.getByLabel('对照泳道', { exact: true }).selectOption('1');
    const x = a.getByLabel('取样框 x', { exact: true }); await x.fill(String(Number(await x.inputValue()) + 1));
    const baseline = await localPackage(a);
    expect(baseline.project.strips).toHaveLength(2);
    expect(baseline.project.strips[0].prepared.source.original?.bytes).toEqual(source.original!.bytes);
    await button(a, /^(登录 \/ 注册|Sign in \/ Register)$/).click();
    await evidence(a, dir, 'login', info);
    await button(a, /^(返回分析 ×|Back to analysis ×)$/).click();
    await signIn(a, username, true);
    await prepareSave(a, title);
    await evidence(a, dir, 'save', info);
    await expect(cloud(a).getByRole('heading', { name: '确认保存项目', exact: true })).toBeVisible();
    const first = await upload(a);
    expect(first.snapshot.revision).toBe(1);
    expect(first.snapshot.appVersion).toMatch(/^wb:[a-f0-9]{40}(:local-changes)?$/);
    await b.goto(dev); await signIn(b, username, false); await openVersion(b, title);
    expect((await localPackage(b)).project).toEqual(baseline.project);
    await button(a, /^(返回分析 ×|Back to analysis ×)$/).click();
    await a.getByLabel('对照泳道', { exact: true }).selectOption('2');
    const secondState = await localPackage(a);
    await prepareSave(a); const second = await upload(a); expect(second.snapshot.revision).toBe(2);expect(second.project.currentRevision).toBe(second.snapshot.id);
    // The other context still holds revision 1. Its save must fail without replacing revision 2.
    await b.getByLabel('对照泳道', { exact: true }).selectOption('3');
    const staleState = await localPackage(b);
    await prepareSave(b); const conflict = await upload(b, 409);expect(conflict.data.code.code).toBe('revision_conflict');
    await expect(cloud(b).getByRole('status')).toContainText('未覆盖');
    await button(b, /^(返回项目列表|Back to projects)$/).click();
    await openVersion(a, title, 2);expect((await localPackage(a)).project).toEqual(secondState.project);
    await c.goto(dev);await signIn(c, other, true);
    await expect(cloud(c).getByText('这里还没有项目。打开工具后，可将当前分析保存到云端。')).toBeVisible();
    await expect(cloud(c).getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await button(b, /^(退出登录|Sign out)$/).click();
    expect((await localPackage(b)).project).toEqual(staleState.project);
    await expect(cloud(b).getByText('游客 · 本机分析', { exact: true })).toBeVisible();
    await b.getByLabel('对照泳道', { exact: true }).selectOption('0');
    await expect(b.getByTestId('single-relative-1')).toHaveText('1×');
    expect(pageErrors).toEqual([]);
    await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify({ run, syntheticOnly: true, projectId: first.project.id, revisions: [first.snapshot.id, second.snapshot.id], appVersion: second.snapshot.appVersion, assertions: ['exact original bytes and full project roundtrip', 'two append-only revisions', '409 stale save preserves latest', 'other account sees no project', 'guest analysis after logout'], screenshots: ['login','save'].flatMap(state => [1440,390].flatMap(width => ['zh','en'].map(language => `${state}-${width}-${language}.png`))) }, null, 2));
    console.log('Synthetic cloud acceptance evidence: ' + dir);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
