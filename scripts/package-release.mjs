import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { generateNotices } from './third-party-notices.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const comparePaths = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export async function packageRelease({ root = process.cwd(), outputDir = '.release', allowDirty = false } = {}) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkg.name) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Package name/version cannot safely form a release filename.');
  let commit = null;
  let dirty = true;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  } catch { /* An uncommitted source tree is allowed only with the explicit testing flag. */ }
  if ((!commit || dirty) && !allowDirty) throw new Error('Release packaging requires a clean committed tree. Use --allow-dirty only for local testing.');
  const files = {};
  async function addFile(source, destination) {
    const stat = await lstat(source);
    if (!stat.isFile()) throw new Error(`Release input must be a regular file: ${destination}`);
    files[destination] = new Uint8Array(await readFile(source));
  }
  async function addDirectory(source, destination) {
    const stat = await lstat(source);
    if (!stat.isDirectory()) throw new Error(`Release input must be a directory: ${destination}`);
    for (const entry of (await readdir(source)).sort()) {
      if (entry === '.DS_Store') continue;
      const path = join(source, entry);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Symlinks are not accepted in release input: ${destination}/${entry}`);
      if (info.isDirectory()) await addDirectory(path, `${destination}/${entry}`);
      else await addFile(path, `${destination}/${entry}`);
    }
  }
  await addDirectory(resolve(root, 'dist'), 'dist');
  if (!files['dist/index.html']) throw new Error('A built dist/index.html is required. Run npm run check first.');
  let exampleDirectory;
  for (const candidate of ['public/examples', 'examples']) {
    try { if ((await lstat(resolve(root, candidate))).isDirectory()) { exampleDirectory = candidate; break; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!exampleDirectory) throw new Error('Expected examples/ or public/examples/ containing the release examples.');
  await addDirectory(resolve(root, exampleDirectory), exampleDirectory);
  if (!Object.keys(files).some((path) => path.startsWith(`${exampleDirectory}/`))) throw new Error('The release examples directory is empty.');
  try { await addDirectory(resolve(root, 'docs'), 'docs'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of ['README.md', 'LICENSE']) await addFile(resolve(root, file), file);
  for (const file of ['README.en.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CITATION.cff', 'DISTRIBUTION.md']) {
    try { await addFile(resolve(root, file), file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files['THIRD_PARTY_NOTICES.txt'] = strToU8(await generateNotices({ root }));
  const manifest = {
    schemaVersion: 1, name: pkg.name, version: pkg.version, sourceCommit: commit, sourceDirty: dirty,
    publication: 'This script creates local files only. It does not create or verify a repository, tag, release, or deployment.',
    verification: 'Packaging does not run or certify tests. sourceCommit identifies the source checkout; it does not attest that dist was built from that commit. Record build and test evidence separately.',
    repeatability: 'Payload paths use a fixed ordering and ZIP entry times are fixed. Identical input files and dependency license texts with the same packaging implementation produce the same archive; cross-platform build reproducibility is not certified.',
    distribution: 'Static web application and examples; serve dist/ over localhost or HTTPS. Opening index.html with file:// is not a supported installation.',
    integrity: 'SHA-256 covers every payload file listed below. This manifest does not hash itself; SHA256SUMS covers the complete ZIP.',
    files: Object.entries(files).sort(([a], [b]) => comparePaths(a, b)).map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: sha256(bytes) })),
  };
  const manifestBytes = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  files['release-manifest.json'] = manifestBytes;
  const prefix = `${pkg.name}-${pkg.version}`;
  const archiveFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => comparePaths(a, b)).map(([path, data]) => [`${prefix}/${path}`, [data, { mtime: new Date(1980, 0, 1) }]]));
  const archive = zipSync(archiveFiles, { level: 6 });
  const directory = resolve(root, outputDir);
  await mkdir(directory, { recursive: true });
  const archiveName = `${prefix}-web.zip`;
  const manifestName = `${prefix}-manifest.json`;
  await writeFile(resolve(directory, archiveName), archive);
  await writeFile(resolve(directory, 'SHA256SUMS'), `${sha256(archive)}  ${archiveName}\n${sha256(manifestBytes)}  ${manifestName}\n`);
  await writeFile(resolve(directory, manifestName), manifestBytes);
  return { archive: resolve(directory, archiveName), checksum: resolve(directory, 'SHA256SUMS'), manifest };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--allow-dirty')) throw new Error('Usage: node scripts/package-release.mjs [--allow-dirty]');
  const result = await packageRelease({ allowDirty: args.includes('--allow-dirty') });
  console.log(`Created ${result.archive}\nChecksums: ${result.checksum}`);
  if (result.manifest.sourceDirty) console.warn('This is a dirty-tree test package, not a verified release.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
