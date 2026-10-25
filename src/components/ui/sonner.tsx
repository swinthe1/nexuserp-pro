import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/app/theme-provider'
import { usePhone } from '@/hooks/use-phone'

export function Toaster() {
  const { resolved } = useTheme()
  // on a phone the bottom holds the main buttons (pay, send): messages come from the top
  const phone = usePhone()
  return (
    <Sonner
      theme={resolved}
      position={phone ? 'top-center' : 'bottom-right'}
      richColors
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans text-sm', description: 'text-muted-foreground' } }}
    />
  )
}
