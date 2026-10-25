import { Printer } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { desktop, type DesktopSettings } from '@/lib/desktop'
import { printHtml } from '@/lib/print'

const NONE = '__none'
const TEST_CSS = '@page{size:80mm auto;margin:3mm 4mm} body{margin:0;font:14px/1.35 ui-monospace,Menlo,Consolas,monospace;width:72mm} .c{text-align:center} .big{font-size:20px;font-weight:700}'

/** This computer, in the Windows program: which printer gets receipts and kitchen tickets, the cash drawer, start with Windows. */
export function DesktopSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [s, setS] = React.useState<DesktopSettings | null>(null)
  const [printers, setPrinters] = React.useState<{ name: string; isDefault: boolean }[]>([])
  const [version, setVersion] = React.useState('')
  const [server, setServer] = React.useState('')
  React.useEffect(() => {
    if (!open || !desktop) return
    void desktop.settings().then((x) => { setS(x); setServer(x.server) })
    void desktop.printers().then(setPrinters)
    void desktop.info().then((i) => setVersion(i.version))
  }, [open])
  if (!desktop) return null
  const set = (patch: Partial<DesktopSettings>) => setS((x) => (x ? { ...x, ...patch } : x))
  const save = async () => { if (!s) return; await desktop!.saveSettings(s); toast.success(t('Saved for this computer')); onOpenChange(false) }
  const picker = (label: string, hint: string, key: 'receiptPrinter' | 'kitchenPrinter' | 'documentPrinter', kind: 'receipt' | 'kitchen' | 'document') => (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={s?.[key] || NONE} onValueChange={(v) => set({ [key]: v === NONE ? '' : v })}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('Ask every time (print window)')}</SelectItem>
            {printers.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}{p.isDefault ? ` · ${t('default')}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" aria-label={t('Print a test page')} onClick={async () => {
          await desktop!.saveSettings(s ?? {})
          printHtml(`<div class="c big">NexusERP</div><div class="c">${t('Test page')} · ${label}</div><div class="c">${new Date().toLocaleString()}</div>`, TEST_CSS, kind)
        }}><Printer /></Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('This computer')}</DialogTitle>
          <DialogDescription>{t('NexusERP for Windows {version}. These choices are kept on this computer only.', { version })}</DialogDescription>
        </DialogHeader>
        {!s ? <div className="h-60" /> : (
          <div className="grid max-h-[65dvh] gap-4 overflow-y-auto pr-1">
            {picker(t('Receipts'), t('Till receipts, bills and Z reports print here straight away.'), 'receiptPrinter', 'receipt')}
            {picker(t('Kitchen and bar tickets'), t('New orders sent to the kitchen print here.'), 'kitchenPrinter', 'kitchen')}
            {picker(t('Documents'), t('Invoices, packing slips and other pages: the print window opens with this printer chosen.'), 'documentPrinter', 'document')}
            <div className="grid gap-1.5">
              <Label>{t('Paper width of the receipt printer')}</Label>
              <Select value={String(s.paperWidth)} onValueChange={(v) => set({ paperWidth: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[80, 58].map((w) => <SelectItem key={w} value={String(w)}>{`${w} mm`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 rounded-md border p-3">
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span><span className="font-medium">{t('Cash drawer on a network receipt printer')}</span>
                  <span className="block text-xs text-muted-foreground">{t('Opens after a sale paid in cash. For a drawer on a USB printer, turn on “open the drawer” in the printer’s Windows settings.')}</span></span>
                <Switch checked={s.drawer.mode === 'network'} onCheckedChange={(on) => set({ drawer: { ...s.drawer, mode: on ? 'network' : 'none' } })} />
              </label>
              {s.drawer.mode === 'network' && (
                <div className="grid grid-cols-[1fr_96px_auto] gap-2">
                  <Input value={s.drawer.host} onChange={(e) => set({ drawer: { ...s.drawer, host: e.target.value } })} placeholder="192.168.1.50" aria-label={t('Printer address')} />
                  <Input type="number" value={s.drawer.port} onChange={(e) => set({ drawer: { ...s.drawer, port: Number(e.target.value) } })} aria-label={t('Port')} />
                  <Button variant="outline" onClick={async () => {
                    await desktop!.saveSettings(s); const r = await desktop!.openDrawer()
                    if (r.ok) toast.success(t('The drawer was opened')); else toast.error(t('The drawer did not answer: {reason}', { reason: r.reason ?? '' }))
                  }}>{t('Test')}</Button>
                </div>
              )}
            </div>
            <label className="flex items-center justify-between gap-3 text-[13px]"><span className="font-medium">{t('Start NexusERP with Windows')}</span>
              <Switch checked={s.autoStart} onCheckedChange={(v) => set({ autoStart: v })} /></label>
            <label className="flex items-center justify-between gap-3 text-[13px]"><span><span className="font-medium">{t('Full screen')}</span>
              <span className="block text-xs text-muted-foreground">{t('For tills and kitchen screens. F11 switches it any time.')}</span></span>
              <Switch checked={s.fullScreen} onCheckedChange={(v) => set({ fullScreen: v })} /></label>
            {s.licence && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-[13px]">
                <span><span className="font-medium">{s.company || t('Licence')}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{s.licence} · {s.mode === 'local' ? t('Local server') : t('Cloud')}</span></span>
                {desktop.reactivate && <Button variant="outline" size="sm" onClick={() => void desktop!.reactivate!()}>{t('Change licence or server')}</Button>}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="ds-server">{t('Server address')}</Label>
              <div className="flex gap-2">
                <Input id="ds-server" value={server} onChange={(e) => setServer(e.target.value)} spellCheck={false} />
                <Button variant="outline" disabled={server.trim() === s.server} onClick={() => void desktop!.setServer(server.trim()).catch((e: Error) => toast.error(e.message))}>{t('Change')}</Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button><Button onClick={() => void save()}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
