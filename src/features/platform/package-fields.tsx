/**
 * The client's package: the kind of business and its size, the modules it has, its limits.
 * Picking a package checks its modules and fills its limits; the Super Admin then adds or removes
 * single modules. What is checked here is exactly what the client gets.
 */
import { RotateCcw } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { FEATURES, MODULE_GROUPS, PACKAGES, packageOf, type Feature, type PackageKey } from '@/lib/plans'
import { BUSINESS_TYPES } from './business-types'

export type PackageValue = { key: PackageKey | ''; modules: Feature[]; stores: string; tills: string; users: string }
export const packageDefaults = (key: PackageKey): PackageValue => {
  const p = packageOf(key)!
  return { key, modules: [...p.modules], stores: p.stores == null ? '' : String(p.stores), tills: p.tills == null ? '' : String(p.tills), users: String(p.users) }
}
const limit = (v: string) => (v.trim() === '' ? null : Math.max(1, Math.floor(Number(v))))
export const packageLimits = (v: PackageValue) => ({ max_stores: limit(v.stores), max_tills: limit(v.tills), max_users: limit(v.users) ?? 1 })

/** the packages, by kind of business (a market comes in three sizes) */
const GROUPS = BUSINESS_TYPES.map((b) => ({ type: b, items: PACKAGES.filter((p) => p.businessType === b.value) })).filter((g) => g.items.length)

export function PackagePicker({ value, onChange, legacy }: { value: PackageValue; onChange: (v: PackageValue) => void
  /** an older plan the client is still on: shown, and kept until a package is chosen */
  legacy?: string | null }) {
  const pkg = packageOf(value.key)
  const [others, setOthers] = React.useState(false)
  const toggle = (f: Feature, on: boolean) => onChange({ ...value, modules: on ? [...new Set([...value.modules, f])] : value.modules.filter((x) => x !== f) })
  const kind = (f: Feature) => (pkg?.modules.includes(f) ? 'in' : pkg?.optional.includes(f) ? 'offer' : 'other')
  const changed = pkg && (value.modules.length !== pkg.modules.length || pkg.modules.some((m) => !value.modules.includes(m)))
  return (
    <div className="col-span-2 grid gap-3">
      <div className="grid gap-1.5">
        <Label>{t('Package')}</Label>
        <Select value={value.key || '__legacy'} onValueChange={(k) => onChange(k === '__legacy' ? { ...value, key: '' } : packageDefaults(k as PackageKey))}>
          <SelectTrigger aria-label={t('Package')}><SelectValue placeholder={t('Choose the kind of business')} /></SelectTrigger>
          <SelectContent>
            {legacy && <SelectItem value="__legacy">{t('Keep the older plan ({plan})', { plan: legacy })}</SelectItem>}
            {GROUPS.map((g) => (
              <SelectGroup key={g.type.value}>
                {g.items.length > 1 && <SelectLabel>{t(g.type.label)}</SelectLabel>}
                {g.items.map((p) => <SelectItem key={p.key} value={p.key}>{g.items.length > 1 ? t(p.label) : t(g.type.label)}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {pkg && <p className="text-[12.5px] text-muted-foreground">{t(pkg.hint)}</p>}
      </div>

      {pkg && <>
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1"><Label htmlFor="pk-stores" className="text-xs">{t('Units|stores')}</Label>
            <Input id="pk-stores" type="number" min={1} className="tabular" value={value.stores} onChange={(e) => onChange({ ...value, stores: e.target.value })} placeholder={t('No limit')} /></div>
          <div className="grid gap-1"><Label htmlFor="pk-tills" className="text-xs">{t('Tills')}</Label>
            <Input id="pk-tills" type="number" min={1} className="tabular" value={value.tills} onChange={(e) => onChange({ ...value, tills: e.target.value })} placeholder={t('No limit')} /></div>
          <div className="grid gap-1"><Label htmlFor="pk-users" className="text-xs">{t('Users')}</Label>
            <Input id="pk-users" type="number" min={1} className="tabular" value={value.users} onChange={(e) => onChange({ ...value, users: e.target.value })} /></div>
        </div>

        <fieldset className="grid gap-2 rounded-md border p-3">
          <legend className="flex items-center gap-2 px-1 text-[13px] font-medium">{t('Modules of this client')}
            <span className="font-normal text-muted-foreground">{t('{n} on', { n: value.modules.length })}</span></legend>
          <p className="text-xs text-muted-foreground">{t('Always there: items and stock, receiving, counts, partners, sales invoices, VAT book, cash and bank, reports. A module left off is not in the menu, its pages do not open and the server refuses it; the client cannot switch it on.')}</p>
          {MODULE_GROUPS.map((g) => {
            const items = FEATURES.filter((f) => f.group === g.key && (others || kind(f.key) !== 'other' || value.modules.includes(f.key)))
            if (!items.length) return null
            return (
              <div key={g.key} className="grid gap-1">
                <span className="text-[12px] font-medium text-muted-foreground">{t(g.label)}</span>
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {items.map((f) => {
                    const k = kind(f.key)
                    return (
                      <label key={f.key} className={cn('flex items-start gap-2 text-[13px]', k === 'other' && !value.modules.includes(f.key) && 'text-muted-foreground')}>
                        <Checkbox className="mt-0.5" checked={value.modules.includes(f.key)} onCheckedChange={(on) => toggle(f.key, !!on)} />
                        <span className="min-w-0">{t(f.label)}
                          {k === 'in' && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10.5px]">{t('in the package')}</Badge>}
                          {k === 'offer' && <Badge variant="outline" className="ml-1.5 px-1.5 py-0 text-[10.5px]">{t('on request')}</Badge>}
                          {(f.hint || f.cost) && <span className="block text-[11.5px] text-muted-foreground">{t(f.cost ?? f.hint!)}</span>}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" className="text-[12.5px] font-medium text-primary hover:underline" onClick={() => setOthers((o) => !o)}>
              {others ? t('Show only what this kind of business uses') : t('Show every module')}</button>
            {changed && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, modules: [...pkg.modules] })}><RotateCcw /> {t('Back to the package’s modules')}</Button>}
          </div>
        </fieldset>
      </>}
    </div>
  )
}
