// What the web page can use when it runs inside the Windows program (window.nexusDesktop).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('nexusDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('nexus:info'),
  printers: () => ipcRenderer.invoke('nexus:printers'),
  /** kind: 'receipt' and 'kitchen' go straight to the chosen printer; 'document' opens the print window */
  print: (html, kind) => ipcRenderer.invoke('nexus:print', { html, kind }),
  openDrawer: () => ipcRenderer.invoke('nexus:drawer'),
  settings: () => ipcRenderer.invoke('nexus:settings'),
  saveSettings: (s) => ipcRenderer.invoke('nexus:save-settings', s),
  setServer: (url) => ipcRenderer.invoke('nexus:set-server', url),
  retry: () => ipcRenderer.invoke('nexus:retry'),
})
