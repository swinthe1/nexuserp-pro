import { desktop, type PrintKind } from '@/lib/desktop'

/**
 * Prints an HTML snippet. In the Windows program a receipt or a kitchen ticket goes straight to the
 * printer chosen for it (no print window); in a browser, through an invisible iframe (works offline,
 * no pop-up blockers).
 */
export function printHtml(body: string, css: string, kind: PrintKind = 'document') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><style>a{color:inherit;text-decoration:none} ${css}</style></head><body>${body}</body></html>`
  if (desktop) {
    void desktop.print(html, kind).catch((e: unknown) => console.error('print', e))
    return
  }
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(f)
  const doc = f.contentDocument!
  doc.open(); doc.write(html); doc.close()
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 1500) }, 120)
}

/** Opens the cash drawer (Windows program with a network receipt printer; otherwise nothing). */
export function openCashDrawer() { if (desktop) void desktop.openDrawer().catch(() => undefined) }
