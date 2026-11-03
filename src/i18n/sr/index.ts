/**
 * Serbian (Latin script) dictionary, merged from every file in ./dict like the Albanian one.
 * It covers the parts of DrisPRO that Kosovo's fiscal rules ask for in both official languages:
 * the till, the fiscal coupon, the Z report, the ATK pages and the fiscal records, with the menu and the top bar. Anything else shows in English.
 * `npm run i18n:check` lists the keys of those parts that have no Serbian yet (see SR_SCOPE in scripts/i18n-check.mjs).
 */
export type Dict = Record<string, string>

const modules = import.meta.glob<{ default: Dict }>('./dict/*.ts', { eager: true })
export const sr: Dict = Object.assign({}, ...Object.keys(modules).sort().map((k) => modules[k]!.default))
