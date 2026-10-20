/* Test-only workaround for Playwright's packaged Electron startup race.
 * The app may finish its initial custom-protocol navigation while Playwright
 * still holds an empty frame tree. Only reload an already rendered local portal;
 * never turn a missing/blank/error page into an apparent successful launch.
 * This file is excluded from the distributed application.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Local CDP connection timed out')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Local CDP connection failed')); }, { once: true });
  });
}

async function restoreInitialNavigation(profile, reports) {
  const deadline = Date.now() + 30_000;
  let target, port;
  while (Date.now() < deadline) {
    try {
      const lines = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
      if (!/^\d{1,5}$/.test(lines[0]) || Number(lines[0]) < 1 || Number(lines[0]) > 65535) throw new Error('Invalid local CDP port');
      port = Number(lines[0]);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      target = targets.find(item => item.type === 'page' && item.url === 'app://wisplab/');
      if (target) break;
    } catch { /* The fresh test process may not have written its endpoint yet. */ }
    await delay(200);
  }
  if (!target) throw new Error('Packaged application did not create its local portal target');
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port) throw new Error('Unexpected local CDP endpoint');
  const socket = await connect(url.href);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`CDP ${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await command('Page.enable');
    let state;
    while (Date.now() < deadline) {
      const result = await command('Runtime.evaluate', {
        expression: `(() => {
          const heading = document.querySelector('h1'), box = heading?.getBoundingClientRect();
          return { url: location.href, readyState: document.readyState,
            heading: heading?.textContent?.trim() || '',
            visible: !!box && box.width > 0 && box.height > 0 && getComputedStyle(heading).visibility !== 'hidden',
            localTools: ['wb','pathology','pcr'].every(tool => Array.from(document.querySelectorAll('a[href]')).some(a => a.href.startsWith('app://wisplab/' + tool + '/')))
          };
        })()`,
        returnByValue: true,
      });
      state = result.result?.value;
      if (state?.url === 'app://wisplab/' && state.readyState === 'complete' && state.heading && state.visible && state.localTools) break;
      await delay(200);
    }
    if (state?.url !== 'app://wisplab/' || state.readyState !== 'complete' || !state.heading || !state.visible || !state.localTools) {
      throw new Error('Packaged portal was not visibly rendered before startup reload: ' + JSON.stringify(state));
    }
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(reports, 'packaged-before-reload.png'), Buffer.from(screenshot.data, 'base64'));
    await command('Page.reload');
    return state;
  } finally {
    socket.close();
    for (const request of pending.values()) clearTimeout(request.timer);
  }
}

module.exports = { restoreInitialNavigation };
