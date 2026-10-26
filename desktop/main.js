// DrisPRO for Windows and Mac: the whole web application in its own window, plus what a browser cannot do:
// printing straight to the receipt and kitchen printers (no print window), opening the cash drawer of a
// network printer, starting with Windows, full screen for tills. The application itself comes from the
// server (always the latest version) and keeps working offline the same way as in the browser.
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, net: enet } = require('electron')
const fs = require('fs')
const net = require('net')
const path = require('path')
const isMac = process.platform === 'darwin'

const DEFAULT_SERVER = 'https://erp.dris-ks.com'
// where licences are checked (our cloud), with its public key (anon role: only the public licence functions)
const LICENCE_API = 'https://api.erp.dris-ks.com'
const LICENCE_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0'
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const defaults = { licence: '', mode: '', company: '', server: DEFAULT_SERVER, receiptPrinter: '', kitchenPrinter: '', documentPrinter: '', paperWidth: 80, drawer: { mode: 'none', host: '', port: 9100 }, autoStart: false, fullScreen: false, bounds: null }
function readSettings() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } } catch { return { ...defaults } }
}
function writeSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)) } catch { /* keep going */ }
}
let settings = readSettings()
let win
// a local server on a plain address (http://192.168.x.x) is treated like https, so offline work and the device's ids work there too
if (/^http:\/\//.test(settings.server)) app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', new URL(settings.server).origin)

// one window only: a second start brings the first one forward
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

function origin() { try { return new URL(settings.server).origin } catch { return DEFAULT_SERVER } }

function createWindow() {
  const b = settings.bounds
  win = new BrowserWindow({
    width: b?.width ?? 1366, height: b?.height ?? 860, x: b?.x, y: b?.y, minWidth: 900, minHeight: 600,
    title: 'DrisPRO', backgroundColor: '#ffffff', show: false, autoHideMenuBar: true,
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
  if (!settings.licence) void win.loadFile(path.join(__dirname, 'activation.html'))
  else void win.loadURL(settings.server)
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    // on a Mac the first menu carries the program's name; Cmd+C / Cmd+V need the Edit menu to work at all
    ...(isMac ? [{ label: 'DrisPRO', submenu: [
      { label: 'Rreth DrisPRO', role: 'about' },
      { type: 'separator' },
      { label: 'Fshih DrisPRO', role: 'hide' },
      { label: 'Fshih të tjerat', role: 'hideOthers' },
      { type: 'separator' },
      { label: 'Dil nga DrisPRO', role: 'quit' },
    ] }] : []),
    { label: 'Ndrysho', submenu: [
      { label: 'Zhbëj', role: 'undo' }, { label: 'Ribëj', role: 'redo' }, { type: 'separator' },
      { label: 'Prit', role: 'cut' }, { label: 'Kopjo', role: 'copy' }, { label: 'Ngjit', role: 'paste' }, { label: 'Zgjidh të gjitha', role: 'selectAll' },
    ] },
    { label: isMac ? 'Pamja' : 'DrisPRO', submenu: [
      { label: 'Rifresko', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
      { label: 'Rifresko plotësisht', accelerator: 'CmdOrCtrl+Shift+R', click: () => win?.webContents.reloadIgnoringCache() },
      { label: 'Ekran i plotë', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => win?.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { label: 'Zmadho', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
      { label: 'Zvogëlo', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: 'Madhësia normale', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Kontrollo për version të ri', click: () => void checkForUpdate(true) },
      { label: 'Mjetet e zhvilluesit', accelerator: isMac ? 'Alt+Cmd+I' : 'CmdOrCtrl+Shift+I', click: () => win?.webContents.toggleDevTools() },
      ...(isMac ? [] : [{ label: 'Dil', accelerator: 'Alt+F4', role: 'quit' }]),
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

handle('drispro:info', () => ({ version: app.getVersion(), platform: process.platform, server: settings.server }))
handle('drispro:printers', async (_a, e) => (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault, description: p.description })))
handle('drispro:print', (a) => printHtml(a))
handle('drispro:drawer', () => openDrawer())
handle('drispro:settings', () => { const { bounds, ...s } = settings; return { ...s, autoStart: app.getLoginItemSettings().openAtLogin } })
handle('drispro:save-settings', (s) => {
  const next = { ...settings }
  for (const k of ['receiptPrinter', 'kitchenPrinter', 'documentPrinter']) if (typeof s?.[k] === 'string') next[k] = s[k]
  if (Number(s?.paperWidth) >= 40 && Number(s?.paperWidth) <= 120) next.paperWidth = Number(s.paperWidth)
  if (s?.drawer) next.drawer = { mode: s.drawer.mode === 'network' ? 'network' : 'none', host: String(s.drawer.host ?? ''), port: Number(s.drawer.port) || 9100 }
  if (typeof s?.fullScreen === 'boolean') { next.fullScreen = s.fullScreen; win?.setFullScreen(s.fullScreen) }
  if (typeof s?.autoStart === 'boolean') { next.autoStart = s.autoStart; app.setLoginItemSettings({ openAtLogin: s.autoStart }) }
  settings = next; writeSettings(settings)
  return true
})
handle('drispro:set-server', async (url) => {
  let u
  try { u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) throw new Error() } catch { throw new Error('Adresa nuk është e vlefshme') }
  const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Po', 'Jo'], defaultId: 0, message: `Të hapet DrisPRO nga ${u.origin}?` })
  if (ok.response !== 0) return false
  settings.server = u.origin; writeSettings(settings)
  if (u.protocol === 'http:') { app.relaunch(); app.exit(0); return true }
  void win.loadURL(settings.server)
  return true
})
handle('drispro:retry', () => { void win.loadURL(settings.server); return true })

/* ------------------------------------------------------------------ licence and where the data lives */
async function post(url, body, headers = {}) {
  const r = await enet.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const text = await r.text()
  let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  if (!r.ok) throw new Error(json?.message || text.slice(0, 200) || `HTTP ${r.status}`)
  return json
}
const SERVER_MSG = {
  'This licence code is not known': 'Ky kod licence nuk njihet. Kontrollojeni dhe provoni përsëri.',
  'This licence is not active; ask your DrisPRO supplier': 'Kjo licencë nuk është aktive; pyesni furnitorin e DrisPRO.',
}
handle('drispro:activate', async (code) => {
  const c = String(code ?? '').trim().toUpperCase()
  if (!/^NXS(-[A-Z0-9]{4}){3}$/.test(c)) throw new Error('Kodi duket kështu: NXS-XXXX-XXXX-XXXX')
  try { return await post(`${LICENCE_API}/rest/v1/rpc/licence_activate`, { p_code: c }, { apikey: LICENCE_KEY, Authorization: `Bearer ${LICENCE_KEY}` }) }
  catch (e) { const m = String(e.message); throw new Error(SERVER_MSG[m] ?? (/fetch failed|ENOTFOUND|ECONN|network/i.test(m) ? 'Aktivizimi kërkon internet një herë. Lidhuni dhe provoni përsëri.' : m)) }
})
handle('drispro:finish-activation', async (a) => {
  const lic = await post(`${LICENCE_API}/rest/v1/rpc/licence_activate`, { p_code: a.code }, { apikey: LICENCE_KEY, Authorization: `Bearer ${LICENCE_KEY}` })
  let server = DEFAULT_SERVER
  if (a.mode === 'local') {
    let u
    try { u = new URL(/^https?:\/\//.test(a.server) ? a.server : `http://${a.server}`) } catch { throw new Error('Shkruani adresën e serverit, p.sh. http://192.168.1.20') }
    // it must be a DrisPRO local server
    // (a server not yet updated still answers under the older name)
    let r = await enet.fetch(`${u.origin}/drispro-config.js`).catch(() => null)
    if (!r || !r.ok) r = await enet.fetch(`${u.origin}/${'nexus'}-config.js`).catch(() => null)
    const text = r && r.ok ? await r.text() : ''
    if (!/local:\s*true/.test(text)) throw new Error(`Në ${u.origin} nuk u gjet një server lokal i DrisPRO. Kontrolloni adresën dhe që serveri është ndezur.`)
    server = u.origin
  } else if (lic.deployment === 'local') throw new Error('Kjo licencë është vetëm për server lokal.')
  settings = { ...settings, licence: lic.code, mode: a.mode, company: lic.company?.name ?? '', server }
  writeSettings(settings)
  // a plain-http local server needs the program to start again once (see the start of this file)
  if (server.startsWith('http://')) { app.relaunch(); app.exit(0); return true }
  void win.loadURL(settings.server)
  return true
})
handle('drispro:reactivate', async () => {
  const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Po', 'Jo'], defaultId: 1, message: 'Të ndryshohet licenca ose vendi i të dhënave (Cloud / server lokal)?', detail: 'Të dhënat nuk fshihen; programi thjesht lidhet me serverin që zgjidhni.' })
  if (ok.response !== 0) return false
  settings = { ...settings, licence: '' }; writeSettings(settings)
  void win.loadFile(path.join(__dirname, 'activation.html'))
  return true
})

/* ------------------------------------------------------------------ the program updates itself */
// The pages come from the server and are always new; this checks the program around them (printers,
// cash drawer). A newer installer is downloaded quietly, checked (size and sha256), and the person is
// asked once; it installs over this one with the same settings and licence, and the program opens again.
const crypto = require('crypto')
const { spawn } = require('child_process')
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) } return false }
let updating = false
let declined = ''
async function checkForUpdate(manual = false) {
  if (updating || !app.isPackaged) return
  updating = true
  try {
    const r = await enet.fetch(`${LICENCE_API}/rest/v1/rpc/desktop_release`, { method: 'POST', headers: { apikey: LICENCE_KEY, 'Content-Type': 'application/json' },
      body: isMac ? '{"p_platform":"mac-update"}' : '{}' })
    const rel = r.ok ? await r.json() : null
    if (!rel || !newer(rel.version, app.getVersion())) {
      if (manual) await dialog.showMessageBox(win, { type: 'info', message: `Keni versionin më të ri (${app.getVersion()}).`, buttons: ['Mirë'] })
      return
    }
    if (rel.version === declined && !manual) return
    const dir = path.join(app.getPath('temp'), 'drispro-update')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, rel.file_name)
    let ready = false
    try { ready = fs.statSync(file).size === rel.size_bytes && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === rel.sha256 } catch { /* not downloaded yet */ }
    if (!ready) {
      const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(`${file}.part`); let size = 0
      for (let i = 0; i < rel.parts; i++) {
        const p = await enet.fetch(`${LICENCE_API}/storage/v1/object/public/downloads/${rel.path}.part${String(i).padStart(3, '0')}`)
        if (!p.ok) throw new Error(`part ${i}: ${p.status}`)
        const buf = Buffer.from(await p.arrayBuffer()); hash.update(buf); size += buf.length
        await new Promise((res, rej) => out.write(buf, (e) => (e ? rej(e) : res())))
      }
      await new Promise((res) => out.end(res))
      if (size !== rel.size_bytes || hash.digest('hex') !== rel.sha256) { fs.rmSync(`${file}.part`, { force: true }); throw new Error('the download is damaged') }
      fs.renameSync(`${file}.part`, file)
    }
    const a = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Po, instaloje tani', 'Më vonë'], defaultId: 0, cancelId: 1,
      message: `Ka një version të ri të DrisPRO (${rel.version}).`,
      detail: `Ju keni ${app.getVersion()}. Instalimi zgjat rreth një minutë; programi mbyllet dhe hapet vetë. Cilësimet dhe licenca mbeten.`,
    })
    if (a.response !== 0) { declined = rel.version; return }
    if (isMac) {
      // the new DrisPRO.app replaces this one once it has closed, then opens again
      const bundle = path.resolve(process.execPath, '..', '..', '..')
      const fresh = path.join(dir, 'new')
      fs.rmSync(fresh, { recursive: true, force: true }); fs.mkdirSync(fresh, { recursive: true })
      require('child_process').execFileSync('/usr/bin/ditto', ['-x', '-k', file, fresh])
      const next = path.join(fresh, 'DrisPRO.app')
      if (!fs.existsSync(next)) throw new Error('the update has no DrisPRO.app')
      const q = (p) => `'${p.replace(/'/g, `'\\''`)}'`
      const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done; rm -rf ${q(bundle)} && mv ${q(next)} ${q(bundle)} && xattr -cr ${q(bundle)}; open ${q(bundle)}`
      spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
    } else {
      // silent install over this one, then it starts again
      spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    }
    setTimeout(() => app.quit(), 500)
  } catch (e) {
    if (manual) await dialog.showMessageBox(win, { type: 'warning', message: 'Kontrolli për version të ri nuk u bë.', detail: String(e.message || e), buttons: ['Mirë'] })
  } finally { updating = false }
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  // a minute after the start (the till is open by then), then every 6 hours
  setTimeout(() => void checkForUpdate(), 60_000)
  setInterval(() => void checkForUpdate(), 6 * 3600_000)
})
app.on('window-all-closed', () => app.quit())
