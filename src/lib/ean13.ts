/** EAN-13 as an SVG string, for printing loyalty cards and labels without a library. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function ean13Bits(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null
  const d = code.split('').map(Number)
  const parity = PARITY[d[0]!]!
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]!]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += R[d[i]!]
  return bits + '101'
}

/** module = width of one bar in px; the human-readable digits sit under the bars */
export function ean13Svg(code: string, { module = 2, height = 60 } = {}): string {
  const bits = ean13Bits(code)
  if (!bits) return ''
  const quiet = 11 * module
  const w = bits.length * module + quiet * 2
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92
  let bars = ''
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') bars += `<rect x="${quiet + i * module}" y="0" width="${module}" height="${guard(i) ? height + 8 : height}"/>`
  }
  const fs = 10 * module / 2 + 4
  const text = `<text x="${quiet - 3 * module}" y="${height + 8 + fs * 0.4}" font-size="${fs}" text-anchor="end">${code[0]}</text>`
    + `<text x="${quiet + 24 * module}" y="${height + 8 + fs * 0.4}" font-size="${fs}" text-anchor="middle" letter-spacing="${module}">${code.slice(1, 7)}</text>`
    + `<text x="${quiet + 71 * module}" y="${height + 8 + fs * 0.4}" font-size="${fs}" text-anchor="middle" letter-spacing="${module}">${code.slice(7)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height + 12 + fs}" width="${w}" height="${height + 12 + fs}" font-family="monospace" fill="#000">${bars}${text}</svg>`
}
