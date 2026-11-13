// What the web page can use when it runs inside the Windows program (window.drisproDesktop).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('drisproDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('drispro:info'),
  printers: () => ipcRenderer.invoke('drispro:printers'),
  /** kind: 'receipt' and 'kitchen' go straight to the chosen printer; 'document' opens the print window */
  /** printer: a printer by its name (a restaurant station's), from version 1.7 */
  print: (html, kind, printer) => ipcRenderer.invoke('drispro:print', { html, kind, printer }),
  openDrawer: () => ipcRenderer.invoke('drispro:drawer'),
  settings: () => ipcRenderer.invoke('drispro:settings'),
  saveSettings: (s) => ipcRenderer.invoke('drispro:save-settings', s),
  setServer: (url) => ipcRenderer.invoke('drispro:set-server', url),
  retry: () => ipcRenderer.invoke('drispro:retry'),
  /** licence code → whose it is, plan, cloud/local allowed */
  activate: (code) => ipcRenderer.invoke('drispro:activate', code),
  finishActivation: (a) => ipcRenderer.invoke('drispro:finish-activation', a),
  reactivate: () => ipcRenderer.invoke('drispro:reactivate'),
  /** this computer's licence, checked now: 'active' (the program opens), 'pending', 'blocked', 'unknown', 'offline' */
  deviceCheck: () => ipcRenderer.invoke('drispro:device-check'),
  /** the files the program saved, newest first: name, full path, time, size */
  downloads: () => ipcRenderer.invoke('drispro:downloads'),
  checkUpdate: () => ipcRenderer.invoke('drispro:check-update'),
  /** opens the folder with the file selected (only a file this program saved) */
  showInFolder: (p) => ipcRenderer.invoke('drispro:show-in-folder', p),
  openFile: (p) => ipcRenderer.invoke('drispro:open-file', p),
  /** called each time a download finishes */
  onDownloaded: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('drispro:downloaded', f); return () => ipcRenderer.removeListener('drispro:downloaded', f) },
})
