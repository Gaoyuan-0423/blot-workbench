import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { packageRelease } from './package-release.mjs';
import { generateNotices } from './third-party-notices.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'blot-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ name: 'blot-workbench', version: '0.1.0-alpha.1' }),
    'package-lock.json': JSON.stringify({ name: 'blot-workbench', version: '0.1.0-alpha.1', packages: { '': {}, 'node_modules/example-runtime': { version: '1.0.0', license: 'MIT' }, 'node_modules/example-build': { version: '2.0.0', dev: true, license: 'ISC' }, 'node_modules/missing-optional': { version: '3.0.0', optional: true } } }),
    'node_modules/example-runtime/package.json': JSON.stringify({ name: 'example-runtime', version: '1.0.0', license: 'MIT' }),
    'node_modules/example-runtime/LICENSE': 'Fixture license text, preserved verbatim.\n',
    'dist/index.html': '<!doctype html><title>Fixture</title>',
    'examples/known-values.json': '[0,65535]',
    'README.md': '# Fixture project\n',
    'LICENSE': 'Fixture project license\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
  return root;
}

test('release archive and manifest preserve bytes and report an uncommitted testing source', async (t) => {
  const root = await fixture(t);
  const result = await packageRelease({ root, allowDirty: true });
  const bytes = await readFile(result.archive);
  const entries = unzipSync(bytes);
  const prefix = 'blot-workbench-0.1.0-alpha.1/';
  const manifest = JSON.parse(strFromU8(entries[`${prefix}release-manifest.json`]));
  assert.equal(manifest.sourceDirty, true);
  assert.equal(manifest.sourceCommit, null);
  assert.ok(entries[`${prefix}dist/index.html`]);
  assert.equal(strFromU8(entries[`${prefix}examples/known-values.json`]), '[0,65535]');
  for (const file of manifest.files) {
    assert.equal(entries[`${prefix}${file.path}`].byteLength, file.bytes);
    assert.equal(createHash('sha256').update(entries[`${prefix}${file.path}`]).digest('hex'), file.sha256);
  }
  const sums = await readFile(result.checksum, 'utf8');
  assert.ok(sums.startsWith(createHash('sha256').update(bytes).digest('hex')));
  assert.ok(sums.includes(`${createHash('sha256').update(entries[`${prefix}release-manifest.json`]).digest('hex')}  blot-workbench-0.1.0-alpha.1-manifest.json`));
  assert.match(manifest.publication, /does not create or verify/);
  assert.match(manifest.verification, /does not attest/);
});

test('the same payload produces the same ZIP even when source mtimes change', async (t) => {
  const root = await fixture(t);
  const first = await packageRelease({ root, allowDirty: true });
  const firstBytes = await readFile(first.archive);
  await utimes(join(root, 'examples', 'known-values.json'), new Date('2001-01-01'), new Date('2001-01-01'));
  const second = await packageRelease({ root, allowDirty: true });
  assert.deepEqual(await readFile(second.archive), firstBytes);
});

test('release creation refuses an uncommitted source unless explicitly marked as a local test', async (t) => {
  const root = await fixture(t);
  await assert.rejects(packageRelease({ root }), /clean committed tree/);
});

test('release creation rejects symbolic links instead of packaging their targets', async (t) => {
  const root = await fixture(t);
  await symlink(join(root, 'LICENSE'), join(root, 'examples', 'linked.txt'));
  await assert.rejects(packageRelease({ root, allowDirty: true }), /Symlinks are not accepted/);
});

test('license inventory preserves available text and labels missing information without guessing', async (t) => {
  const root = await fixture(t);
  const notices = await generateNotices({ root });
  assert.match(notices, /Fixture license text, preserved verbatim/);
  assert.match(notices, /missing-optional@3.0.0/);
  assert.match(notices, /Declared license: UNKNOWN/);
  assert.match(notices, /License text: NOT COLLECTED/);
  assert.doesNotMatch(notices, /example-build@/);
  assert.match(await generateNotices({ root, includeDev: true }), /example-build@2.0.0/);
});
