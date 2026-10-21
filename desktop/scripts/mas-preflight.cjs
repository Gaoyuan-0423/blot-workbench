#!/usr/bin/env node
const { options, preflight } = require('../mas/checks.cjs');
function targetArgument(args) {
  if (args.length === 0) return 'mas';
  if (args.length === 2 && args[0] === '--target' && ['mas', 'mas-dev'].includes(args[1])) return args[1];
  throw new Error('Usage: node scripts/mas-preflight.cjs [--target mas|mas-dev]');
}
if (require.main === module) {
  try {
    const report = preflight(options(process.env, targetArgument(process.argv.slice(2))));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) { console.error(`MAS preflight failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { targetArgument };
