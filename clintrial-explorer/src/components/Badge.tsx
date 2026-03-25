import { cn } from '@/lib/utils'

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'accent' | 'muted'

const variantClasses: Record<Variant, string> = {
  default: 'bg-primary/10 text-primary',
  primary: 'bg-primary text-white',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent/10 text-accent',
  muted: 'bg-gray-100 text-text-muted',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: Variant
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
