import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { inFilter } from '@/components/data-table/data-table'
import { MultiPick, type PickOption } from '@/components/multi-pick'
import { t, td } from '@/i18n'
import { useCategories } from '../api'

type Cat = { id: string; name: string; parent_id: string | null; code?: string | null }

/** the categories in tree order: each main category followed by its sub-categories (indented, with the main one as a hint) */
export function categoryTreeOptions(all: Cat[]): PickOption[] {
  const roots = all.filter((c) => !c.parent_id || !all.some((p) => p.id === c.parent_id))
  return roots.flatMap((r) => [
    { value: r.id, label: td(r.name) },
    ...all.filter((c) => c.parent_id === r.id).map((c) => ({ value: c.id, label: td(c.name), hint: td(r.name), indent: true })),
  ])
}

/** the main category and the sub-category of an item's category, by its id or its name */
export function useCategoryParts() {
  const cats = useCategories()
  return React.useMemo(() => {
    const all = (cats.data ?? []) as Cat[]
    const byId = new Map(all.map((c) => [c.id, c]))
    const byName = new Map(all.map((c) => [c.name, c]))
    return (idOrName: string | null | undefined): { main: string; sub: string } => {
      const c = idOrName ? byId.get(idOrName) ?? byName.get(idOrName) : undefined
      if (!c) return { main: idOrName && !byId.size ? idOrName : idOrName ?? '', sub: '' }
      const p = c.parent_id ? byId.get(c.parent_id) : undefined
      return p ? { main: td(p.name), sub: td(c.name) } : { main: td(c.name), sub: '' }
    }
  }, [cats.data])
}

/**
 * Two filters: Categories and Sub-categories. The value is the list of category ids that narrows the rows:
 * a main category stands for all of its sub-categories until some of them are chosen, then only those.
 */
export function CategoryPicks({ value, onChange, className }: { value: string[]; onChange: (v: string[]) => void; className?: string }) {
  const cats = useCategories()
  const all = (cats.data ?? []) as Cat[]
  const roots = all.filter((c) => !c.parent_id)
  const kids = (id: string) => all.filter((c) => c.parent_id === id).map((c) => c.id)
  const parentOf = (id: string) => all.find((c) => c.id === id)?.parent_id ?? null
  const mains = roots.filter((r) => value.includes(r.id) || kids(r.id).some((k) => value.includes(k))).map((r) => r.id)
  const subs = value.filter((id) => !!parentOf(id))
  const subOptions = all.filter((c) => c.parent_id && (!mains.length || mains.includes(c.parent_id)))
    .map((c) => ({ value: c.id, label: td(c.name), hint: td(all.find((p) => p.id === c.parent_id)?.name ?? '') }))

  const setMains = (next: string[]) => {
    const gone = mains.filter((m) => !next.includes(m))
    const added = next.filter((m) => !mains.includes(m))
    onChange([...value.filter((id) => !gone.includes(id) && !gone.includes(parentOf(id) ?? '')), ...added])
  }
  const setSubs = (next: string[]) => {
    let v = value.filter((id) => !parentOf(id) || next.includes(id))
    for (const s of next.filter((x) => !subs.includes(x))) { const p = parentOf(s); v = [...v.filter((id) => id !== p), s] }
    // the last sub-category of a chosen main category taken off: the whole main category again
    for (const s of subs.filter((x) => !next.includes(x))) {
      const p = parentOf(s)
      if (p && mains.includes(p) && !v.some((id) => parentOf(id) === p) && !v.includes(p)) v = [...v, p]
    }
    onChange(v)
  }
  return (
    <>
      <MultiPick label={t('Categories')} value={mains} onChange={setMains} options={roots.map((r) => ({ value: r.id, label: td(r.name) }))} className={className} />
      <MultiPick label={t('Sub-categories')} value={subs} onChange={setSubs} options={subOptions} className={className} />
    </>
  )
}

type Parts = ReturnType<typeof useCategoryParts>

/** the Category and Sub-category columns of a table whose rows know their item's category (its id or its name) */
export function categoryColumns<T>(get: (r: T) => string | null | undefined, parts: Parts): ColumnDef<T>[] {
  return [
    // one column: "Pije - Alkolike"; filtered by the main category
    { id: 'category', accessorFn: (r) => parts(get(r)).main, filterFn: inFilter, header: t('Category / sub-category'),
      meta: { label: t('Category / sub-category'), exportValue: (r: T) => { const p = parts(get(r)); return p.sub ? `${p.main} - ${p.sub}` : p.main } },
      cell: ({ row }) => { const p = parts(get(row.original)); return p.main ? (p.sub ? `${p.main} - ${p.sub}` : p.main) : '—' } },
    { id: 'subcategory', accessorFn: (r) => parts(get(r)).sub, filterFn: inFilter, header: t('Sub-category'), meta: { label: t('Sub-category'), filterOnly: true, noExport: true } },
  ]
}

/** the two filters of such a table, with the values its rows have */
export function categoryFacets<T>(rows: T[] | undefined, get: (r: T) => string | null | undefined, parts: Parts) {
  const ps = (rows ?? []).map((r) => parts(get(r)))
  const mains = [...new Set(ps.map((p) => p.main).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const subs = [...new Set(ps.map((p) => p.sub).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return [
    { columnId: 'category', title: t('Category'), options: mains.map((c) => ({ label: c, value: c })) },
    { columnId: 'subcategory', title: t('Sub-category'), options: subs.map((c) => ({ label: c, value: c })) },
  ]
}
