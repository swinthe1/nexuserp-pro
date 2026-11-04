import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'
/** modern: the DrisPRO look; classic: a Windows program (title bar, menu bar, toolbar, tree, status bar) */
export type Look = 'modern' | 'classic'
interface ThemeCtx { theme: Theme; resolved: 'light' | 'dark'; setTheme: (t: Theme) => void; look: Look; setLook: (l: Look) => void }

const ThemeContext = React.createContext<ThemeCtx | null>(null)
const KEY = 'drispro.theme'
const LOOK_KEY = 'drispro.look'

function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    try { return (localStorage.getItem(KEY) as Theme) || 'light' } catch { return 'light' }
  })
  const [sysDark, setSysDark] = React.useState(systemDark)
  const [look, setLookState] = React.useState<Look>(() => {
    try { return localStorage.getItem(LOOK_KEY) === 'classic' ? 'classic' : 'modern' } catch { return 'modern' }
  })
  React.useEffect(() => { document.documentElement.classList.toggle('classic', look === 'classic') }, [look])
  const setLook = React.useCallback((l: Look) => {
    setLookState(l)
    try { localStorage.setItem(LOOK_KEY, l) } catch { /* private mode */ }
  }, [])

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSysDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  }, [])

  return <ThemeContext.Provider value={{ theme, resolved, setTheme, look, setLook }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
