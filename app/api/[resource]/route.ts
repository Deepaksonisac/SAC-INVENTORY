import { NextResponse } from 'next/server'
import * as inv from '@/lib/inventory'
import type { DeleteResult } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string }> }
type Body = Record<string, unknown>

const intParam = (sp: URLSearchParams, key: string) => {
  const n = Number(sp.get(key))
  return Number.isInteger(n) && n > 0 ? n : null
}

const strParam = (sp: URLSearchParams, key: string) => {
  const v = sp.get(key)
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
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
  const siteId = intParam(sp, 'site_id')
  const productId = intParam(sp, 'product_id')
  const from = strParam(sp, 'from')
  const to = strParam(sp, 'to')
  try {
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
    const body = (await request.json()) as Body
    if (method === 'PUT' && !body.id) {
      return NextResponse.json({ error: 'Record id is required' }, { status: 400 })
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
    const body = (await request.json()) as { ids?: unknown }
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
    if (ids.length === 0) return NextResponse.json({ error: 'No records selected' }, { status: 400 })
    return NextResponse.json(remove(ids))
  } catch (error) {
    return fail(error)
  }
}
