/**
 * Shelf, price and barcode labels. One layout (boxes in millimetres) is drawn two ways: as HTML for the
 * print window and the preview, and as a PDF for download — so both look the same.
 */
import { msg, t } from '@/i18n'
import { barsSvg, drawBarsPdf, encode, type Bars } from '@/lib/barcode'
import { nf } from '@/lib/documents/render-statement'
import { formatDate } from '@/lib/utils'

export type LabelItem = {
  variant_id: string; product_id: string; sku: string; name: string; barcode: string | null; symbology: string | null
  uom: string | null; brand: string | null; category: string | null; net: number; vat_rate: number; price: number; old_price: number | null
  weight_kg: number | null; volume_l: number | null; pack: { name: string; factor: number; barcode: string | null } | null; qty: number
}
export type LabelData = { currency: string; decimals: number; items: LabelItem[] }

export type Template = 'shelf' | 'price' | 'barcode'
export const TEMPLATES: { id: Template; name: string; hint: string }[] = [
  { id: 'shelf', name: msg('Shelf label'), hint: msg('Name, price with VAT, price per kg or litre, barcode') },
  { id: 'price', name: msg('Price label'), hint: msg('A big price, for the item or the shelf') },
  { id: 'barcode', name: msg('Barcode label'), hint: msg('To stick on items that have no barcode') },
]

export type Size = { id: string; name: string; w: number; h: number; sheet?: { cols: number; rows: number; gapX?: number; gapY?: number } }
export const SIZES: Size[] = [
  { id: 'a4-3x8', name: msg('A4 sheet · 24 labels 70 × 37 mm'), w: 70, h: 37, sheet: { cols: 3, rows: 8 } },
  { id: 'a4-3x7', name: msg('A4 sheet · 21 labels 70 × 42 mm'), w: 70, h: 42.3, sheet: { cols: 3, rows: 7 } },
  { id: 'a4-2x7', name: msg('A4 sheet · 14 labels 99 × 38 mm'), w: 99.1, h: 38.1, sheet: { cols: 2, rows: 7, gapX: 2.5 } },
  { id: 'a4-4x10', name: msg('A4 sheet · 40 labels 48 × 25 mm'), w: 48.5, h: 25.4, sheet: { cols: 4, rows: 10 } },
  { id: 'a4-5x13', name: msg('A4 sheet · 65 labels 38 × 21 mm'), w: 38.1, h: 21.2, sheet: { cols: 5, rows: 13, gapX: 2.5 } },
  { id: 'roll-58x40', name: msg('Label printer · 58 × 40 mm'), w: 58, h: 40 },
  { id: 'roll-50x30', name: msg('Label printer · 50 × 30 mm'), w: 50, h: 30 },
  { id: 'roll-40x25', name: msg('Label printer · 40 × 25 mm'), w: 40, h: 25 },
  { id: 'roll-100x50', name: msg('Label printer · 100 × 50 mm'), w: 100, h: 50 },
]

export type LabelOptions = {
  template: Template; size: string; custom?: { w: number; h: number }
  price: boolean; oldPrice: boolean; unitPrice: boolean; pack: boolean; barcode: boolean; sku: boolean; date: boolean; brand: boolean
  /** a sheet already partly used: start at this position (1 = first) */
  start: number
  /** printer calibration, mm */
  offsetX: number; offsetY: number
  border: boolean
}
export const LABEL_DEFAULTS: LabelOptions = {
  template: 'shelf', size: 'a4-3x8', price: true, oldPrice: true, unitPrice: false, pack: false, barcode: true, sku: true, date: true, brand: false,
  start: 1, offsetX: 0, offsetY: 0, border: false,
}

export const sizeOf = (o: LabelOptions): Size => {
  if (o.size === 'custom') return { id: 'custom', name: '', w: Math.max(15, o.custom?.w ?? 50), h: Math.max(10, o.custom?.h ?? 30) }
  return SIZES.find((s) => s.id === o.size) ?? SIZES[0]
}

const SYMBOL: Record<string, string> = { EUR: '€', ALL: 'L', USD: '$', GBP: '£', CHF: 'CHF', MKD: 'den' }
const money = (n: number, d: LabelData) => `${nf(n, d.decimals)} ${SYMBOL[d.currency] ?? d.currency}`

type TextBox = { k: 'text'; x: number; y: number; w: number; size: number; text: string; bold?: boolean; align?: 'left' | 'right' | 'center'; lines?: number; strike?: boolean; gray?: boolean }
type BarBox = { k: 'bars'; x: number; y: number; w: number; h: number; bars: Bars }
type Box = TextBox | BarBox

/** a size (mm) at which a line of text fits the width, assuming average glyphs (bold digits are about 0.56 em) */
const fit = (text: string, w: number, size: number, k = 0.56) => Math.min(size, w / Math.max(1, text.length * k))

/** where everything goes on one label */
export function layout(it: LabelItem, d: LabelData, o: LabelOptions, W: number, H: number): Box[] {
  const p = Math.max(1.2, Math.min(W, H) * 0.05)
  const iw = W - 2 * p
  const out: Box[] = []
  const bars = o.barcode && it.barcode ? encode(it.barcode, it.symbology) : null
  const price = money(it.price, d)
  const old = o.oldPrice && it.old_price != null && it.old_price !== it.price ? money(it.old_price, d) : null
  const per = !o.unitPrice ? null
    : it.volume_l ? `${money(it.price / it.volume_l, d)} / l` : it.weight_kg ? `${money(it.price / it.weight_kg, d)} / kg` : null
  const pack = o.pack && it.pack ? `${it.pack.name} × ${nf(it.pack.factor, 0)}: ${money(it.price * it.pack.factor, d)}` : null
  const foot = [o.sku ? it.sku : null, o.date ? formatDate(new Date().toISOString().slice(0, 10)) : null].filter(Boolean).join('  ·  ')
  const name = o.brand && it.brand && !it.name.toLowerCase().includes(it.brand.toLowerCase()) ? `${it.brand} ${it.name}` : it.name

  if (o.template === 'shelf') {
    const ns = Math.min(H * 0.095, 4.2)
    out.push({ k: 'text', x: p, y: p, w: iw, size: ns, text: name, bold: true, lines: 2 })
    const top = p + ns * 2.35
    const fs = Math.min(H * 0.07, 2.6)
    const bw = bars ? Math.min(iw * 0.46, 38) : 0
    const right = p + bw + (bars ? p : 0)
    const rw = W - p - right
    let y = top
    if (old && o.price) { out.push({ k: 'text', x: right, y, w: rw, size: fs * 1.15, text: old, align: 'right', strike: true, gray: true }); y += fs * 1.4 }
    if (o.price) {
      const ps = fit(price, rw, Math.min(H * 0.27, 14))
      out.push({ k: 'text', x: right, y, w: rw, size: ps, text: price, bold: true, align: 'right' }); y += ps * 1.12
    }
    if (per) { out.push({ k: 'text', x: right, y, w: rw, size: fs, text: per, align: 'right', gray: true }); y += fs * 1.3 }
    if (pack) out.push({ k: 'text', x: right, y, w: rw, size: fs, text: pack, align: 'right', gray: true })
    if (bars) {
      const bh = Math.max(5, H - top - p - fs * 1.3 - (foot ? fs * 1.3 : 0))
      out.push({ k: 'bars', x: p, y: top, w: bw, h: bh, bars })
      out.push({ k: 'text', x: p, y: top + bh + 0.3, w: bw, size: fs, text: bars.text, align: 'center' })
    }
    if (foot) out.push({ k: 'text', x: p, y: H - p - fs, w: iw, size: fs * 0.95, text: foot, gray: true, align: bars ? 'left' : 'left' })
    return out
  }

  if (o.template === 'price') {
    const ns = Math.min(H * 0.11, 4.5)
    out.push({ k: 'text', x: p, y: p, w: iw, size: ns, text: name, bold: true, lines: 2, align: 'center' })
    const fs = Math.min(H * 0.075, 2.6)
    const bh = bars ? Math.min(H * 0.17, 9) : 0
    const bottom = H - p - (bars ? bh + fs * 1.25 : 0) - (foot ? fs * 1.25 : 0)
    const top = p + ns * 2.35
    const sub = [old, per, pack].filter(Boolean) as string[]
    const room = bottom - top - sub.length * fs * 1.3
    const ps = o.price ? fit(price, iw, Math.max(2, Math.min(room / 1.15, 22))) : 0
    const block = ps * 1.05 + sub.length * fs * 1.3
    let y = top + Math.max(0, (bottom - top - block) / 2)
    if (o.price) { out.push({ k: 'text', x: p, y, w: iw, size: ps, text: price, bold: true, align: 'center' }); y += ps * 1.05 }
    if (old) { out.push({ k: 'text', x: p, y, w: iw, size: fs * 1.1, text: old, align: 'center', strike: true, gray: true }); y += fs * 1.3 }
    for (const s of [per, pack]) if (s) { out.push({ k: 'text', x: p, y, w: iw, size: fs, text: s, align: 'center', gray: true }); y += fs * 1.3 }
    let by = H - p - (foot ? fs * 1.25 : 0)
    if (bars) {
      by -= bh + fs * 1.25
      const bw = Math.min(iw * 0.75, 40)
      out.push({ k: 'bars', x: (W - bw) / 2, y: by, w: bw, h: bh, bars })
      out.push({ k: 'text', x: p, y: by + bh + 0.2, w: iw, size: fs, text: bars.text, align: 'center' })
    }
    if (foot) out.push({ k: 'text', x: p, y: H - p - fs, w: iw, size: fs * 0.95, text: foot, gray: true, align: 'center' })
    return out
  }

  // barcode label
  const ns = Math.min(H * 0.1, 3.4)
  out.push({ k: 'text', x: p, y: p, w: iw, size: ns, text: name, bold: true, lines: 1, align: 'center' })
  const fs = Math.min(H * 0.1, 3)
  const foot2 = [o.sku ? it.sku : null, o.price ? price : null].filter(Boolean) as string[]
  const top = p + ns * 1.3
  const bottom = H - p - (foot2.length ? fs * 1.25 : 0)
  const code = bars ?? encode(it.sku, 'code128')
  if (code) {
    const bh = Math.max(4, bottom - top - fs * 1.3)
    out.push({ k: 'bars', x: p, y: top, w: iw, h: bh, bars: code })
    out.push({ k: 'text', x: p, y: top + bh + 0.2, w: iw, size: fs, text: code.text, align: 'center' })
  }
  if (foot2.length === 2) {
    out.push({ k: 'text', x: p, y: H - p - fs, w: iw / 2, size: fs, text: foot2[0], gray: true })
    out.push({ k: 'text', x: p + iw / 2, y: H - p - fs, w: iw / 2, size: fs, text: foot2[1], bold: true, align: 'right' })
  } else if (foot2.length === 1) out.push({ k: 'text', x: p, y: H - p - fs, w: iw, size: fs, text: foot2[0], bold: !!o.price && !o.sku, align: 'center' })
  return out
}

/** every label to print, in order: each item as many times as asked */
export const expand = (items: LabelItem[], counts: Record<string, number>) =>
  items.flatMap((it) => Array.from({ length: Math.max(0, Math.min(500, counts[it.variant_id] ?? it.qty)) }, () => it))

type Placed = { page: number; x: number; y: number }
/** where each label goes: on A4 sheets in a grid (from the chosen start), or one per page on a roll */
export function place(n: number, o: LabelOptions): { pages: number; at: Placed[]; pageW: number; pageH: number } {
  const s = sizeOf(o)
  if (!s.sheet) return { pages: n, at: Array.from({ length: n }, (_, i) => ({ page: i, x: o.offsetX, y: o.offsetY })), pageW: s.w, pageH: s.h }
  const { cols, rows, gapX = 0, gapY = 0 } = s.sheet
  const per = cols * rows
  const mx = (210 - cols * s.w - (cols - 1) * gapX) / 2 + o.offsetX
  const my = (297 - rows * s.h - (rows - 1) * gapY) / 2 + o.offsetY
  const skip = Math.max(0, Math.min(per - 1, (o.start || 1) - 1))
  const at = Array.from({ length: n }, (_, i) => {
    const k = i + skip
    const cell = k % per
    return { page: Math.floor(k / per), x: mx + (cell % cols) * (s.w + gapX), y: my + Math.floor(cell / cols) * (s.h + gapY) }
  })
  return { pages: n ? at[n - 1].page + 1 : 0, at, pageW: 210, pageH: 297 }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function boxHtml(b: Box) {
  if (b.k === 'bars') return `<div style="position:absolute;left:${b.x}mm;top:${b.y}mm;width:${b.w}mm;height:${b.h}mm">${barsSvg(b.bars)}</div>`
  const clamp = b.lines && b.lines > 1 ? `display:-webkit-box;-webkit-line-clamp:${b.lines};-webkit-box-orient:vertical;white-space:normal` : 'white-space:nowrap;text-overflow:ellipsis'
  return `<div style="position:absolute;left:${b.x}mm;top:${b.y}mm;width:${b.w}mm;font-size:${b.size}mm;line-height:1.12;overflow:hidden;${clamp};` +
    `text-align:${b.align ?? 'left'};font-weight:${b.bold ? 700 : 400};${b.strike ? 'text-decoration:line-through;' : ''}${b.gray ? 'color:#444;' : ''}">${esc(b.text)}</div>`
}

/** labels as HTML for printing (and the preview) */
export function labelsHtml(data: LabelData, items: LabelItem[], o: LabelOptions) {
  const s = sizeOf(o)
  const pl = place(items.length, o)
  const pages: string[] = Array.from({ length: pl.pages }, () => '')
  items.forEach((it, i) => {
    const a = pl.at[i]
    pages[a.page] += `<div class="lb" style="left:${a.x}mm;top:${a.y}mm;width:${s.w}mm;height:${s.h}mm">${layout(it, data, o, s.w, s.h).map(boxHtml).join('')}</div>`
  })
  const css = `@page{size:${pl.pageW}mm ${pl.pageH}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{position:relative;width:${pl.pageW}mm;height:${pl.pageH}mm;overflow:hidden;page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}
.lb{position:absolute;overflow:hidden;${o.border ? 'outline:0.2mm dashed #999;outline-offset:-0.1mm;' : ''}}svg{display:block;width:100%;height:100%}`
  return { css, body: pages.map((p) => `<div class="pg">${p}</div>`).join(''), pages: pl.pages }
}

/** labels as a PDF (base64-free Blob) */
export async function labelsPdf(data: LabelData, items: LabelItem[], o: LabelOptions) {
  const { jsPDF } = await import('jspdf')
  const s = sizeOf(o)
  const pl = place(items.length, o)
  const pdf = new jsPDF({ unit: 'mm', format: [pl.pageW, pl.pageH], orientation: pl.pageW > pl.pageH ? 'landscape' : 'portrait', compress: true })
  const PT = 72 / 25.4
  let page = 0
  items.forEach((it, i) => {
    const a = pl.at[i]
    while (a.page > page) { pdf.addPage([pl.pageW, pl.pageH], pl.pageW > pl.pageH ? 'landscape' : 'portrait'); page++ }
    if (o.border) { pdf.setDrawColor(160); pdf.setLineDashPattern([1, 1], 0); pdf.setLineWidth(0.15); pdf.rect(a.x, a.y, s.w, s.h); pdf.setLineDashPattern([], 0) }
    for (const b of layout(it, data, o, s.w, s.h)) {
      if (b.k === 'bars') { drawBarsPdf(pdf, b.bars, a.x + b.x, a.y + b.y, b.w, b.h); continue }
      pdf.setFont('helvetica', b.bold ? 'bold' : 'normal')
      let size = b.size * PT
      pdf.setFontSize(size)
      // one line that is too long becomes smaller (the price), several lines wrap
      if ((b.lines ?? 1) === 1) {
        const tw = pdf.getTextWidth(b.text)
        if (tw > b.w && b.align !== 'left') { size = size * b.w / tw; pdf.setFontSize(size) }
      }
      pdf.setTextColor(b.gray ? 68 : 0)
      let lines = (b.lines ?? 1) > 1 ? pdf.splitTextToSize(b.text, b.w) as string[] : [b.text]
      if (lines.length > (b.lines ?? 1)) { lines = lines.slice(0, b.lines); lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S{0,3}$/, '') + '…' }
      if ((b.lines ?? 1) === 1 && pdf.getTextWidth(lines[0]) > b.w) {
        let txt = lines[0]
        while (txt.length > 1 && pdf.getTextWidth(txt + '…') > b.w) txt = txt.slice(0, -1)
        lines = [txt + '…']
      }
      const x = b.align === 'right' ? a.x + b.x + b.w : b.align === 'center' ? a.x + b.x + b.w / 2 : a.x + b.x
      const lh = (size / PT) * 1.12
      lines.forEach((ln, k) => {
        const y = a.y + b.y + k * lh
        pdf.text(ln, x, y, { baseline: 'top', align: b.align ?? 'left' })
        if (b.strike) {
          const w = pdf.getTextWidth(ln)
          const x0 = b.align === 'right' ? x - w : b.align === 'center' ? x - w / 2 : x
          pdf.setDrawColor(68); pdf.setLineWidth(0.2); pdf.line(x0, y + lh * 0.45, x0 + w, y + lh * 0.45)
        }
      })
    }
  })
  return pdf.output('blob') as Blob
}

export const labelsFile = () => `${t('Labels')}-${new Date().toISOString().slice(0, 10)}.pdf`
