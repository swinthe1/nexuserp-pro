import { useQueryClient } from '@tanstack/react-query'
import { Copy, Store } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { generatePassword } from './api'

/** what the server is doing at each step, for the progress line */
function stepLabel(step: number, steps: number) {
  if (step <= 1) return msg('The shop, its products, suppliers, customers and staff')
  if (step === 2) return msg('Purchase orders, goods received and supplier invoices')
  if (step === 3) return msg('The bakery bakes its bread')
  if (step <= steps - 4) return msg('The tills, day by day')
  if (step === steps - 3) return msg('Orders and invoices for restaurants, the hotel and the school')
  if (step === steps - 2) return msg('Rent, electricity, assets and cash to the bank')
  if (step === steps - 1) return msg('Attendance, salaries, CRM and the VAT return')
  return msg('This morning at the tills')
}

/** Platform › a Kosovo supermarket with two months of sample data in every module, for showing DrisPRO to a client */
export function DemoClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [name, setName] = React.useState('Market Dardania')  // i18n-ignore
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState(generatePassword)
  const [days, setDays] = React.useState(30)
  const [progress, setProgress] = React.useState<{ step: number; steps: number } | null>(null)
  const [done, setDone] = React.useState(false)
  const busy = !!progress && !done

  React.useEffect(() => { if (open && !busy) { setProgress(null); setDone(false); setPassword(generatePassword()) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error(t('Write the name and the email of the demo account.'))
    setProgress({ step: 1, steps: 100 })
    try {
      const first = unwrap(await supabase.rpc('platform_create_demo_client', { p: { name: name.trim(), owner_email: email.trim().toLowerCase(), owner_password: password, days } })) as unknown as
        { company_id: string; next: number | null; steps: number }
      let next = first.next
      while (next) {
        setProgress({ step: next, steps: first.steps })
        const r = unwrap(await supabase.rpc('platform_demo_fill', { p_company: first.company_id, p_step: next })) as unknown as { next: number | null }
        next = r.next
      }
      setProgress({ step: first.steps, steps: first.steps })
      setDone(true)
      await qc.invalidateQueries()
    } catch (e) {
      toast.error(describeError(e))
      setProgress(null)
    }
  }

  const details = [
    t('DrisPRO demo: {name}', { name }),
    `${t('Address')}: ${window.location.origin}`,
    `${t('Email')}: ${email.trim().toLowerCase()}`,
    `${t('Password')}: ${password}`,
  ].join('\n')
  const pct = progress ? Math.round((progress.step / progress.steps) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Store className="size-4" />{t('Demo client')}</DialogTitle>
          <DialogDescription>
            {t('A supermarket in Prishtina, in euro, open since the first day of last month: products and stock, purchases, the tills day by day, wholesale customers, a bakery, assets, staff and salaries, VAT, CRM, loyalty cards and promotions. For showing DrisPRO to a client.')}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="grid gap-3">
            <p className="text-sm">{t('{name} is ready. Sign in with these details, or open it from the list of clients.', { name })}</p>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{details}</pre>
          </div>
        ) : progress ? (
          <div className="grid gap-2 py-2" role="status" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span>{t(stepLabel(progress.step, progress.steps))}</span>
              <span className="tabular text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{t('It takes a few minutes. Keep this window open.')}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="dm-name">{t('Name of the shop')}</Label>
              <Input id="dm-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="dm-email">{t('Email of the demo account')}</Label>
              <Input id="dm-email" type="email" autoComplete="off" value={email} placeholder="demo@drispro.com" onChange={(e) => setEmail(e.target.value)} />  {/* i18n-ignore */}
              <p className="text-xs text-muted-foreground">{t('A new address, not one of a real client: the demo can be deleted later with everything in it.')}</p></div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="grid gap-1.5"><Label htmlFor="dm-pass">{t('Password')}</Label>
                <div className="flex gap-2"><Input id="dm-pass" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>{t('New password')}</Button></div></div>
              <div className="grid gap-1.5"><Label htmlFor="dm-days">{t('Licence, days')}</Label>
                <Input id="dm-days" type="number" min={1} max={365} className="tabular" value={days} onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 30)))} /></div>
            </div>
          </div>
        )}
        <DialogFooter>
          {done ? (
            <>
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(details).then(() => toast.success(t('Copied'))) }}><Copy />{t('Copy')}</Button>
              <Button onClick={() => onOpenChange(false)}>{t('Done')}</Button>
            </>
          ) : !progress && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
              <Button onClick={() => void run()}>{t('Create the demo')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
