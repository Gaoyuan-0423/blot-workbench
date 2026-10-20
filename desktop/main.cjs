const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { APP_ORIGIN, isAppUrl, serveAsset } = require('./lib/assets.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (!app.isPackaged && process.env.WISPLAB_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.WISPLAB_DESKTOP_USER_DATA));
const externalHosts = new Set(['wisplab.top', 'wb.wisplab.top', 'pathology.wisplab.top', 'pcr.wisplab.top', 'github.com', 'gaoyuan-0423.github.io']);
let window;
let openingExternal = false;
function languageIsChinese() { return app.getLocale().toLowerCase().startsWith('zh'); }
function text(zh, en) { return languageIsChinese() ? zh : en; }
async function openExternalConfirmed(input) {
  let url;
  try { url = new URL(input); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol) || !externalHosts.has(url.hostname) || url.username || url.password || openingExternal) return;
  openingExternal = true;
  try {
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: text('打开外部网页', 'Open external website'),
      message: text('此链接将在系统浏览器中打开，需要网络连接。', 'This link will open in your system browser and needs an internet connection.'),
      detail: url.href,
      buttons: [text('取消', 'Cancel'), text('打开浏览器', 'Open browser')],
      defaultId: 0, cancelId: 0,
    });
    if (answer.response === 1) await shell.openExternal(url.href);
  } finally { openingExternal = false; }
}
function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 390, minHeight: 600,
    icon: path.join(__dirname, 'build/icon.png'),
    title: 'WispLab Experimental — unsigned / 未签名实验版', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, partition: 'persist:wisplab-desktop' },
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault(); void openExternalConfirmed(url);
  });
  window.webContents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Existing web tutorials sometimes use target="_blank". Keep them local in
    // this single trusted window instead of creating another renderer window.
    if (isAppUrl(url)) void window?.loadURL(url);
    else void openExternalConfirmed(url);
    return { action: 'deny' };
  });
  window.on('page-title-updated', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = undefined; });
  const start = !app.isPackaged && isAppUrl(process.env.WISPLAB_DESKTOP_TEST_URL) ? process.env.WISPLAB_DESKTOP_TEST_URL : APP_ORIGIN + '/';
  void window.loadURL(start);
}
app.whenReady().then(() => {
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');
  const appsRoot = path.join(resources, 'apps');
  for (const tool of ['portal', 'wb', 'pathology', 'pcr']) {
    if (!fs.existsSync(path.join(appsRoot, tool, 'index.html'))) throw new Error(text(`缺少内置 ${tool} 资源。请先完成桌面资源组装，再启动。`, `Missing bundled ${tool} assets. Run the desktop staging command before starting.`));
  }
  const desktopSession = session.fromPartition('persist:wisplab-desktop');
  desktopSession.protocol.handle('app', request => serveAsset(request, appsRoot));
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.on('will-download', (event, item, contents) => {
    if (!contents || contents !== window?.webContents || item.getInitiatorOrigin() !== APP_ORIGIN || !/^(blob:app:\/\/wisplab\/|data:|app:\/\/wisplab\/)/.test(item.getURL())) {
      event.preventDefault(); return;
    }
    // Leaving savePath unset invokes Electron's native Save dialog.
    item.setSaveDialogOptions({
      title: text('保存分析结果', 'Save analysis result'),
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename()).replace(/[\u0000-\u001f]/g, '_')),
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
  });
  ipcMain.handle('wisplab:get-app-version', event => {
    if (event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Untrusted caller');
    return app.getVersion();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'WispLab', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: text('编辑', 'Edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: text('视图', 'View'), submenu: [{ label: text('总首页', 'Home'), click: () => window?.loadURL(APP_ORIGIN + '/') }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}).catch(error => {
  dialog.showErrorBox(text('WispLab 桌面版无法启动', 'WispLab desktop could not start'), error.message);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
