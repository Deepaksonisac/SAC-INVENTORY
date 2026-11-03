import { Badge } from '@/components/ui/badge'
import type { Column } from '@/components/data-table'
import { formatDate, formatQty } from '@/lib/format'
import { cn } from '@/lib/utils'

const TONES: Record<string, string> = {
  Active: 'bg-secondary text-secondary-foreground border-transparent',
  'In Stock': 'bg-secondary text-secondary-foreground border-transparent',
  Inward: 'bg-secondary text-secondary-foreground border-transparent',
  'Transfer In': 'bg-secondary text-secondary-foreground border-transparent',
  'On Hold': 'bg-warning text-warning-foreground border-transparent',
  'Low Stock': 'bg-warning text-warning-foreground border-transparent',
  'Transfer Out': 'bg-warning text-warning-foreground border-transparent',
  Completed: 'bg-muted text-muted-foreground border-transparent',
  'Out of Stock': 'bg-destructive/10 text-destructive border-transparent',
  Outward: 'bg-destructive/10 text-destructive border-transparent',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', TONES[status] ?? '')}>
      {status}
    </Badge>
  )
}

export function qtyCol<T extends object>(key: keyof T & string, header: string): Column<T> {
  return {
    key,
    header,
    align: 'right',
    value: (row) => Number((row as Record<string, unknown>)[key] ?? 0),
    render: (row) => formatQty(Number((row as Record<string, unknown>)[key] ?? 0)),
  }
}

export function dateCol<T extends object>(key: keyof T & string, header: string): Column<T> {
  return {
    key,
    header,
    value: (row) => String((row as Record<string, unknown>)[key] ?? ''),
    render: (row) => formatDate(String((row as Record<string, unknown>)[key] ?? '')),
  }
}
