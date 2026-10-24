import * as React from 'react'

/** Runs handler on key (with ⌘/Ctrl when mod=true). Ignores typing in inputs unless mod is set. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { mod?: boolean } = {}) {
  const ref = React.useRef(handler)
  ref.current = handler
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      const mod = e.metaKey || e.ctrlKey
      if (!!opts.mod !== mod) return
      const t = e.target as HTMLElement | null
      if (!opts.mod && t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, opts.mod])
}
