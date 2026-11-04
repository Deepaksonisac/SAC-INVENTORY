'use client'

import { MapPin, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDate, formatQty } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Site, StockRow } from '@/lib/types'

export const SITE_STATUSES = ['Active', 'On Hold', 'Completed'] as const

const STATUS_TONE: Record<string, string> = {
  Active: 'bg-secondary text-secondary-foreground',
  'On Hold': 'bg-warning text-warning-foreground',
  Completed: 'bg-muted text-muted-foreground',
}

interface SiteInventoryProps {
  site: Site
  items: StockRow[]
  onStatusChange: (status: string) => void
  onEdit: () => void
  onDelete: () => void
}

const HEAD = 'px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase'

export function SiteInventory({ site, items, onStatusChange, onEdit, onDelete }: SiteInventoryProps) {
  const outOfStock = items.filter((i) => i.available <= 0).length

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{site.site_name}</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{site.site_code}</span>
            {site.client_name && <span>Client: {site.client_name}</span>}
            {site.location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {site.location}
              </span>
            )}
            {site.start_date && <span>Started {formatDate(site.start_date)}</span>}
            <span>
              {items.length} {items.length === 1 ? 'item' : 'items'}
              {outOfStock > 0 && <span className="text-destructive"> ({outOfStock} out of stock)</span>}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={site.status}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label={`Status of ${site.site_name}`}
            className={cn(
              'h-7 cursor-pointer rounded-full border-0 px-2.5 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              STATUS_TONE[site.status],
            )}
          >
            {SITE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${site.site_name}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${site.site_name}`}
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {site.remarks && <p className="border-b px-4 py-2 text-sm text-muted-foreground">{site.remarks}</p>}

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No stock at this site yet. Add items through Stock IN.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className={cn(HEAD, 'text-left')}>Item</th>
                <th className={cn(HEAD, 'text-right')}>BOQ</th>
                <th className={cn(HEAD, 'text-right')}>Starting stock</th>
                <th className={cn(HEAD, 'text-right')}>Received</th>
                <th className={cn(HEAD, 'text-right')}>Issued</th>
                <th className={cn(HEAD, 'text-right')}>In Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium">{i.product_name}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {i.boq_qty > 0 ? formatQty(i.boq_qty) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatQty(i.opening_stock)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatQty(i.total_received)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {i.total_issued > 0 ? formatQty(i.total_issued) : '-'}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums',
                      i.available <= 0 && 'text-destructive',
                    )}
                  >
                    {formatQty(i.available)} <span className="font-normal text-muted-foreground">{i.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
