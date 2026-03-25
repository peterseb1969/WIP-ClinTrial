import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface ChipLinkProps {
  to: string
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'accent'
  className?: string
}

const variantClasses = {
  default: 'bg-primary/10 text-primary hover:bg-primary/20',
  primary: 'bg-primary-light/10 text-primary hover:bg-primary-light/20',
  accent: 'bg-accent/10 text-accent hover:bg-accent/20',
}

export function ChipLink({ to, children, variant = 'default', className }: ChipLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </Link>
  )
}
