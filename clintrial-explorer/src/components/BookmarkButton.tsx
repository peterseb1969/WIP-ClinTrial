import { Bookmark } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBookmarks } from '@/hooks/useBookmarks'

interface BookmarkButtonProps {
  nctId: string
  className?: string
  size?: 'sm' | 'md'
}

/** Star toggle button for bookmarking a trial by NCT ID */
export function BookmarkButton({ nctId, className, size = 'md' }: BookmarkButtonProps) {
  const { toggle, has } = useBookmarks()
  const isBookmarked = has(nctId)

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggle(nctId)
      }}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this trial'}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        isBookmarked
          ? 'text-accent hover:text-accent/80'
          : 'text-text-muted hover:text-accent',
        className,
      )}
    >
      <Bookmark
        className={cn(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')}
        fill={isBookmarked ? 'currentColor' : 'none'}
      />
    </button>
  )
}
