'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, GripVertical, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormDialog, type FieldDef, type Values } from '@/components/form-dialog'
import { PageHeader } from '@/components/page-header'
import { SITE_STATUSES, SiteInventory } from '@/components/site-card'
import { apiSend, useApi } from '@/lib/api'
import { formatDate, formatQty } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DeleteResult, Site, StockRow, TxnRow } from '@/lib/types'

const siteFields = (): FieldDef[] => [
  { name: 'site_name', label: 'Site Name', required: true, full: true, placeholder: 'e.g. Westin Hotel Jaipur' },
  { name: 'location', label: 'Location', placeholder: 'City / area' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: SITE_STATUSES.map((s) => ({ value: s, label: s })),
  },
]

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

export function DashboardView() {
  const { data: sites, isLoading } = useApi<Site[]>('sites')
  const { data: stock } = useApi<StockRow[]>('stock')
  const { data: issues } = useApi<TxnRow[]>('outward')
  const [dialog, setDialog] = useState<{ site: Site | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null)
  const [selectedSite, setSelectedSite] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [siteOrder, setSiteOrder] = useState<number[]>([])
  const [draggedSite, setDraggedSite] = useState<number | null>(null)

  const needle = query.trim().toLowerCase()
  const itemsFor = (siteId: number) =>
    (stock ?? []).filter(
      (s) =>
        s.site_id === siteId &&
        (!needle || s.product_name.toLowerCase().includes(needle)),
    )

  const orderedSites = [...(sites ?? [])].sort((a, b) => {
    const ai = siteOrder.indexOf(a.id)
    const bi = siteOrder.indexOf(b.id)
    if (ai < 0 && bi < 0) return a.site_name.localeCompare(b.site_name)
    if (ai < 0) return 1
    if (bi < 0) return -1
    return ai - bi
  })

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('sitestock-site-order')
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.every((id) => Number.isInteger(id))) setSiteOrder(parsed)
      }
    } catch (err) {
      console.error('Could not restore site order:', err)
    }
  }, [])

  useEffect(() => {
    if (selectedSite === null && sites?.length) setSelectedSite(sites[0].id)
    if (selectedSite !== null && sites && !sites.some((site) => site.id === selectedSite)) {
      setSelectedSite(sites[0]?.id ?? null)
    }
  }, [sites, selectedSite])

  const selected = orderedSites.find((site) => site.id === selectedSite) ?? null
  const visibleSites = orderedSites.filter((site) => !needle || site.site_name.toLowerCase().includes(needle) || itemsFor(site.id).length)

  const activeSites = sites?.filter((s) => s.status === 'Active').length ?? 0
  const itemsInStock = stock?.filter((s) => s.available > 0).length ?? 0

  const changeStatus = async (site: Site, status: string) => {
    setError('')
    try {
      await apiSend('PUT', 'sites', { id: site.id, status })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status')
    }
  }

  const removeSite = async (site: Site) => {
    setError('')
    try {
      const result = await apiSend<DeleteResult>('DELETE', 'sites', { ids: [site.id] })
      if (result.errors.length > 0) setError(result.errors[0])
      else if (selectedSite === site.id) setSelectedSite(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete site')
    }
  }

  const saveSite = async (values: Values) => {
    const site = dialog?.site
    await apiSend(site ? 'PUT' : 'POST', 'sites', site ? { ...values, id: site.id } : values)
  }

  const moveSite = (target: number) => {
    if (draggedSite === null || draggedSite === target) return
    const ids = orderedSites.map((site) => site.id)
    const from = ids.indexOf(draggedSite)
    const to = ids.indexOf(target)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, draggedSite)
    setSiteOrder(ids)
    window.localStorage.setItem('sitestock-site-order', JSON.stringify(ids))
    setDraggedSite(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory Dashboard"
        description="Site-wise stock. Every Stock IN and Stock OUT updates these numbers automatically."
        action={
          <Button size="lg" onClick={() => setDialog({ site: null })}>
            <Plus />
            Add Site
          </Button>
        }
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total Sites" value={sites?.length ?? 0} />
        <Kpi label="Active Sites" value={activeSites} />
        <Kpi label="Items in Stock" value={itemsInStock} />
        <Kpi label="Issue Entries" value={issues?.length ?? 0} />
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!isLoading && sites?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <Building2 className="size-6" />
            </span>
            <div>
              <p className="font-semibold">Add your first site</p>
              <p className="text-sm text-muted-foreground">
                Then use Stock IN to receive items. Stock is tracked automatically per site.
              </p>
            </div>
            <Button onClick={() => setDialog({ site: null })}>
              <Plus />
              Add Site
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section aria-label="Site-wise stock" className="grid gap-4 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,2fr)]">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm">Your sites</CardTitle>
              <CardDescription>Drag to reorder. Select a site to view its inventory.</CardDescription>
              <div className="relative mt-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search item..."
                aria-label="Search item"
                className="h-9 pl-8"
              />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 p-2">
              {visibleSites.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No sites match your search.</p>
              ) : visibleSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  draggable
                  onDragStart={() => setDraggedSite(site.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveSite(site.id)}
                  onDragEnd={() => setDraggedSite(null)}
                  onClick={() => setSelectedSite(site.id)}
                  aria-pressed={selectedSite === site.id}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-3 text-left transition-colors',
                    selectedSite === site.id ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted',
                    draggedSite === site.id && 'opacity-50',
                  )}
                >
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{site.site_name}</span>
                  <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {site.product_count}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="min-w-0">
            {selected ? (
              <SiteInventory
                site={selected}
                items={itemsFor(selected.id)}
                onStatusChange={(status) => changeStatus(selected, status)}
                onEdit={() => setDialog({ site: selected })}
                onDelete={() => setDeleteTarget(selected)}
              />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  Select a site to see its stock details.
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recently Issued</CardTitle>
          <CardDescription>
            Latest Stock OUT entries.{' '}
            <Link href="/outward" className="font-medium text-primary underline underline-offset-2">
              View all
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!issues?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No items issued yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Issued By</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues
                    .filter((r) => selectedSite === null || r.site_id === selectedSite)
                    .slice(0, 10)
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="min-w-24 whitespace-normal">{r.site_name}</TableCell>
                        <TableCell className="min-w-32 font-medium whitespace-normal">{r.product_name}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.person || '-'}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                          {formatQty(r.quantity)} <span className="font-normal text-muted-foreground">{r.unit}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={dialog?.site ? 'edit' : 'create'}
        title={dialog?.site ? 'Edit Site' : 'Add Site'}
        initial={
          dialog?.site
            ? { site_name: dialog.site.site_name, location: dialog.site.location, status: dialog.site.status }
            : { site_name: '', location: '', status: 'Active' }
        }
        fields={siteFields}
        onSubmit={saveSite}
        submitLabel={dialog?.site ? 'Update' : 'Save Site'}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.site_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the site, its item allocations, opening balances, Stock IN/OUT history, and any
              transfers involving it. Transfers are removed at both sites; deletion is blocked if another site's later
              balance would become negative.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (deleteTarget) await removeSite(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
