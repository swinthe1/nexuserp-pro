/**
 * "More": the actions of a screen that are not its next step, behind one ⋯ button. The rule of the
 * program is one clear main button for what usually comes next, and everything else here; an action
 * that cannot be undone asks first, in the same window as everywhere else.
 */
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export type MoreItem = {
  label: string
  icon?: LucideIcon
  /** what it does; or `to` to open a page */
  onSelect?: () => unknown
  to?: string
  /** asks before doing it (delete, cancel, anything that cannot be undone) */
  confirm?: { title: string; description: React.ReactNode; confirmLabel?: string }
  destructive?: boolean
  disabled?: boolean
  /** a line above this item */
  separate?: boolean
  hidden?: boolean
}

export function MoreMenu({ items, size = 'default', label, className }: { items: MoreItem[]; size?: 'sm' | 'default'; label?: string; className?: string }) {
  const navigate = useNavigate()
  const [asking, setAsking] = React.useState<MoreItem | null>(null)
  const shown = items.filter((i) => !i.hidden)
  if (!shown.length) return null
  const run = (i: MoreItem) => { if (i.confirm) setAsking(i); else if (i.to) navigate(i.to); else void i.onSelect?.() }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size === 'sm' ? 'sm' : 'default'} className={cn(!label && 'px-2.5', className)} aria-label={label ?? t('More')}>
            <MoreHorizontal />{label && <span>{label}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {shown.map((i, n) => (
            <React.Fragment key={i.label}>
              {i.separate && n > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem disabled={i.disabled} onSelect={() => run(i)} className={cn(i.destructive && 'text-destructive focus:text-destructive')}>
                {i.icon && <i.icon />} {i.label}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {asking?.confirm && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) setAsking(null) }} title={asking.confirm.title} description={asking.confirm.description}
          confirmLabel={asking.confirm.confirmLabel ?? asking.label} destructive={asking.destructive}
          onConfirm={async () => { await asking.onSelect?.(); setAsking(null) }} />
      )}
    </>
  )
}
