import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Inline spinning loader icon */
export function LoadingSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-primary', className)} />
}

/** Full-page centered loading state with message */
export function PageLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <LoadingSpinner className="h-8 w-8" />
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  )
}
