import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const licenseDescription = (value) => {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.map(licenseDescription).join(' OR ') || 'UNKNOWN';
  return typeof value?.type === 'string' ? value.type : 'UNKNOWN';
};

export async function generateNotices({ root = process.cwd(), includeDev = false } = {}) {
  const lockText = await readFile(resolve(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockText);
  if (!lock.packages) throw new Error('A package-lock.json with a packages inventory is required.');
  const workspaces = new Set(lock.packages['']?.workspaces ?? []);
  const lines = [
    'THIRD-PARTY NOTICES', '',
    `Project: ${lock.name ?? 'blot-workbench'} ${lock.version ?? ''}`,
    `Lockfile SHA-256: ${createHash('sha256').update(lockText).digest('hex')}`,
    `Scope: ${includeDev ? 'production and development' : 'production'} dependencies in package-lock.json.`,
    'Generated from dependency metadata and available LICENSE/COPYING/NOTICE files.',
    'This is an inventory, not a legal determination. Review UNKNOWN and missing license texts.',
    'Optional dependencies absent on this platform remain listed when present in the lockfile.', '',
  ];
  for (const [packagePath, entry] of Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!packagePath || (!includeDev && entry.dev === true)) continue;
    // A workspace is listed twice: its source directory and its node_modules link.
    // Read the declared source once, including its own LICENSE file.
    if (entry.link === true && workspaces.has(entry.resolved)) continue;
    const workspace = workspaces.has(packagePath) && /^[a-zA-Z0-9@._/-]+$/.test(packagePath) && !packagePath.startsWith('/');
    if ((!packagePath.startsWith('node_modules/') && !workspace) || packagePath.split('/').includes('..')) throw new Error(`Unsupported dependency path: ${packagePath}`);
    const directory = resolve(root, packagePath);
    let manifest = null;
    try { manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const name = manifest?.name ?? packagePath.split('node_modules/').at(-1);
    lines.push('='.repeat(72), `${name}@${manifest?.version ?? entry.version ?? 'UNKNOWN'}`, `Installed path: ${packagePath}`, `Declared license: ${licenseDescription(manifest?.license ?? manifest?.licenses ?? entry.license)}`);
    const repository = manifest?.repository;
    if (repository) lines.push(`Repository: ${typeof repository === 'string' ? repository : repository.url ?? 'UNKNOWN'}`);
    let files = [];
    try { files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)).sort(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let included = 0;
    for (const file of files) {
      const path = resolve(directory, file);
      const stat = await lstat(path);
      if (!stat.isFile()) continue;
      if (stat.size > 512_000) { lines.push(`Manual review required: ${file} exceeds the license-text size limit.`); continue; }
      lines.push('', `--- ${file} ---`, (await readFile(path, 'utf8')).trimEnd());
      included += 1;
    }
    if (!included) lines.push('License text: NOT COLLECTED. Review the dependency source before distribution.');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  let output = '.release/THIRD_PARTY_NOTICES.txt';
  let includeDev = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--include-dev') includeDev = true;
    else if (args[i] === '--output' && args[i + 1]) output = args[++i];
    else throw new Error('Usage: node scripts/third-party-notices.mjs [--output file] [--include-dev]');
  }
  const notices = await generateNotices({ includeDev });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), notices);
  console.log(`Wrote third-party inventory: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
