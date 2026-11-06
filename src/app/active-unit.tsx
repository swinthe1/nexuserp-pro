import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { useMyWarehouseAccess, useWarehouses } from '@/features/inventory/api'
import { useCompanySettings } from '@/features/settings/api'

/*
 * The unit one works in now (Lider Market 2, Extra Grill, Depo Qendrore…), next to the company:
 * the company is the business with its NUI and books, the unit a shop, restaurant or warehouse of it.
 * Chosen once, it narrows the lists that have a unit and comes first in the forms; "all units" is the
 * whole company. Who may work in one unit only has it fixed. Kept per company on this device.
 */

const KEY = (company: string) => `drispro.unit.${company}`
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const read = (company: string | null | undefined) => {
  if (!company) return null
  try { return localStorage.getItem(KEY(company)) } catch { return null }
}

export function setActiveUnit(company: string, id: string | null) {
  try { if (id) localStorage.setItem(KEY(company), id); else localStorage.removeItem(KEY(company)) } catch { /* private window */ }
  listeners.forEach((l) => l())
}

export interface UnitRow { id: string; code: string; name: string; warehouse_type: string; city: string | null; is_active: boolean }

export function useActiveUnit() {
  const { companyId } = useCompany()
  const chosen = React.useSyncExternalStore(subscribe, () => read(companyId), () => null)
  const all = useWarehouses({ all: true }).data as UnitRow[] | undefined
  const access = useMyWarehouseAccess().data
  const said = (useCompanySettings().data as { multi_unit?: boolean | null } | undefined)?.multi_unit
  return React.useMemo(() => {
    const active = (all ?? []).filter((w) => w.is_active)
    const units = access?.length ? active.filter((w) => access.includes(w.id)) : active
    const fixed = units.length === 1 ? units[0]! : null
    // one unit (said so when the client was made, or only one there): the program does not talk about units
    const multi = said === false ? false : active.length > 1
    const unit = fixed ?? units.find((w) => w.id === chosen) ?? null
    return {
      /** the unit chosen, or null for all units of the company */
      unit,
      /** the units this person may choose from */
      units,
      /** works in one unit only: it cannot be changed */
      fixed: !!fixed,
      /** the company works with several units: the unit shows where it matters */
      multi,
      /** the client was set up with one unit: a second one is for the Super Admin to allow */
      oneOnly: said === false,
      set: (id: string | null) => { if (companyId) setActiveUnit(companyId, id) },
    }
  }, [all, access, chosen, companyId, said])
}

/** the unit to put first in a form: the active one, when it is among those the form offers */
export function useDefaultUnit(offered?: { id: string }[] | null) {
  const { unit } = useActiveUnit()
  return unit && (!offered || offered.some((w) => w.id === unit.id)) ? unit.id : null
}

/** a new document takes the active unit when its unit field is still empty */
export function useFillUnit(set: (id: string) => void, current: string | null | undefined, isNew: boolean) {
  const unit = useDefaultUnit()
  React.useEffect(() => { if (isNew && unit && !current) set(unit) }, [unit, isNew]) // eslint-disable-line react-hooks/exhaustive-deps
}
