#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { DESKTOP, options, preflight, assertReady } = require('../mas/checks.cjs');
const { targetArgument } = require('./mas-preflight.cjs');

async function main() {
  const opts = options(process.env, targetArgument(process.argv.slice(2)));
  process.env.WISPLAB_MAS_TARGET = opts.target;
  const report = preflight(opts);
  console.log(JSON.stringify(report, null, 2));
  assertReady(report);
  if (fs.existsSync(opts.output)) throw new Error(`Output already exists: ${opts.output}. Preserve or remove the prior build before rebuilding this version/build/architecture.`);
  const { build, Platform, Arch } = require('electron-builder');
  await build({ projectDir: DESKTOP, config: path.join(DESKTOP, 'mas/config.cjs'), targets: Platform.MAC.createTarget([opts.target], Arch[opts.arch]), publish: 'never' });
  console.log(`Signed artifacts verified in ${opts.output}. No upload or submission was performed; sandbox testing and App Store validation are still required.`);
}
function failBuild(error) {
  console.error(`MAS build blocked: ${error.message}`);
  process.exitCode = 1;
  // temp-file's asynchronous exit hook can replace the pending exit code with
  // zero. Preserve failure after cleanup, as electron-builder's CLI does.
  process.once('exit', () => { process.exitCode = 1; });
}
if (require.main === module) main().catch(failBuild);
module.exports = { failBuild };
