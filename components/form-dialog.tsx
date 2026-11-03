'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/native-select'
import { cn } from '@/lib/utils'

export type Values = Record<string, string>

export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea'
  options?: { value: string | number; label: string }[]
  required?: boolean
  placeholder?: string
  hint?: ReactNode
  full?: boolean
  readOnly?: boolean
  disabled?: boolean
  /** Autocomplete hints for free-text fields (e.g. existing item names). */
  suggestions?: string[]
}

export type FormMode = 'create' | 'edit' | 'view'

interface FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  mode: FormMode
  initial: Values
  fields: (values: Values) => FieldDef[]
  /** Return a patch for dependent fields (e.g. reset product when site changes). */
  derive?: (next: Values, changed: string) => Values
  onSubmit: (values: Values) => Promise<void>
  submitLabel?: string
}

function FormBody({
  title,
  description,
  mode,
  initial,
  fields,
  derive,
  onSubmit,
  submitLabel,
  onClose,
}: Omit<FormDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [values, setValues] = useState<Values>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const viewOnly = mode === 'view'

  const change = (name: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value }
      return derive ? { ...next, ...derive(next, name) } : next
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (viewOnly) return
    setError('')
    setSaving(true)
    try {
      await onSubmit(values)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {fields(values).map((f) => {
          const id = `field-${f.name}`
          const type = f.type ?? 'text'
          const full = f.full ?? type === 'textarea'
          const locked = viewOnly || f.readOnly || f.disabled
          return (
            <div key={f.name} className={cn('flex flex-col gap-1.5', full && 'sm:col-span-2')}>
              <Label htmlFor={id}>
                {f.label}
                {f.required && !viewOnly && <span className="text-destructive"> *</span>}
              </Label>
              {type === 'select' ? (
                <NativeSelect
                  id={id}
                  value={values[f.name] ?? ''}
                  disabled={locked}
                  required={f.required}
                  onChange={(e) => change(f.name, e.target.value)}
                >
                  <option value="">{f.placeholder ?? 'Select...'}</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : type === 'textarea' ? (
                <Textarea
                  id={id}
                  value={values[f.name] ?? ''}
                  rows={2}
                  disabled={locked}
                  placeholder={f.placeholder}
                  onChange={(e) => change(f.name, e.target.value)}
                />
              ) : (
                <Input
                  id={id}
                  list={f.suggestions ? `${id}-list` : undefined}
                  autoComplete={f.suggestions ? 'off' : undefined}
                  type={type}
                  value={values[f.name] ?? ''}
                  disabled={locked && !f.readOnly}
                  readOnly={f.readOnly || viewOnly}
                  required={f.required}
                  placeholder={f.placeholder}
                  min={type === 'number' ? 0 : undefined}
                  step={type === 'number' ? 'any' : undefined}
                  className={cn('h-9', f.readOnly && 'bg-muted font-medium')}
                  onChange={(e) => change(f.name, e.target.value)}
                />
              )}
              {f.suggestions && (
                <datalist id={`${id}-list`}>
                  {f.suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>
          {viewOnly ? 'Close' : 'Cancel'}
        </Button>
        {!viewOnly && (
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? 'Saving...' : (submitLabel ?? 'Save')}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

export function FormDialog({ open, onOpenChange, ...rest }: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <FormBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
