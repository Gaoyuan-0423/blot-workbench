const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
(async () => {
  const output = path.resolve(__dirname, '../out');
  const names = fs.readdirSync(output).filter(name => /\.(dmg|zip|exe|blockmap)$/.test(name)).sort();
  if (!names.length) throw new Error('No installer or archive is present to checksum.');
  const lines = [];
  for (const name of names) {
    const hash = createHash('sha256');
    for await (const bytes of fs.createReadStream(path.join(output, name))) hash.update(bytes);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  fs.writeFileSync(path.join(output, 'SHASUMS256.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
