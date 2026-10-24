import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { optional?: boolean }
>(({ className, optional, children, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('text-[13px] font-medium leading-none text-foreground/90 peer-disabled:opacity-60', className)} {...props}>
    {children}{optional && <span className="ml-1 font-normal text-muted-foreground">{t('(optional)')}</span>}
  </LabelPrimitive.Root>
))
Label.displayName = LabelPrimitive.Root.displayName
export { Label }
