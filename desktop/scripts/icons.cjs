// Rasterize the existing WispLab brand SVG for native package icon formats.
// The PNG is committed, so normal installation/CI does not require Chromium.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../../deployment/wisplab/portal/favicon.svg'), 'utf8');
  if (!source.startsWith('<svg ') || /<script|foreignObject|href\s*=/i.test(source)) throw new Error('The icon must be a standalone trusted vector.');
  const output = path.resolve(__dirname, '../build');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    await page.setContent('<style>html,body{margin:0;width:1024px;height:1024px}svg{width:1024px;height:1024px;display:block}</style>' + source);
    await page.screenshot({ path: path.join(output, 'icon.png'), omitBackground: true });
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
