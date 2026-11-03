'use client'

import { useState, type ReactNode } from 'react'
import { Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { DataTable, type Column } from '@/components/data-table'
import { FormDialog, type FieldDef, type FormMode, type Values } from '@/components/form-dialog'
import { PageHeader } from '@/components/page-header'
import { apiSend, useApi } from '@/lib/api'
import type { DeleteResult } from '@/lib/types'

interface ResourcePageProps<T extends { id: number }> {
  title: string
  description: string
  singular: string
  resource: string
  params?: Record<string, string | number | null | undefined>
  columns: Column<T>[]
  fields: (values: Values) => FieldDef[]
  derive?: (next: Values, changed: string) => Values
  blank: () => Values
  toValues: (row: T) => Values
  filters?: ReactNode
  /** Return false to hide edit/delete for a row (e.g. transfer-linked entries). */
  isLocked?: (row: T) => boolean
  allowEdit?: boolean
  allowView?: boolean
  addLabel?: string
  addDisabled?: boolean
  addHint?: ReactNode
  banner?: ReactNode
  dialogDescription?: string
  deleteDescription?: string
  exportSubtitle?: string
  submitLabel?: string
}

type Notice = { kind: 'success' | 'error'; text: string; details?: string[] }

export function ResourcePage<T extends { id: number }>({
  title,
  description,
  singular,
  resource,
  params,
  columns,
  fields,
  derive,
  blank,
  toValues,
  filters,
  isLocked,
  allowEdit = true,
  allowView = true,
  addLabel,
  addDisabled,
  addHint,
  banner,
  dialogDescription,
  deleteDescription,
  exportSubtitle,
  submitLabel,
}: ResourcePageProps<T>) {
  const { data, isLoading, error } = useApi<T[]>(resource, params)
  const [dialog, setDialog] = useState<{ mode: FormMode; row: T | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const remove = async (rows: T[]) => {
    try {
      const result = await apiSend<DeleteResult>('DELETE', resource, { ids: rows.map((r) => r.id) })
      if (result.errors.length > 0) {
        setNotice({
          kind: result.deleted > 0 ? 'success' : 'error',
          text: `${result.deleted} deleted, ${result.errors.length} skipped.`,
          details: result.errors,
        })
      } else {
        setNotice({ kind: 'success', text: `${result.deleted} ${singular.toLowerCase()} record(s) deleted.` })
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Delete failed' })
    }
  }

  const submit = async (values: Values) => {
    const row = dialog?.row
    await apiSend(row ? 'PUT' : 'POST', resource, row ? { ...values, id: row.id } : values)
    setNotice({ kind: 'success', text: `${singular} ${row ? 'updated' : 'saved'} successfully.` })
  }

  const mode = dialog?.mode ?? 'create'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description={description}
        action={
          <Button size="lg" disabled={addDisabled} onClick={() => setDialog({ mode: 'create', row: null })}>
            <Plus />
            {addLabel ?? `Add ${singular}`}
          </Button>
        }
      />

      {banner}
      {addHint && addDisabled && (
        <p className="rounded-lg border border-dashed bg-card px-3 py-2 text-sm text-muted-foreground">{addHint}</p>
      )}

      {notice && (
        <div
          role="status"
          className={
            notice.kind === 'success'
              ? 'flex items-start justify-between gap-3 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground'
              : 'flex items-start justify-between gap-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive'
          }
        >
          <div>
            <p className="font-medium">{notice.text}</p>
            {notice.details?.map((d) => (
              <p key={d} className="mt-0.5">
                {d}
              </p>
            ))}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <DataTable<T>
        columns={columns}
        rows={data}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        exportTitle={title}
        exportSubtitle={exportSubtitle}
        selectable
        onBulkDelete={remove}
        toolbar={filters}
        rowActions={(row) => {
          const locked = isLocked?.(row) ?? false
          return (
            <div className="inline-flex items-center gap-0.5">
              {allowView && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`View ${singular}`}
                  onClick={() => setDialog({ mode: 'view', row })}
                >
                  <Eye />
                </Button>
              )}
              {allowEdit && !locked && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${singular}`}
                  onClick={() => setDialog({ mode: 'edit', row })}
                >
                  <Pencil />
                </Button>
              )}
              {!locked && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${singular}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          )
        }}
      />

      <FormDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={mode}
        title={mode === 'view' ? `${singular} Details` : mode === 'edit' ? `Edit ${singular}` : `New ${singular}`}
        description={dialogDescription}
        initial={dialog?.row ? toValues(dialog.row) : blank()}
        fields={fields}
        derive={derive}
        onSubmit={submit}
        submitLabel={submitLabel ?? (mode === 'edit' ? 'Update' : 'Save')}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {singular.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDescription ??
                'This cannot be undone. Balances for the affected site are recalculated automatically, and the delete is blocked if it would cause negative stock.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (deleteTarget) await remove([deleteTarget])
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
