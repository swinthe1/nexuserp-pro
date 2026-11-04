import * as React from 'react'

/**
 * The size of the whole program on this screen (user menu → Screen size): smaller to fit more on a
 * small laptop, bigger on a large monitor or for tired eyes. "Fit the screen" picks it from the
 * window's width. It is kept per device, because it depends on the screen, and phones always stay
 * at 100% (they have their own layout). Viewport heights are corrected for it in the CSS build.
 */
export const ZOOMS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const
export type ZoomSetting = number | 'auto'
const KEY = 'drispro.zoom'

function read(): ZoomSetting {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'auto') return 'auto'
    const n = Number(v)
    return (ZOOMS as readonly number[]).includes(n) ? n : 1
  } catch { return 1 }
}

/** for "fit the screen": the program is laid out for about 1600 points across */
const autoFor = (w: number) => (w >= 1600 ? 1 : w >= 1440 ? 0.9 : w >= 1280 ? 0.85 : 0.8)

export function effectiveZoom(s: ZoomSetting, w = typeof window === 'undefined' ? 1600 : window.innerWidth) {
  if (w < 768) return 1
  return s === 'auto' ? autoFor(w) : s
}

let setting: ZoomSetting = typeof window === 'undefined' ? 1 : read()
const listeners = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  const z = effectiveZoom(setting)
  const html = document.documentElement
  html.style.setProperty('--z', String(z))
  html.style.zoom = z === 1 ? '' : String(z)
}

export function setZoom(s: ZoomSetting) {
  setting = s
  try { localStorage.setItem(KEY, String(s)) } catch { /* only this session */ }
  apply()
  listeners.forEach((l) => l())
}

/** one step smaller or bigger from what the screen shows now */
export function stepZoom(dir: 1 | -1) {
  const now = effectiveZoom(setting)
  const list = ZOOMS as readonly number[]
  const next = dir > 0 ? list.find((z) => z > now + 0.001) : [...list].reverse().find((z) => z < now - 0.001)
  if (next) setZoom(next)
}

export function useZoom() {
  const s = React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => setting, () => setting)
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => {
    if (s !== 'auto') return
    const on = () => force()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [s])
  return { setting: s, zoom: effectiveZoom(s) }
}

if (typeof window !== 'undefined') {
  apply()
  let t: number | undefined
  window.addEventListener('resize', () => { window.clearTimeout(t); t = window.setTimeout(apply, 120) })
  // Ctrl+Alt + / − / 0, beside the browser's own Ctrl + / −
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.altKey) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1) }
    else if (e.key === '-') { e.preventDefault(); stepZoom(-1) }
    else if (e.key === '0') { e.preventDefault(); setZoom(1) }
  })
}
