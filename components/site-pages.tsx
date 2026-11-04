'use client'

import { useState } from 'react'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/data-table'
import { FormDialog, type FieldDef, type Values } from '@/components/form-dialog'
import { PageHeader } from '@/components/page-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ProductFilter, SiteFilter } from '@/components/filters'
import { ResourcePage } from '@/components/resource-page'
import { StatusBadge, dateCol, qtyCol } from '@/components/table-bits'
import { apiSend, refreshApiCache, useApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import { formatQty, todayISO } from '@/lib/format'
import type { DeleteResult, Product, Site, StockRow, TxnRow, LedgerRow } from '@/lib/types'
import * as XLSX from 'xlsx'

const siteFields = (values: Values): FieldDef[] => [
  { name: 'site_name', label: 'Site name', required: true, full: true },
  { name: 'site_code', label: 'Site code', placeholder: 'Auto-generated if blank' },
  { name: 'client_name', label: 'Client' },
  { name: 'location', label: 'Location' },
  { name: 'start_date', label: 'Start date', type: 'date' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: ['Active', 'On Hold', 'Completed'].map((status) => ({ value: status, label: status })),
  },
  { name: 'remarks', label: 'Notes', type: 'textarea', full: true },
]

const allocationValues = (row: StockRow): Values => ({
  site_id: String(row.site_id),
  product_id: String(row.product_id),
  boq_qty: String(row.boq_qty),
  opening_stock: String(row.opening_stock),
  min_stock: String(row.min_stock),
  allocation_date: row.allocation_date,
  remarks: row.remarks,
  _locked: row.txn_count > 0 ? 'true' : '',
})

export function SiteListPage() {
  const columns: Column<Site>[] = [
    { key: 'site_name', header: 'Site name', className: 'font-medium' },
    { key: 'site_code', header: 'Site code' },
    { key: 'location', header: 'Location' },
    { key: 'client_name', header: 'Client' },
    { key: 'product_count', header: 'Items', align: 'right', value: (site) => site.product_count },
    {
      key: 'status',
      header: 'Status',
      render: (site) => <StatusBadge status={site.status} />,
    },
  ]

  return (
    <ResourcePage<Site>
      title="Site List"
      description="Create and maintain sites. Every site's stock ledger remains independent."
      singular="Site"
      resource="sites"
      columns={columns}
      fields={siteFields}
      blank={() => ({ site_name: '', site_code: '', client_name: '', location: '', start_date: '', status: 'Active', remarks: '' })}
      toValues={(site) => ({
        site_name: site.site_name,
        site_code: site.site_code,
        client_name: site.client_name,
        location: site.location,
        start_date: site.start_date ?? '',
        status: site.status,
        remarks: site.remarks,
      })}
      dialogDescription="Site details are saved permanently in the local inventory database."
      deleteDescription="This permanently deletes the site, its item allocations, starting stock, Stock IN/OUT history, and any transfers involving this site. A transfer to another site is removed at both ends. Deletion is blocked if removing a transfer receipt would make later stock at another site negative."
    />
  )
}

function stockColumns(): Column<StockRow>[] {
  return [
    { key: 'site_name', header: 'Site', className: 'min-w-32 font-medium whitespace-normal' },
    { key: 'product_code', header: 'Item code' },
    { key: 'product_name', header: 'Item', className: 'min-w-36 whitespace-normal' },
    { key: 'category', header: 'Category' },
    { key: 'unit', header: 'Unit' },
    qtyCol<StockRow>('opening_stock', 'Starting stock'),
    qtyCol<StockRow>('total_received', 'Stock IN'),
    qtyCol<StockRow>('total_issued', 'Stock OUT'),
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      value: (row) => row.available,
      render: (row) => <span className="font-semibold tabular-nums">{formatQty(row.available)} {row.unit}</span>,
    },
  ]
}

function ItemDialogFields({
  values,
  sites,
  products,
}: {
  values: Values
  sites: Site[] | undefined
  products: Product[] | undefined
}): FieldDef[] {
  const knownItem = values.product_id !== '' && values.product_id !== '__new__'
  return [
    {
      name: 'site_id',
      label: 'Site',
      type: 'select',
      required: true,
      disabled: Boolean(values._locked),
      options: (sites ?? []).map((site) => ({ value: site.id, label: site.site_name })),
    },
    {
      name: 'product_id',
      label: 'Item',
      type: 'select',
      required: true,
      disabled: Boolean(values._locked),
      options: [
        ...(values._editing ? [] : [{ value: '__new__', label: '+ Create a new item' }]),
        ...(products ?? []).map((product) => ({
          value: product.id,
          label: `${product.product_code} — ${product.product_name}`,
        })),
      ],
    },
    ...(knownItem
      ? []
      : [
          { name: 'product_name', label: 'Item name', required: true, full: true },
          { name: 'product_code', label: 'Item code', placeholder: 'Auto-generated if blank' },
          { name: 'category', label: 'Category' },
          { name: 'unit', label: 'Unit', required: true, placeholder: 'e.g. Nos, Kg, Mtr' },
        ]),
    { name: 'boq_qty', label: 'BOQ quantity', type: 'number' },
    { name: 'opening_stock', label: 'Starting stock', type: 'number' },
    { name: 'min_stock', label: 'Minimum stock', type: 'number' },
    { name: 'allocation_date', label: 'Effective date', type: 'date', required: true },
    { name: 'remarks', label: 'Notes', type: 'textarea', full: true },
  ]
}

export function ItemListPage() {
  const { data: sites } = useApi<Site[]>('sites')
  const { data: products } = useApi<Product[]>('products')
  const [siteId, setSiteId] = useState('')
  const { data: stock, isLoading, error } = useApi<StockRow[]>('allocations', { site_id: siteId })
  const [dialog, setDialog] = useState<{ row: StockRow | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StockRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')

  const submit = async (values: Values) => {
    const body = {
      ...values,
      site_id: Number(values.site_id),
      product_id: values.product_id === '__new__' ? undefined : Number(values.product_id),
    }
    if (dialog?.row) {
      await apiSend('PUT', 'allocations', { ...body, id: dialog.row.id })
    } else {
      await apiSend('POST', 'site-items', body)
    }
    setNotice('Site item saved. Its balance is tracked separately from every other site.')
    setFormError('')
    setDialog(null)
  }

  const removeItems = async (rows: StockRow[]) => {
    const result = await apiSend<DeleteResult>('DELETE', 'allocations', { ids: rows.map((row) => row.id) })
    setNotice(
      result.errors.length
        ? `${result.deleted} item(s) removed. ${result.errors.join(' ')}`
        : `${result.deleted} site item(s) removed.`,
    )
  }

  const removeItem = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setNotice('')
    try {
      const result = await apiSend<DeleteResult>('DELETE', 'allocations', { ids: [deleteTarget.id] })
      if (result.errors.length) throw new Error(result.errors[0])
      setNotice(`"${deleteTarget.product_name}" removed from ${deleteTarget.site_name}.`)
    } catch (err) {
      setNotice(err instanceof Error ? `Could not delete item: ${err.message}` : 'Could not delete item.')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const columns: Column<StockRow>[] = [
    { key: 'site_name', header: 'Site', className: 'min-w-32 font-medium whitespace-normal' },
    { key: 'product_code', header: 'Item code' },
    { key: 'product_name', header: 'Item', className: 'min-w-36 whitespace-normal' },
    { key: 'category', header: 'Category' },
    { key: 'unit', header: 'Unit' },
    qtyCol<StockRow>('opening_stock', 'Starting stock'),
    qtyCol<StockRow>('total_received', 'Stock IN'),
    qtyCol<StockRow>('total_issued', 'Stock OUT'),
    qtyCol<StockRow>('available', 'Available'),
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Item List"
        description="Items are allocated to a site individually. An item only appears at sites where it has been added."
        action={
          <Button size="lg" disabled={!sites?.length} onClick={() => {
            setFormError('')
            setDialog({ row: null })
          }}>
            <Plus /> Add item to site
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <SiteFilter value={siteId} onChange={setSiteId} allLabel="All sites" />
      </div>
      {notice && <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <DataTable
        columns={columns}
        rows={stock}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        exportTitle="Site Items"
        emptyText={siteId ? 'No items have been added to this site yet.' : 'No site items found.'}
        selectable
        onBulkDelete={removeItems}
        rowActions={(row) => (
          <div className="inline-flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFormError('')
                setDialog({ row })
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${row.product_name} from ${row.site_name}`}
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      />
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.product_name} from this site?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the item from {deleteTarget?.site_name} and deletes its starting stock and
              transaction history. The item remains allocated at other sites. Any related transfers are removed at
              both ends, and deletion is blocked if that would make another site's later balance negative.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void removeItem()
              }}
            >
              {deleting ? 'Deleting...' : 'Delete item'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FormDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={dialog?.row ? 'edit' : 'create'}
        title={dialog?.row ? 'Edit site item' : 'Add item to site'}
        description="Starting stock, minimum stock and BOQ are stored on this site's item allocation."
        initial={
          dialog?.row
            ? { ...allocationValues(dialog.row), product_id: String(dialog.row.product_id), _editing: 'true' }
            : {
                site_id: siteId || (sites?.length === 1 ? String(sites[0].id) : ''),
                product_id: '__new__',
                product_name: '',
                product_code: '',
                category: '',
                unit: '',
                boq_qty: '0',
                opening_stock: '0',
                min_stock: '0',
                allocation_date: todayISO(),
                remarks: '',
              }
        }
        fields={(values) => ItemDialogFields({ values, sites, products })}
        derive={(values, changed): Values => {
          if (changed === 'product_id' && values.product_id === '__new__') {
            return { product_name: '', product_code: '', category: '', unit: '' }
          }
          if (changed === 'product_id') {
            const product = products?.find((item) => String(item.id) === values.product_id)
            return product ? { product_name: product.product_name, unit: product.unit } : {}
          }
          return {}
        }}
        onSubmit={async (values) => {
          try {
            await submit(values)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not save this item'
            setFormError(message)
            throw err
          }
        }}
        submitLabel={dialog?.row ? 'Update item' : 'Add item'}
      />
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
    </div>
  )
}

export function ReportsPage() {
  const [report, setReport] = useState<'stock' | 'ledger'>('stock')
  const [siteId, setSiteId] = useState('')
  const [productId, setProductId] = useState('')
  const { data: stock, isLoading: stockLoading } = useApi<StockRow[]>('stock', { site_id: siteId, product_id: productId }, report === 'stock')
  const { data: ledger, isLoading: ledgerLoading, error } = useApi<LedgerRow[]>('ledger', { site_id: siteId, product_id: productId }, report === 'ledger')
  const stockReportColumns = stockColumns()
  const ledgerColumns: Column<LedgerRow>[] = [
    { key: 'site_name', header: 'Site' },
    { key: 'product_name', header: 'Item' },
    dateCol<LedgerRow>('date', 'Date'),
    { key: 'type', header: 'Transaction' },
    qtyCol<LedgerRow>('in_qty', 'Stock IN'),
    qtyCol<LedgerRow>('out_qty', 'Stock OUT'),
    qtyCol<LedgerRow>('closing', 'Balance'),
    { key: 'person', header: 'Issued / received by' },
    { key: 'challan_no', header: 'Reference' },
  ]
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Reports" description="Generate site-wise or item-wise stock reports and export the filtered results." />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-1" role="group" aria-label="Report type">
          {(['stock', 'ledger'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setReport(value)} className={`rounded-md px-3 py-1.5 text-sm ${report === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              {value === 'stock' ? 'Stock summary' : 'Transaction ledger'}
            </button>
          ))}
        </div>
        <SiteFilter value={siteId} onChange={setSiteId} />
        <ProductFilter value={productId} onChange={setProductId} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      {report === 'stock'
        ? <DataTable columns={stockReportColumns} rows={stock} rowKey={(row) => row.id} isLoading={stockLoading} exportTitle="Site Stock Report" />
        : <DataTable columns={ledgerColumns} rows={ledger} rowKey={(row) => row.key} isLoading={ledgerLoading} exportTitle="Transaction Ledger" />}
    </div>
  )
}

type ImportKind = 'sites' | 'items' | 'inward' | 'outward'

const IMPORT_GUIDES: Record<ImportKind, string> = {
  sites: 'Site Name, Site Code, Location, Client, Start Date, Status, Remarks',
  items: 'Site, Item Code, Item Name, Category, Unit, Starting Stock, Minimum Stock, BOQ Qty, Allocation Date, Remarks',
  inward: 'Site, Item Name, Unit, Date, Quantity, Supplier, Received By, Challan No, Remarks',
  outward: 'Site, Item Name, Unit, Date, Quantity, Issued By, Issued To, Purpose, Challan No, Remarks',
}

const headerKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
const rowValue = (row: Record<string, unknown>, key: string) => {
  const wanted = headerKey(key)
  const found = Object.entries(row).find(([header]) => headerKey(header) === wanted)
  return found?.[1] === undefined || found[1] === null ? '' : String(found[1]).trim()
}

function importDate(value: string) {
  if (!value) return ''
  if (/^\d+(\.\d+)?$/.test(value)) {
    const parsed = XLSX.SSF.parse_date_code(Number(value))
    if (parsed) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  return value
}

async function loadRows<T>(resource: string): Promise<T[]> {
  const response = await fetch(`/api/${resource}`)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Could not read the latest ${resource} data`)
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `Could not load ${resource}`
    throw new Error(message)
  }
  if (!Array.isArray(payload)) throw new Error(`Unexpected response while loading ${resource}`)
  return payload as T[]
}

export function ImportExportPage() {
  const { data: sites } = useApi<Site[]>('sites')
  const { data: products } = useApi<Product[]>('products')
  const { data: stock } = useApi<StockRow[]>('stock')
  const { data: inward } = useApi<TxnRow[]>('inward')
  const { data: outward } = useApi<TxnRow[]>('outward')
  const [kind, setKind] = useState<ImportKind>('items')
  const [exportKind, setExportKind] = useState<ImportKind>('items')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const exportRows = async (format: 'csv' | 'xlsx') => {
    const data = (stock ?? [])
    const columns = exportKind === 'sites'
      ? ['Site Name', 'Site Code', 'Location', 'Client', 'Start Date', 'Status', 'Remarks']
      : exportKind === 'items'
        ? ['Site', 'Item Code', 'Item Name', 'Category', 'Unit', 'Starting Stock', 'Minimum Stock', 'BOQ Qty', 'Allocation Date', 'Stock IN', 'Stock OUT', 'Available Balance', 'Remarks']
        : ['Site', 'Item Name', 'Unit', 'Date', 'Quantity', exportKind === 'inward' ? 'Supplier' : 'Issued To', exportKind === 'inward' ? 'Received By' : 'Issued By', ...(exportKind === 'outward' ? ['Purpose'] : []), 'Challan No', 'Remarks']
    const rows = exportKind === 'sites'
      ? (sites ?? []).map((site) => [site.site_name, site.site_code, site.location, site.client_name, site.start_date ?? '', site.status, site.remarks])
      : exportKind === 'items'
        ? data.map((row) => [
            row.site_name, row.product_code, row.product_name, row.category, row.unit, row.opening_stock,
            row.min_stock, row.boq_qty, row.allocation_date,
            ...(exportKind === 'items' ? [row.total_received, row.total_issued, row.available] : []),
            row.remarks,
          ])
        : ((exportKind === 'inward' ? inward : outward) ?? []).map((row) => [
            row.site_name, row.product_name, row.unit, row.date, row.quantity, row.party, row.person,
            ...(exportKind === 'outward' ? [row.purpose] : []), row.challan_no, row.remarks,
          ])
    await exportTable(format, `${exportKind}-inventory`, columns.map((header) => ({ header })), rows, `Export type: ${exportKind}`)
  }

  const downloadTemplate = async (format: 'csv' | 'xlsx') => {
    const headers = IMPORT_GUIDES[kind].split(', ')
    await exportTable(format, `${kind}-import-template`, headers.map((header) => ({ header })), [], `Import type: ${kind}`)
  }

  const importFile = async (file: File) => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) throw new Error('The selected file has no worksheet.')
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (rows.length === 0) throw new Error('The selected worksheet has no data rows.')

      let knownSites = kind === 'sites' ? [] : await loadRows<Site>('sites')
      let knownProducts = kind === 'items' ? await loadRows<Product>('products') : []
      let knownStock = kind === 'items' ? await loadRows<StockRow>('stock') : []
      let completed = 0
      const failures: string[] = []
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        try {
          const siteLabel = rowValue(row, 'Site')
          const site = knownSites.find((entry) =>
            entry.site_name.toLowerCase() === siteLabel.toLowerCase() ||
            entry.site_code.toLowerCase() === siteLabel.toLowerCase(),
          )
          if (kind !== 'sites' && !site) throw new Error(`Site "${siteLabel}" was not found`)

          if (kind === 'sites') {
            await apiSend('POST', 'sites', {
              site_name: rowValue(row, 'Site Name'),
              site_code: rowValue(row, 'Site Code'),
              location: rowValue(row, 'Location'),
              client_name: rowValue(row, 'Client'),
              start_date: importDate(rowValue(row, 'Start Date')) || null,
              status: rowValue(row, 'Status') || 'Active',
              remarks: rowValue(row, 'Remarks'),
            }, false)
          } else if (kind === 'items') {
            const code = rowValue(row, 'Item Code')
            const itemName = rowValue(row, 'Item Name')
            const product = knownProducts.find((entry) =>
              (code && entry.product_code.toLowerCase() === code.toLowerCase()) ||
              entry.product_name.toLowerCase() === itemName.toLowerCase(),
            )
            const existing = knownStock.find((entry) => entry.site_id === site?.id && entry.product_id === product?.id)
            const payload = {
              site_id: site?.id,
              product_id: product?.id,
              product_code: code,
              product_name: itemName,
              category: rowValue(row, 'Category'),
              unit: rowValue(row, 'Unit'),
              opening_stock: rowValue(row, 'Starting Stock') || rowValue(row, 'Opening Stock') || '0',
              min_stock: rowValue(row, 'Minimum Stock') || '0',
              boq_qty: rowValue(row, 'BOQ Qty') || '0',
              allocation_date: importDate(rowValue(row, 'Allocation Date')) || todayISO(),
              remarks: rowValue(row, 'Remarks'),
            }
            if (existing) await apiSend('PUT', 'allocations', { ...payload, id: existing.id }, false)
            else await apiSend('POST', 'site-items', payload, false)
            completed += 1
            knownProducts = await loadRows<Product>('products')
            knownStock = await loadRows<StockRow>('stock')
            continue
          } else {
            const isInward = kind === 'inward'
            await apiSend('POST', kind, {
              site_id: site?.id,
              item_name: rowValue(row, 'Item Name'),
              unit: rowValue(row, 'Unit'),
              date: importDate(rowValue(row, 'Date')) || todayISO(),
              quantity: rowValue(row, 'Quantity'),
              party: rowValue(row, isInward ? 'Supplier' : 'Issued To'),
              person: rowValue(row, isInward ? 'Received By' : 'Issued By'),
              purpose: rowValue(row, 'Purpose'),
              challan_no: rowValue(row, 'Challan No'),
              remarks: rowValue(row, 'Remarks'),
            }, false)
          }
          completed += 1
        } catch (err) {
          failures.push(`Row ${index + 2}: ${err instanceof Error ? err.message : 'Import failed'}`)
        }
      }

      await refreshApiCache()
      if (failures.length) {
        setMessage(`${completed} of ${rows.length} rows imported.`)
        setError(failures.slice(0, 8).join('\n'))
      } else {
        setMessage(`${completed} rows imported successfully.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the selected file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Import / Export" description="Move inventory data in CSV or Excel format. Site and item associations are preserved on import and export." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Export inventory</CardTitle>
            <CardDescription>Choose a data set. Item and transaction exports retain their site association.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <select
              value={exportKind}
              onChange={(event) => setExportKind(event.target.value as ImportKind)}
              aria-label="Export data type"
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="sites">Sites</option>
              <option value="items">Site items and starting stock</option>
              <option value="inward">Stock IN transactions</option>
              <option value="outward">Stock OUT transactions</option>
            </select>
            <Button variant="outline" onClick={() => void exportRows('xlsx')}><Download /> Export Excel</Button>
            <Button variant="outline" onClick={() => void exportRows('csv')}><Download /> Export CSV</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Import data</CardTitle>
            <CardDescription>Upload a CSV or Excel file. Imports are processed row by row; any rejected rows are listed below.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as ImportKind)}
              aria-label="Import data type"
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="sites">Sites</option>
              <option value="items">Site items and starting stock</option>
              <option value="inward">Stock IN transactions</option>
              <option value="outward">Stock OUT transactions</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Required columns: {IMPORT_GUIDES[kind]}. Use YYYY-MM-DD or an Excel date for date fields.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void downloadTemplate('xlsx')}>Excel template</Button>
              <Button type="button" variant="outline" onClick={() => void downloadTemplate('csv')}>CSV template</Button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Upload className="size-4" /> {busy ? 'Importing...' : 'Choose file'}
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void importFile(file)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            </div>
          </CardContent>
        </Card>
      </div>
      {message && <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">{message}</p>}
      {error && <pre role="alert" className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</pre>}
      <Card>
        <CardHeader>
          <CardTitle>Import reference</CardTitle>
          <CardDescription>Rows are matched to an existing site by site name or site code. Stock OUT requires the item to already be allocated at that site.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Every imported issue includes its transaction date and Issued By value. Exported balances are grouped by site, so the same item at two sites appears as two separate rows.
        </CardContent>
      </Card>
    </div>
  )
}
