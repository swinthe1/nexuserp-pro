import { Download, FileSpreadsheet, FileText, FolderDown, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDateWith, t } from '@/i18n'
import { desktop, type DesktopDownload } from '@/lib/desktop'
import { downloadExport, useMyExports } from '@/lib/my-exports'
import { cn } from '@/lib/utils'

/** the files the Windows program saved, kept fresh as each download finishes */
function useDesktopDownloads() {
  const [list, setList] = React.useState<DesktopDownload[]>([])
  React.useEffect(() => {
    if (!desktop?.downloads) return
    void desktop.downloads().then(setList).catch(() => undefined)
    return desktop.onDownloaded?.((d) => setList((l) => [d, ...l.filter((x) => x.path !== d.path)].slice(0, 10)))
  }, [])
  return list
}

/**
 * In the top bar: the file exported last, to open it again. In the Windows program also where it was
 * saved on this computer, with a button that opens that folder; a browser does not tell the page
 * where it saves, so there it is Ctrl+J.
 */
export function LastExportButton() {
  const list = useMyExports()
  const saved = useDesktopDownloads()
  const last = list.data?.[0]
  if (!last) return null
  // the copy on this computer: the newest download with the same name (the browser may add " (1)")
  const stem = last.file_name.replace(/\.[^.]+$/, '')
  const local = saved.find((d) => d.name === last.file_name || d.name.startsWith(stem))
  const Icon = last.kind === 'pdf' ? FileText : FileSpreadsheet
  const recent = Date.now() - new Date(last.created_at).getTime() < 10 * 60_000
  return (
    <div className="hidden items-center md:flex">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn('flex h-8 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] hover:bg-secondary', recent ? 'border-primary/40 bg-primary/5' : 'border-transparent text-muted-foreground')}
          title={t('The file exported last')}>
          <Icon className={cn('size-4 shrink-0', last.kind === 'pdf' ? 'text-destructive' : 'text-success')} />
          <span className="truncate">{last.file_name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="truncate text-sm font-medium text-foreground">{last.file_name}</span>
            <span className="text-[12px] text-muted-foreground">{formatDateWith(new Date(last.created_at), { dateStyle: 'medium', timeStyle: 'short' })}{last.page_title ? ` · ${last.page_title}` : ''}</span>
            {local && <span className="break-all text-[11.5px] text-muted-foreground" title={local.path}>{local.path}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {local && desktop?.openFile && <DropdownMenuItem onSelect={() => void desktop!.openFile!(local.path)}><SquareArrowOutUpRight /> {t('Open the file')}</DropdownMenuItem>}
          {local && desktop?.showInFolder && <DropdownMenuItem onSelect={() => void desktop!.showInFolder!(local.path)}><FolderOpen /> {t('Open the folder where it is saved')}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => void downloadExport(last)}><Download /> {t('Download again')}</DropdownMenuItem>
          {last.page && <DropdownMenuItem asChild><Link to={last.page}><SquareArrowOutUpRight /> {t('Go to the page it came from')}</Link></DropdownMenuItem>}
          <DropdownMenuItem asChild><Link to="/exports"><FolderDown /> {t('My exports')}</Link></DropdownMenuItem>
          {!desktop && <p className="px-2 py-1.5 text-[11.5px] text-muted-foreground">{t('The browser saved it in Downloads: Ctrl+J shows it, with "Show in folder".')}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {local && desktop?.showInFolder && (
        <button type="button" onClick={() => void desktop!.showInFolder!(local.path)} title={local.path} aria-label={t('Open the folder where it is saved')}
          className="ml-0.5 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"><FolderOpen className="size-4" /></button>
      )}
    </div>
  )
}
