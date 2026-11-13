// The hidden help-at-a-distance page and the bar on the screen: only these few calls, nothing else.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('drisproSupport', {
  /** where to listen: the realtime address, the public key, this computer's channel and label */
  config: () => ipcRenderer.invoke('support:config'),
  /** a request arrived: the server checks it, then the person is asked → { ok, ice, who } | { ok: false, declined | unanswered } */
  request: (session) => ipcRenderer.invoke('support:request', session),
  /** the screen is being shared: the bar appears */
  active: (a) => ipcRenderer.invoke('support:active', a),
  /** it ended (by: client, admin, failed): the bar goes, the server is told */
  ended: (a) => ipcRenderer.invoke('support:ended', a),
  /** the bar's "Stop" */
  stop: () => ipcRenderer.invoke('support:stop'),
  onStop: (cb) => { ipcRenderer.on('support:stop', () => cb()) },
  /** one mouse or key event from the support person (used only when the person here allowed control) */
  input: (session, ev) => ipcRenderer.send('support:input', { session, ev }),
})
