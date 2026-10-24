import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/** Label, control and a hint, in the settings grid */
export function Field({ label, hint, children, className, htmlFor }: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A row with a switch on the right, for yes/no settings */
export function ToggleRow({ title, description, control }: { title: string; description?: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

/** Sticky save bar shown while a form has unsaved changes */
export function SaveBar({ dirty, saving, onSave, onReset, disabled }: {
  dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; disabled?: boolean
}) {
  if (!dirty) return null
  return (
    <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg print:hidden">
      <span className="text-[13px] text-muted-foreground">{t('You have unsaved changes.')}</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onReset}>{t('Discard')}</Button>
        <Button size="sm" disabled={saving || disabled} onClick={onSave}>{saving ? t('Saving…') : t('Save changes')}</Button>
      </div>
    </div>
  )
}
