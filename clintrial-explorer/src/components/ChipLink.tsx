import { cn } from '@/lib/utils'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { trialFilters, type FilterKey, type MultiFilterKey } from '@/hooks/useTrialFilters'
import { Check } from 'lucide-react'

interface ChipLinkProps {
  filterKey: FilterKey
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

const selectedClasses = 'bg-primary text-white hover:bg-primary/80'

const MULTI_KEYS = new Set(['status', 'phase', 'study_type', 'therapeutic_area', 'molecule', 'condition', 'sponsor', 'country'])

export function ChipLink({ filterKey, filterValue, children, variant = 'default', className }: ChipLinkProps) {
  const toggle = useFilterToggle()
  const isSelected = MULTI_KEYS.has(filterKey)
    ? trialFilters.isSelected(filterKey as MultiFilterKey, filterValue)
    : false

  return (
    <button
      onClick={() => toggle(filterKey, filterValue)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer',
        isSelected ? selectedClasses : variantClasses[variant],
        className,
      )}
    >
      {isSelected && <Check className="h-3 w-3" />}
      {children}
    </button>
  )
}
