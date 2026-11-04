import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageUp, PenLine, Plus, Star, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useMembers } from '@/features/sales/api'

type Signature = { id: string; person_name: string; person_title: string | null; image: string; user_ids: string[]; is_default: boolean }

/**
 * A photo of a signature on paper, made ready for documents: the paper (white, grey, a shadow)
 * becomes transparent, the ink is kept and darkened a little, and the picture is cut to the ink.
 */
export async function cleanSignature(f: File): Promise<string> {
  const url = URL.createObjectURL(f)
  try {
    const img = new Image(); img.src = url; await img.decode()
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight))
    const W = Math.max(1, Math.round(img.naturalWidth * k)), H = Math.max(1, Math.round(img.naturalHeight * k))
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, W, H)
    const px = g.getImageData(0, 0, W, H)
    const d = px.data
    // the paper's brightness: most of the picture is paper
    const lum = new Uint8Array(W * H)
    const hist = new Array(256).fill(0)
    for (let i = 0; i < W * H; i++) { const l = Math.round(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!); lum[i] = l; hist[l]++ }
    let acc = 0, paper = 255
    for (let l = 255; l >= 0; l--) { acc += hist[l]; if (acc > W * H * 0.5) { paper = l; break } }
    const ink = Math.max(0, paper - 70), soft = Math.max(ink + 1, paper - 25)
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let i = 0; i < W * H; i++) {
      const l = lum[i]!
      const a = l <= ink ? 255 : l >= soft ? 0 : Math.round(255 * (soft - l) / (soft - ink))
      d[i * 4 + 3] = a
      if (a > 0) {
        // a little darker, so a ballpoint reads on the PDF
        d[i * 4] = Math.round(d[i * 4]! * 0.7); d[i * 4 + 1] = Math.round(d[i * 4 + 1]! * 0.7); d[i * 4 + 2] = Math.round(d[i * 4 + 2]! * 0.75)
        if (a > 60) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
    }
    g.putImageData(px, 0, 0)
    if (x1 < 0) throw new Error('empty')
    const pad = 6
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad)
    const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  } finally { URL.revokeObjectURL(url) }
}

/** The signatures documents can go out with: the owner's, the director's, the finance director's… */
export function SignaturesCard() {
  const { companyId, can } = useCompany()
  const admin = can('admin.write')
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['company-signatures', companyId], enabled: !!companyId && admin,
    queryFn: async () => unwrap(await supabase.from('company_signatures').select('id, person_name, person_title, image, user_ids, is_default')
      .eq('company_id', companyId!).is('deleted_at', null).order('is_default', { ascending: false }).order('person_name')) as unknown as Signature[],
  })
  const members = useMembers()
  const [edit, setEdit] = React.useState<Partial<Signature> | null>(null)
  const del = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('signature_delete', { p_id: id })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['company-signatures', companyId] }); void qc.invalidateQueries({ queryKey: ['my-signatures', companyId] }); toast.success(t('The signature was removed')) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!admin) return null
  const who = (ids: string[]) => ids.map((u) => members.data?.find((m) => m.id === u)?.full_name ?? members.data?.find((m) => m.id === u)?.email ?? '…')
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{t('Signatures')}</CardTitle>
          <CardDescription>{t('The signature of the owner, the director or the finance director, to send invoices and documents as a signed and stamped PDF, without printing and scanning them. Each signature says who may sign with it.')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEdit({ person_name: '', person_title: '', user_ids: [], is_default: !(list.data?.length) })}><Plus /> {t('Add a signature')}</Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!list.data?.length ? (
          <EmptyState compact icon={PenLine} title={t('No signatures yet')} description={t('Sign on a white paper, take a photo and add it here: the paper is removed by itself.')} />
        ) : list.data.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
            <div className="grid h-16 w-44 place-items-center rounded-md border bg-white"><img src={s.image} alt="" className="max-h-14 max-w-40 object-contain" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.person_name}{s.person_title && <span className="font-normal text-muted-foreground">, {s.person_title}</span>}
                {s.is_default && <Badge variant="secondary" className="ml-2"><Star className="size-3" /> {t('Default')}</Badge>}</p>
              <p className="text-[13px] text-muted-foreground">{s.user_ids.length ? t('Signs with it: {names}, and the administrators', { names: who(s.user_ids).join(', ') }) : t('Only the administrators sign with it')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEdit(s)}>{t('Change')}</Button>
            <ConfirmDialog trigger={<Button variant="ghost" size="sm" className="text-destructive" aria-label={t('Remove')}><Trash2 /></Button>}
              title={t('Remove the signature of {name}?', { name: s.person_name })} description={t('Documents already sent keep it; new ones can no longer be signed with it.')}
              confirmLabel={t('Remove')} destructive onConfirm={() => del.mutateAsync(s.id)} />
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">{t('Every document that goes out signed says so in its history: who sent it, with whose signature, and how (PDF, email, print). It is a picture of the signature, not a qualified electronic signature.')}</p>
      </CardContent>
      {edit && <SignatureDialog value={edit} members={members.data ?? []} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function SignatureDialog({ value, members, onClose }: { value: Partial<Signature>; members: { id: string; full_name: string | null; email: string | null }[]; onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [name, setName] = React.useState(value.person_name ?? '')
  const [title, setTitle] = React.useState(value.person_title ?? '')
  const [image, setImage] = React.useState<string | null>(null)
  const [users, setUsers] = React.useState<string[]>(value.user_ids ?? [])
  const [def, setDef] = React.useState(!!value.is_default)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const pick = async (f: File | undefined) => {
    if (!f) return
    try { setImage(await cleanSignature(f)) } catch { toast.error(t('No signature found in this picture: sign with a dark pen on white paper')) }
  }
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('signature_save', {
      p_company: companyId!, p_id: (value.id ?? null) as string, p_name: name, p_title: title, p_image: (image ?? null) as string, p_user_ids: users, p_default: def,
    })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['company-signatures', companyId] }); void qc.invalidateQueries({ queryKey: ['my-signatures', companyId] }); toast.success(t('Saved')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  const shown = image ?? value.image ?? null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{value.id ? t('Change the signature') : t('Add a signature')}</DialogTitle>
          <DialogDescription>{t('Sign with a dark pen on white paper, take a photo or scan it. The paper is removed and only the ink is kept.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-24 w-60 place-items-center rounded-md border bg-white bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%,transparent_75%,#f3f4f6_75%),linear-gradient(45deg,#f3f4f6_25%,transparent_25%,transparent_75%,#f3f4f6_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]">
              {shown ? <img src={shown} alt="" className="max-h-20 max-w-56 object-contain" /> : <span className="text-[12px] text-muted-foreground">{t('No picture yet')}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><ImageUp /> {shown ? t('Another picture') : t('Choose a picture')}</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="sg-name">{t('Name and surname')}</Label><Input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="sg-title">{t('Position')}</Label>
              <Input id="sg-title" list="sg-titles" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Director')} />
              <datalist id="sg-titles">{[t('Owner'), t('Director'), t('Executive director'), t('Finance director'), t('Accountant')].map((x) => <option key={x} value={x} />)}</datalist>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('Who may sign documents with it')}</Label>
            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={users.includes(m.id)} onCheckedChange={(c) => setUsers((u) => c ? [...u, m.id] : u.filter((x) => x !== m.id))} />
                  <span className="truncate">{m.full_name || m.email}</span>
                </label>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">{t('The administrators always may. Nobody else sees the picture.')}</p>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">{t('Offered first when a document is sent')}<Switch checked={def} onCheckedChange={setDef} /></label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={name.trim().length < 2 || !shown} onClick={() => save.mutate()}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
