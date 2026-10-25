const fs = require('node:fs/promises');
const path = require('node:path');

const APP_ORIGIN = 'app://wisplab';
const API_ORIGINS = [
  'https://api.openai.com',
  'https://dashscope.aliyuncs.com',
  'https://dashscope-intl.aliyuncs.com',
  'https://api.siliconflow.cn',
  'https://api.deepseek.com',
  'https://api.moonshot.cn',
];
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  `connect-src 'self' ${API_ORIGINS.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.zip': 'application/zip', '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.rdml': 'application/xml',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function isAppUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'app:' && url.hostname === 'wisplab' && !url.port && !url.username && !url.password;
  } catch { return false; }
}
function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function route(input) {
  if (!isAppUrl(input)) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(input).pathname); } catch { return null; }
  if (!pathname.startsWith('/') || /[\\\u0000-\u001f\u007f:]/.test(pathname)) return null;
  const parts = pathname.split('/').slice(1);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  const tool = ['wb', 'pathology', 'pcr'].includes(parts[0]) ? parts.shift() : 'portal';
  // Only the four installed tool roots are served, never arbitrary OS paths.
  const relative = parts.join('/') || 'index.html';
  return { tool, file: relative.endsWith('/') ? relative + 'index.html' : relative };
}
function headers(type) {
  return {
    'Content-Type': type,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}
async function serveAsset(request, appsRoot) {
  const reply = (text, status) => new Response(text, { status, headers: headers('text/plain; charset=utf-8') });
  if (!['GET', 'HEAD'].includes(request.method)) return reply('Method not allowed', 405);
  const target = route(request.url);
  if (!target) return reply('Not found', 404);
  const parsed = new URL(request.url);
  if (/^\/(wb|pathology|pcr)$/.test(parsed.pathname)) {
    parsed.pathname += '/';
    return new Response(null, { status: 308, headers: { ...headers('text/plain'), Location: parsed.href } });
  }
  try {
    const installed = await fs.realpath(appsRoot);
    const root = await fs.realpath(path.join(appsRoot, target.tool));
    if (!within(installed, root)) return reply('Not found', 404);
    const file = await fs.realpath(path.resolve(root, target.file));
    if (!within(root, file)) return reply('Not found', 404);
    const type = TYPES[path.extname(file).toLowerCase()];
    const stat = await fs.stat(file);
    if (!type || !stat.isFile() || stat.size > 256 * 1024 * 1024) return reply('Not found', 404);
    return new Response(request.method === 'HEAD' ? null : await fs.readFile(file), { headers: headers(type) });
  } catch { return reply('Not found', 404); }
}
module.exports = { APP_ORIGIN, API_ORIGINS, CONTENT_SECURITY_POLICY, isAppUrl, route, serveAsset };
