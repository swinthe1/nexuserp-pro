import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import type { Json } from '@/lib/database.types'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/** a labelled choice of a report's filter panel */
export function Pick({ label, value, onChange, options, width, disabled }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; width: string; disabled?: boolean }) {
  return (
    <div className="grid gap-1"><Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn('h-9', width)}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select></div>
  )
}

/** a range from–to of a report's filter panel */
export function Range({ label, lo, hi, onLo, onHi }: { label: string; lo: string; hi: string; onLo: (v: string) => void; onHi: (v: string) => void }) {
  return (
    <div className="grid gap-1"><Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input inputMode="decimal" className="h-9 w-24" placeholder={t('from|amount')} value={lo} onChange={(e) => onLo(e.target.value)} />
        <span className="text-muted-foreground">–</span>
        <Input inputMode="decimal" className="h-9 w-24" placeholder={t('to|amount')} value={hi} onChange={(e) => onHi(e.target.value)} />
      </div></div>
  )
}


type Saved<F> = { id: string; name: string; config: Partial<F>; is_shared: boolean; user_id: string }

/** the filters of a report kept under a name, for oneself or the whole company; a quick period stays a quick period */
export function SavedFilters<F>({ storeKey, current, onApply, prepare, restore }: {
  storeKey: string
  current: () => F
  onApply: (f: Partial<F>) => void
  /** what is kept (a quick period without its dates) */
  prepare?: (f: F) => Partial<F>
  /** what is applied (the dates of a quick period, counted again) */
  restore?: (c: Partial<F>) => Partial<F>
}) {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const key = ['table-views', companyId, storeKey]
  const list = useQuery({
    queryKey: key, enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('data_table_views').select('id, name, config, is_shared, user_id')
      .eq('company_id', companyId!).eq('table_key', storeKey).order('name')) as unknown as Saved<F>[],
  })
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const save = useMutation({
    mutationFn: async () => {
      const f = current()
      unwrap(await supabase.from('data_table_views').insert({ company_id: companyId!, user_id: user!.id, table_key: storeKey,
        name: name.trim(), config: (prepare ? prepare(f) : f) as unknown as Json, is_shared: shared, is_default: false }))
    },
    onSuccess: () => { toast.success(t('Filters “{name}” saved', { name: name.trim() })); setOpen(false); setName(''); setShared(false); void qc.invalidateQueries({ queryKey: key }) },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('data_table_views').delete().eq('id', id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline"><Bookmark /> {t('Saved filters')}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {!!list.data?.length && <DropdownMenuLabel>{t('Saved filters')}</DropdownMenuLabel>}
          {(list.data ?? []).map((p) => (
            <DropdownMenuItem key={p.id} className="group" onSelect={() => onApply(restore ? restore(p.config) : p.config)}>
              <span className="flex-1 truncate">{p.name}</span>
              {p.is_shared && <span className="text-[11px] text-muted-foreground">{t('Shared')}</span>}
              {p.user_id === user?.id && <Trash2 className="size-3.5 opacity-0 group-hover:opacity-60" onClick={(e) => { e.stopPropagation(); e.preventDefault(); remove.mutate(p.id) }} />}
            </DropdownMenuItem>
          ))}
          {!!list.data?.length && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setOpen(true)}>{t('Save these filters…')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t('Save these filters')}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="preset-name">{t('Name')}</Label>
              <Input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Imports this month')} autoFocus /></div>
            <label className="flex items-center justify-between gap-3 text-sm">{t('Everyone in the company can use them')}<Switch checked={shared} onCheckedChange={setShared} /></label>
            <p className="text-[12.5px] text-muted-foreground">{t('A quick period such as this month is kept as the period, so it moves with the calendar.')}</p>
          </div>
          <DialogFooter><Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
