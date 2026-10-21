const path = require('node:path');
const { DESKTOP, TEAM_ID, BUNDLE_ID, options, preflight, assertReady, verifyOutputs, validateResources } = require('./checks.cjs');

// An explicit config path replaces package.json build; never spread or extend
// the experimental config because its mac.identity=null disables signing.
function createConfiguration(opts, report) {
  const signing = {
    identity: TEAM_ID,
    provisioningProfile: opts.profile,
    entitlements: path.join(__dirname, 'entitlements.plist'),
    entitlementsInherit: path.join(__dirname, 'entitlements.inherit.plist'),
    preAutoEntitlements: false,
    hardenedRuntime: false,
    type: opts.target === 'mas-dev' ? 'development' : 'distribution',
  };
  return {
    extends: null,
    appId: BUNDLE_ID,
    productName: 'WispLab',
    buildVersion: opts.buildNumber,
    forceCodeSigning: true,
    electronVersion: require('../package.json').devDependencies.electron,
    artifactName: `WispLab-${opts.version}-${opts.buildNumber}-${opts.target}-\${arch}.\${ext}`,
    directories: { output: opts.output },
    icon: 'build/icon.png',
    asar: true,
    files: ['main.cjs', 'preload.cjs', 'lib/**', 'build/icon.png', 'package.json'],
    extraMetadata: { version: opts.version, productName: 'WispLab', description: 'Local WispLab analysis tools', wisplabDistribution: { channel: opts.target, buildNumber: opts.buildNumber, appleAppId: '6825229877' } },
    extraResources: [{ from: 'resources/apps', to: 'apps' }, { from: 'resources/release.json', to: 'release.json' }],
    mac: {
      category: 'public.app-category.education',
      target: [{ target: opts.target, arch: [opts.arch] }],
      bundleVersion: opts.buildNumber,
      extendInfo: { ElectronTeamID: TEAM_ID },
      notarize: false,
    },
    mas: signing,
    masDev: { ...signing, type: 'development' },
    publish: null,
    beforePack: async (context) => {
      if (context.electronPlatformName !== 'mas' || context.targets.some((target) => target.name !== opts.target))
        throw new Error('Only the selected MAS target is allowed by this configuration.');
      assertReady(preflight(opts));
    },
    // electron-builder 26's separate MAS sign path does not emit afterSign.
    // Validate after artifacts are finished instead, including mas-dev .app.
    afterAllArtifactBuild: async () => {
      const app = verifyOutputs(opts, report);
      validateResources(path.join(app, 'Contents/Resources'), opts.target);
      return [];
    },
  };
}
module.exports = () => {
  const opts = options();
  const report = preflight(opts);
  assertReady(report);
  return createConfiguration(opts, report);
};
module.exports.createConfiguration = createConfiguration;
