/** Prints an HTML snippet through an invisible iframe (works offline, no pop-up blockers) */
export function printHtml(body: string, css: string) {
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(f)
  const doc = f.contentDocument!
  doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`); doc.close()
  setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 1500) }, 120)
}

