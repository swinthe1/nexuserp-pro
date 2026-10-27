import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { msg, t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { PublicFooter, PublicHeader } from './public-shell'

type Form = Record<'legal_name' | 'vat_number' | 'email' | 'phone' | 'iban' | 'website' | 'address' | 'city' | 'postal_code' | 'contact_name' | 'contact_phone' | 'contact_email', string>
type Data = Partial<Form> & { done: boolean; company: string; name?: string; tax_number?: string | null }

const FIELDS: { key: keyof Form; label: string; type?: string; wide?: boolean; group: 'firm' | 'contact' }[] = [
  { key: 'legal_name', label: msg('Legal name'), wide: true, group: 'firm' },
  { key: 'address', label: msg('Address'), wide: true, group: 'firm' },
  { key: 'city', label: msg('Town'), group: 'firm' },
  { key: 'postal_code', label: msg('Postal code'), group: 'firm' },
  { key: 'phone', label: msg('Phone'), type: 'tel', group: 'firm' },
  { key: 'email', label: msg('E-mail'), type: 'email', group: 'firm' },
  { key: 'vat_number', label: msg('VAT number'), group: 'firm' },
  { key: 'iban', label: msg('IBAN'), group: 'firm' },
  { key: 'website', label: msg('Website'), group: 'firm' },
  { key: 'contact_name', label: msg('Name and surname'), wide: true, group: 'contact' },
  { key: 'contact_phone', label: msg('Phone'), type: 'tel', group: 'contact' },
  { key: 'contact_email', label: msg('E-mail'), type: 'email', group: 'contact' },
]

/** The page a customer or supplier opens from the link a company sent: their own details, checked and sent once. */
export function PartnerInfoPage() {
  const { token = '' } = useParams()
  const q = useQuery({ queryKey: ['partner-info', token], retry: false,
    queryFn: async () => unwrap(await supabase.rpc('partner_info_form', { p_token: token })) as unknown as Data })
  const [f, setF] = React.useState<Form | null>(null)
  React.useEffect(() => {
    if (q.data && !f) setF(Object.fromEntries(FIELDS.map((x) => [x.key, (q.data as Partial<Form>)[x.key] ?? ''])) as Form)
  }, [q.data, f])
  const send = useMutation({ mutationFn: async () => unwrap(await supabase.rpc('partner_info_submit', { p_token: token, p: f as never })) })
  const d = q.data
  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader>
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{d ? t('Your details for {company}', { company: d.company }) : t('Your details')}</h1>
        <p className="mt-3 max-w-xl text-white/75">{t('Check and complete them, so invoices and payments reach you without mistakes. It takes a minute.')}</p>
      </PublicHeader>
      <main className="relative mx-auto -mt-8 max-w-3xl px-4 pb-16 sm:px-6">
        {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? (
          <Card><CardContent className="grid justify-items-center gap-2 p-10 text-center"><TriangleAlert className="size-7 text-warning" />
            <p className="font-medium">{tServer(describeError(q.error))}</p></CardContent></Card>
        ) : d?.done || send.isSuccess ? (
          <Card><CardContent className="grid justify-items-center gap-2 p-10 text-center"><CheckCircle2 className="size-8 text-success" />
            <p className="text-lg font-semibold">{t('Thank you! The details were sent to {company}.', { company: d?.company ?? '' })}</p>
            <p className="text-sm text-muted-foreground">{t('You can close this page.')}</p></CardContent></Card>
        ) : f && d && (
          <Card><CardContent className="grid gap-6 p-5 sm:p-8">
            <div><div className="text-lg font-semibold">{d.name}</div>{d.tax_number && <div className="text-sm text-muted-foreground">{t('NIPT / NUI')} {d.tax_number}</div>}</div>
            {(['firm', 'contact'] as const).map((g) => (
              <section key={g} className="grid gap-3">
                <h2 className="text-sm font-semibold">{g === 'firm' ? t('The business') : t('Contact person (optional)')}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.filter((x) => x.group === g).map((x) => (
                    <div key={x.key} className={x.wide ? 'grid gap-1.5 sm:col-span-2' : 'grid gap-1.5'}>
                      <Label htmlFor={`pi-${x.key}`}>{t(x.label)}</Label>
                      <Input id={`pi-${x.key}`} type={x.type ?? 'text'} className="h-11" value={f[x.key]} maxLength={200}
                        onChange={(e) => setF({ ...f, [x.key]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {send.isError && <p className="text-sm text-destructive">{tServer(describeError(send.error))}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="text-xs text-muted-foreground">{t('The details go only to {company}, to be used on invoices and payments.', { company: d.company })}</p>
              <Button size="lg" className="h-11" loading={send.isPending} onClick={() => send.mutate()}>{t('Send the details')}</Button>
            </div>
          </CardContent></Card>
        )}
      </main>
      <PublicFooter />
    </div>
  )
}
