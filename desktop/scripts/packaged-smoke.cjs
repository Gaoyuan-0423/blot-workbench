const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const product = require('../package.json').productName;
let binary;
if (process.platform === 'win32') binary = path.join(root, 'out/win-unpacked', product + '.exe');
else if (process.platform === 'darwin') binary = path.join(root, process.arch === 'arm64' ? 'out/mac-arm64' : 'out/mac', product + '.app/Contents/MacOS/' + product);
else throw new Error('Packaged smoke must run on the target macOS or Windows platform.');
if (!fs.existsSync(binary)) throw new Error('Build the native package before testing it: ' + binary);
const result = spawnSync(process.execPath, [path.join(__dirname, 'smoke.cjs')], {
  cwd: root, env: { ...process.env, WISPLAB_DESKTOP_BINARY: binary }, stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
