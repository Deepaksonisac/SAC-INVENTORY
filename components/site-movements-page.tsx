'use client'

import { useState } from 'react'
import { Download, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/data-table'
import { FormDialog, type FieldDef, type Values } from '@/components/form-dialog'
import { PageHeader } from '@/components/page-header'
import { ProductFilter, SiteFilter } from '@/components/filters'
import { apiSend, useApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import { formatDate, formatQty, todayISO } from '@/lib/format'
import type { Product, Site, SiteMovementRow, SiteMovementSummary } from '@/lib/types'

interface OpenIssue {
  id: number
  site_id: number
  product_id: number
  date: string
  challan_no: string
  site_name: string
  product_name: string
  unit: string
  issued: number
  returned: number
  remaining: number
}

type DialogMode = 'issue' | 'return' | 'opening'

export function SiteMovementsPage() {
  const [siteId, setSiteId] = useState('')
  const [productId, setProductId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [notice, setNotice] = useState('')
  const { data: sites } = useApi<Site[]>('sites')
  const { data: products } = useApi<Product[]>('products')
  const params = { site_id: siteId, product_id: productId, from, to }
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useApi<SiteMovementSummary[]>('movement-summary', params)
  const { data: movements, isLoading: movementsLoading, error: movementsError } = useApi<SiteMovementRow[]>('site-movements', params)
  const { data: issues } = useApi<OpenIssue[]>('movement-issues')

  const movementColumns: Column<SiteMovementRow>[] = [
    { key: 'site_name', header: 'Site', className: 'min-w-28 font-medium whitespace-normal' },
    { key: 'product_name', header: 'Item', className: 'min-w-32 whitespace-normal' },
    { key: 'movement_type', header: 'Movement', render: (row) => row.movement_type === 'ISSUE' ? 'Material OUT' : 'Material RETURN' },
    { key: 'issue_date', header: 'Issue date', value: (row) => formatDate(row.movement_type === 'ISSUE' ? row.date : row.issue_date ?? '') },
    { key: 'return_date', header: 'Return date', value: (row) => row.movement_type === 'RETURN' ? formatDate(row.date) : '' },
    { key: 'quantity', header: 'Quantity', align: 'right', render: (row) => `${formatQty(row.quantity)} ${row.unit}` },
    { key: 'challan_no', header: 'Challan No.' },
    { key: 'issue_challan_no', header: 'Original issue', value: (row) => row.issue_challan_no || '—' },
    { key: 'remarks', header: 'Notes' },
  ]

  const summaryColumns: Column<SiteMovementSummary>[] = [
    { key: 'site_name', header: 'Site', className: 'min-w-28 font-medium whitespace-normal' },
    { key: 'product_name', header: 'Item', className: 'min-w-32 whitespace-normal' },
    { key: 'central_opening', header: 'Central opening', align: 'right', render: (row) => `${formatQty(row.central_opening)} ${row.unit}` },
    { key: 'total_issued', header: 'Total issued', align: 'right', render: (row) => `${formatQty(row.total_issued)} ${row.unit}` },
    { key: 'total_returned', header: 'Returned', align: 'right', render: (row) => `${formatQty(row.total_returned)} ${row.unit}` },
    { key: 'consumed', header: 'Consumed', align: 'right', render: (row) => `${formatQty(row.consumed)} ${row.unit}` },
    { key: 'central_available', header: 'Central available', align: 'right', render: (row) => <span className="font-semibold tabular-nums">{formatQty(row.central_available)} {row.unit}</span> },
    { key: 'site_available', header: 'Site available', align: 'right', render: (row) => `${formatQty(row.site_available)} ${row.unit}` },
  ]

  const issueFields = (values: Values): FieldDef[] => [
      { name: 'site_id', label: 'Site', type: 'select', required: true, options: (sites ?? []).map((site) => ({ value: site.id, label: site.site_name })) },
      { name: 'product_id', label: 'Item', type: 'select', required: true, disabled: !values.site_id, options: (products ?? []).map((product) => ({ value: product.id, label: `${product.product_name} (${product.unit})` })) },
      { name: 'date', label: 'Issue date', type: 'date', required: true },
      { name: 'quantity', label: 'Quantity issued', type: 'number', required: true, hint: 'Quantity is checked against this site’s Central Store balance.' },
      { name: 'challan_no', label: 'Challan number', required: true },
      { name: 'remarks', label: 'Notes', type: 'textarea', full: true },
    ]

  const returnFields = (): FieldDef[] => [
    { name: 'issue_id', label: 'Original issue', type: 'select', required: true, options: (issues ?? []).map((issue) => ({ value: issue.id, label: `${issue.site_name} · ${issue.product_name} · ${formatDate(issue.date)} · ${issue.challan_no || `Issue #${issue.id}`} · ${formatQty(issue.remaining)} ${issue.unit} remaining` })) },
    { name: 'date', label: 'Return date', type: 'date', required: true },
    { name: 'quantity', label: 'Quantity returned', type: 'number', required: true },
    { name: 'challan_no', label: 'Return challan number', required: true },
    { name: 'remarks', label: 'Notes', type: 'textarea', full: true },
  ]

  const openingFields = (values: Values): FieldDef[] => [
    { name: 'site_id', label: 'Site', type: 'select', required: true, options: (sites ?? []).map((site) => ({ value: site.id, label: site.site_name })) },
    { name: 'product_id', label: 'Item', type: 'select', required: true, disabled: !values.site_id, options: (products ?? []).map((product) => ({ value: product.id, label: `${product.product_name} (${product.unit})` })) },
    { name: 'opening_qty', label: 'Opening quantity', type: 'number', required: true, hint: 'Set the starting balance for this site’s separate Central Store. It locks after the first movement.' },
  ]

  const openForm = (mode: DialogMode) => {
    setNotice('')
    setDialog(mode)
  }

  const openingFor = (site: string, product: string) =>
    summary?.find((row) => String(row.site_id) === site && String(row.product_id) === product)?.central_opening ?? 0

  const initial: Values = dialog === 'return'
    ? { issue_id: '', date: todayISO(), quantity: '', challan_no: '', remarks: '' }
    : dialog === 'opening'
      ? { site_id: siteId || '', product_id: productId || '', opening_qty: String(openingFor(siteId, productId)) }
      : { site_id: siteId || '', product_id: productId || '', date: todayISO(), quantity: '', challan_no: '', remarks: '' }

  const derive = (values: Values, changed: string): Values => {
    if (dialog === 'return' && changed === 'issue_id') {
      const issue = issues?.find((row) => String(row.id) === values.issue_id)
      return issue ? { site_id: String(issue.site_id), product_id: String(issue.product_id) } : {}
    }
    if (dialog === 'opening' && changed === 'site_id') return { product_id: '', opening_qty: '0' }
    if (dialog === 'opening' && changed === 'product_id') return { opening_qty: String(openingFor(values.site_id, values.product_id)) }
    if (changed === 'site_id') return { product_id: '', issue_id: '' }
    return {}
  }

  const submit = async (values: Values) => {
    if (dialog === 'opening') {
      await apiSend('POST', 'central-stock', { site_id: Number(values.site_id), product_id: Number(values.product_id), opening_qty: Number(values.opening_qty) })
      setNotice('Central Store opening quantity saved for this site and item.')
    } else {
      await apiSend('POST', 'site-movements', {
        movement_type: dialog === 'return' ? 'RETURN' : 'ISSUE',
        site_id: Number(values.site_id),
        product_id: Number(values.product_id),
        issue_id: values.issue_id ? Number(values.issue_id) : undefined,
        date: values.date,
        quantity: Number(values.quantity),
        challan_no: values.challan_no,
        remarks: values.remarks,
      })
      setNotice(dialog === 'return' ? 'Material return recorded and both balances updated.' : 'Material issued and both balances updated.')
    }
    setDialog(null)
  }

  const exportSummary = () => exportTable('xlsx', 'site-wise-material-movement-summary', [
    { header: 'Site' }, { header: 'Item code' }, { header: 'Item' }, { header: 'Unit' },
    { header: 'Central opening', align: 'right' }, { header: 'Total issued', align: 'right' },
    { header: 'Total returned', align: 'right' }, { header: 'Consumed', align: 'right' },
    { header: 'Central available', align: 'right' }, { header: 'Site available', align: 'right' },
  ], (summary ?? []).map((row) => [row.site_name, row.product_code, row.product_name, row.unit, row.central_opening, row.total_issued, row.total_returned, row.consumed, row.central_available, row.site_available]), `Date range: ${from || 'All'} to ${to || 'All'}`)

  const exportHistory = () => exportTable('xlsx', 'site-wise-material-movement-history', [
    { header: 'Site' }, { header: 'Item code' }, { header: 'Item' }, { header: 'Movement' },
    { header: 'Issue date' }, { header: 'Return date' }, { header: 'Quantity', align: 'right' }, { header: 'Challan no.' },
    { header: 'Original issue challan' }, { header: 'Notes' },
  ], (movements ?? []).map((row) => [row.site_name, row.product_code, row.product_name, row.movement_type, row.movement_type === 'ISSUE' ? row.date : row.issue_date ?? '', row.movement_type === 'RETURN' ? row.date : '', row.quantity, row.challan_no, row.issue_challan_no ?? '', row.remarks]), `Date range: ${from || 'All'} to ${to || 'All'}`)

  const errors = summaryError ?? movementsError
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Material Movement"
        description="Issue material from each site’s separate Central Store, record returns against original challans, and review site-level balances."
        action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => openForm('return')} disabled={!issues?.length}><RotateCcw /> Material RETURN</Button><Button onClick={() => openForm('issue')}><Plus /> Material OUT</Button></div>}
      />
      {notice && <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">{notice}</p>}
      {errors && <p role="alert" className="text-sm text-destructive">{errors.message}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Site-wise movement summary</CardTitle>
          <CardDescription>Each site has an independent Central Store pool. Issued quantities increase that site’s stock; returns replenish only that site’s pool.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SiteFilter value={siteId} onChange={setSiteId} />
            <ProductFilter value={productId} onChange={setProductId} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">From <input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-foreground" /></label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">To <input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-foreground" /></label>
            <Button variant="outline" size="sm" onClick={() => void exportSummary()} disabled={!summary?.length}><Download /> Export Excel</Button>
          </div>
          <DataTable columns={summaryColumns} rows={summary} rowKey={(row) => `${row.site_id}-${row.product_id}`} isLoading={summaryLoading} exportTitle="Site Movement Summary" emptyText="Set an opening quantity for a site item to begin tracking Central Store movements." />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><CardTitle>Movement history</CardTitle><CardDescription>Issue and return entries stay associated with their site and original issue.</CardDescription></div>
            <Button variant="outline" size="sm" onClick={() => void exportHistory()} disabled={!movements?.length}><Download /> Export Excel</Button>
          </div>
        </CardHeader>
        <CardContent><DataTable columns={movementColumns} rows={movements} rowKey={(row) => row.id} isLoading={movementsLoading} exportTitle="Site Material Movement History" emptyText="No material movements match these filters." /></CardContent>
      </Card>
      <details className="rounded-lg border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Central Store opening balance setup</summary>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <p className="text-sm text-muted-foreground">Opening balances are setup only; daily movements are limited to Material OUT and Material RETURN.</p>
          <Button variant="outline" onClick={() => openForm('opening')}><Plus /> Set opening stock</Button>
        </div>
      </details>
      <FormDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode="create"
        title={dialog === 'opening' ? 'Set Central Store opening stock' : dialog === 'return' ? 'Record material return' : 'Issue material to site'}
        description={dialog === 'opening' ? 'Opening quantities are maintained separately for every site and item.' : dialog === 'return' ? 'Select an original issue. The return is capped at its unreturned quantity.' : 'Issue from this site’s Central Store. The destination site balance is credited automatically.'}
        initial={initial}
        fields={(values) => dialog === 'opening' ? openingFields(values) : dialog === 'return' ? returnFields() : issueFields(values)}
        derive={derive}
        onSubmit={submit}
        submitLabel={dialog === 'opening' ? 'Save opening stock' : dialog === 'return' ? 'Save return' : 'Save issue'}
      />
    </div>
  )
}
