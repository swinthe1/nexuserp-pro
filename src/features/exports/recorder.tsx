import { useQueryClient } from '@tanstack/react-query'
import { activePage } from '@/components/layout/work-tabs'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { t } from '@/i18n'
import { setExportRecorder } from '@/lib/export'
import { supabase } from '@/lib/supabase'

/**
 * Keeps a copy of every file a person exports from a list or report ("Eksportet e mia"): the browser
 * saves it in its own downloads folder, which a web page cannot open or show; the copy can be
 * downloaded again from any computer. Mounted once in the app's layout.
 */
export function ExportsRecorder() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  React.useEffect(() => {
    if (!companyId || !user) { setExportRecorder(null); return }
    setExportRecorder((blob, filename, rows) => {
      const kind = /\.xlsx$/i.test(filename) ? 'xlsx' : /\.pdf$/i.test(filename) ? 'pdf' : 'csv'
      const safe = filename.replace(/[\\/:*?"<>|#%]+/g, '-').slice(0, 150) || `export.${kind}`
      const path = `${companyId}/${user.id}/${crypto.randomUUID()}/${safe}`
      const page = `${window.location.pathname}${window.location.search}`.slice(0, 300)
      const title = (activePage()?.querySelector('h1')?.textContent ?? document.title ?? '').trim().slice(0, 200) || null
      void (async () => {
        const up = await supabase.storage.from('my-exports').upload(path, blob, { contentType: blob.type || undefined, upsert: false })
        if (up.error) return
        const ins = await supabase.from('my_exports').insert({ company_id: companyId, file_name: safe, kind, page, page_title: title, row_count: rows, size_bytes: blob.size, path } as never)
        if (ins.error) return
        void qc.invalidateQueries({ queryKey: ['my-exports', companyId] })
        toast.success(t('{file} is in your downloads', { file: safe }), {
          description: t('A copy is kept under My exports, to download again from any computer.'),
          action: { label: t('My exports'), onClick: () => navigate('/exports') },
        })
      })()
    })
    return () => setExportRecorder(null)
  }, [companyId, user, qc, navigate])
  return null
}
