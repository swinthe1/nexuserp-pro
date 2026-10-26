import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold transition-[color,background-color,box-shadow,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.16),0_1px_2px_hsl(var(--primary)/0.35)] hover:bg-primary/90 hover:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.16),0_3px_8px_-2px_hsl(var(--primary)/0.45)]',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border border-input bg-card shadow-[0_1px_2px_hsl(200_30%_15%/0.05)] hover:border-primary/35 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'font-medium hover:bg-secondary hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // on a phone a finger needs about 40 px: min sizes only grow a button, never shrink a bigger one
        default: 'h-9 px-3.5 max-sm:min-h-10',
        sm: 'h-8 px-2.5 text-[13px] max-sm:min-h-9',
        xs: 'h-7 px-2 text-xs max-sm:min-h-8',
        lg: 'h-10 px-5',
        icon: 'size-9 max-sm:min-h-10 max-sm:min-w-10',
        'icon-sm': 'size-8 max-sm:min-h-10 max-sm:min-w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} disabled={disabled || loading} {...props}>
        {asChild ? children : (<>{loading && <Loader2 className="animate-spin" />}{children}</>)}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
