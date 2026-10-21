const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const DESKTOP = path.resolve(__dirname, '..');
const TEAM_ID = '29RXSR5JXC';
const BUNDLE_ID = 'top.wisplab.desktop';
const APP_IDENTIFIER = `${TEAM_ID}.${BUNDLE_ID}`;
const REPOS = { wb: 'Gaoyuan-0423/blot-workbench', pathology: 'Gaoyuan-0423/pathology-workbench', pcr: 'Gaoyuan-0423/pcr-workbench', portal: 'Gaoyuan-0423/blot-workbench' };
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  requireThat(!result.error && result.status === 0, `${path.basename(file)} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return { stdout: result.stdout, stderr: result.stderr };
}
function parsePlist(text) { return require('plist').parse(text); }
function options(env = process.env, target = env.WISPLAB_MAS_TARGET || 'mas') {
  requireThat(target === 'mas' || target === 'mas-dev', 'Target must be mas or mas-dev.');
  const version = env.WISPLAB_MAS_VERSION || '1.0.0';
  const buildNumber = env.WISPLAB_MAS_BUILD_NUMBER || '1';
  const arch = env.WISPLAB_MAS_ARCH || 'universal';
  requireThat(/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(version), 'WISPLAB_MAS_VERSION must be a numeric major.minor.patch version, without a prerelease suffix.');
  requireThat(/^[1-9]\d{0,3}$/.test(buildNumber), 'WISPLAB_MAS_BUILD_NUMBER must be an integer from 1 to 9999; increase it for each upload.');
  requireThat(['arm64', 'x64', 'universal'].includes(arch), 'WISPLAB_MAS_ARCH must be arm64, x64, or universal.');
  for (const key of ['CSC_LINK', 'CSC_INSTALLER_LINK', 'CSC_NAME', 'CSC_KEY_PASSWORD', 'CSC_INSTALLER_KEY_PASSWORD', 'CSC_FOR_PULL_REQUEST'])
    requireThat(!env[key], `${key} is not supported by the MAS entry point; use installed keychain identities.`);
  requireThat(env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false', 'Signing discovery must not be disabled.');
  for (const key of ['WISPLAB_MAS_PROFILE', 'CSC_KEYCHAIN'])
    if (env[key]) requireThat(path.isAbsolute(env[key]), `${key} must be an absolute path.`);
  return { target, version, buildNumber, arch, profile: env.WISPLAB_MAS_PROFILE, keychain: env.CSC_KEYCHAIN,
    output: path.join(DESKTOP, 'out', target === 'mas' ? 'mas-store' : 'mas-dev', `${version}-${buildNumber}-${arch}`) };
}
function parseIdentities(text) {
  return [...new Map([...text.matchAll(/\b([0-9A-Fa-f]{40})\s+"([^"]+)"/g)].map((match) =>
    [match[1].toUpperCase(), { sha1: match[1].toUpperCase(), name: match[2] }])).values()];
}
function certificateIdentity(bytes) {
  const certificate = new crypto.X509Certificate(bytes);
  const subject = certificate.toLegacyObject().subject;
  return { name: subject.CN, teamId: subject.OU, sha1: certificate.fingerprint.replaceAll(':', '').toUpperCase() };
}
function profileCertificateHashes(profile) {
  return (profile.DeveloperCertificates || []).map((certificate) =>
    hash(Buffer.isBuffer(certificate) ? certificate : Buffer.from(certificate, 'base64'), 'sha1').toUpperCase());
}
function identifyCertificateTeams(identities, keychain, run = command) {
  return identities.filter((identity) => /^(Apple Development|Mac Developer|Apple Distribution|3rd Party Mac Developer Application|3rd Party Mac Developer Installer):/.test(identity.name)).map((identity) => {
    // find-certificate exports public certificates only, never private keys.
    const pem = run('/usr/bin/security', ['find-certificate', '-a', '-c', identity.name, '-p', ...(keychain ? [keychain] : [])]).stdout;
    const certificates = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map((match) => certificateIdentity(match[0]));
    const certificate = certificates.find((entry) => entry.sha1 === identity.sha1 && entry.name === identity.name);
    requireThat(certificate, `Cannot verify public certificate metadata for ${identity.name}.`);
    return { ...identity, teamId: certificate.teamId };
  });
}
function selectIdentity(identities, types, allowedCertificateHashes) {
  for (const type of types) {
    const matches = identities.filter((identity) => identity.name.startsWith(`${type}:`) && identity.teamId === TEAM_ID && (!allowedCertificateHashes || allowedCertificateHashes.includes(identity.sha1)));
    if (!matches.length) continue;
    requireThat(matches.length === 1, `Multiple ${type} identities for this team; use CSC_KEYCHAIN to select a dedicated keychain.`);
    return matches[0];
  }
  throw new Error(`Missing valid private-key identity: ${types.join(' or ')} for team ${TEAM_ID}.`);
}
function validateProfile(profile, target, identity, now = new Date()) {
  requireThat(identity.teamId === TEAM_ID, 'Signing certificate organizational unit does not match the registered team.');
  requireThat(Array.isArray(profile.TeamIdentifier) && profile.TeamIdentifier.length === 1 && profile.TeamIdentifier[0] === TEAM_ID, 'Provisioning profile belongs to the wrong team.');
  const entitlements = profile.Entitlements || {};
  requireThat(entitlements['com.apple.application-identifier'] === APP_IDENTIFIER, 'Provisioning profile must contain the exact registered bundle ID; wildcard profiles are rejected.');
  requireThat(entitlements['com.apple.developer.team-identifier'] === TEAM_ID, 'Provisioning entitlement team does not match.');
  requireThat(Array.isArray(profile.Platform) && profile.Platform.some((platform) => platform === 'OSX' || platform === 'macOS'), 'Provisioning profile must target macOS.');
  requireThat(Number.isFinite(new Date(profile.ExpirationDate).getTime()) && new Date(profile.ExpirationDate) > now, 'Provisioning profile is expired or has no valid expiry.');
  requireThat(Number.isFinite(new Date(profile.CreationDate).getTime()) && new Date(profile.CreationDate) <= now, 'Provisioning profile creation date is invalid or in the future.');
  requireThat(!profile.ProvisionsAllDevices, 'Developer ID / all-device profiles are not MAS profiles.');
  const debugValues = ['get-task-allow', 'com.apple.security.get-task-allow']
    .filter((key) => Object.hasOwn(entitlements, key)).map((key) => entitlements[key]);
  requireThat(debugValues.every((value) => typeof value === 'boolean') && new Set(debugValues).size <= 1, 'Provisioning profile has invalid or conflicting debug entitlements.');
  if (target === 'mas-dev') {
    // Apple-issued macOS development profiles may omit both debug keys.
    // Development certificate membership and registered devices establish the
    // purpose; permission to attach a debugger is not a required capability.
    requireThat(/^(Apple Development|Mac Developer):/.test(identity.name) && Array.isArray(profile.ProvisionedDevices) && profile.ProvisionedDevices.length > 0, 'mas-dev requires a development signing certificate and a profile with registered test devices.');
  } else {
    requireThat(/^(Apple Distribution|3rd Party Mac Developer Application):/.test(identity.name) && !debugValues.includes(true) && !profile.ProvisionedDevices, 'mas requires a Mac App Store distribution certificate and profile without device restrictions or get-task-allow.');
  }
  requireThat(Array.isArray(profile.DeveloperCertificates) && profileCertificateHashes(profile).includes(identity.sha1), 'The selected app signing certificate is not included in the provisioning profile.');
  // Team-prefixed macOS application groups are authorized by the signing team,
  // not by profile group registration. Do not require a group.* entitlement here.
  return { uuid: profile.UUID, expiresAt: new Date(profile.ExpirationDate).toISOString(), teamId: TEAM_ID, bundleId: BUNDLE_ID };
}
function regularFiles(root, prefix = '') {
  requireThat(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), `Expected a real directory: ${root}`);
  const result = {};
  for (const name of fs.readdirSync(root).sort()) {
    const absolute = path.join(root, name), relative = prefix + name;
    const stat = fs.lstatSync(absolute);
    requireThat(!stat.isSymbolicLink(), `Symlink is not allowed in staged resources: ${relative}`);
    if (stat.isDirectory()) Object.assign(result, regularFiles(absolute, relative + '/'));
    else {
      requireThat(stat.isFile(), `Non-file resource: ${relative}`);
      result[relative] = hash(fs.readFileSync(absolute));
    }
  }
  return result;
}
function validateResources(resources, target) {
  for (const [entry, directory] of [[resources, true], [path.join(resources, 'apps'), true], [path.join(resources, 'release.json'), false]]) {
    const stat = fs.lstatSync(entry);
    requireThat(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'Staged resource roots and manifest must not be symlinks.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'release.json'), 'utf8'));
  requireThat(manifest.schemaVersion === 1 && ['local', 'ci'].includes(manifest.mode), 'Invalid desktop resource manifest.');
  if (target === 'mas') requireThat(manifest.mode === 'ci' && manifest.desktopTreeDirty === false, 'Store packaging requires clean CI-staged resources; local/dirty resources cannot be uploaded.');
  const apps = path.join(resources, 'apps');
  requireThat(JSON.stringify(fs.readdirSync(apps).sort()) === JSON.stringify(Object.keys(REPOS).sort()), 'Staged apps must contain exactly portal, wb, pathology, and pcr.');
  for (const [tool, repository] of Object.entries(REPOS)) {
    const source = manifest.sources?.[tool];
    requireThat(source?.repository === repository && /^[a-f0-9]{40}$/.test(source.gitSha), `Invalid source identity for ${tool}.`);
    requireThat(source.files && Object.hasOwn(source.files, 'index.html'), `Missing source file manifest for ${tool}.`);
    const actual = regularFiles(path.join(apps, tool));
    requireThat(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(source.files).sort()), `Staged resource hashes or file list differ for ${tool}.`);
    if (target === 'mas') {
      requireThat(source.dirty === false, `Dirty source rejected: ${tool}.`);
      if (tool === 'portal') requireThat(source.buildOrigin === 'pinned-source' && source.gitSha === manifest.sources.wb.gitSha, 'Portal must come from the same pinned WB source.');
      else {
        const ci = source.ci;
        requireThat(source.buildOrigin === 'successful-ci-artifact' && ci?.conclusion === 'success' && ci.headSha === source.gitSha && ci.artifactName === 'web-dist' && Number.isSafeInteger(ci.runId) && ci.runId > 0 && Number.isSafeInteger(ci.artifactId) && ci.artifactId > 0 && new RegExp(`^https://github.com/${repository}/actions/runs/[0-9]+$`).test(ci.runUrl) && /^sha256:[a-f0-9]{64}$/.test(ci.artifactDigest), `Incomplete successful CI provenance for ${tool}.`);
      }
    }
  }
  requireThat(manifest.sources.portal.gitSha === manifest.sources.wb.gitSha, 'Portal and WB source versions differ.');
  return { mode: manifest.mode, desktopGitSha: manifest.desktopGitSha, sources: Object.fromEntries(Object.entries(manifest.sources).map(([tool, source]) => [tool, source.gitSha])) };
}
function provisioningDeviceId(data) {
  const hardware = data.SPHardwareDataType?.[0];
  requireThat(hardware, 'Unable to inspect the Mac provisioning device identifier.');
  if (typeof hardware.provisioning_UDID === 'string' && hardware.provisioning_UDID) return hardware.provisioning_UDID;
  requireThat(!hardware.chip_type && /Intel/i.test(hardware.cpu_type || '') && hardware.platform_UUID, 'Provisioning UDID is required on Apple Silicon; hardware UUID is not an interchangeable identifier.');
  return hardware.platform_UUID;
}
function preflight(opts, run = command) {
  const errors = [], checks = {};
  const check = (name, task) => { try { checks[name] = task(); } catch (error) { errors.push({ check: name, message: error.message }); } };
  check('host', () => { requireThat(process.platform === 'darwin', 'MAS packaging requires macOS.'); return process.platform; });
  check('dependencies', () => {
    requireThat(require('electron-builder/package.json').version === '26.15.3', 'This configuration is verified for electron-builder 26.15.3 only.');
    require.resolve('plist');
    requireThat(require('app-builder-lib/out/codeSign/macCodeSign').isSignAllowed(false), 'electron-builder would skip signing in this environment.');
    return { electronBuilder: '26.15.3', electron: require('electron/package.json').version };
  });
  check('xcode', () => {
    const developer = run('/usr/bin/xcode-select', ['-p']).stdout.trim();
    requireThat(developer.endsWith('/Contents/Developer') && fs.existsSync(path.join(developer, 'Platforms/MacOSX.platform')), 'Full Xcode must be selected; Command Line Tools alone are insufficient.');
    const version = run('/usr/bin/xcodebuild', ['-version']).stdout.trim();
    run('/usr/bin/xcodebuild', ['-checkFirstLaunchStatus']);
    run('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
    return version;
  });
  check('resources', () => validateResources(path.join(DESKTOP, 'resources'), opts.target));
  if (opts.target === 'mas') check('sourceTree', () => {
    requireThat(!run('/usr/bin/git', ['-C', DESKTOP, 'status', '--porcelain']).stdout.trim(), 'Store packaging requires a clean source tree.');
    const sha = run('/usr/bin/git', ['-C', DESKTOP, 'rev-parse', 'HEAD']).stdout.trim();
    requireThat(sha === checks.resources?.desktopGitSha, 'Desktop sources changed after CI resource staging; stage again.');
    return sha;
  });
  let appIdentity, profile, profileError;
  try {
    requireThat(opts.profile && fs.statSync(opts.profile).isFile(), 'Set WISPLAB_MAS_PROFILE to an existing provisioning profile outside the repository.');
    const real = fs.realpathSync(opts.profile), repo = fs.realpathSync(path.join(DESKTOP, '..'));
    requireThat(real !== repo && !real.startsWith(repo + path.sep), 'Keep provisioning profiles outside the source repository.');
    profile = parsePlist(run('/usr/bin/security', ['cms', '-D', '-i', real]).stdout);
  } catch (error) { profileError = error; }
  check('identities', () => {
    const suffix = opts.keychain ? [opts.keychain] : [];
    const identities = identifyCertificateTeams(parseIdentities(run('/usr/bin/security', ['find-identity', '-v', ...suffix]).stdout + '\n' + run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', ...suffix]).stdout), opts.keychain, run);
    // Store app/installer share the team qualifier: keep store ambiguity checks
    // before profile membership so Builder cannot select a different same-team
    // certificate. Development uses the exact selected SHA1 qualifier instead.
    appIdentity = selectIdentity(identities, opts.target === 'mas' ? ['Apple Distribution', '3rd Party Mac Developer Application'] : ['Mac Developer', 'Apple Development'], profile && opts.target === 'mas-dev' ? profileCertificateHashes(profile) : undefined);
    const installer = opts.target === 'mas' ? selectIdentity(identities, ['3rd Party Mac Developer Installer']) : undefined;
    if (installer) requireThat(appIdentity.name.includes(TEAM_ID) && installer.name.includes(TEAM_ID), 'Store app and installer identities must both match the shared team qualifier required by electron-builder.');
    return { app: appIdentity, ...(installer ? { installer } : {}) };
  });
  check('profile', () => {
    if (profileError) throw profileError;
    requireThat(appIdentity, 'A valid app signing identity is required to validate profile certificate membership.');
    const result = validateProfile(profile, opts.target, appIdentity);
    if (opts.target === 'mas-dev') {
      const hardware = provisioningDeviceId(JSON.parse(run('/usr/sbin/system_profiler', ['SPHardwareDataType', '-json']).stdout));
      requireThat(hardware && profile.ProvisionedDevices.some((device) => device.toUpperCase() === hardware.toUpperCase()), 'Development profile does not include this Mac; register this device and regenerate it.');
    }
    return result;
  });
  return { ok: errors.length === 0, target: opts.target, version: opts.version, buildNumber: opts.buildNumber, architecture: opts.arch, output: opts.output, checks, errors,
    scope: 'Prerequisites only. No signing, installation, submission, or App Store approval has occurred.' };
}
function assertReady(report) {
  requireThat(report.ok, `MAS preflight failed:\n${report.errors.map((error) => `- ${error.check}: ${error.message}`).join('\n')}`);
}
function verifyEntitlements(actual, expected) {
  requireThat(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) && Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value)), 'Signed entitlements differ from the explicit minimal MAS entitlement set.');
}
function verifyOutputs(opts, report, run = command) {
  const directories = fs.readdirSync(opts.output).filter((name) => name === opts.target || name === `${opts.target}-${opts.arch}`);
  requireThat(directories.length === 1, 'Expected exactly one MAS output directory for the selected architecture.');
  const output = path.join(opts.output, directories[0]);
  const app = path.join(output, 'WispLab.app');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const detail = run('/usr/bin/codesign', ['--display', '--verbose=4', app]).stderr;
  requireThat(detail.includes(`TeamIdentifier=${TEAM_ID}`) && !detail.includes('Signature=adhoc'), 'The output is unsigned, ad-hoc, or signed by another team.');
  const info = parsePlist(fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8'));
  requireThat(info.CFBundleIdentifier === BUNDLE_ID && info.CFBundleShortVersionString === opts.version && info.CFBundleVersion === opts.buildNumber && info.ElectronTeamID === TEAM_ID, 'Signed bundle identity/version mismatch.');
  requireThat(hash(fs.readFileSync(path.join(app, 'Contents/embedded.provisionprofile'))) === hash(fs.readFileSync(opts.profile)), 'Embedded provisioning profile does not match the checked profile.');
  const parent = parsePlist(fs.readFileSync(path.join(__dirname, 'entitlements.plist'), 'utf8'));
  const child = parsePlist(fs.readFileSync(path.join(__dirname, 'entitlements.inherit.plist'), 'utf8'));
  const signedEntitlements = (file) => {
    const result = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', file]);
    const text = (result.stdout + result.stderr).match(/<\?xml[\s\S]*?<\/plist>/)?.[0];
    requireThat(text, 'Unable to read signed entitlements.');
    return parsePlist(text);
  };
  verifyEntitlements(signedEntitlements(app), parent);
  const frameworks = path.join(app, 'Contents/Frameworks');
  const helpers = fs.readdirSync(frameworks).filter((name) => name.endsWith('.app'));
  requireThat(helpers.length > 0, 'Electron helper applications are missing.');
  for (const helper of helpers) verifyEntitlements(signedEntitlements(path.join(frameworks, helper)), child);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wisplab-mas-cert-'));
  try {
    const prefix = path.join(temporary, 'cert');
    // Optional long-option arguments must be attached; a separate prefix is
    // interpreted as another code path by codesign.
    run('/usr/bin/codesign', ['--display', `--extract-certificates=${prefix}`, app]);
    requireThat(hash(fs.readFileSync(prefix + '0'), 'sha1').toUpperCase() === report.checks.identities.app.sha1, 'Signed app uses a different certificate from preflight.');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  if (opts.target === 'mas') {
    const packages = fs.readdirSync(output).filter((name) => name.endsWith('.pkg'));
    requireThat(packages.length === 1, 'Expected one signed Mac App Store installer.');
    const signature = run('/usr/sbin/pkgutil', ['--check-signature', path.join(output, packages[0])]).stdout;
    requireThat(signature.includes('signed by a certificate trusted by') && signature.includes(report.checks.identities.installer.name), 'Installer signature is not trusted or uses an unexpected signing identity.');
  }
  return app;
}
module.exports = { DESKTOP, TEAM_ID, BUNDLE_ID, APP_IDENTIFIER, options, parseIdentities, certificateIdentity, identifyCertificateTeams, profileCertificateHashes, selectIdentity, validateProfile, validateResources, provisioningDeviceId, preflight, assertReady, verifyEntitlements, verifyOutputs, command };
