import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/app/theme-provider'

export function Toaster() {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans text-sm', description: 'text-muted-foreground' } }}
    />
  )
}
