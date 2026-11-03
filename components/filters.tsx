'use client'

import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/native-select'
import { useApi } from '@/lib/api'
import type { Product, Site } from '@/lib/types'

export function SiteFilter({
  value,
  onChange,
  allLabel = 'All Sites',
}: {
  value: string
  onChange: (v: string) => void
  allLabel?: string
}) {
  const { data: sites } = useApi<Site[]>('sites')
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by site"
      className="w-full sm:w-56"
    >
      <option value="">{allLabel}</option>
      {sites?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.site_name} ({s.site_code})
        </option>
      ))}
    </NativeSelect>
  )
}

export function ProductFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: products } = useApi<Product[]>('products')
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by product"
      className="w-full sm:w-56"
    >
      <option value="">All Products</option>
      {products?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.product_code} - {p.product_name}
        </option>
      ))}
    </NativeSelect>
  )
}

export function DateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFrom(e.target.value)}
        aria-label="From date"
        className="h-9 w-36"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onTo(e.target.value)}
        aria-label="To date"
        className="h-9 w-36"
      />
    </div>
  )
}
