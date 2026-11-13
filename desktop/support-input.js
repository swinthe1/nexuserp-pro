// Help at a distance, step 2: the support person's mouse and keyboard, on this computer, only while the person
// here allowed control and the red bar is on screen. Windows only: a small PowerShell helper calls SendInput
// (the same thing a mouse and a keyboard do), fed one line per event. Nothing else is possible through it:
// no files, no commands, only pointer and keys. The Windows key is never pressed for the other side, and
// Windows itself keeps its own screens (the UAC prompt, Ctrl+Alt+Del) out of reach of any program.
const { spawn } = require('child_process')

const CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class DrisInput {
  [StructLayout(LayoutKind.Sequential)] struct MI { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct U { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
  [StructLayout(LayoutKind.Sequential)] struct IN { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, IN[] i, int size);
  static void Mouse(int dx, int dy, uint data, uint flags) { var i = new IN[1]; i[0].type = 0; i[0].u.mi.dx = dx; i[0].u.mi.dy = dy; i[0].u.mi.data = data; i[0].u.mi.flags = flags; SendInput(1, i, Marshal.SizeOf(typeof(IN))); }
  public static void Move(int x, int y) { Mouse(x, y, 0, 0x0001 | 0x8000); }
  public static void Button(int b, bool up) { uint f = b == 2 ? (up ? 0x10u : 0x08u) : b == 1 ? (up ? 0x40u : 0x20u) : (up ? 0x04u : 0x02u); Mouse(0, 0, 0, f); }
  public static void Wheel(int d, bool h) { Mouse(0, 0, unchecked((uint)d), h ? 0x01000u : 0x0800u); }
  public static void Key(int vk, bool up, bool ext) { var i = new IN[1]; i[0].type = 1; i[0].u.ki.vk = (ushort)vk; i[0].u.ki.flags = (up ? 2u : 0u) | (ext ? 1u : 0u); SendInput(1, i, Marshal.SizeOf(typeof(IN))); }
  public static void Text(int c) { var i = new IN[2]; for (int k = 0; k < 2; k++) { i[k].type = 1; i[k].u.ki.scan = (ushort)c; i[k].u.ki.flags = 4u | (k == 1 ? 2u : 0u); } SendInput(2, i, Marshal.SizeOf(typeof(IN))); }
}`
const PS = `$ErrorActionPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
${CS}
'@
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $p = $l.Split(' ')
  switch ($p[0]) {
    'M' { [DrisInput]::Move([int]$p[1], [int]$p[2]) }
    'B' { [DrisInput]::Button([int]$p[1], $p[2] -eq '1') }
    'W' { [DrisInput]::Wheel([int]$p[1], $p[2] -eq '1') }
    'K' { [DrisInput]::Key([int]$p[1], $p[2] -eq '1', $p[3] -eq '1') }
    'T' { [DrisInput]::Text([int]$p[1]) }
  }
}`

// the keys of a browser keyboard event (KeyboardEvent.code) as Windows virtual keys; [vk, extended]
const VK = {
  Backspace: [8], Tab: [9], Enter: [13], NumpadEnter: [13, 1], ShiftLeft: [0xA0], ShiftRight: [0xA1], ControlLeft: [0xA2], ControlRight: [0xA3, 1],
  AltLeft: [0xA4], AltRight: [0xA5, 1], Pause: [0x13], CapsLock: [0x14], Escape: [0x1B], Space: [0x20], PageUp: [0x21, 1], PageDown: [0x22, 1],
  End: [0x23, 1], Home: [0x24, 1], ArrowLeft: [0x25, 1], ArrowUp: [0x26, 1], ArrowRight: [0x27, 1], ArrowDown: [0x28, 1], PrintScreen: [0x2C],
  Insert: [0x2D, 1], Delete: [0x2E, 1], ContextMenu: [0x5D, 1], NumLock: [0x90, 1], ScrollLock: [0x91],
  Semicolon: [0xBA], Equal: [0xBB], Comma: [0xBC], Minus: [0xBD], Period: [0xBE], Slash: [0xBF], Backquote: [0xC0], BracketLeft: [0xDB],
  Backslash: [0xDC], BracketRight: [0xDD], Quote: [0xDE], IntlBackslash: [0xE2],
  NumpadMultiply: [0x6A], NumpadAdd: [0x6B], NumpadSubtract: [0x6D], NumpadDecimal: [0x6E], NumpadDivide: [0x6F, 1],
}
for (let i = 0; i < 26; i++) VK[`Key${String.fromCharCode(65 + i)}`] = [65 + i]
for (let i = 0; i < 10; i++) { VK[`Digit${i}`] = [48 + i]; VK[`Numpad${i}`] = [0x60 + i] }
for (let i = 1; i <= 24; i++) VK[`F${i}`] = [0x6F + i]

let ps = null
let held = new Set()
const write = (line) => { try { if (ps && ps.stdin.writable) ps.stdin.write(line + '\n') } catch { /* helper gone */ } }

function start() {
  if (process.platform !== 'win32') return false
  if (ps) return true
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
  ps.on('exit', () => { ps = null })
  ps.on('error', () => { ps = null })
  return true
}

// let go of whatever the other side still holds down, then stop the helper
function stop() {
  for (const h of held) { const [kind, a, b] = h.split(':'); write(kind === 'B' ? `B ${a} 1` : `K ${a} 1 ${b}`) }
  held = new Set()
  if (ps) { const p = ps; ps = null; setTimeout(() => { try { p.stdin.end(); p.kill() } catch { /* gone */ } }, 300) }
}

const clamp = (v) => Math.max(0, Math.min(65535, Math.round(Number(v) * 65535)))
/** one event from the support person: {t:'m',x,y} | {t:'b',b,up} | {t:'w',dy,dx} | {t:'k',code,up} | {t:'c',ch} */
function handle(ev) {
  if (!ps || !ev || typeof ev !== 'object') return
  if (ev.t === 'm' && Number.isFinite(+ev.x) && Number.isFinite(+ev.y)) write(`M ${clamp(ev.x)} ${clamp(ev.y)}`)
  else if (ev.t === 'b' && [0, 1, 2].includes(ev.b)) {
    write(`B ${ev.b} ${ev.up ? 1 : 0}`)
    if (ev.up) held.delete(`B:${ev.b}`); else held.add(`B:${ev.b}`)
  } else if (ev.t === 'w') {
    const dy = Math.max(-2400, Math.min(2400, Math.round(-Number(ev.dy) || 0))), dx = Math.max(-2400, Math.min(2400, Math.round(Number(ev.dx) || 0)))
    if (dy) write(`W ${dy} 0`)
    if (dx) write(`W ${dx} 1`)
  } else if (ev.t === 'k' && typeof ev.code === 'string' && VK[ev.code]) {
    const [vk, ext] = VK[ev.code]
    write(`K ${vk} ${ev.up ? 1 : 0} ${ext ? 1 : 0}`)
    if (ev.up) held.delete(`K:${vk}:${ext ? 1 : 0}`); else held.add(`K:${vk}:${ext ? 1 : 0}`)
  } else if (ev.t === 'c' && typeof ev.ch === 'string') {
    // a typed character, as text: the keyboard layout of either side does not matter
    for (const ch of ev.ch.slice(0, 32)) { const c = ch.charCodeAt(0); if (c >= 32 && c !== 127) write(`T ${c}`) }
  }
}

module.exports = { start, stop, handle, supported: () => process.platform === 'win32' }
