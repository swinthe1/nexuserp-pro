import { useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** A copy of a file the person exported ("Eksportet e mia"). */
export type MyExport = { id: string; file_name: string; kind: 'xlsx' | 'csv' | 'pdf'; page: string | null; page_title: string | null; row_count: number | null; size_bytes: number | null; path: string; created_at: string }

/** the same file again, under its own name */
export async function downloadExport(r: Pick<MyExport, 'path' | 'file_name'>) {
  const { data, error } = await supabase.storage.from('my-exports').download(r.path)
  if (error) throw error
  const url = URL.createObjectURL(data)
  const a = document.createElement('a'); a.href = url; a.download = r.file_name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** the file's bytes as base64, to go as an email attachment */
export async function exportBase64(r: Pick<MyExport, 'path'>) {
  const { data, error } = await supabase.storage.from('my-exports').download(r.path)
  if (error) throw error
  const bytes = new Uint8Array(await data.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function useMyExports() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['my-exports', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('my_exports').select('id, file_name, kind, page, page_title, row_count, size_bytes, path, created_at')
      .eq('company_id', companyId!).order('created_at', { ascending: false }).limit(200)) as unknown as MyExport[],
  })
}

