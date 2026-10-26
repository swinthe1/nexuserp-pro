/* a phone photo is several MB: make it 2000 px at most, which reads just as well and costs less */
export async function shrink(file: File): Promise<{ data: string; mime: string }> {
  const toB64 = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = bad; r.readAsDataURL(b) })
  if (file.type === 'application/pdf') return { data: await toB64(file), mime: 'application/pdf' }
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    if (k === 1 && file.size < 2_500_000 && /image\/(jpeg|png|webp)/.test(file.type)) return { data: await toB64(file), mime: file.type }
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('image'))), 'image/jpeg', 0.85))
    return { data: await toB64(blob), mime: 'image/jpeg' }
  } catch { return { data: await toB64(file), mime: file.type || 'image/jpeg' } }
}
