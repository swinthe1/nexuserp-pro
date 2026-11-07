import * as React from 'react'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

export function ConfirmDialog({ trigger, title, description, confirmLabel, destructive, onConfirm, open: openProp, onOpenChange }: {
  /** the button that opens it; leave it out when the dialog is opened from elsewhere (open + onOpenChange) */
  trigger?: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<unknown> | void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [own, setOwn] = React.useState(false)
  const open = openProp ?? own
  const setOpen = (o: boolean) => { setOwn(o); onOpenChange?.(o) }
  const [busy, setBusy] = React.useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('Cancel')}</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try { await onConfirm(); setOpen(false) } catch { /* toast shown by caller */ } finally { setBusy(false) }
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
