import { Check, Copy } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { CALLS, VERIFY_NODE, VERIFY_PHP, WEBHOOK_EVENTS, WEBHOOK_EXAMPLE } from '@/features/portal/api-calls'
import { msg, t } from '@/i18n'
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { PublicFooter, PublicHeader } from './public-shell'

const SECTIONS = [
  { id: 'start', label: msg('Start') }, { id: 'keys', label: msg('Keys and limits') }, { id: 'calls', label: msg('The calls') },
  { id: 'webhooks', label: msg('Webhooks') }, { id: 'ai', label: msg('ChatGPT and Claude') }, { id: 'errors', label: msg('Errors') },
]

function Code({ children, label }: { children: string; label?: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <div className="relative overflow-hidden rounded-lg border bg-[#0B0B0C] text-[13px] text-white/90">
      {label && <div className="border-b border-white/10 px-4 py-1.5 text-xs text-white/60">{label}</div>}
      <button type="button" aria-label={t('Copy')} className="absolute right-2 top-2 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        onClick={() => void navigator.clipboard?.writeText(children).then(() => { setDone(true); toast.success(t('Copied')); setTimeout(() => setDone(false), 1500) })}>
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
      <pre className="overflow-x-auto p-4 pr-12 leading-relaxed"><code>{children}</code></pre>
    </div>
  )
}

/** The public documentation of the DrisPRO API, webhooks and the ChatGPT/Claude connector. */
export function DevelopersPage() {
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc`
  const curl = `curl -X POST '${base}/api_products' \\
  -H 'apikey: ${supabaseAnonKey}' \\
  -H 'x-api-key: nxa_…' \\
  -H 'Content-Type: application/json' \\
  -d '{"p_limit": 200}'` // i18n-ignore
  const js = `const r = await fetch('${base}/api_stock', {
  method: 'POST',
  headers: { apikey: PUBLIC_KEY, 'x-api-key': process.env.DRISPRO_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_skus: ['33173'] }),
})
if (!r.ok) throw new Error((await r.json()).message)
const stock = await r.json()` // i18n-ignore
  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{t('Connect your programs to DrisPRO')}</h1>
        <p className="mt-4 max-w-xl text-lg text-white/75">{t('A web shop, a mobile app, a report in Excel or another company’s program: read products, prices and stock, send orders, hear the moment an invoice is posted.')}</p>
      </PublicHeader>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block"><ul className="sticky top-6 grid gap-1 text-sm">
          {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{t(s.label)}</a></li>)}
        </ul></nav>
        <main className="grid min-w-0 gap-14 [&_h2]:scroll-mt-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-semibold [&_p]:leading-relaxed">
          <section className="grid gap-4"><h2 id="start">{t('Start')}</h2>
            <p>{t('The API is a set of calls. Each call is a POST with JSON to the address below, with two keys in the headers: the public key in “apikey” (the same for everyone) and the company’s own key in “x-api-key”.')}</p>
            <Code label={t('Address of the calls')}>{base + '/<call>'}</Code>
            <Code label="curl">{curl}</Code>{/* i18n-ignore */}
            <Code label="JavaScript">{js}</Code>{/* i18n-ignore */}
          </section>

          <section className="grid gap-4"><h2 id="keys">{t('Keys and limits')}</h2>
            <p>{t('An administrator of the company makes the key in DrisPRO: Company › B2B portal and API › API keys. A key works only for what it was allowed (its scopes) and with the rights of the person who made it. It is shown only once; keep it on your server, never in a web page or a phone app.')}</p>
            <ul className="grid gap-1.5 text-[15px]">
              {[t('At most 120 calls a minute for each key; past that the answer is 429 and you wait a minute.'), t('A key can be switched off at once if it leaks.'), t('Amounts are numbers with a dot, dates are YYYY-MM-DD, times are ISO 8601 with the time zone.')].map((x) => (
                <li key={x} className="flex gap-2"><Check className="mt-1 size-4 shrink-0 text-primary" />{x}</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4"><h2 id="calls">{t('The calls')}</h2>
            <div className="grid gap-3">
              {CALLS.map((c) => (
                <div key={c.fn} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2"><code className="font-semibold">POST /rpc/{c.fn}</code><span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{c.scope}</span></div>{/* i18n-ignore */}
                  <p className="mt-1 text-[14px] text-muted-foreground">{t(c.what)}</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2 text-[12px]">{c.body}</pre>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4"><h2 id="webhooks">{t('Webhooks')}</h2>
            <p>{t('Instead of asking every few minutes, let DrisPRO call you. An administrator adds your address in DrisPRO (Company › B2B portal and API › Webhooks) and chooses what to hear about. Every message is a POST with JSON; answer with any 2xx code within 10 seconds.')}</p>
            <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm">
              <thead className="bg-muted/60 text-left"><tr><th className="px-3 py-2 font-medium">{t('Event')}</th><th className="px-3 py-2 font-medium">{t('When')}</th></tr></thead>
              <tbody className="divide-y">{WEBHOOK_EVENTS.map((e) => <tr key={e.key}><td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{e.key}</td><td className="px-3 py-2">{t(e.what)}</td></tr>)}</tbody>
            </table></div>
            <Code label={t('A message')}>{WEBHOOK_EXAMPLE}</Code>
            <h3>{t('Is it really from DrisPRO?')}</h3>
            <p>{t('Each message carries X-DrisPRO-Timestamp and X-DrisPRO-Signature: sha256= and the HMAC-SHA256 of “timestamp.body” with your webhook’s secret. Check it, and refuse messages older than five minutes. X-DrisPRO-Delivery is the same when a message is sent again, so you can ignore one you already have.')}</p>
            <Code label="Node.js">{VERIFY_NODE}</Code>{/* i18n-ignore */}
            <Code label="PHP">{VERIFY_PHP}</Code>{/* i18n-ignore */}
            <h3>{t('When your program does not answer')}</h3>
            <p>{t('DrisPRO tries again after 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours and a day. An address that fails 50 times in a row is switched off and the company’s administrators are told; they switch it back on in DrisPRO. In the cloud, addresses must be https and on the public internet.')}</p>
          </section>

          <section className="grid gap-4"><h2 id="ai">{t('ChatGPT and Claude')}</h2>
            <p>{t('Each person can link DrisPRO to their own ChatGPT or Claude (account menu › DrisPRO in ChatGPT and Claude). The link speaks the Model Context Protocol (MCP): the assistant reads sales, stock, debts and reports with that person’s rights and can prepare drafts of invoices and purchase orders, never book them.')}</p>
          </section>

          <section className="grid gap-4"><h2 id="errors">{t('Errors')}</h2>
            <p>{t('An error comes back with an HTTP code and JSON: { "code": "…", "message": "…" }. The message is in English and says what to fix.')}</p>
            <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><tbody className="divide-y">
              {[['400', t('Something is missing or wrong in what you sent')], ['401 / 403', t('The key is wrong, switched off, or not allowed this call')], ['404', t('The call or the thing asked for does not exist')],
                ['409', t('It exists already (e.g. the same external_id)')], ['429', t('Too many calls this minute')], ['5xx', t('Our side: try again in a moment')]].map(([c, w]) => (
                <tr key={c}><td className={cn('whitespace-nowrap px-3 py-2 font-mono text-[12px]')}>{c}</td><td className="px-3 py-2">{w}</td></tr>
              ))}
            </tbody></table></div>
          </section>
        </main>
      </div>
      <PublicFooter />
    </div>
  )
}
