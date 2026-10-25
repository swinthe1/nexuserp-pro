import { ImagePlus, Trash2, Upload } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { useProductImages, useSetProductImage } from '../api'

/** a picture shrunk to at most 800 px on the long side, as a JPEG data: URL */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error(t('This file is not a picture.'))); i.src = url
    })
    const scale = Math.min(1, 800 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally { URL.revokeObjectURL(url) }
}

/** The product's picture next to its name: click to see it large, change or remove it. */
export function ProductPhoto({ productId, name, hasImage }: { productId: string; name: string; hasImage: boolean }) {
  const { can } = useCompany()
  const images = useProductImages(hasImage ? [productId] : [])
  const setImage = useSetProductImage(productId)
  const [open, setOpen] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const src = hasImage ? images.data?.[productId] : undefined
  const canEdit = can('inventory.write')
  if (!src && !canEdit) return null

  const pick = () => input.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    let data: string
    try { data = await shrink(f) } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); return }
    setImage.mutate(data, { onSuccess: () => setOpen(false) })
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} />
      <button type="button" onClick={() => (src ? setOpen(true) : pick())} aria-label={src ? t('Show the picture') : t('Add a picture')}
        className={cn('grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-card',
          !src && 'border-dashed text-muted-foreground hover:border-primary hover:text-primary', setImage.isPending && 'opacity-60')}>
        {src ? <img src={src} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{name}</DialogTitle></DialogHeader>
          {src && <img src={src} alt={name} className="mx-auto max-h-[60vh] rounded-md object-contain" />}
          {canEdit && (
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" className="text-destructive" disabled={setImage.isPending}
                onClick={() => setImage.mutate(null, { onSuccess: () => setOpen(false) })}><Trash2 /> {t('Remove the picture')}</Button>
              <Button variant="outline" disabled={setImage.isPending} onClick={pick}><Upload /> {t('Change the picture')}</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
