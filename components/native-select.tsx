import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex h-9 w-full', className)}>
      <select
        {...props}
        className="h-full w-full cursor-pointer appearance-none rounded-lg border border-input bg-card py-1 pr-8 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}
