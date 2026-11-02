import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs'
import fs from 'fs'
const R = '/home/claude/skaner-apk/app/src/main/res/'
const mark = (t, b, d) => `<rect x="6" y="8" width="20" height="20" rx="5" fill="${t}"/><rect x="6" y="36" width="20" height="20" rx="5" fill="${b}"/><path d="M32 8h2a24 24 0 0 1 0 48h-2z" fill="${d}"/>`
const legacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E8A5F"/><g transform="translate(10 10) scale(0.6875)">${mark('#B9F5D8', '#EA8010', '#FFFFFF')}</g></svg>`
// adaptive foreground: 108 units, the mark inside the 66-unit safe circle
const fg = (t, b, d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(32 32) scale(0.6875)">${mark(t, b, d)}</g></svg>`
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' })
const shot = async (svg, size, path) => {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await p.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }); await p.close()
}
for (const [d, k] of Object.entries(dens)) {
  const dir = `${R}mipmap-${d}/`; fs.mkdirSync(dir, { recursive: true })
  await shot(legacy, Math.round(48 * k), dir + 'ic_launcher.png')
  await shot(fg('#B9F5D8', '#EA8010', '#FFFFFF'), Math.round(108 * k), dir + 'ic_launcher_fg.png')
  await shot(fg('#FFFFFF', '#FFFFFF', '#FFFFFF'), Math.round(108 * k), dir + 'ic_launcher_mono.png')
}
await shot(legacy, 512, '/home/claude/skaner-apk/icon-512.png')
await b.close(); console.log('icons ok')
