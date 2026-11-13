// The window's only door to the program: start an engine action, and hear what it says.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('server', {
  info: () => ipcRenderer.invoke('info'),
  run: (action, input, keepData) => ipcRenderer.invoke('run', { action, input, keepData }),
  restartComputer: () => ipcRenderer.invoke('restart-computer'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  installed: () => ipcRenderer.invoke('installed'),
  onEngine: (cb) => ipcRenderer.on('engine', (_e, m) => cb(m)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onPage: (cb) => ipcRenderer.on('page', (_e, p) => cb(p)),
})
