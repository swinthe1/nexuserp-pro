// DrisPRO Server: installs the DrisPRO server on this Windows computer and keeps an eye on it afterwards.
// The window walks through the install (checks → what needs a restart → the answers → the install → done);
// afterwards the program lives next to the clock: green when every part answers, with the buttons to check
// and repair, copy the database, update, or remove. All the work is done by engine/engine.ps1; this file
// only starts it (as administrator when it changes something) and shows what it says.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, nativeImage, dialog } = require('electron')
const { spawn, execFile } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(process.env.ProgramData || 'C:\\ProgramData', 'DrisPRO Server')
const STATE = path.join(ROOT, 'state.json')
const res = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, ...p))
const ENGINE = res('engine', 'engine.ps1')
const BUNDLE = res('bundle', 'drispro-server')
const args = process.argv.slice(1)
const has = (a) => args.includes(a)
const argValue = (a) => { const i = args.indexOf(a); return i >= 0 ? args[i + 1] : null }

if (!app.requestSingleInstanceLock()) app.quit()

let win = null
let tray = null
let last = null   // the last status
let running = null   // the engine run now (one at a time)

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8').replace(/^\uFEFF/, '')) } catch { return {} } }
const installed = () => !!readState().installedAt

/* ------------------------------------------------------------------ administrator */
// Changing the computer (BIOS, WSL, network, the start task) needs an administrator; looking does not.
let admin = null
function isAdmin() {
  if (admin !== null) return Promise.resolve(admin)
  return new Promise((ok) => execFile('net', ['session'], { windowsHide: true }, (err) => ok((admin = !err))))
}
// this copy of the program closes and an administrator's copy opens on the same page; if Windows' question is
// refused, the plain copy comes back next to the clock
function relaunchAsAdmin(extra) {
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`
  const exe = q(process.execPath)
  const a = extra.map(q).join(',')
  const cmd = `Start-Sleep -Milliseconds 800; try { Start-Process -FilePath ${exe} -Verb RunAs${a ? ` -ArgumentList ${a}` : ''} -ErrorAction Stop } catch { Start-Process -FilePath ${exe} -ArgumentList '--tray' }`
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  app.quitting = true
  setTimeout(() => app.quit(), 100)
}

/* ------------------------------------------------------------------ the engine */
function engine(action, input = {}, extra = []) {
  if (running) return Promise.resolve({ code: -2 })
  return new Promise((done) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ENGINE, '-Action', action, ...extra],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    running = p
    let buf = ''
    const events = []
    const take = (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        let ev
        try { ev = JSON.parse(line) } catch { ev = { t: 'line', text: line } }
        events.push(ev)
        if (win && !win.isDestroyed()) win.webContents.send('engine', { action, ev })
      }
    }
    p.stdout.on('data', take)
    p.stderr.on('data', (c) => take(Buffer.from(c.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.stringify({ t: 'line', text: l })).join('\n') + '\n')))
    p.on('close', (code) => { running = null; take('\n'); done({ code, events }) })
    p.on('error', (e) => { running = null; done({ code: -1, events: [{ t: 'stop', key: 'unexpected', text: String(e.message || e) }] }) })
    // the answers (licence, PIN, passwords) only on stdin: never on a command line, never on disk
    p.stdin.end(JSON.stringify(input))
  })
}

/* ------------------------------------------------------------------ the window */
function openWindow(page) {
  if (win && !win.isDestroyed()) { win.webContents.send('page', page); win.show(); win.focus(); return }
  win = new BrowserWindow({
    width: 920, height: 680, minWidth: 760, minHeight: 560, show: false, title: 'DrisPRO Server', backgroundColor: '#f6f8f7',
    icon: res('build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: has('--resume') ? { page, resume: '1' } : { page } })
  win.once('ready-to-show', () => win.show())
  // closing the window keeps the program next to the clock (once installed)
  win.on('close', (e) => {
    if (running) { e.preventDefault(); dialog.showMessageBox(win, { type: 'info', message: 'Një punë është ende duke u bërë.', detail: 'Prisni sa të përfundojë; pastaj dritarja mbyllet.', buttons: ['Mirë'] }); return }
    if (installed() && !app.quitting) { e.preventDefault(); win.hide() }
  })
}

ipcMain.handle('info', async () => ({ admin: await isAdmin(), state: readState(), version: app.getVersion(), status: last, page: argValue('--page') }))
ipcMain.handle('run', async (_e, { action, input, keepData }) => {
  if (!['preflight', 'prepare', 'licence', 'install', 'status', 'repair', 'backup', 'update', 'restart', 'uninstall'].includes(action)) return { code: -1 }
  const needsAdmin = !['status', 'licence'].includes(action)
  if (needsAdmin && !(await isAdmin())) { relaunchAsAdmin(['--page', action === 'preflight' ? 'install' : action]); return { code: -3 } }
  const extra = action === 'install' ? ['-Bundle', BUNDLE] : action === 'uninstall' && keepData ? ['-KeepData'] : []
  const r = await engine(action, input || {}, extra)
  if (['install', 'repair', 'restart', 'update'].includes(action)) void refresh()
  if (action === 'uninstall' && r.code === 0) { app.setLoginItemSettings({ openAtLogin: false }); tray?.destroy(); tray = null }
  return r
})
ipcMain.handle('restart-computer', async () => {
  // after the restart the install continues by itself, where it stopped
  const resume = `"${process.execPath}" --page install --resume`
  await new Promise((ok) => execFile('reg.exe', ['add', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce', '/v', 'DrisPROServer', '/t', 'REG_SZ', '/d', resume, '/f'], { windowsHide: true }, ok))
  execFile('shutdown.exe', ['/r', '/t', '10', '/c', 'DrisPRO Server: rinisja për virtualizimin dhe WSL. Instalimi vazhdon vetë pas hyrjes.'], { windowsHide: true })
  return true
})
ipcMain.handle('copy', (_e, text) => { clipboard.writeText(String(text)); return true })
ipcMain.handle('open-url', (_e, url) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return true })
ipcMain.handle('open-logs', () => { void shell.openPath(path.join(ROOT, 'logs')); return true })
ipcMain.handle('installed', () => { startTray(); return true })

/* ------------------------------------------------------------------ next to the clock */
const icon = (name) => nativeImage.createFromPath(res('build', name)).resize({ width: 16, height: 16 })
function healthOf(s) {
  if (!s || !s.installed) return 'missing'
  const sv = s.server?.services || {}
  const bad = Object.entries(sv).filter(([, v]) => !['healthy', 'running'].includes(v))
  if (!s.server?.answers || bad.length) return 'bad'
  if (!s.network || s.task !== 'Running') return 'warn'
  return 'ok'
}
async function refresh() {
  const r = await engine('status')
  if (r.code === -2) return
  last = r.events.find((e) => e.t === 'status') || last
  if (win && !win.isDestroyed()) win.webContents.send('status', last)
  if (!tray) return
  const h = healthOf(last)
  tray.setImage(icon(h === 'ok' ? 'tray-ok.png' : h === 'warn' ? 'tray-warn.png' : 'tray-bad.png'))
  tray.setToolTip(h === 'ok' ? `DrisPRO Server punon\n${last?.url || ''}` : h === 'warn' ? 'DrisPRO Server punon, por ka diçka për të kontrolluar' : 'DrisPRO Server: ka një problem')
  buildMenu()
}
function buildMenu() {
  const url = last?.url || readState().url
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Gjendja e serverit', click: () => openWindow('status') },
    { label: 'Hap DrisPRO', enabled: !!url, click: () => void shell.openExternal(url) },
    { label: url ? `Kopjo adresën (${url})` : 'Kopjo adresën', enabled: !!url, click: () => clipboard.writeText(url) },
    { type: 'separator' },
    { label: 'Kontrollo dhe ripariro', click: () => openWindow('repair') },
    { label: 'Bëj kopje të bazës tani', click: () => openWindow('backup') },
    { label: 'Përditëso serverin', click: () => openWindow('update') },
    { type: 'separator' },
    { label: 'Hap logët', click: () => void shell.openPath(path.join(ROOT, 'logs')) },
    { label: 'Çinstalo serverin…', click: () => openWindow('uninstall') },
    { type: 'separator' },
    { label: 'Mbyll këtë program (serveri vazhdon të punojë)', click: () => { app.quitting = true; app.quit() } },
  ]))
}
function startTray() {
  if (tray) return
  tray = new Tray(icon('tray-warn.png'))
  tray.setToolTip('DrisPRO Server')
  tray.on('click', () => openWindow('status'))
  buildMenu()
  // with Windows, next to the clock, without asking for administrator
  app.setLoginItemSettings({ openAtLogin: true, args: ['--tray'] })
  void refresh()
  setInterval(() => void refresh(), 60_000)
}

/* ------------------------------------------------------------------ start */
app.on('second-instance', (_e, argv) => { const i = argv.indexOf('--page'); openWindow(i >= 0 ? argv[i + 1] : 'status') })
app.on('window-all-closed', () => { if (!installed()) app.quit() })
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const page = argValue('--page')
  if (installed()) {
    startTray()
    if (!has('--tray') || page) openWindow(page || 'status')
  } else {
    // a server already running here whose note was lost: its status makes the note again, and the status opens, not a new install
    try { await engine('status', {}, []) } catch { /* no server here */ }
    if (installed()) { startTray(); openWindow(page || 'status') } else openWindow(page || 'install')
  }
})
