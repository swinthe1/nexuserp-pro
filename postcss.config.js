import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

/**
 * The app's own zoom (user menu → screen size) zooms the whole page with CSS zoom, which also
 * zooms viewport heights: a 100dvh panel would end above or below the window. Every vh/dvh/svh
 * length in the styles is divided by the zoom (--z, 1 when not zoomed), so it is the window again.
 */
const unzoomViewport = () => ({
  postcssPlugin: 'unzoom-viewport',
  Declaration(decl) {
    if (decl.value.includes('vh') && !decl.value.includes('var(--z')) {
      decl.value = decl.value.replace(/(-?\d*\.?\d+)(dvh|svh|lvh|vh)\b/g, 'calc($1$2 / var(--z, 1))')
    }
  },
})
unzoomViewport.postcss = true

export default { plugins: [tailwindcss, autoprefixer, unzoomViewport] }
