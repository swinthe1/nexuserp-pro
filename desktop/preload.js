// What the web page can use when it runs inside the Windows program (window.drisproDesktop).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('drisproDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('drispro:info'),
  printers: () => ipcRenderer.invoke('drispro:printers'),
  /** kind: 'receipt' and 'kitchen' go straight to the chosen printer; 'document' opens the print window */
  print: (html, kind) => ipcRenderer.invoke('drispro:print', { html, kind }),
  openDrawer: () => ipcRenderer.invoke('drispro:drawer'),
  settings: () => ipcRenderer.invoke('drispro:settings'),
  saveSettings: (s) => ipcRenderer.invoke('drispro:save-settings', s),
  setServer: (url) => ipcRenderer.invoke('drispro:set-server', url),
  retry: () => ipcRenderer.invoke('drispro:retry'),
  /** licence code → whose it is, plan, cloud/local allowed */
  activate: (code) => ipcRenderer.invoke('drispro:activate', code),
  finishActivation: (a) => ipcRenderer.invoke('drispro:finish-activation', a),
  reactivate: () => ipcRenderer.invoke('drispro:reactivate'),
})
