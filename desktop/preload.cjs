const { contextBridge, ipcRenderer } = require('electron');
// No generic IPC, filesystem, shell, or credentials are exposed to web content.
contextBridge.exposeInMainWorld('wispLabDesktop', Object.freeze({
  isDesktop: true,
  getAppVersion: () => ipcRenderer.invoke('wisplab:get-app-version'),
}));
