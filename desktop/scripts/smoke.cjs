/* Real Electron integration check: bundled import, analysis, worker, export,
 * navigation and persistence with HTTP(S) disabled. No server is started. */
const { _electron: electron } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { deflateSync } = require('node:zlib');
const { execFileSync } = require('node:child_process');

function png(width, height, pixel) {
  const crc = data => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
    header.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([header, body, checksum]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = pixel(x, y), offset = y * (width * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++) raw[offset + c] = rgb[c];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const blot = () => png(360, 112, (x, y) => {
  const lane = Math.floor((x - 18) / 60);
  const v = lane >= 0 && lane < 6 && x < 42 + lane * 60 && y >= 48 && y < 64 ? 200 - lane * 20 : 240;
  return [v, v, v];
});
const ihc = () => png(320, 240, (x, y) => {
  const gx = Math.round(x / 40), gy = Math.round(y / 36);
  if (gx > 0 && gx < 8 && gy > 0 && gy < 6 && Math.hypot(x - gx * 40, y - gy * 36) < 11) {
    return (gx + gy) % 2 ? [125, 85, 48] : [82, 78, 130];
  }
  return [246, 246, 242];
});

(async () => {
  const root = path.resolve(__dirname, '..'), reports = path.join(root, 'reports');
  await fs.mkdir(reports, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wisplab-desktop-smoke-'));
  const report = { checks: [], failures: [], remoteRequests: [], phase: 'launch' };
  let app, page;
  let launchDiagnostic;
  const watchdog = setTimeout(() => { app?.process().kill('SIGTERM'); }, 180_000);
  try {
    const binary = process.env.WISPLAB_DESKTOP_BINARY;
    // A native startup dialog can block CDP initialization before firstWindow().
    // Capture the disposable Windows CI desktop before Playwright times out and
    // terminates the process; this never runs in the distributed application.
    if (process.platform === 'win32' && binary) {
      report.bundledIndexes = Object.fromEntries(await Promise.all(
        ['portal', 'wb', 'pathology', 'pcr'].map(async tool => {
          const file = path.join(path.dirname(binary), 'resources/apps', tool, 'index.html');
          return [tool, await fs.stat(file).then(value => value.isFile(), () => false)];
        }),
      ));
      launchDiagnostic = setTimeout(() => {
        if (app) return;
        try {
          report.launchWindows = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
            Get-Process | Where-Object { $_.MainWindowTitle } |
              Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
            $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
            $bitmap.Save((Join-Path $env:WISPLAB_SMOKE_REPORTS 'windows-launch.png'))
            $graphics.Dispose()
            $bitmap.Dispose()
          `], { env: { ...process.env, WISPLAB_SMOKE_REPORTS: reports }, encoding: 'utf8', timeout: 10_000 });
        } catch (error) {
          report.launchDiagnosticError = error.message;
        }
      }, 15_000);
    }
    app = await electron.launch({
      ...(binary ? { executablePath: binary } : {}),
      args: [...(binary ? [] : [root]), `--user-data-dir=${profile}`],
      env: { ...process.env, WISPLAB_DESKTOP_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '1' }, timeout: 45_000,
    });
    clearTimeout(launchDiagnostic);
    report.phase = 'runtime';
    const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData') }));
    assert.equal(await fs.realpath(runtime.userData), await fs.realpath(profile), 'Smoke must use a disposable profile');
    report.packaged = runtime.packaged;
    page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
    const context = app.context();
    await context.addInitScript(() => {
      let platform;
      Object.defineProperty(window, 'WispLab', {
        configurable: true,
        get: () => platform,
        set(value) {
          platform = { ...value, registerProjectAdapter(adapter) {
            window.__testProjectAdapter = adapter;
            return value.registerProjectAdapter(adapter);
          } };
        },
      });
    });
    await context.setOffline(true);
    await context.route(/^https?:/, route => { report.remoteRequests.push(route.request().url()); return route.abort('internetdisconnected'); });
    page.on('pageerror', error => report.failures.push(error.message));
    page.on('requestfailed', request => { if (request.url().startsWith('app:')) report.failures.push(`${request.url()}: ${request.failure()?.errorText}`); });
    await page.goto('app://wisplab/?lang=zh');
    assert.deepEqual(await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: Object.keys(window.wispLabDesktop).sort(), desktop: window.wispLabDesktop.isDesktop })),
      { require: 'undefined', process: 'undefined', bridge: ['getAppVersion', 'isDesktop'], desktop: true });
    assert.equal(await page.evaluate(() => window.wispLabDesktop.getAppVersion()), require('../package.json').version);
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.webviewTag, false);
    report.checks.push('isolated sandboxed renderer and minimal preload');
    const inline = await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__unexpectedInlineScript = true';
      document.head.append(script); script.remove();
      window.open('https://example.invalid/untrusted-popup');
      return window.__unexpectedInlineScript === true;
    });
    assert.equal(inline, false);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    report.checks.push('CSP blocks inline scripts and the shell blocks untrusted popup windows');
    await expect(page.locator('a[href^="app://wisplab/wb/"]').first()).toBeVisible();
    await expect(page.locator('a[href^="app://wisplab/pathology/"]').first()).toBeVisible();
    await expect(page.locator('a[href^="app://wisplab/pcr/"]').first()).toBeVisible();
    await page.screenshot({ path: path.join(reports, 'desktop-portal-zh.png'), fullPage: true });
    report.checks.push('offline portal with local cross-tool navigation');

    // The test, not the renderer or product preload, chooses a temporary save path.
    // This also verifies the product's initiator guard accepts legitimate blob exports.
    await app.evaluate(({ session }, directory) => {
      globalThis.__desktopDownloads = [];
      session.fromPartition('persist:wisplab-desktop').on('will-download', (_event, item) => {
        const target = directory + '/' + item.getFilename().replace(/[\\/]/g, '_');
        const origin = item.getInitiatorOrigin();
        item.setSavePath(target);
        item.once('done', (_event, state) => globalThis.__desktopDownloads.push({ target, state, origin }));
      });
    }, reports);
    const exported = async button => {
      const count = await app.evaluate(() => globalThis.__desktopDownloads.length);
      await button.click();
      await expect.poll(() => app.evaluate(() => globalThis.__desktopDownloads.length)).toBe(count + 1);
      const item = await app.evaluate(() => globalThis.__desktopDownloads.at(-1));
      assert.equal(item.state, 'completed'); assert.equal(item.origin, 'app://wisplab');
      assert.ok((await fs.stat(item.target)).size > 30);
      return item.target;
    };
    await page.evaluate(() => { window.open('app://wisplab/wb/?mode=single&lang=zh'); });
    await page.waitForURL('app://wisplab/wb/?mode=single&lang=zh');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    report.checks.push('local target-blank links stay in the trusted app window');
    await page.getByLabel('导入单排条带图片', { exact: true }).setInputFiles({ name: 'offline-known-pixels.png', mimeType: 'image/png', buffer: blot() });
    await expect(page.getByTestId(/^single-relative-/)).toHaveCount(6);
    const csv = await fs.readFile(await exported(page.getByRole('button', { name: '导出 CSV', exact: true })), 'utf8');
    assert.match(csv, /net_signal/); assert.match(csv, /15360/); assert.match(csv, /53760/);
    await page.screenshot({ path: path.join(reports, 'desktop-wb-zh.png'), fullPage: true });
    report.checks.push('offline WB raster import, six measured lanes, known signal CSV');

    // Test the real project-adapter boundary, including a slow archive that
    // finishes after an edit. The hooks exist only in Playwright's test page.
    for (const mode of ['demo', 'real']) {
      await page.goto(`app://wisplab/wb/?lang=zh#${mode}`);
      const name = page.getByRole('textbox', { name: mode === 'real' ? '真实项目名称' : '项目名称', exact: true });
      await expect(name).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__testProjectAdapter?.tool)).toBe(`wb-${mode}`);
      const beforeName = await name.inputValue();
      await page.evaluate(async () => {
        const adapter = window.__testProjectAdapter;
        window.__testArchive = await adapter.exportProject();
        const bytes = await window.__testArchive.blob.arrayBuffer();
        const slow = new Blob([bytes]);
        slow.arrayBuffer = () => new Promise(resolve => { window.__finishArchiveRead = () => resolve(bytes); });
        window.__testImportResult = adapter.importProject(slow).then(() => 'accepted', error => error.name);
      });
      const edited = `edited-during-${mode}-import`;
      await name.fill(edited); await name.press('Tab');
      const late = await page.evaluate(async () => { window.__finishArchiveRead(); return window.__testImportResult; });
      assert.equal(late, 'AbortError'); await expect(name).toHaveValue(edited);
      const rejected = await page.evaluate(async () => {
        let prompts = 0; const previous = window.confirm;
        window.confirm = () => { prompts++; return false; };
        const result = {};
        try {
          try { await window.__testProjectAdapter.importProject(new Blob(['invalid zip'])); } catch (error) { result.invalid = error.name; }
          result.invalidPrompts = prompts;
          try { await window.__testProjectAdapter.importProject(window.__testArchive.blob, { isCurrent: () => false }); } catch (error) { result.stale = error.name; }
          result.stalePrompts = prompts;
          try { await window.__testProjectAdapter.importProject(window.__testArchive.blob); } catch (error) { result.cancelled = error.name; }
          result.cancelPrompts = prompts;
          return result;
        } finally { window.confirm = previous; }
      });
      assert.ok(rejected.invalid); assert.equal(rejected.invalidPrompts, 0);
      assert.equal(rejected.stale, 'AbortError'); assert.equal(rejected.stalePrompts, 0);
      assert.equal(rejected.cancelled, 'AbortError'); assert.equal(rejected.cancelPrompts, 1);
      await expect(name).toHaveValue(edited);
      await page.evaluate(async () => {
        const previous = window.confirm; window.confirm = () => true;
        try { await window.__testProjectAdapter.importProject(window.__testArchive.blob, { isCurrent: () => true }); }
        finally { window.confirm = previous; }
      });
      await expect(name).toHaveValue(beforeName);
      await expect(page.locator(mode === 'real' ? '.real-save-status' : '.save-status')).toHaveClass(/saved/);
      report.checks.push(`WB ${mode} validated archive roundtrip, cancellation, account guard and delayed-import edit protection`);
    }

    await page.goto('app://wisplab/pathology/?lang=zh');
    await page.setInputFiles('.dropzone input[type="file"]', { name: 'offline-synthetic-ihc.png', mimeType: 'image/png', buffer: ihc() });
    await expect(page.getByRole('status')).toContainText('已导入');
    await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
    const area = Number.parseFloat(await page.locator('.result-overall td').nth(1).textContent());
    assert.ok(area > 2 && area < 40, `Unexpected synthetic IHC area: ${area}`);
    await exported(page.getByRole('button', { name: '导出 Excel', exact: true }));
    await page.screenshot({ path: path.join(reports, 'desktop-pathology-zh.png'), fullPage: true });
    report.checks.push('offline pathology import, worker analysis and Excel export');

    await page.goto('app://wisplab/pcr/?lang=zh');
    await page.getByRole('button', { name: '标准曲线示例', exact: true }).click();
    await expect(page.getByText('ΔΔCt 结果表')).toBeVisible();
    await exported(page.getByRole('button', { name: '导出结果 CSV', exact: true }));
    await page.screenshot({ path: path.join(reports, 'desktop-pcr-zh.png'), fullPage: true });
    report.checks.push('offline PCR bundled data, calculation and CSV export');
    // A real navigation shares the app origin, but project keys remain tool-specific.
    await page.goto('app://wisplab/pathology/?lang=zh');
    await expect(page.locator('.result-overall td').nth(1)).toHaveText(/%$/);
    report.checks.push('pathology IndexedDB project survives cross-tool navigation');
    await page.goto('app://wisplab/?lang=en');
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
    await page.screenshot({ path: path.join(reports, 'desktop-portal-en.png'), fullPage: true });
    report.checks.push('English locale on desktop');
    assert.match(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), /WispLab Experimental.*unsigned/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 844));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await page.screenshot({ path: path.join(reports, 'desktop-portal-en-narrow.png'), fullPage: true });
    report.checks.push('experimental native title and narrow-window layout');
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.remoteRequests, [], 'Guest analysis and local projects must not contact HTTP(S), including account/capability APIs');
    report.checks.push('guest analysis and local projects make zero HTTP(S) requests');
    report.phase = 'complete';
    report.success = true;
  } catch (error) {
    report.success = false; report.error = error.stack;
    // Preserve the primary failure even if Windows still holds a profile file.
    console.error(report.error);
    if (page) await page.screenshot({ path: path.join(reports, 'desktop-smoke-failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    clearTimeout(launchDiagnostic);
    clearTimeout(watchdog);
    if (app) {
      const forceClose = setTimeout(() => app.process().kill('SIGTERM'), 10_000);
      await app.close().catch(() => {});
      clearTimeout(forceClose);
    }
    try {
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      report.cleanupError = error.message;
      report.success = false;
      process.exitCode = 1;
    }
    await fs.writeFile(path.join(reports, 'smoke.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
})();
