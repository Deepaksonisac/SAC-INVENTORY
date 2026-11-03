'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ResourcePage } from '@/components/resource-page'
import { SiteFilter } from '@/components/filters'
import { dateCol } from '@/components/table-bits'
import type { Column } from '@/components/data-table'
import type { FieldDef, Values } from '@/components/form-dialog'
import { useApi } from '@/lib/api'
import { formatQty, round3, todayISO } from '@/lib/format'
import type { Product, Site, StockRow, TxnRow } from '@/lib/types'

const UNITS = ['Nos', 'Mtr', 'Kg', 'Box', 'Set', 'Roll', 'Ltr', 'Pcs', 'Bag']

const byName = (name: string) => (p: { product_name: string }) =>
  p.product_name.trim().toLowerCase() === name.trim().toLowerCase()

export function TxnPage({ kind }: { kind: 'inward' | 'outward' }) {
  const inward = kind === 'inward'
  const [siteId, setSiteId] = useState('')
  const { data: sites } = useApi<Site[]>('sites')
  const { data: products } = useApi<Product[]>('products')
  const { data: stock } = useApi<StockRow[]>('stock')

  const siteStock = (site: string) => stock?.filter((s) => String(s.site_id) === site) ?? []

  /** Stock left for an issue; when editing, the entry's own quantity is given back. */
  const availableFor = (site: string, item: string, orig?: Values) => {
    const row = siteStock(site).find(byName(item))
    if (!row) return ''
    const sameEntry = orig && orig._orig_site === site && orig._orig_item.toLowerCase() === item.toLowerCase()
    return String(round3(row.available + (sameEntry ? Number(orig._orig_qty || 0) : 0)))
  }

  const columns: Column<TxnRow>[] = [
    { key: 'site_name', header: 'Site', className: 'min-w-24 font-medium whitespace-normal' },
    { key: 'product_name', header: 'Item', className: 'min-w-32 whitespace-normal' },
    dateCol<TxnRow>('date', 'Date'),
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right',
      value: (r) => r.quantity,
      render: (r) => (
        <span className="font-semibold tabular-nums">
          {formatQty(r.quantity)} <span className="font-normal text-muted-foreground">{r.unit}</span>
        </span>
      ),
    },
    inward
      ? { key: 'challan_no', header: 'Challan No.' }
      : { key: 'person', header: 'Issued By', className: 'font-medium' },
  ]

  const fields = (values: Values): FieldDef[] => {
    const siteOptions = sites?.map((s) => ({ value: s.id, label: s.site_name })) ?? []
    const dateField: FieldDef = { name: 'date', label: 'Date', type: 'date', required: true }
    const siteField: FieldDef = {
      name: 'site_id',
      label: 'Site',
      type: 'select',
      required: true,
      options: siteOptions,
    }

    if (inward) {
      const known = products?.find(byName(values.item_name))
      const isNew = values.item_name.trim() !== '' && !known
      return [
        dateField,
        siteField,
        {
          name: 'item_name',
          label: 'Item Name',
          required: true,
          placeholder: 'Type or pick an item',
          suggestions: products?.map((p) => p.product_name),
          hint: isNew ? 'New item. It will be added to your inventory automatically.' : undefined,
          full: true,
        },
        {
          name: 'unit',
          label: 'Unit',
          required: true,
          readOnly: Boolean(known),
          suggestions: UNITS,
          placeholder: 'e.g. Nos, Mtr, Kg',
        },
        { name: 'quantity', label: 'Quantity Received', type: 'number', required: true },
        { name: 'challan_no', label: 'Challan / Ref No.' },
      ]
    }

    const items = siteStock(values.site_id).filter(
      (s) => s.available > 0 || s.product_name.toLowerCase() === values.item_name.toLowerCase(),
    )
    const available = Number(values.available)
    const over = values.available !== '' && Number(values.quantity) > available
    return [
      dateField,
      siteField,
      {
        name: 'item_name',
        label: 'Item',
        type: 'select',
        required: true,
        disabled: !values.site_id,
        placeholder: values.site_id ? 'Select item' : 'Select a site first',
        options: items.map((s) => ({
          value: s.product_name,
          label: `${s.product_name} (${formatQty(Number(availableFor(values.site_id, s.product_name, values)))} ${s.unit} available)`,
        })),
        hint: values.site_id && items.length === 0 ? 'No stock available at this site.' : undefined,
        full: true,
      },
      {
        name: 'quantity',
        label: values.unit ? `Quantity Issued (${values.unit})` : 'Quantity Issued',
        type: 'number',
        required: true,
        hint: over ? (
          <span className="text-destructive">Only {formatQty(available)} available at this site.</span>
        ) : values.available !== '' ? (
          `Available: ${formatQty(available)} ${values.unit}`
        ) : undefined,
      },
      { name: 'person', label: 'Issued By', required: true },
    ]
  }

  const derive = (next: Values, changed: string): Values => {
    if (inward) {
      if (changed === 'item_name') {
        const known = products?.find(byName(next.item_name))
        return known ? { unit: known.unit } : {}
      }
      return {}
    }
    if (changed === 'site_id') return { item_name: '', unit: '', available: '' }
    if (changed === 'item_name') {
      const row = siteStock(next.site_id).find(byName(next.item_name))
      return { unit: row?.unit ?? '', available: availableFor(next.site_id, next.item_name, next) }
    }
    return {}
  }

  const blank = (): Values => ({
    date: todayISO(),
    site_id: siteId || (sites?.length === 1 ? String(sites[0].id) : ''),
    item_name: '',
    unit: '',
    available: '',
    quantity: '',
    party: '',
    person: '',
    challan_no: '',
    remarks: '',
    _orig_site: '',
    _orig_item: '',
    _orig_qty: '',
  })

  const toValues = (r: TxnRow): Values => {
    const base: Values = {
      date: r.date,
      site_id: String(r.site_id),
      item_name: r.product_name,
      unit: r.unit,
      available: '',
      quantity: String(r.quantity),
      party: r.party,
      person: r.person,
      challan_no: r.challan_no,
      remarks: r.remarks,
      _orig_site: String(r.site_id),
      _orig_item: r.product_name,
      _orig_qty: String(r.quantity),
    }
    return { ...base, available: availableFor(base.site_id, base.item_name, base) }
  }

  const noSites = !sites?.length
  const nothingToIssue = !inward && !stock?.some((s) => s.available > 0)

  return (
    <ResourcePage<TxnRow>
      title={inward ? 'Stock IN' : 'Stock OUT'}
      description={
        inward
          ? 'Record material received at a site. Stock is updated automatically and new items are added on the fly.'
          : 'Record material issued from a site. The issued quantity is deducted from that site automatically.'
      }
      singular={inward ? 'Stock IN' : 'Stock OUT'}
      addLabel={inward ? 'Add Stock IN' : 'Add Stock OUT'}
      resource={kind}
      params={{ site_id: siteId }}
      columns={columns}
      fields={fields}
      derive={derive}
      blank={blank}
      toValues={toValues}
      allowView={false}
      isLocked={(row) => row.transfer_code !== ''}
      addDisabled={noSites || nothingToIssue}
      addHint={
        noSites ? (
          <>
            Add a site on the{' '}
            <Link href="/" className="font-medium text-primary underline underline-offset-2">
              Dashboard
            </Link>{' '}
            first.
          </>
        ) : (
          'No stock available yet. Add stock through Stock IN first.'
        )
      }
      submitLabel="Save"
      filters={<SiteFilter value={siteId} onChange={setSiteId} />}
    />
  )
}
