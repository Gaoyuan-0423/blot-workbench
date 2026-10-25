const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const plist = require('plist');
const { options, TEAM_ID, BUNDLE_ID, APP_IDENTIFIER, parseIdentities, profileCertificateHashes, selectIdentity, validateProfile, validateResources, provisioningDeviceId, verifyEntitlements, verifyInstallerSignature, verifyOutputs, assertReady } = require('../mas/checks.cjs');
const { createConfiguration } = require('../mas/config.cjs');
const { targetArgument } = require('../scripts/mas-preflight.cjs');
const certificate = Buffer.from('Synthetic certificate bytes for membership validation only');
const identity = { name: `Apple Distribution: Example (${TEAM_ID})`, teamId: TEAM_ID, sha1: crypto.createHash('sha1').update(certificate).digest('hex').toUpperCase() };
const developmentIdentity = { ...identity, name: 'Apple Development: Yuan Gao (Y24V367CCV)' };
const now = new Date('2026-10-21T00:00:00Z');
function profile() {
  return { UUID: 'synthetic', TeamIdentifier: [TEAM_ID], Platform: ['OSX'], CreationDate: '2026-10-01T00:00:00Z', ExpirationDate: '2027-10-01T00:00:00Z', DeveloperCertificates: [certificate], Entitlements: { 'com.apple.application-identifier': APP_IDENTIFIER, 'com.apple.developer.team-identifier': TEAM_ID, 'get-task-allow': false } };
}
test('MAS configuration is independent, requires signing, and validates version/target input', async () => {
  const original = require('../package.json');
  assert.equal(original.build.mac.identity, null);
  assert.equal(original.version, '0.1.0-experimental.3');
  assert.equal(original.build.appId, 'top.wisplab.desktop.experimental');
  for (const target of ['mas', 'mas-dev']) {
    const opts = options({ WISPLAB_MAS_VERSION: '1.2.3', WISPLAB_MAS_BUILD_NUMBER: '42' }, target);
    const config = createConfiguration(opts, { checks: { identities: { app: identity } } });
    await require('app-builder-lib/out/util/config/config').validateConfiguration(config, {});
    assert.equal(config.extends, null);
    assert.equal(config.appId, 'top.wisplab.desktop');
    assert.equal(config.productName, 'WispLab');
    assert.equal(config.extraMetadata.version, '1.2.3');
    assert.equal(config.mac.bundleVersion, '42');
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.mas.identity, target === 'mas-dev' ? identity.sha1 : TEAM_ID);
    assert.notEqual(config.mac.identity, null);
    assert.equal(config.mas.preAutoEntitlements, false);
    assert.equal(config.mas.type, target === 'mas' ? 'distribution' : 'development');
    assert.equal(config.mac.target[0].target, target);
    assert.equal(config.publish, null);
    assert.match(config.directories.output, new RegExp(target === 'mas' ? 'mas-store' : 'mas-dev'));
    await assert.rejects(config.beforePack({ electronPlatformName: 'darwin', targets: [] }), /Only the selected MAS target/);
  }
  for (const env of [{ WISPLAB_MAS_VERSION: '1.0-beta' }, { WISPLAB_MAS_BUILD_NUMBER: '0' }, { WISPLAB_MAS_BUILD_NUMBER: '10000' }, { WISPLAB_MAS_ARCH: 'ia32' }, { CSC_NAME: '-' }, { CSC_LINK: 'secret.p12' }, { WISPLAB_MAS_PROFILE: 'relative.profile' }, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }]) assert.throws(() => options(env));
  assert.throws(() => options({}, 'dmg'));
  assert.throws(() => targetArgument(['--target', 'mas', '--publish', 'always']));
  assert.throws(() => assertReady({ ok: false, errors: [{ check: 'identity', message: 'missing' }] }), /preflight failed/);
});
test('MAS timestamps are disabled only in the isolated MAS targets, not ordinary macOS configuration', async () => {
  const report = { checks: { identities: { app: identity } } };
  for (const target of ['mas', 'mas-dev']) {
    const config = createConfiguration(options({}, target), report);
    assert.equal(config.mas.timestamp, 'none');
    assert.equal(config.masDev.timestamp, 'none');
    assert.equal(Object.hasOwn(config.mac, 'timestamp'), false);
    await assert.rejects(config.beforePack({ electronPlatformName: 'darwin', targets: [{ name: 'dmg' }] }), /Only the selected MAS target/);
    await assert.rejects(config.beforePack({ electronPlatformName: 'mas', targets: [{ name: 'dmg' }] }), /Only the selected MAS target/);
  }
  assert.equal(Object.hasOwn(require('../package.json').build.mac, 'timestamp'), false);
  assert.throws(() => options({}, 'dmg'));
});
test('MAS build failure remains nonzero after real temporary-file asynchronous cleanup', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wisplab-mas-exit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'cleanup-completed');
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const { TmpDir } = require('temp-file');
    const { failBuild } = require('./scripts/mas-build.cjs');
    (async () => {
      const directory = await new TmpDir().createTempDir();
      console.log(JSON.stringify({ directory }));
      require('async-exit-hook')((callback) => {
        if (callback) setTimeout(() => {
          fs.writeFileSync(process.env.MAS_TEST_CLEANUP_MARKER, 'completed');
          callback();
        }, 10);
      });
      throw new Error('synthetic signing failure');
    })().catch(failBuild);
  `], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, APP_BUILDER_TMP_DIR: root, TMP_DIR_MANAGER_ENSURE_REMOVED_ON_EXIT: 'true', MAS_TEST_CLEANUP_MARKER: marker },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /MAS build blocked: synthetic signing failure/);
  assert.equal(fs.existsSync(JSON.parse(child.stdout).directory), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'completed');
});
test('signing selection follows builder priorities and rejects ambiguous/wrong-team identities', () => {
  const development = { name: `Mac Developer: Example (${TEAM_ID})`, sha1: '1'.repeat(40) };
  const identities = parseIdentities(`1) ${identity.sha1} "${identity.name}"\n2) ${development.sha1} "${development.name}"\n1) ${identity.sha1} "${identity.name}"`).map((entry) => ({ ...entry, teamId: TEAM_ID }));
  assert.equal(identities.length, 2);
  assert.deepEqual(selectIdentity(identities, ['Apple Distribution', '3rd Party Mac Developer Application']), identity);
  assert.throws(() => selectIdentity([{ ...identity, teamId: 'OTHERTEAM0' }], ['Apple Distribution']), /Missing/);
  assert.throws(() => selectIdentity([identity, { ...identity, sha1: '2'.repeat(40) }], ['Apple Distribution']), /Multiple/);
  assert.throws(() => selectIdentity(identities, ['3rd Party Mac Developer Installer']), /Missing/);
});
test('development identity uses certificate OU and profile fingerprint, never CN parentheses as team ID', () => {
  const development = { ...identity, name: 'Apple Development: Yuan Gao (Y24V367CCV)' };
  const another = { ...development, sha1: '2'.repeat(40) };
  const selected = selectIdentity([development, another], ['Mac Developer', 'Apple Development'], profileCertificateHashes(profile()));
  assert.deepEqual(selected, development);
  assert.throws(() => selectIdentity([{ ...development, teamId: 'OTHERTEAM0', name: `Apple Development: Example (${TEAM_ID})` }], ['Apple Development']), /Missing/);
  assert.throws(() => selectIdentity([development], ['Apple Development'], ['3'.repeat(40)]), /Missing/);
  const config = createConfiguration(options({}, 'mas-dev'), { checks: { identities: { app: selected } } });
  assert.equal(config.mas.identity, development.sha1);
  assert.equal(config.masDev.identity, development.sha1);
  assert.throws(() => createConfiguration(options({}, 'mas-dev'), {}), /preflight-verified/);
  const p = profile(); p.ProvisionedDevices = ['device']; p.Entitlements['get-task-allow'] = true;
  assert.doesNotThrow(() => validateProfile(p, 'mas-dev', selected, now));
  assert.throws(() => validateProfile(p, 'mas-dev', { ...selected, teamId: 'OTHERTEAM0' }, now), /organizational unit/);
});
test('profiles reject wrong team/bundle/certificate, expiry and wrong distribution purpose', () => {
  assert.equal(validateProfile(profile(), 'mas', identity, now).bundleId, 'top.wisplab.desktop');
  const withoutDebug = profile(); delete withoutDebug.Entitlements['get-task-allow'];
  assert.doesNotThrow(() => validateProfile(withoutDebug, 'mas', identity, now));
  for (const mutate of [
    (p) => { p.TeamIdentifier = ['OTHERTEAM0']; },
    (p) => { p.Entitlements['com.apple.application-identifier'] = `${TEAM_ID}.*`; },
    (p) => { p.ExpirationDate = '2025-01-01'; },
    (p) => { p.CreationDate = '2027-01-01'; },
    (p) => { p.Platform = ['iOS']; },
    (p) => { p.DeveloperCertificates = [Buffer.from('other')]; },
    (p) => { p.ProvisionsAllDevices = true; },
    (p) => { p.ProvisionedDevices = ['device']; },
    (p) => { p.Entitlements['get-task-allow'] = true; },
  ]) { const p = profile(); mutate(p); assert.throws(() => validateProfile(p, 'mas', identity, now)); }
  const development = profile(); development.ProvisionedDevices = ['device']; development.Entitlements['get-task-allow'] = true;
  assert.doesNotThrow(() => validateProfile(development, 'mas-dev', developmentIdentity, now));
  assert.throws(() => validateProfile(profile(), 'mas-dev', identity, now));
});
test('macOS development profiles may omit debug permission; certificate and devices establish purpose', () => {
  const development = profile();
  development.ProvisionedDevices = ['registered-provisioning-udid'];
  delete development.Entitlements['get-task-allow'];
  assert.doesNotThrow(() => validateProfile(development, 'mas-dev', developmentIdentity, now));
  assert.throws(() => validateProfile(development, 'mas-dev', identity, now), /development signing certificate/);
  assert.throws(() => validateProfile(profile(), 'mas', developmentIdentity, now), /distribution certificate/);
  for (const key of ['get-task-allow', 'com.apple.security.get-task-allow']) {
    for (const value of [true, false]) {
      const p = { ...development, Entitlements: { ...development.Entitlements, [key]: value } };
      assert.doesNotThrow(() => validateProfile(p, 'mas-dev', developmentIdentity, now));
      if (value) assert.throws(() => validateProfile({ ...p, ProvisionedDevices: undefined }, 'mas', identity, now), /get-task-allow/);
    }
  }
  for (const values of [{ 'get-task-allow': 'true' }, { 'get-task-allow': false, 'com.apple.security.get-task-allow': true }])
    assert.throws(() => validateProfile({ ...development, Entitlements: { ...development.Entitlements, ...values } }, 'mas-dev', developmentIdentity, now), /invalid or conflicting/);
  assert.throws(() => validateProfile({ ...development, ProvisionedDevices: [] }, 'mas-dev', developmentIdentity, now), /registered test devices/);
});
test('Apple Silicon provisioning UDID is not replaced by its hardware UUID', () => {
  assert.equal(provisioningDeviceId({ SPHardwareDataType: [{ chip_type: 'Apple M4', provisioning_UDID: 'provisioning', platform_UUID: 'hardware' }] }), 'provisioning');
  assert.equal(provisioningDeviceId({ SPHardwareDataType: [{ cpu_type: 'Intel Core i7', platform_UUID: 'intel-hardware' }] }), 'intel-hardware');
  assert.throws(() => provisioningDeviceId({ SPHardwareDataType: [{ chip_type: 'Apple M4', platform_UUID: 'wrong' }] }), /Provisioning UDID/);
});
test('minimal entitlements include only selected files/outbound access and inherited helper sandbox', () => {
  const parent = plist.parse(fs.readFileSync(path.join(__dirname, '../mas/entitlements.plist'), 'utf8'));
  const child = plist.parse(fs.readFileSync(path.join(__dirname, '../mas/entitlements.inherit.plist'), 'utf8'));
  assert.deepEqual(Object.keys(parent).sort(), ['com.apple.application-identifier', 'com.apple.developer.team-identifier', 'com.apple.security.app-sandbox', 'com.apple.security.application-groups', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.network.client'].sort());
  assert.deepEqual(parent['com.apple.security.application-groups'], [APP_IDENTIFIER]);
  assert.deepEqual(child, { 'com.apple.security.app-sandbox': true, 'com.apple.security.inherit': true });
  verifyEntitlements(parent, parent);
  assert.throws(() => verifyEntitlements({ ...parent, 'com.apple.security.network.server': true }, parent));
});
test('post-sign verification attaches the certificate prefix and checks the extracted public certificate', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wisplab-mas-verification-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'mas-dev-universal', 'WispLab.app');
  const contents = path.join(app, 'Contents');
  fs.mkdirSync(path.join(contents, 'Frameworks', 'WispLab Helper.app'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), plist.build({ CFBundleIdentifier: BUNDLE_ID, CFBundleShortVersionString: '1.0.0', CFBundleVersion: '1', ElectronTeamID: TEAM_ID }));
  const profilePath = path.join(root, 'fixture.provisionprofile');
  fs.writeFileSync(profilePath, 'synthetic profile');
  fs.copyFileSync(profilePath, path.join(contents, 'embedded.provisionprofile'));
  const opts = { ...options({}, 'mas-dev'), output: root, profile: profilePath };
  let extractedDirectory, extractedCertificate = certificate;
  const run = (file, args) => {
    assert.equal(file, '/usr/bin/codesign');
    if (args[0] === '--verify') return { stdout: '', stderr: '' };
    if (args[1] === '--verbose=4') return { stdout: '', stderr: `TeamIdentifier=${TEAM_ID}` };
    if (args[1] === '--entitlements') {
      const name = args.at(-1) === app ? 'entitlements.plist' : 'entitlements.inherit.plist';
      return { stdout: fs.readFileSync(path.join(__dirname, '../mas', name), 'utf8'), stderr: '' };
    }
    assert.equal(args.length, 3);
    assert.match(args[1], /^--extract-certificates=.+/);
    assert.equal(args[2], app);
    const prefix = args[1].slice('--extract-certificates='.length);
    extractedDirectory = path.dirname(prefix);
    fs.writeFileSync(prefix + '0', extractedCertificate);
    return { stdout: '', stderr: '' };
  };
  const report = { checks: { identities: { app: developmentIdentity } } };
  assert.equal(verifyOutputs(opts, report, run), app);
  assert.equal(fs.existsSync(extractedDirectory), false);
  extractedCertificate = Buffer.from('wrong certificate');
  assert.throws(() => verifyOutputs(opts, report, run), /different certificate/);
  assert.equal(fs.existsSync(extractedDirectory), false);
});
test('MAS installer verification accepts Apple status and requires the exact leaf certificate', () => {
  const installer = { ...identity, name: `3rd Party Mac Developer Installer: Example (${TEAM_ID})` };
  let status = 'signed by a developer certificate issued by Apple (Development)';
  let leafName = installer.name;
  const chain = (bytes) => `<signature style="RSA"><KeyInfo><X509Data><X509Certificate>\n${bytes.toString('base64')}\n</X509Certificate></X509Data></KeyInfo></signature>`;
  let toc = `<xar><toc>${chain(certificate)}</toc></xar>`;
  const run = (file, args) => {
    if (file === '/usr/sbin/pkgutil') {
      assert.deepEqual(args, ['--check-signature', 'fixture.pkg']);
      return { stdout: `Status: ${status}\nCertificate Chain:\n  1. ${leafName}\n  2. Apple Root CA\n`, stderr: '' };
    }
    assert.equal(file, '/usr/bin/xar');
    assert.deepEqual(args, ['--dump-toc=-', '-f', 'fixture.pkg']);
    return { stdout: toc, stderr: '' };
  };
  for (const accepted of [status, 'signed by a certificate trusted by macOS', 'signed by a certificate trusted by Mac OS X']) {
    status = accepted;
    assert.doesNotThrow(() => verifyInstallerSignature('fixture.pkg', installer, run));
  }
  for (const rejected of ['no signature', 'signed by an untrusted certificate', 'signed by a certificate that has since expired']) {
    status = rejected;
    assert.throws(() => verifyInstallerSignature('fixture.pkg', installer, run), /not trusted/);
  }
  status = 'signed by a developer certificate issued by Apple (Development)';
  leafName = 'Unexpected Installer';
  assert.throws(() => verifyInstallerSignature('fixture.pkg', installer, run), /unexpected signing identity/);
  leafName = installer.name;
  toc = chain(Buffer.from('different certificate with the same claimed name'));
  assert.throws(() => verifyInstallerSignature('fixture.pkg', installer, run), /different certificate/);
  toc = `<xar><toc>${chain(certificate)}${chain(certificate)}</toc></xar>`;
  assert.throws(() => verifyInstallerSignature('fixture.pkg', installer, run), /one installer signature/);
});
test('store resources require exact CI provenance and hashes; extra files and symlinks fail', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wisplab-mas-resources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40), fileHash = crypto.createHash('sha256').update('fixture').digest('hex');
  const manifest = { schemaVersion: 1, mode: 'ci', desktopTreeDirty: false, desktopGitSha: sha, sources: {} };
  for (const tool of ['wb', 'pathology', 'pcr', 'portal']) {
    const repository = `Gaoyuan-0423/${tool === 'portal' || tool === 'wb' ? 'blot' : tool}-workbench`;
    fs.mkdirSync(path.join(root, 'apps', tool), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', tool, 'index.html'), 'fixture');
    manifest.sources[tool] = { repository, gitSha: sha, dirty: false, buildOrigin: tool === 'portal' ? 'pinned-source' : 'successful-ci-artifact', files: { 'index.html': fileHash }, ci: { runId: 1, artifactId: 2, conclusion: 'success', headSha: sha, artifactName: 'web-dist', artifactDigest: `sha256:${'b'.repeat(64)}`, runUrl: `https://github.com/${repository}/actions/runs/1` } };
  }
  const save = () => fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(manifest));
  save(); assert.equal(validateResources(root, 'mas').mode, 'ci');
  manifest.mode = 'local'; save(); assert.throws(() => validateResources(root, 'mas'), /CI-staged/); assert.equal(validateResources(root, 'mas-dev').mode, 'local');
  manifest.mode = 'ci'; manifest.sources.wb.ci.conclusion = 'failure'; save(); assert.throws(() => validateResources(root, 'mas'), /CI provenance/);
  manifest.sources.wb.ci.conclusion = 'success'; save();
  const original = path.join(root, 'apps/wb/index.html');
  fs.writeFileSync(original, 'changed'); assert.throws(() => validateResources(root, 'mas'), /hashes/);
  fs.writeFileSync(original, 'fixture'); fs.writeFileSync(path.join(root, 'apps/wb/extra.txt'), 'extra'); assert.throws(() => validateResources(root, 'mas'), /file list/);
  fs.unlinkSync(path.join(root, 'apps/wb/extra.txt'));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  // Directory junctions exercise the same lstat rejection on Windows without
  // requiring Developer Mode or the symbolic-link privilege.
  fs.symlinkSync(outside, path.join(root, 'apps/wb/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateResources(root, 'mas'), /Symlink/);
});
