const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { isAppUrl, route, serveAsset, CONTENT_SECURITY_POLICY } = require('../lib/assets.cjs');

test('only the fixed application origin is trusted', () => {
  for (const url of ['app://wisplab/', 'app://wisplab/wb/?mode=single', 'app://wisplab/pathology/']) assert.equal(isAppUrl(url), true);
  for (const url of ['https://wisplab.top/', 'app://other/wb/', 'app://user@wisplab/', 'app://wisplab:80/', 'file:///etc/passwd', 'javascript:alert(1)']) assert.equal(isAppUrl(url), false);
  assert.deepEqual(route('app://wisplab/wb/?mode=single'), { tool: 'wb', file: 'index.html' });
  assert.deepEqual(route('app://wisplab/pathology/ort/model.wasm'), { tool: 'pathology', file: 'ort/model.wasm' });
  assert.deepEqual(route('app://wisplab/locale.js'), { tool: 'portal', file: 'locale.js' });
  for (const url of ['app://wisplab/wb/%00.html', 'app://wisplab/wb/%2e%2e%2fsecret.txt', 'app://wisplab/wb/%5csecret.txt', 'app://wisplab/wb/.env', 'app://wisplab/wb/%ZZ']) assert.equal(route(url), null);
});

test('bundled assets use correct MIME and isolation headers and cannot escape their tool', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wisplab-assets-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const apps = path.join(tmp, 'apps');
  for (const tool of ['portal', 'wb', 'pathology', 'pcr']) {
    await fs.mkdir(path.join(apps, tool, 'assets'), { recursive: true });
    await fs.writeFile(path.join(apps, tool, 'index.html'), tool);
  }
  await fs.writeFile(path.join(apps, 'wb', 'assets', 'worker.js'), 'export {};');
  await fs.writeFile(path.join(tmp, 'secret.txt'), 'must never escape');
  const get = (url, method = 'GET') => serveAsset({ url, method }, apps);
  for (const tool of ['wb', 'pathology', 'pcr']) {
    const response = await get(`app://wisplab/${tool}/`);
    assert.equal(response.status, 200); assert.equal(await response.text(), tool);
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const worker = await get('app://wisplab/wb/assets/worker.js');
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await (await get('app://wisplab/wb/', 'HEAD')).text(), '');
  assert.equal((await get('app://wisplab/wb/', 'POST')).status, 405);
  assert.equal((await get('app://wisplab/wb/../../secret.txt')).status, 404);
  assert.equal((await get('https://wisplab.top/wb/')).status, 404);
  assert.equal((await get('app://wisplab/wb/missing.js')).status, 404);
  const redirect = await get('app://wisplab/wb?mode=single');
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), 'app://wisplab/wb/?mode=single');
  // Windows symlinks may require developer privileges; directory junctions do not.
  await fs.symlink(tmp, path.join(apps, 'wb', 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await get('app://wisplab/wb/outside/secret.txt')).status, 404);
});

test('CSP permits bundled workers/WASM but rejects inline scripts and remote code', () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(CONTENT_SECURITY_POLICY, /worker-src 'self' blob:/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY.match(/script-src[^;]*/)[0], /https:|'unsafe-inline'|'unsafe-eval'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /connect-src[^;]*(?:\*|http:)/);
});
