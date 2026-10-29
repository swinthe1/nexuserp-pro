import { Building2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { usePlatformClients } from '../api'
import { licenseState } from '../dialogs'
import { Badge } from '@/components/ui/badge'

/** Ctrl K in the console: find a client by name, NUI or an administrator's email, and open it. */
export function ClientSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const clients = usePlatformClients(open)
  const navigate = useNavigate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0" hideClose>
        <DialogTitle className="sr-only">{t('Find a client')}</DialogTitle>
        <Command>
          <CommandInput placeholder={t('Find a client: name, NUI or email…')} autoFocus />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>{clients.isLoading ? t('Loading…') : t('No client matches the search')}</CommandEmpty>
            <CommandGroup heading={t('Clients')}>
              {(clients.data?.clients ?? []).map((c) => {
                const s = licenseState(c)
                return (
                  <CommandItem key={c.id} value={[c.name, c.legal_name, c.tax_number, ...c.admins].filter(Boolean).join(' ')}
                    onSelect={() => { onOpenChange(false); navigate(`/platform/clients/${c.id}`) }} className="gap-3">
                    <Building2 className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.tax_number, c.admins[0]].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
