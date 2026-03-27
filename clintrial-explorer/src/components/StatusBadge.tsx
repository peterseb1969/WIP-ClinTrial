import { cn } from '@/lib/utils'
import { STATUS_COLORS, formatStatus } from '@/lib/trial-utils'

interface StatusBadgeProps {
  status: string
  className?: string
}

/** Color-coded badge for CT_STATUS values (recruiting=green, completed=blue, etc.) */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        STATUS_COLORS[status] || 'bg-gray-100 text-text-muted',
        className,
      )}
    >
      {formatStatus(status)}
    </span>
  )
}
