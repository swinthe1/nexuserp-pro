import { ArrowDownToLine, ArrowRight, Cable, CalendarPlus, KeyRound, MoreHorizontal, Pause, Play, Shapes, ShieldCheck, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { startSupportVisit } from '@/components/license-banner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { formatDate, todayISO } from '@/lib/utils'
import { type PlatformClient, useSaveLicense } from '../api'
import { addMonths, BusinessTypeDialog, DeleteClientDialog, LicenseDialog, LiveLinkDialog, PasswordDialog } from '../dialogs'

/** Open a client's company to help them (written in the platform's diary). */
export function useOpenCompany() {
  const { switchCompany } = useCompany()
  const navigate = useNavigate()
  return async (id: string, path = '/') => { startSupportVisit(id); await switchCompany(id); navigate(path) }
}

/** One more year (or month) on a licence, from its end date (or from today when it has ended). */
export function useRenew() {
  const save = useSaveLicense()
  return {
    pending: save.isPending,
    renew: (c: PlatformClient, months = 12) => {
      if (!c.plan || !c.valid_until) return
      const from = c.valid_until < todayISO() ? todayISO() : c.valid_until
      const until = addMonths(from, months)
      save.mutate({ company: c.id, plan: c.plan, max_users: c.max_users ?? 1, valid_from: c.valid_from ?? todayISO(), valid_until: until, status: c.status === 'suspended' ? 'suspended' : 'active', notes: c.notes },
        { onSuccess: () => toast.success(t('{name}: valid until {date}', { name: c.name, date: formatDate(until) })), onError: (e) => toast.error(describeError(e)) })
    },
    pause: (c: PlatformClient, on: boolean) => {
      if (!c.plan || !c.valid_until) return
      save.mutate({ company: c.id, plan: c.plan, max_users: c.max_users ?? 1, valid_from: c.valid_from ?? todayISO(), valid_until: c.valid_until, status: on ? 'suspended' : 'active', notes: c.notes },
        { onSuccess: () => toast.success(on ? t('{name} is paused: nobody can sign in', { name: c.name }) : t('{name} works again', { name: c.name })), onError: (e) => toast.error(describeError(e)) })
    },
  }
}

/** The "⋯" of a client, in the list and on its page. */
export function ClientActions({ c, button }: { c: PlatformClient; button?: React.ReactNode }) {
  const open = useOpenCompany()
  const { renew, pause } = useRenew()
  const [dialog, setDialog] = React.useState<null | 'licence' | 'password' | 'type' | 'link' | 'delete'>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button ?? <Button variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: c.name })} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button>}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => void open(c.id)}><ArrowRight /> {t('Open this company')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog('licence')}><ShieldCheck /> {t('Change licence')}</DropdownMenuItem>
          {c.valid_until && <DropdownMenuItem onSelect={() => renew(c, 12)}><CalendarPlus /> {t('One more year')}</DropdownMenuItem>}
          {c.status === 'suspended'
            ? <DropdownMenuItem onSelect={() => pause(c, false)}><Play /> {t('Resume the licence')}</DropdownMenuItem>
            : c.status && <DropdownMenuItem onSelect={() => pause(c, true)}><Pause /> {t('Pause the licence')}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog('type')}><Shapes /> {t('Type of business')}</DropdownMenuItem>
          <DropdownMenuItem disabled={!c.admins.length} onSelect={() => setDialog('password')}><KeyRound /> {t('Set a new password')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('link')}><Cable /> {t('Live link and training')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void open(c.id, '/settings/migration')}><ArrowDownToLine /> {t('Move data from the old program')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog('delete')}><Trash2 /> {t('Delete the client')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LicenseDialog client={dialog === 'licence' ? c : null} onClose={() => setDialog(null)} />
      <PasswordDialog target={dialog === 'password' ? { email: c.admins[0] ?? '' } : null} onClose={() => setDialog(null)} />
      <BusinessTypeDialog client={dialog === 'type' ? c : null} onClose={() => setDialog(null)} />
      <LiveLinkDialog client={dialog === 'link' ? c : null} onClose={() => setDialog(null)} />
      <DeleteClientDialog client={dialog === 'delete' ? c : null} onClose={() => setDialog(null)} />
    </>
  )
}
