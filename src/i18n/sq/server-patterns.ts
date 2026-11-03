/**
 * Database messages with values in them (errors, notifications, report labels).
 * `en` uses % for each value, exactly like the SQL format string (%% is a literal percent sign);
 * `sq` refers to the values as {0}, {1}, … in any order.
 * Values that are enum words, month names or system default names are translated too (see translateArg in ../index.ts).
 */
import { serverTemplates } from './server-templates'

const PCT = '\u0000'

function toRegex(en: string) {
  const esc = en
    .replace(/%%/g, PCT)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '(.+?)')
    .replace(new RegExp(PCT, 'g'), '%')
  return new RegExp(`^${esc}$`, 's')
}

const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'

/** Values on their own that need translating: "Aug 2025" (fiscal periods), "October 2026" */
const special: { re: RegExp; sq: string }[] = [
  { re: new RegExp(`^${MON} (\\d{4})$`), sq: '{0} {1}' },
  { re: /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/, sq: '{0} {1}' },
  { re: /^FY (\d{4})$/, sq: 'VF {0}' },
]

/** templates → patterns, most specific first (more literal text wins over general templates); `sq` holds the translation in any language */
export const buildPatterns = (templates: [string, string][]) => templates
  .filter(([en]) => en.replace(/%%/g, '').includes('%'))
  .sort((a, b) => b[0].replace(/%/g, '').length - a[0].replace(/%/g, '').length)
  .map(([en, sq]) => ({ re: toRegex(en), sq }))

export const serverPatterns = [...buildPatterns(serverTemplates), ...special]
