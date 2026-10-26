/**
 * Barcodes drawn without a library: EAN-13, EAN-8 and Code 128.
 * A barcode is a list of modules (1 = bar, 0 = space) plus the text printed under it.
 */
export type Bars = { modules: string; text: string; kind: 'ean13' | 'ean8' | 'code128'; guards?: number[] }

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const R = L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).join(''))
const G = R.map((p) => [...p].reverse().join(''))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** GS1 check digit of the digits before it */
export function gtinCheck(body: string) {
  let s = 0
  for (let i = 0; i < body.length; i++) s += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return (10 - (s % 10)) % 10
}
const validGtin = (code: string, len: number) => new RegExp(`^\\d{${len}}$`).test(code) && gtinCheck(code.slice(0, -1)) === Number(code.at(-1))

function ean13(code: string): Bars {
  const d = [...code].map(Number)
  const par = PARITY[d[0]]
  let m = '101'
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[d[i]]
  m += '01010'
  for (let i = 7; i <= 12; i++) m += R[d[i]]
  m += '101'
  return { modules: m, text: code, kind: 'ean13', guards: [0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94] }
}

function ean8(code: string): Bars {
  const d = [...code].map(Number)
  let m = '101'
  for (let i = 0; i < 4; i++) m += L[d[i]]
  m += '01010'
  for (let i = 4; i < 8; i++) m += R[d[i]]
  m += '101'
  return { modules: m, text: code, kind: 'ean8', guards: [0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66] }
}

// Code 128: bar and space widths of the 106 symbols, then the stop
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112').split(' ')
const widths = (w: string) => [...w].map((n, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(n))).join('')

function code128(text: string): Bars {
  const values: number[] = []
  if (/^\d{2,}$/.test(text)) {
    // digits are packed two at a time (set C); an odd last digit goes in set B
    values.push(105)
    const even = text.length - (text.length % 2)
    for (let i = 0; i < even; i += 2) values.push(Number(text.slice(i, i + 2)))
    if (even < text.length) values.push(100, text.charCodeAt(even) - 32)
  } else {
    values.push(104)
    for (const ch of text) { const c = ch.charCodeAt(0); values.push(c >= 32 && c <= 127 ? c - 32 : 31) }
  }
  let sum = values[0]
  for (let k = 1; k < values.length; k++) sum += values[k] * k
  values.push(sum % 103)
  return { modules: values.map((v) => widths(C128[v])).join('') + widths(C128[106]), text, kind: 'code128' }
}

/** the bars for a code: EAN when it is one (or when the symbology says so), otherwise Code 128 */
export function encode(code: string, symbology?: string | null): Bars | null {
  const c = (code ?? '').trim()
  if (!c) return null
  if ((symbology === 'ean13' || !symbology || symbology === 'internal') && validGtin(c, 13)) return ean13(c)
  if (symbology === 'upca' && validGtin(c, 12)) return ean13('0' + c)
  if ((symbology === 'ean8' || !symbology) && validGtin(c, 8)) return ean8(c)
  if (validGtin(c, 13)) return ean13(c)
  return /^[\x20-\x7f]+$/.test(c) ? code128(c) : null
}

/** the empty margin each side, in modules, that scanners need */
export const quietZone = (b: Bars) => (b.kind === 'code128' ? 10 : 9)

/** runs of bars: [first module, width] */
export function barRuns(b: Bars) {
  const out: [number, number][] = []
  for (let i = 0; i < b.modules.length; i++) {
    if (b.modules[i] !== '1') continue
    let n = 1
    while (b.modules[i + n] === '1') n++
    out.push([i, n]); i += n - 1
  }
  return out
}

/** An SVG of the bars (with their quiet zones) that stretches to the box it is put in */
export function barsSvg(b: Bars) {
  const q = quietZone(b)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${b.modules.length + q * 2} 10" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="#000">` +
    barRuns(b).map(([x, n]) => `<rect x="${x + q}" y="0" width="${n}" height="10"/>`).join('') + '</g></svg>'
}

/** draws the bars into a PDF (jsPDF) in the box x, y, w, h (mm) */
type PdfLike = { rect: (x: number, y: number, w: number, h: number, style?: string | null) => unknown; setFillColor: (ch1: string) => unknown }
export function drawBarsPdf(pdf: PdfLike,
  b: Bars, x: number, y: number, w: number, h: number) {
  const q = quietZone(b)
  const mw = w / (b.modules.length + q * 2)
  pdf.setFillColor('#000000')
  for (const [i, n] of barRuns(b)) pdf.rect(x + (i + q) * mw, y, n * mw, h, 'F')
}
