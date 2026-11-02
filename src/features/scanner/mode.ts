/**
 * Scanner mode: DrisPRO on a handheld (Zebra and the like). It is installed as its own app,
 * "DrisPRO Skaner", that opens on /skaner; the device remembers the mode until someone leaves it.
 */
const KEY = 'drispro.mode'

export function isScannerMode() {
  try { return localStorage.getItem(KEY) === 'scanner' || location.pathname.startsWith('/skaner') } catch { return false }
}
export function setScannerMode(on: boolean) {
  try { if (on) localStorage.setItem(KEY, 'scanner'); else localStorage.removeItem(KEY) } catch { /* private window */ }
  applyScannerManifest(on)
}
/** the scanner app has its own manifest (name, icon, start page), so Chrome installs it as a second app */
export function applyScannerManifest(on = isScannerMode()) {
  try {
    const l = document.querySelector('link[rel="manifest"]')
    if (l) l.setAttribute('href', on ? '/skaner.webmanifest' : '/manifest.webmanifest')
  } catch { /* no document */ }
}
