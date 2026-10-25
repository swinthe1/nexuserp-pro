// NexusERP for Windows: the whole web application in its own window, plus what a browser cannot do:
// printing straight to the receipt and kitchen printers (no print window), opening the cash drawer of a
// network printer, starting with Windows, full screen for tills. The application itself comes from the
// server (always the latest version) and keeps working offline the same way as in the browser.
const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron')
const fs = require('fs')
const net = require('net')
const path = require('path')

const DEFAULT_SERVER = 'https://erp.dris-ks.com'
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const defaults = { server: DEFAULT_SERVER, receiptPrinter: '', kitchenPrinter: '', documentPrinter: '', paperWidth: 80, drawer: { mode: 'none', host: '', port: 9100 }, autoStart: false, fullScreen: false, bounds: null }
function readSettings() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } } catch { return { ...defaults } }
}
function writeSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)) } catch { /* keep going */ }
}
let settings
let win

// one window only: a second start brings the first one forward
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

function origin() { try { return new URL(settings.server).origin } catch { return DEFAULT_SERVER } }

function createWindow() {
  const b = settings.bounds
  win = new BrowserWindow({
    width: b?.width ?? 1366, height: b?.height ?? 860, x: b?.x, y: b?.y, minWidth: 900, minHeight: 600,
    title: 'NexusERP', backgroundColor: '#ffffff', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  })
  if (settings.fullScreen) win.setFullScreen(true)
  win.once('ready-to-show', () => win.show())
  win.on('close', () => { if (!win.isFullScreen() && !win.isMaximized()) { settings.bounds = win.getBounds(); writeSettings(settings) } })
  // links to other sites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin())) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } } }
    void shell.openExternal(url); return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin()) && !url.startsWith('file:')) { e.preventDefault(); void shell.openExternal(url) } })
  // the server cannot be reached and nothing is kept yet: a page to try again or change the address
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith('file:')) void win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: settings.server } })
  })
  void win.loadURL(settings.server)
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'NexusERP', submenu: [
      { label: 'Rifresko', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
      { label: 'Rifresko plotësisht', accelerator: 'CmdOrCtrl+Shift+R', click: () => win?.webContents.reloadIgnoringCache() },
      { label: 'Ekran i plotë', accelerator: 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { label: 'Zmadho', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
      { label: 'Zvogëlo', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: 'Madhësia normale', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Mjetet e zhvilluesit', accelerator: 'CmdOrCtrl+Shift+I', click: () => win?.webContents.toggleDevTools() },
      { label: 'Dil', accelerator: 'Alt+F4', role: 'quit' },
    ] },
  ]))
}

/* ------------------------------------------------------------------ printing */
const microns = (mm) => Math.round(mm * 1000)
async function printHtml({ html, kind }) {
  const device = kind === 'receipt' ? settings.receiptPrinter : kind === 'kitchen' ? settings.kitchenPrinter : settings.documentPrinter
  const silent = (kind === 'receipt' || kind === 'kitchen') && !!device
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const opts = { silent, printBackground: false, deviceName: device || undefined, margins: { marginType: 'none' } }
    // a roll of paper: as wide as the roll, as long as the content
    if (kind === 'receipt' || kind === 'kitchen') {
      const height = await w.webContents.executeJavaScript('document.documentElement.scrollHeight', true).catch(() => 1200)
      opts.pageSize = { width: microns(settings.paperWidth || 80), height: Math.max(microns(60), Math.round((Number(height) + 40) * 264.58)) }
    }
    await new Promise((resolve, reject) => w.webContents.print(opts, (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason)))))
    return { ok: true, printer: device || null, silent }
  } finally { setTimeout(() => w.destroy(), 500) }
}

// ESC p 0 25 250: the usual pulse that opens a drawer connected to a receipt printer
function openDrawer() {
  const d = settings.drawer || {}
  if (d.mode !== 'network' || !d.host) return Promise.resolve({ ok: false, reason: 'not set' })
  return new Promise((resolve) => {
    const s = net.createConnection({ host: d.host, port: Number(d.port) || 9100, timeout: 3000 }, () => {
      s.end(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]))
    })
    s.on('close', () => resolve({ ok: true }))
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, reason: 'timeout' }) })
    s.on('error', (e) => resolve({ ok: false, reason: e.message }))
  })
}

/* ------------------------------------------------------------------ what the page can ask */
const fromApp = (e) => { try { const u = new URL(e.senderFrame?.url ?? e.sender.getURL()); return u.origin === origin() || u.protocol === 'file:' } catch { return false } }
function handle(name, fn) { ipcMain.handle(name, async (e, arg) => { if (!fromApp(e)) throw new Error('not allowed'); return fn(arg, e) }) }

handle('nexus:info', () => ({ version: app.getVersion(), platform: process.platform, server: settings.server }))
handle('nexus:printers', async (_a, e) => (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault, description: p.description })))
handle('nexus:print', (a) => printHtml(a))
handle('nexus:drawer', () => openDrawer())
handle('nexus:settings', () => { const { bounds, ...s } = settings; return { ...s, autoStart: app.getLoginItemSettings().openAtLogin } })
handle('nexus:save-settings', (s) => {
  const next = { ...settings }
  for (const k of ['receiptPrinter', 'kitchenPrinter', 'documentPrinter']) if (typeof s?.[k] === 'string') next[k] = s[k]
  if (Number(s?.paperWidth) >= 40 && Number(s?.paperWidth) <= 120) next.paperWidth = Number(s.paperWidth)
  if (s?.drawer) next.drawer = { mode: s.drawer.mode === 'network' ? 'network' : 'none', host: String(s.drawer.host ?? ''), port: Number(s.drawer.port) || 9100 }
  if (typeof s?.fullScreen === 'boolean') { next.fullScreen = s.fullScreen; win?.setFullScreen(s.fullScreen) }
  if (typeof s?.autoStart === 'boolean') { next.autoStart = s.autoStart; app.setLoginItemSettings({ openAtLogin: s.autoStart }) }
  settings = next; writeSettings(settings)
  return true
})
handle('nexus:set-server', async (url) => {
  let u
  try { u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) throw new Error() } catch { throw new Error('Adresa nuk është e vlefshme') }
  const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Po', 'Jo'], defaultId: 0, message: `Të hapet NexusERP nga ${u.origin}?` })
  if (ok.response !== 0) return false
  settings.server = u.origin; writeSettings(settings); void win.loadURL(settings.server)
  return true
})
handle('nexus:retry', () => { void win.loadURL(settings.server); return true })

app.whenReady().then(() => {
  settings = readSettings()
  buildMenu()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
