import { NextResponse } from 'next/server'
import * as inv from '@/lib/inventory'
import type { DeleteResult } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string }> }
type Body = Record<string, unknown>

const intParam = (sp: URLSearchParams, key: string) => {
  const raw = sp.get(key)
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new inv.InventoryError(`${key} must be a positive integer`)
  return n
}

const dateParam = (sp: URLSearchParams, key: string) => {
  const value = sp.get(key)
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new inv.InventoryError(`${key} must be a valid date`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new inv.InventoryError(`${key} must be a valid date`)
  }
  return value
}

const fail = (error: unknown) => {
  if (error instanceof inv.InventoryError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error('[v0] API error:', error)
  return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
}

const savers: Record<string, (body: Body) => number> = {
  sites: inv.saveSite,
  products: inv.saveProduct,
  allocations: inv.saveAllocation,
  'site-items': inv.saveSiteItem,
  inward: inv.saveInward,
  outward: inv.saveOutward,
  transfers: inv.saveTransfer,
}

const deleters: Record<string, (ids: number[]) => DeleteResult> = {
  sites: inv.deleteSites,
  products: inv.deleteProducts,
  allocations: inv.deleteAllocations,
  inward: (ids) => inv.deleteTxns('inward', ids),
  outward: (ids) => inv.deleteTxns('outward', ids),
  transfers: inv.deleteTransfers,
}

export async function GET(request: Request, { params }: Ctx) {
  const { resource } = await params
  const sp = new URL(request.url).searchParams
  try {
    const siteId = intParam(sp, 'site_id')
    const productId = intParam(sp, 'product_id')
    const from = dateParam(sp, 'from')
    const to = dateParam(sp, 'to')
    switch (resource) {
      case 'sites':
        return NextResponse.json(inv.listSites())
      case 'products':
        return NextResponse.json(inv.listProducts())
      case 'allocations':
        return NextResponse.json(inv.stockRows({ siteId, productId }))
      case 'stock':
        return NextResponse.json(inv.stockRows({ siteId, productId, from, to }))
      case 'ledger':
        return NextResponse.json(inv.ledgerRows({ siteId, productId, from, to }))
      case 'inward':
      case 'outward':
        return NextResponse.json(inv.listTxns(resource, { siteId, productId, from, to }))
      case 'transfers':
        return NextResponse.json(inv.listTransfers({ siteId, from, to }))
      default:
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return fail(error)
  }
}

async function write(request: Request, ctx: Ctx, method: 'POST' | 'PUT') {
  const { resource } = await ctx.params
  const save = savers[resource]
  if (!save) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (resource === 'site-items' && method === 'PUT') {
    return NextResponse.json({ error: 'Site items can only be created with POST' }, { status: 405 })
  }
  try {
    let parsed: unknown
    try {
      parsed = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const body = parsed as Body
    if (method === 'PUT' && (!Number.isInteger(Number(body.id)) || Number(body.id) <= 0)) {
      return NextResponse.json({ error: 'A valid record id is required' }, { status: 400 })
    }
    if (method === 'POST') delete body.id
    const id = save(body)
    return NextResponse.json({ id })
  } catch (error) {
    return fail(error)
  }
}

export const POST = (request: Request, ctx: Ctx) => write(request, ctx, 'POST')
export const PUT = (request: Request, ctx: Ctx) => write(request, ctx, 'PUT')

export async function DELETE(request: Request, ctx: Ctx) {
  const { resource } = await ctx.params
  const remove = deleters[resource]
  if (!remove) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    let parsed: unknown
    try {
      parsed = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const body = parsed as { ids?: unknown }
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'No records selected' }, { status: 400 })
    }
    const ids = body.ids.map(Number)
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: 'Record ids must be positive integers' }, { status: 400 })
    }
    return NextResponse.json(remove(ids))
  } catch (error) {
    return fail(error)
  }
}
