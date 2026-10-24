/**
 * Albanian dictionary, merged from every file in ./dict (one per area, so areas can be edited independently).
 * Each file: `export default { 'English text': 'Teksti shqip', … } satisfies Dict`.
 * Keys starting with "enum:" translate database enum values; "data:" translates system default names when the plain key is ambiguous.
 */
export type Dict = Record<string, string>

const modules = import.meta.glob<{ default: Dict }>('./dict/*.ts', { eager: true })
export const sq: Dict = Object.assign({}, ...Object.keys(modules).sort().map((k) => modules[k]!.default))
