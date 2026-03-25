import { cn } from '@/lib/utils'
import { useFilterNav } from '@/hooks/useFilterNav'
import type { FilterKey } from '@/hooks/useTrialFilters'

interface ChipLinkProps {
  /** Filter key to set when clicked */
  filterKey: FilterKey
  /** Filter value */
  filterValue: string
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'accent'
  className?: string
}

const variantClasses = {
  default: 'bg-primary/10 text-primary hover:bg-primary/20',
  primary: 'bg-primary-light/10 text-primary hover:bg-primary-light/20',
  accent: 'bg-accent/10 text-accent hover:bg-accent/20',
}

export function ChipLink({ filterKey, filterValue, children, variant = 'default', className }: ChipLinkProps) {
  const addFilter = useFilterNav()

  return (
    <button
      onClick={() => addFilter(filterKey, filterValue)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}
