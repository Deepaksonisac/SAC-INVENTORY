'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NativeSelect } from '@/components/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportTable, type ExportFormat } from '@/lib/export'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  /** Plain value used for search, sorting and export. Defaults to row[key]. */
  value?: (row: T) => string | number
  render?: (row: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string | number
  exportTitle: string
  exportSubtitle?: string
  isLoading?: boolean
  selectable?: boolean
  onBulkDelete?: (rows: T[]) => Promise<void> | void
  rowActions?: (row: T) => ReactNode
  toolbar?: ReactNode
  searchPlaceholder?: string
  emptyText?: string
}

const PAGE_SIZES = [10, 25, 50, 100]

export function DataTable<T extends object>({
  columns,
  rows,
  rowKey,
  exportTitle,
  exportSubtitle,
  isLoading,
  selectable = false,
  onBulkDelete,
  rowActions,
  toolbar,
  searchPlaceholder = 'Search...',
  emptyText = 'No Records Found',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<Set<string | number>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const cellValue = (row: T, col: Column<T>): string | number => {
    if (col.value) return col.value(row)
    const raw = (row as Record<string, unknown>)[col.key]
    return raw === null || raw === undefined ? '' : (raw as string | number)
  }

  const filtered = useMemo(() => {
    const all = rows ?? []
    const q = search.trim().toLowerCase()
    let list = q
      ? all.filter((row) =>
          columns.some((col) =>
            String(col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] ?? ''))
              .toLowerCase()
              .includes(q),
          ),
        )
      : all
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1
        list = [...list].sort((a, b) => {
          const av = col.value ? col.value(a) : (((a as Record<string, unknown>)[col.key] ?? '') as string | number)
          const bv = col.value ? col.value(b) : (((b as Record<string, unknown>)[col.key] ?? '') as string | number)
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
          return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir
        })
      }
    }
    return list
  }, [rows, search, sort, columns])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [search, pageSize])

  // Drop selections for rows that no longer exist (after delete / refetch).
  useEffect(() => {
    if (!rows) return
    const valid = new Set(rows.map(rowKey))
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => valid.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [rows, rowKey])

  const filteredKeys = filtered.map(rowKey)
  const selectedInView = filteredKeys.filter((k) => selected.has(k)).length
  const allSelected = filtered.length > 0 && selectedInView === filtered.length
  const selectedRows = (rows ?? []).filter((r) => selected.has(rowKey(r)))

  const toggleAll = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of filteredKeys) {
        if (checked) next.add(k)
        else next.delete(k)
      }
      return next
    })

  const toggleOne = (key: string | number, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null,
    )

  const handleExport = (format: ExportFormat) => {
    const source = selectedRows.length > 0 ? selectedRows : filtered
    void exportTable(
      format,
      exportTitle,
      columns.map((c) => ({ header: c.header, align: c.align })),
      source.map((row) => columns.map((c) => cellValue(row, c))),
      exportSubtitle,
    )
  }

  const confirmDelete = async () => {
    if (!onBulkDelete) return
    setBusy(true)
    try {
      await onBulkDelete(selectedRows)
      setSelected(new Set())
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  const colSpan = columns.length + 1 + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
  const hasSelection = selectedRows.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search table"
              className="h-9 pl-8"
            />
          </div>
          {toolbar}
        </div>
        <div className="flex items-center gap-2">
          {hasSelection && onBulkDelete && (
            <Button variant="destructive" size="lg" onClick={() => setConfirmOpen(true)}>
              <Trash2 />
              Delete ({selectedRows.length})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="lg" disabled={filtered.length === 0}>
                  <Download />
                  Export{hasSelection ? ` (${selectedRows.length})` : ''}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>CSV (.csv)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('pdf')}>PDF (.pdf)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selectable && hasSelection && (
        <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          <span>
            {selectedRows.length} of {rows?.length ?? 0} selected. Export and delete apply to the selection.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X /> Clear
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allSelected}
                    indeterminate={selectedInView > 0 && !allSelected}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                  />
                </TableHead>
              )}
              <TableHead className="hidden w-14 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:table-cell">
                S.No.
              </TableHead>
              {columns.map((col) => {
                const active = sort?.key === col.key
                const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <TableHead
                    key={col.key}
                    className={cn('text-xs font-semibold tracking-wide whitespace-nowrap uppercase', col.align === 'right' && 'text-right')}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'inline-flex items-center gap-1 uppercase hover:text-foreground',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {col.header}
                      <Icon className="size-3" />
                    </button>
                  </TableHead>
                )
              })}
              {rowActions && (
                <TableHead className="sticky right-0 border-l bg-muted text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Actions
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !rows ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row, i) => {
                const key = rowKey(row)
                return (
                  <TableRow key={key} data-state={selected.has(key) ? 'selected' : undefined}>
                    {selectable && (
                      <TableCell>
                        <Checkbox
                          aria-label="Select row"
                          checked={selected.has(key)}
                          onCheckedChange={(v) => toggleOne(key, Boolean(v))}
                        />
                      </TableCell>
                    )}
                    <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                      {(currentPage - 1) * pageSize + i + 1}
                    </TableCell>
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          'whitespace-nowrap',
                          col.align === 'right' && 'text-right tabular-nums',
                          col.className,
                        )}
                      >
                        {col.render ? col.render(row) : String(cellValue(row, col))}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="sticky right-0 border-l bg-card text-right whitespace-nowrap">
                        {rowActions(row)}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
        <span>
          {filtered.length === 0
            ? '0 records'
            : `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            Rows
            <NativeSelect
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 w-20"
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center tabular-nums">
            {currentPage} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedRows.length} selected record(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected records and recalculates the affected site balances. Records
              that are still in use will be skipped and reported.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy} variant="destructive">
              {busy ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
