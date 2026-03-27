import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

/** Container card with border and shadow, optionally clickable */
export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={cn('rounded-lg border border-gray-200 bg-surface p-4 shadow-sm', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    >
      {children}
    </div>
  )
}

/** Header section within a Card */
export function CardHeader({ children, className }: CardProps) {
  return <div className={cn('mb-3', className)}>{children}</div>
}

/** Bold title text within a CardHeader */
export function CardTitle({ children, className }: CardProps) {
  return <h3 className={cn('text-lg font-semibold text-text', className)}>{children}</h3>
}
