import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check, Star, Trash2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import type { Json } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import type { TableViewConfig } from './types'
import { t } from '@/i18n'

interface SavedView { id: string; name: string; config: TableViewConfig; is_default: boolean; is_shared: boolean; user_id: string }

export function useSavedViews(tableKey: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['table-views', companyId, tableKey],
    enabled: !!tableKey && !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('data_table_views')
        .select('id, name, config, is_default, is_shared, user_id')
        .eq('company_id', companyId).eq('table_key', tableKey!).order('name')
      if (error) throw error
      return data as unknown as SavedView[]
    },
  })
}

export function SavedViews({ tableKey, current, onApply }: { tableKey: string; current: () => TableViewConfig; onApply: (c: TableViewConfig) => void }) {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const views = useSavedViews(tableKey)
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const [asDefault, setAsDefault] = React.useState(false)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const key = ['table-views', companyId, tableKey]

  const save = useMutation({
    mutationFn: async () => {
      if (asDefault) {
        await supabase.from('data_table_views').update({ is_default: false }).eq('table_key', tableKey).eq('user_id', user!.id).eq('company_id', companyId)
      }
      const { error } = await supabase.from('data_table_views').insert({
        company_id: companyId, user_id: user!.id, table_key: tableKey, name: name.trim(),
        config: current() as unknown as Json, is_shared: shared, is_default: asDefault,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('View “{name}” saved', { name: name.trim() }))
      setSaving(false); setName(''); setShared(false); setAsDefault(false)
      void qc.invalidateQueries({ queryKey: key })
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('data_table_views').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><Bookmark /> {t('Views')}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{t('Saved views')}</DropdownMenuLabel>
          {!views.data?.length && <div className="px-2 py-2 text-xs text-muted-foreground">{t('Save filters, sorting and columns to reuse them.')}</div>}
          {views.data?.map((v) => (
            <DropdownMenuItem key={v.id} onSelect={() => { onApply(v.config); setActiveId(v.id) }} className="group">
              {activeId === v.id ? <Check className="!text-primary" /> : v.is_default ? <Star /> : <Bookmark />}
              <span className="flex-1 truncate">{v.name}</span>
              {v.is_shared && <span className="text-2xs text-muted-foreground">shared</span>}
              {v.user_id === user?.id && (
                <button
                  className="rounded p-0.5 opacity-0 hover:bg-destructive/10 group-hover:opacity-100"
                  aria-label={t('Delete view {name}', { name: v.name })}
                  onClick={(e) => { e.stopPropagation(); remove.mutate(v.id) }}
                >
                  <Trash2 className="!size-3.5 !text-destructive" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>{t('Save current view…')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('Save view')}</DialogTitle></DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate() }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="view-name">{t('Name')}</Label>
              <Input id="view-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Low stock in Tirana store')} />
            </div>
            <label className="flex items-center justify-between text-sm">{t('Share with the company')} <Switch checked={shared} onCheckedChange={setShared} /></label>
            <label className="flex items-center justify-between text-sm">{t('Open this view by default')} <Switch checked={asDefault} onCheckedChange={setAsDefault} /></label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaving(false)}>{t('Cancel')}</Button>
              <Button type="submit" loading={save.isPending} disabled={!name.trim()}>{t('Save view')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
