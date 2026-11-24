import { all, get, run, transaction } from './db'
import { round3, smCode, transferCode } from './format'
import type {
  DeleteResult,
  LedgerRow,
  LedgerType,
  Product,
  Site,
  StockRow,
  StockStatus,
  SiteMovementRow,
  SiteMovementSummary,
  TransferRow,
  TxnRow,
} from './types'

export class InventoryError extends Error {}

type Body = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

const text = (b: Body, key: string, label: string, required = false, max = 500) => {
  const raw = b[key]
  const value = raw === undefined || raw === null ? '' : String(raw).trim()
  if (required && !value) throw new InventoryError(`${label} is required`)
  if (value.length > max) throw new InventoryError(`${label} is too long`)
  return value
}

const quantity = (
  b: Body,
  key: string,
  label: string,
  opts: { positive?: boolean; required?: boolean } = {},
) => {
  const { positive = false, required = true } = opts
  const raw = b[key]
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new InventoryError(`${label} is required`)
    return 0
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new InventoryError(`${label} must be a number`)
  if (n < 0) throw new InventoryError(`${label} cannot be negative`)
  if (positive && n <= 0) throw new InventoryError(`${label} must be greater than zero`)
  if (n > 1_000_000_000) throw new InventoryError(`${label} is too large`)
  return round3(n)
}

const dateValue = (b: Body, key: string, label: string, required = true) => {
  const raw = text(b, key, label, required)
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== raw
  ) {
    throw new InventoryError(`${label} must be a valid date`)
  }
  return raw
}

const idValue = (b: Body, key: string, label: string) => {
  const n = Number(b[key])
  if (!Number.isInteger(n) || n <= 0) throw new InventoryError(`${label} is required`)
  return n
}

const optionalId = (b: Body, key: string) => {
  const raw = b[key]
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

const friendlyDbError = (error: unknown): never => {
  if (error instanceof InventoryError) throw error
  const pgError = error as { code?: string; constraint?: string; message?: string }
  const detail = `${pgError.constraint ?? ''} ${pgError.message ?? String(error)}`
  if (detail.includes('sites_site_code')) throw new InventoryError('Site code already exists')
  if (detail.includes('products_product_code')) throw new InventoryError('Product code already exists')
  if (detail.includes('site_materials_site_id')) {
    throw new InventoryError('This product is already allocated to the selected site')
  }
  if (pgError.code === '23503') {
    throw new InventoryError('This record is referenced by other records and cannot be changed or removed')
  }
  throw error
}

/* ------------------------------------------------------------------ */
/* Site material lookup + ledger engine                                */
/* ------------------------------------------------------------------ */

interface SmInfo {
  id: number
  site_id: number
  site_name: string
  site_code: string
  product_id: number
  product_code: string
  product_name: string
  category: string
  unit: string
  boq_qty: number
  opening_stock: number
  min_stock: number
  allocation_date: string
  remarks: string
}

interface Entry extends LedgerRow {
  kindOrder: number
  txnId: number
}

export interface Bundle {
  sm: SmInfo
  rows: Entry[]
  closing: number
}

export interface SmFilter {
  siteId?: number | null
  productId?: number | null
  smIds?: number[]
}

export async function loadSiteMaterials(filter: SmFilter = {}): Promise<SmInfo[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.siteId) {
    where.push('sm.site_id = ?')
    params.push(filter.siteId)
  }
  if (filter.productId) {
    where.push('sm.product_id = ?')
    params.push(filter.productId)
  }
  if (filter.smIds) {
    if (filter.smIds.length === 0) return []
    where.push(`sm.id IN (${filter.smIds.map(() => '?').join(',')})`)
    params.push(...filter.smIds)
  }
  return all<SmInfo>(
    `SELECT sm.id, sm.site_id, s.site_name, s.site_code, sm.product_id, p.product_code, p.product_name,
            p.category, p.unit, sm.boq_qty, sm.opening_stock, sm.min_stock, sm.allocation_date, sm.remarks
       FROM site_materials sm
       JOIN sites s ON s.id = sm.site_id
       JOIN products p ON p.id = sm.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.site_name, p.product_name`,
    ...params,
  )
}

interface RawTxn {
  id: number
  site_material_id: number
  txn_date: string
  quantity: number
  party: string
  person: string
  challan_no: string
  remarks: string
  purpose: string
  transfer_id: number | null
  counterpart: string | null
  reference_no: string | null
  approved_by: string | null
  movement_type?: 'ISSUE' | 'RETURN'
}

/**
 * Builds the running-balance ledger for each site material independently.
 * Balances are always derived from the stored transactions, so editing or deleting an
 * old transaction automatically recalculates every later balance for that site material only.
 */
export async function buildLedgers(sms: SmInfo[]): Promise<Map<number, Bundle>> {
  const bundles = new Map<number, Bundle>()
  for (const sm of sms) bundles.set(sm.id, { sm, rows: [], closing: sm.opening_stock })
  if (sms.length === 0) return bundles

  const smIds = sms.map((sm) => sm.id)
  const placeholders = smIds.map(() => '?').join(',')
  const [inward, outward, movements] = await Promise.all([
    all<RawTxn>(
      `SELECT i.id, i.site_material_id, i.txn_date, i.quantity, i.supplier AS party, i.received_by AS person,
              i.challan_no, i.remarks, '' AS purpose, i.transfer_id,
              fs.site_name AS counterpart, t.reference_no, t.approved_by
         FROM material_inward i
         LEFT JOIN material_transfers t ON t.id = i.transfer_id
         LEFT JOIN site_materials fsm ON fsm.id = t.from_site_material_id
         LEFT JOIN sites fs ON fs.id = fsm.site_id
        WHERE i.site_material_id IN (${placeholders})`,
      ...smIds,
    ),
    all<RawTxn>(
      `SELECT o.id, o.site_material_id, o.txn_date, o.quantity, o.issued_to AS party, o.issued_by AS person,
              o.challan_no, o.remarks, o.purpose, o.transfer_id,
              ts.site_name AS counterpart, t.reference_no, t.approved_by
         FROM material_outward o
         LEFT JOIN material_transfers t ON t.id = o.transfer_id
         LEFT JOIN site_materials tsm ON tsm.id = t.to_site_material_id
         LEFT JOIN sites ts ON ts.id = tsm.site_id
        WHERE o.site_material_id IN (${placeholders})`,
      ...smIds,
    ),
    all<RawTxn>(
      `SELECT m.id, sm.id AS site_material_id, m.movement_date AS txn_date, m.quantity,
              'Central Store' AS party, '' AS person, m.challan_no, m.remarks, '' AS purpose,
              NULL::integer AS transfer_id, NULL::text AS counterpart, NULL::text AS reference_no,
              NULL::text AS approved_by, m.movement_type
         FROM site_material_movements m
         JOIN site_materials sm ON sm.site_id=m.site_id AND sm.product_id=m.product_id
        WHERE sm.id IN (${placeholders})`,
      ...smIds,
    ),
  ])

  const push = (raw: RawTxn, kind: 'in' | 'out') => {
    const bundle = bundles.get(raw.site_material_id)
    if (!bundle) return
    const { sm } = bundle
    const isTransfer = raw.transfer_id !== null
    const type: LedgerType = raw.movement_type
      ? raw.movement_type === 'ISSUE' ? 'Site Issue' : 'Site Return'
      : isTransfer
        ? kind === 'in' ? 'Transfer In' : 'Transfer Out'
        : kind === 'in' ? 'Inward' : 'Outward'
    const remarks = [raw.purpose, raw.remarks].filter(Boolean).join(' | ')
    bundle.rows.push({
      key: raw.movement_type ? `movement-${raw.id}` : `${kind}-${raw.id}`,
      sm_id: sm.id,
      sm_code: smCode(sm.id),
      site_id: sm.site_id,
      site_name: sm.site_name,
      product_id: sm.product_id,
      product_code: sm.product_code,
      product_name: sm.product_name,
      unit: sm.unit,
      date: raw.txn_date,
      type,
      opening: 0,
      in_qty: kind === 'in' ? raw.quantity : 0,
      out_qty: kind === 'out' ? raw.quantity : 0,
      closing: 0,
      challan_no: isTransfer ? (raw.reference_no ?? '') : raw.challan_no,
      person: isTransfer ? (raw.approved_by ?? '') : raw.person,
      party: isTransfer
        ? `${kind === 'in' ? 'From' : 'To'}: ${raw.counterpart ?? ''}`
        : raw.party,
      remarks,
      transfer_code: isTransfer ? transferCode(raw.transfer_id as number) : '',
      kindOrder: kind === 'in' ? 0 : 1,
      txnId: raw.id,
    })
  }
  inward.forEach((r) => push(r, 'in'))
  outward.forEach((r) => push(r, 'out'))
  movements.forEach((row) => push(row, row.movement_type === 'ISSUE' ? 'in' : 'out'))

  for (const bundle of bundles.values()) {
    // Same-day order: receipts first, then issues, then entry order.
    bundle.rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.kindOrder - b.kindOrder || a.txnId - b.txnId,
    )
    let balance = bundle.sm.opening_stock
    for (const row of bundle.rows) {
      row.opening = balance
      balance = round3(balance + row.in_qty - row.out_qty)
      row.closing = balance
    }
    bundle.closing = balance
  }
  return bundles
}

/** Throws (and so rolls back the surrounding transaction) if any balance would go below zero. */
async function assertNonNegative(smIds: number[]) {
  const unique = [...new Set(smIds)]
  const bundles = await buildLedgers(await loadSiteMaterials({ smIds: unique }))
  for (const { sm, rows } of bundles.values()) {
    for (const row of rows) {
      if (row.closing < 0) {
        throw new InventoryError(
          `Not allowed: "${sm.product_name}" at "${sm.site_name}" would have negative stock (${row.closing} ${sm.unit}) on ${row.date}.`,
        )
      }
    }
  }
}

const findSiteMaterial = (siteId: number, productId: number) =>
  get<{ id: number }>('SELECT id FROM site_materials WHERE site_id = ? AND product_id = ?', siteId, productId)

async function requireAllocation(siteId: number, productId: number, label = 'the selected site') {
  const found = await findSiteMaterial(siteId, productId)
  if (!found) throw new InventoryError(`This product is not allocated to ${label}. Allocate it first.`)
  return found.id
}

async function removeMany(ids: number[], remove: (id: number) => Promise<void>): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: 0, errors: [] }
  for (const id of ids) {
    try {
      await transaction(() => remove(id))
      result.deleted += 1
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Delete failed')
    }
  }
  return result
}

/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */

export function listSites(): Promise<Site[]> {
  return all<Site>(
    `SELECT s.id, s.site_name, s.site_code, s.client_name, s.location, s.start_date, s.status, s.remarks,
            (SELECT COUNT(*) FROM site_materials sm WHERE sm.site_id = s.id) AS product_count
       FROM sites s ORDER BY s.site_name`,
  )
}

/** Next free human-readable code such as SITE-001 or ITM-007. */
async function generateCode(table: 'sites' | 'products', column: string, prefix: string) {
  let n = ((await get<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`))?.m ?? 0) + 1
  let code = ''
  do {
    code = `${prefix}-${String(n).padStart(3, '0')}`
    n += 1
  } while (await get(`SELECT 1 FROM ${table} WHERE ${column} = ?`, code))
  return code
}

async function deleteSiteMaterialHistory(smIds: number[]) {
  const ids = [...new Set(smIds)]
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(',')
  const transfers = await all<{ id: number; from_site_material_id: number; to_site_material_id: number }>(
    `SELECT id, from_site_material_id, to_site_material_id
       FROM material_transfers
      WHERE from_site_material_id IN (${placeholders}) OR to_site_material_id IN (${placeholders})`,
    ...ids,
    ...ids,
  )
  const removedIds = new Set(ids)
  const affectedIds = [
    ...new Set(
      transfers
        .flatMap((transfer) => [transfer.from_site_material_id, transfer.to_site_material_id])
        .filter((materialId) => !removedIds.has(materialId)),
    ),
  ]

  for (const transfer of transfers) {
    await run('DELETE FROM material_transfers WHERE id = ?', transfer.id)
  }
  await run(`DELETE FROM material_inward WHERE site_material_id IN (${placeholders})`, ...ids)
  await run(`DELETE FROM material_outward WHERE site_material_id IN (${placeholders})`, ...ids)
  return affectedIds
}

async function removeOrphanProducts(productIds: number[]) {
  for (const productId of new Set(productIds)) {
    await run(
      `DELETE FROM products
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM site_materials WHERE product_id = ?)`,
      productId,
      productId,
    )
  }
}

export async function saveSite(input: Body) {
  try {
    const id = optionalId(input, 'id')
    let body = input
    if (id) {
      const existing = await get<Body>('SELECT * FROM sites WHERE id = ?', id)
      if (!existing) throw new InventoryError('Site not found')
      body = { ...existing, ...input }
    }
    const status = text(body, 'status', 'Status') || 'Active'
    if (!['Active', 'On Hold', 'Completed'].includes(status)) throw new InventoryError('Invalid status')
    const values = [
      text(body, 'site_name', 'Site name', true, 120),
      text(body, 'site_code', 'Site code', false, 30) || (await generateCode('sites', 'site_code', 'SITE')),
      text(body, 'client_name', 'Client name', false, 120),
      text(body, 'location', 'Location', false, 200),
      dateValue(body, 'start_date', 'Start date', false),
      status,
      text(body, 'remarks', 'Remarks', false, 1000),
    ]
    if (id) {
      await run(
        `UPDATE sites SET site_name=?, site_code=?, client_name=?, location=?, start_date=?, status=?, remarks=? WHERE id=?`,
        ...values,
        id,
      )
      return id
    }
    return await run(
      `INSERT INTO sites (site_name, site_code, client_name, location, start_date, status, remarks) VALUES (?,?,?,?,?,?,?)`,
      ...values,
    )
  } catch (error) {
    return friendlyDbError(error)
  }
}

export function deleteSites(ids: number[]) {
  return removeMany(ids, async (id) => {
    const site = await get<{ site_name: string }>('SELECT site_name FROM sites WHERE id = ?', id)
    if (!site) return
    const materials = await all<{ id: number; product_id: number }>(
      'SELECT id, product_id FROM site_materials WHERE site_id = ?',
      id,
    )
    const materialIds = materials.map((material) => material.id)
    const productIds = materials.map((material) => material.product_id)
    const affectedIds = await deleteSiteMaterialHistory(materialIds)
    await assertNonNegative(affectedIds)
    if (materialIds.length) {
      await run(`DELETE FROM site_materials WHERE id IN (${materialIds.map(() => '?').join(',')})`, ...materialIds)
    }
    await removeOrphanProducts(productIds)
    await run('DELETE FROM sites WHERE id = ?', id)
  })
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export function listProducts(): Promise<Product[]> {
  return all<Product>(
    `SELECT p.id, p.product_code, p.product_name, p.category, p.description, p.unit, p.brand, p.model, p.min_stock,
            (SELECT COUNT(*) FROM site_materials sm WHERE sm.product_id = p.id) AS site_count
       FROM products p ORDER BY p.product_name`,
  )
}

export async function saveProduct(body: Body) {
  try {
    const id = optionalId(body, 'id')
    const values = [
      text(body, 'product_code', 'Product code', true, 40),
      text(body, 'product_name', 'Product name', true, 160),
      text(body, 'category', 'Category', false, 80),
      text(body, 'description', 'Description', false, 1000),
      text(body, 'unit', 'Unit', true, 20),
      text(body, 'brand', 'Brand', false, 80),
      text(body, 'model', 'Model', false, 80),
      quantity(body, 'min_stock', 'Minimum stock level', { required: false }),
    ]
    if (id) {
      if (!(await get('SELECT id FROM products WHERE id = ?', id))) throw new InventoryError('Product not found')
      await run(
        `UPDATE products SET product_code=?, product_name=?, category=?, description=?, unit=?, brand=?, model=?, min_stock=? WHERE id=?`,
        ...values,
        id,
      )
      return id
    }
    return await run(
      `INSERT INTO products (product_code, product_name, category, description, unit, brand, model, min_stock) VALUES (?,?,?,?,?,?,?,?)`,
      ...values,
    )
  } catch (error) {
    return friendlyDbError(error)
  }
}

export function deleteProducts(ids: number[]) {
  return removeMany(ids, async (id) => {
    const product = await get<{ product_name: string }>('SELECT product_name FROM products WHERE id = ?', id)
    if (!product) return
    const allocated = await get<{ n: number }>('SELECT COUNT(*) AS n FROM site_materials WHERE product_id = ?', id)
    if (allocated && allocated.n > 0) {
      throw new InventoryError(`"${product.product_name}" is allocated to a site. Remove the allocation first.`)
    }
    const centralStock = await get<{ n: number }>('SELECT COUNT(*) AS n FROM site_central_stock WHERE product_id=?', id)
    if (centralStock && centralStock.n > 0) {
      throw new InventoryError(`"${product.product_name}" has Central Store balances or movement history and cannot be removed.`)
    }
    await run('DELETE FROM products WHERE id = ?', id)
  })
}

/* ------------------------------------------------------------------ */
/* Stock register / allocations                                        */
/* ------------------------------------------------------------------ */

export interface StockFilter extends SmFilter {
  from?: string | null
  to?: string | null
}

export async function stockRows(filter: StockFilter = {}): Promise<StockRow[]> {
  const sms = await loadSiteMaterials(filter)
  const bundles = await buildLedgers(sms)
  const { from, to } = filter
  return sms.map((sm) => {
    const rows = bundles.get(sm.id)?.rows ?? []
    let opening = sm.opening_stock
    let received = 0
    let issued = 0
    let issuedUpToEnd = 0
    for (const r of rows) {
      if (to && r.date > to) continue
      issuedUpToEnd += r.out_qty
      if (from && r.date < from) {
        opening += r.in_qty - r.out_qty
        continue
      }
      received += r.in_qty
      issued += r.out_qty
    }
    opening = round3(opening)
    received = round3(received)
    issued = round3(issued)
    const available = round3(opening + received - issued)
    const status: StockStatus =
      available <= 0 ? 'Out of Stock' : available <= sm.min_stock ? 'Low Stock' : 'In Stock'
    return {
      id: sm.id,
      sm_code: smCode(sm.id),
      site_id: sm.site_id,
      site_name: sm.site_name,
      site_code: sm.site_code,
      product_id: sm.product_id,
      product_code: sm.product_code,
      product_name: sm.product_name,
      category: sm.category,
      unit: sm.unit,
      boq_qty: sm.boq_qty,
      opening_stock: opening,
      min_stock: sm.min_stock,
      allocation_date: sm.allocation_date,
      remarks: sm.remarks,
      total_received: received,
      total_issued: issued,
      available,
      pending_boq: round3(sm.boq_qty - issuedUpToEnd),
      status,
      txn_count: rows.length,
    }
  })
}

export async function ledgerRows(filter: StockFilter = {}): Promise<LedgerRow[]> {
  const bundles = await buildLedgers(await loadSiteMaterials(filter))
  const out: LedgerRow[] = []
  for (const { rows } of bundles.values()) {
    for (const r of rows) {
      if (filter.from && r.date < filter.from) continue
      if (filter.to && r.date > filter.to) continue
      const { kindOrder: _k, txnId: _t, ...row } = r
      out.push(row)
    }
  }
  return out
}

export async function saveAllocation(body: Body) {
  try {
    const id = optionalId(body, 'id')
    const siteId = idValue(body, 'site_id', 'Site')
    const productId = idValue(body, 'product_id', 'Product')
    const values = [
      siteId,
      productId,
      quantity(body, 'boq_qty', 'BOQ quantity'),
      quantity(body, 'opening_stock', 'Opening stock', { required: false }),
      quantity(body, 'min_stock', 'Minimum stock', { required: false }),
      dateValue(body, 'allocation_date', 'Allocation date'),
      text(body, 'remarks', 'Remarks', false, 1000),
    ]
    if (!(await get('SELECT id FROM sites WHERE id = ?', siteId))) throw new InventoryError('Site not found')
    if (!(await get('SELECT id FROM products WHERE id = ?', productId))) throw new InventoryError('Product not found')

    return await transaction(async () => {
      if (id) {
        const existing = await get<{ site_id: number; product_id: number }>(
          'SELECT site_id, product_id FROM site_materials WHERE id = ?',
          id,
        )
        if (!existing) throw new InventoryError('Allocation not found')
        const bundle = (await buildLedgers(await loadSiteMaterials({ smIds: [id] }))).get(id)
        const hasTxns = (bundle?.rows.length ?? 0) > 0
        if (hasTxns && (existing.site_id !== siteId || existing.product_id !== productId)) {
          throw new InventoryError(
            'Site and product cannot be changed once transactions exist for this Site Material ID',
          )
        }
        await run(
          `UPDATE site_materials SET site_id=?, product_id=?, boq_qty=?, opening_stock=?, min_stock=?, allocation_date=?, remarks=? WHERE id=?`,
          ...values,
          id,
        )
        await assertNonNegative([id])
        return id
      }
      return run(
        `INSERT INTO site_materials (site_id, product_id, boq_qty, opening_stock, min_stock, allocation_date, remarks) VALUES (?,?,?,?,?,?,?)`,
        ...values,
      )
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}

export async function saveSiteItem(body: Body) {
  try {
    const siteId = idValue(body, 'site_id', 'Site')
    const productId = optionalId(body, 'product_id')
    const allocationDate = dateValue(body, 'allocation_date', 'Allocation date') ?? ''
    const boqQty = quantity(body, 'boq_qty', 'BOQ quantity', { required: false })
    const openingStock = quantity(body, 'opening_stock', 'Opening stock', { required: false })
    const minStock = quantity(body, 'min_stock', 'Minimum stock', { required: false })
    const remarks = text(body, 'remarks', 'Remarks', false, 1000)
    if (!(await get('SELECT id FROM sites WHERE id = ?', siteId))) throw new InventoryError('Site not found')

    return await transaction(async () => {
      let linkedProductId = productId
      if (linkedProductId) {
        if (!(await get('SELECT id FROM products WHERE id = ?', linkedProductId))) {
          throw new InventoryError('Item not found')
        }
      } else {
        const productName = text(body, 'product_name', 'Item name', true, 160)
        const unit = text(body, 'unit', 'Unit', true, 20)
        const productCode =
          text(body, 'product_code', 'Item code', false, 40) ||
          (await generateCode('products', 'product_code', 'ITM'))
        linkedProductId = await run(
          `INSERT INTO products (product_code, product_name, category, description, unit, brand, model, min_stock)
           VALUES (?,?,?,?,?,?,?,?)`,
          productCode,
          productName,
          text(body, 'category', 'Category', false, 80),
          text(body, 'description', 'Description', false, 1000),
          unit,
          text(body, 'brand', 'Brand', false, 80),
          text(body, 'model', 'Model', false, 80),
          minStock,
        )
      }

      return run(
        `INSERT INTO site_materials (site_id, product_id, boq_qty, opening_stock, min_stock, allocation_date, remarks)
         VALUES (?,?,?,?,?,?,?)`,
        siteId,
        linkedProductId,
        boqQty,
        openingStock,
        minStock,
        allocationDate,
        remarks,
      )
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}

export function deleteAllocations(ids: number[]) {
  return removeMany(ids, async (id) => {
    const sm = (await loadSiteMaterials({ smIds: [id] }))[0]
    if (!sm) return
    const movements = await get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM site_material_movements WHERE site_id=? AND product_id=?',
      sm.site_id,
      sm.product_id,
    )
    if (movements?.n) throw new InventoryError('This site item has material movement history and cannot be removed')
    const affectedIds = await deleteSiteMaterialHistory([id])
    await assertNonNegative(affectedIds)
    await run('DELETE FROM site_materials WHERE id = ?', id)
    await removeOrphanProducts([sm.product_id])
  })
}

/* ------------------------------------------------------------------ */
/* Inward / outward transactions                                       */
/* ------------------------------------------------------------------ */

export interface TxnFilter {
  siteId?: number | null
  productId?: number | null
  from?: string | null
  to?: string | null
}

export async function listTxns(kind: 'inward' | 'outward', filter: TxnFilter = {}): Promise<TxnRow[]> {
  const table = kind === 'inward' ? 'material_inward' : 'material_outward'
  const party = kind === 'inward' ? 't.supplier' : 't.issued_to'
  const person = kind === 'inward' ? 't.received_by' : 't.issued_by'
  const purpose = kind === 'inward' ? "''" : 't.purpose'
  const where: string[] = []
  const params: unknown[] = []
  if (filter.siteId) {
    where.push('sm.site_id = ?')
    params.push(filter.siteId)
  }
  if (filter.productId) {
    where.push('sm.product_id = ?')
    params.push(filter.productId)
  }
  if (filter.from) {
    where.push('t.txn_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('t.txn_date <= ?')
    params.push(filter.to)
  }
  const rows = await all<Omit<TxnRow, 'sm_code' | 'transfer_code'> & { transfer_id: number | null }>(
    `SELECT t.id, t.txn_date AS date, sm.id AS sm_id, sm.site_id, s.site_name, sm.product_id,
            p.product_code, p.product_name, p.unit, t.quantity, t.challan_no, t.remarks, t.transfer_id,
            ${party} AS party, ${person} AS person, ${purpose} AS purpose
       FROM ${table} t
       JOIN site_materials sm ON sm.id = t.site_material_id
       JOIN sites s ON s.id = sm.site_id
       JOIN products p ON p.id = sm.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.txn_date DESC, t.id DESC`,
    ...params,
  )
  return rows.map(({ transfer_id, ...r }) => ({
    ...r,
    sm_code: smCode(r.sm_id),
    transfer_code: transfer_id ? transferCode(transfer_id) : '',
  }))
}

/** Finds an item by name (case-insensitive). Stock IN creates unknown items automatically. */
async function resolveProductId(body: Body, createIfMissing: boolean) {
  const name = text(body, 'item_name', 'Item name', false, 160)
  if (!name) return idValue(body, 'product_id', 'Item')
  const found = await get<{ id: number }>('SELECT id FROM products WHERE lower(product_name) = lower(?)', name)
  if (found) return found.id
  if (!createIfMissing) throw new InventoryError(`"${name}" has no stock at the selected site`)
  const unit = text(body, 'unit', 'Unit', true, 20)
  return run(
    'INSERT INTO products (product_code, product_name, unit) VALUES (?,?,?)',
    await generateCode('products', 'product_code', 'ITM'),
    name,
    unit,
  )
}

/** Links an item to a site the first time it is received there, so no manual allocation step is needed. */
async function resolveSiteMaterial(siteId: number, productId: number, kind: 'inward' | 'outward', date: string) {
  const found = await findSiteMaterial(siteId, productId)
  if (found) return found.id
  if (kind === 'outward') throw new InventoryError('This item has no stock at the selected site')
  if (!(await get('SELECT id FROM sites WHERE id = ?', siteId))) throw new InventoryError('Site not found')
  return run('INSERT INTO site_materials (site_id, product_id, allocation_date) VALUES (?,?,?)', siteId, productId, date)
}

/** Drops an automatic site/item link once its last transaction is gone. */
async function pruneEmptyLink(smId: number) {
  await run(
    `DELETE FROM site_materials
      WHERE id = ? AND opening_stock = 0 AND boq_qty = 0
        AND NOT EXISTS (SELECT 1 FROM material_inward WHERE site_material_id = ?)
        AND NOT EXISTS (SELECT 1 FROM material_outward WHERE site_material_id = ?)
        AND NOT EXISTS (SELECT 1 FROM material_transfers WHERE from_site_material_id = ? OR to_site_material_id = ?)`,
    smId,
    smId,
    smId,
    smId,
    smId,
  )
}

async function saveTxn(kind: 'inward' | 'outward', body: Body) {
  try {
    const id = optionalId(body, 'id')
    const date = dateValue(body, 'date', 'Date')
    const siteId = idValue(body, 'site_id', 'Site')
    const qty = quantity(body, 'quantity', kind === 'inward' ? 'Received quantity' : 'Issued quantity', {
      positive: true,
    })
    const challan = text(body, 'challan_no', 'Challan number', false, 60)
    const remarks = text(body, 'remarks', 'Remarks', false, 1000)
    const table = kind === 'inward' ? 'material_inward' : 'material_outward'

    const fields =
      kind === 'inward'
        ? [text(body, 'party', 'Received from', false, 160), text(body, 'person', 'Received by', false, 120), '']
        : [
            text(body, 'party', 'Issued to', false, 160),
            text(body, 'person', 'Issued by', true, 120),
            text(body, 'purpose', 'Purpose', false, 300),
          ]

    return await transaction(async () => {
      const productId = await resolveProductId(body, kind === 'inward')
      const smId = await resolveSiteMaterial(siteId, productId, kind, date ?? '')
      const affected = [smId]
      if (id) {
        const existing = await get<{ site_material_id: number; transfer_id: number | null }>(
          `SELECT site_material_id, transfer_id FROM ${table} WHERE id = ?`,
          id,
        )
        if (!existing) throw new InventoryError('Transaction not found')
        if (existing.transfer_id) {
          throw new InventoryError('This entry belongs to a transfer. Manage it from Material Transfer.')
        }
        affected.push(existing.site_material_id)
        if (kind === 'inward') {
          await run(
            `UPDATE material_inward SET site_material_id=?, txn_date=?, quantity=?, supplier=?, challan_no=?, received_by=?, remarks=? WHERE id=?`,
            smId, date, qty, fields[0], challan, fields[1], remarks, id,
          )
        } else {
          await run(
            `UPDATE material_outward SET site_material_id=?, txn_date=?, quantity=?, issued_to=?, issued_by=?, purpose=?, challan_no=?, remarks=? WHERE id=?`,
            smId, date, qty, fields[0], fields[1], fields[2], challan, remarks, id,
          )
        }
        await assertNonNegative(affected)
        if (existing.site_material_id !== smId) await pruneEmptyLink(existing.site_material_id)
        return id
      }
      const newId =
        kind === 'inward'
          ? await run(
              `INSERT INTO material_inward (site_material_id, txn_date, quantity, supplier, challan_no, received_by, remarks) VALUES (?,?,?,?,?,?,?)`,
              smId, date, qty, fields[0], challan, fields[1], remarks,
            )
          : await run(
              `INSERT INTO material_outward (site_material_id, txn_date, quantity, issued_to, issued_by, purpose, challan_no, remarks) VALUES (?,?,?,?,?,?,?,?)`,
              smId, date, qty, fields[0], fields[1], fields[2], challan, remarks,
            )
      await assertNonNegative(affected)
      return newId
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}

export const saveInward = (body: Body) => saveTxn('inward', body)
export const saveOutward = (body: Body) => saveTxn('outward', body)

export function deleteTxns(kind: 'inward' | 'outward', ids: number[]) {
  const table = kind === 'inward' ? 'material_inward' : 'material_outward'
  return removeMany(ids, async (id) => {
    const existing = await get<{ site_material_id: number; transfer_id: number | null }>(
      `SELECT site_material_id, transfer_id FROM ${table} WHERE id = ?`,
      id,
    )
    if (!existing) return
    if (existing.transfer_id) {
      throw new InventoryError(
        `Entry #${id} belongs to ${transferCode(existing.transfer_id)}. Delete the transfer instead.`,
      )
    }
    await run(`DELETE FROM ${table} WHERE id = ?`, id)
    await assertNonNegative([existing.site_material_id])
    await pruneEmptyLink(existing.site_material_id)
  })
}

/* ------------------------------------------------------------------ */
/* Transfers                                                           */
/* ------------------------------------------------------------------ */

export async function listTransfers(filter: TxnFilter = {}): Promise<TransferRow[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.siteId) {
    where.push('(fsm.site_id = ? OR tsm.site_id = ?)')
    params.push(filter.siteId, filter.siteId)
  }
  if (filter.from) {
    where.push('t.transfer_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('t.transfer_date <= ?')
    params.push(filter.to)
  }
  const rows = await all<Omit<TransferRow, 'transfer_code' | 'from_sm_code' | 'to_sm_code'> & { from_sm: number; to_sm: number }>(
    `SELECT t.id, t.transfer_date AS date, fsm.id AS from_sm, tsm.id AS to_sm,
            fsm.site_id AS from_site_id, fs.site_name AS from_site,
            tsm.site_id AS to_site_id, ts.site_name AS to_site,
            p.id AS product_id, p.product_code, p.product_name, p.unit,
            t.quantity, t.reference_no, t.approved_by, t.remarks
       FROM material_transfers t
       JOIN site_materials fsm ON fsm.id = t.from_site_material_id
       JOIN site_materials tsm ON tsm.id = t.to_site_material_id
       JOIN sites fs ON fs.id = fsm.site_id
       JOIN sites ts ON ts.id = tsm.site_id
       JOIN products p ON p.id = fsm.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.transfer_date DESC, t.id DESC`,
    ...params,
  )
  return rows.map(({ from_sm, to_sm, ...r }) => ({
    ...r,
    transfer_code: transferCode(r.id),
    from_sm_code: smCode(from_sm),
    to_sm_code: smCode(to_sm),
  }))
}

export async function saveTransfer(body: Body) {
  try {
    if (optionalId(body, 'id')) {
      throw new InventoryError('Transfers cannot be edited. Delete the transfer and create a new one.')
    }
    const date = dateValue(body, 'date', 'Date')
    const fromSiteId = idValue(body, 'from_site_id', 'From site')
    const toSiteId = idValue(body, 'to_site_id', 'To site')
    const productId = idValue(body, 'product_id', 'Product')
    const qty = quantity(body, 'quantity', 'Transfer quantity', { positive: true })
    const reference = text(body, 'reference_no', 'Reference number', false, 60)
    const approvedBy = text(body, 'approved_by', 'Approved by', true, 120)
    const remarks = text(body, 'remarks', 'Remarks', false, 1000)
    if (fromSiteId === toSiteId) throw new InventoryError('Source and destination sites must be different')

    return await transaction(async () => {
      const fromSm = await requireAllocation(fromSiteId, productId, 'the source site')
      const toSm = await requireAllocation(toSiteId, productId, 'the destination site')
      const transferId = await run(
        `INSERT INTO material_transfers (transfer_date, from_site_material_id, to_site_material_id, quantity, reference_no, approved_by, remarks) VALUES (?,?,?,?,?,?,?)`,
        date, fromSm, toSm, qty, reference, approvedBy, remarks,
      )
      await run(
        `INSERT INTO material_outward (site_material_id, txn_date, quantity, issued_by, challan_no, remarks, transfer_id) VALUES (?,?,?,?,?,?,?)`,
        fromSm, date, qty, approvedBy, reference, remarks, transferId,
      )
      await run(
        `INSERT INTO material_inward (site_material_id, txn_date, quantity, received_by, challan_no, remarks, transfer_id) VALUES (?,?,?,?,?,?,?)`,
        toSm, date, qty, approvedBy, reference, remarks, transferId,
      )
      await assertNonNegative([fromSm, toSm])
      return transferId
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}

export function deleteTransfers(ids: number[]) {
  return removeMany(ids, async (id) => {
    const t = await get<{ from_site_material_id: number; to_site_material_id: number }>(
      'SELECT from_site_material_id, to_site_material_id FROM material_transfers WHERE id = ?',
      id,
    )
    if (!t) return
    // Linked inward/outward rows are removed by ON DELETE CASCADE.
    await run('DELETE FROM material_transfers WHERE id = ?', id)
    await assertNonNegative([t.from_site_material_id, t.to_site_material_id])
  })
}

/* ------------------------------------------------------------------ */
/* Site-wise Central Store movements                                   */
/* ------------------------------------------------------------------ */

export async function saveCentralOpening(body: Body) {
  try {
    const siteId = idValue(body, 'site_id', 'Site')
    const productId = idValue(body, 'product_id', 'Item')
    const opening = quantity(body, 'opening_qty', 'Central Store opening quantity')
    if (!(await get('SELECT id FROM sites WHERE id = ?', siteId))) throw new InventoryError('Site not found')
    if (!(await get('SELECT id FROM products WHERE id = ?', productId))) throw new InventoryError('Item not found')
    return transaction(async () => {
      const centralId = await run(
        `INSERT INTO site_central_stock (site_id, product_id, opening_qty) VALUES (?,?,?)
         ON CONFLICT (site_id, product_id) DO UPDATE SET opening_qty=EXCLUDED.opening_qty`,
        siteId,
        productId,
        opening,
      )
      const existing = await get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM site_material_movements WHERE site_id=? AND product_id=?',
        siteId,
        productId,
      )
      if (existing?.n) throw new InventoryError('Opening stock cannot be changed after movements are recorded')
      return centralId
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}

export async function siteMovementSummary(filter: TxnFilter = {}): Promise<SiteMovementSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.siteId) { where.push('cs.site_id=?'); params.push(filter.siteId) }
  if (filter.productId) { where.push('cs.product_id=?'); params.push(filter.productId) }
  const stock = await stockRows({ siteId: filter.siteId, productId: filter.productId })
  const siteBalances = new Map(stock.map((row) => [`${row.site_id}:${row.product_id}`, row.available]))
  const rows = await all<SiteMovementSummary>(
    `SELECT cs.site_id, s.site_name, cs.product_id, p.product_code, p.product_name, p.unit,
            cs.opening_qty AS central_opening,
            ROUND((cs.opening_qty - COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='ISSUE'),0)
              + COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='RETURN'),0))::numeric, 3)::float8 AS central_available,
            COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='ISSUE'
              AND (? IS NULL OR m.movement_date >= ?) AND (? IS NULL OR m.movement_date <= ?)),0)::float8 AS total_issued,
            COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='RETURN'
              AND (? IS NULL OR m.movement_date >= ?) AND (? IS NULL OR m.movement_date <= ?)),0)::float8 AS total_returned,
            (COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='ISSUE'
              AND (? IS NULL OR m.movement_date >= ?) AND (? IS NULL OR m.movement_date <= ?)),0)
              - COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type='RETURN'
              AND (? IS NULL OR m.movement_date >= ?) AND (? IS NULL OR m.movement_date <= ?)),0))::float8 AS consumed,
            0::float8 AS site_available
       FROM site_central_stock cs
       JOIN sites s ON s.id=cs.site_id JOIN products p ON p.id=cs.product_id
       LEFT JOIN site_material_movements m ON m.site_id=cs.site_id AND m.product_id=cs.product_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY cs.site_id, s.site_name, cs.product_id, p.product_code, p.product_name, p.unit, cs.opening_qty
       ORDER BY s.site_name, p.product_name`,
    ...Array.from({ length: 16 }, (_, index) => index % 4 < 2 ? filter.from ?? null : filter.to ?? null), ...params,
  )
  return rows.map((row) => ({ ...row, site_available: siteBalances.get(`${row.site_id}:${row.product_id}`) ?? 0 }))
}

export async function siteMovementRows(filter: TxnFilter = {}): Promise<SiteMovementRow[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.siteId) { where.push('m.site_id=?'); params.push(filter.siteId) }
  if (filter.productId) { where.push('m.product_id=?'); params.push(filter.productId) }
  if (filter.from) { where.push('m.movement_date>=?'); params.push(filter.from) }
  if (filter.to) { where.push('m.movement_date<=?'); params.push(filter.to) }
  return all<SiteMovementRow>(
    `SELECT m.id, m.site_id, s.site_name, m.product_id, p.product_code, p.product_name, p.unit,
            m.movement_type, m.quantity, m.movement_date AS date, m.challan_no, m.issue_id,
            i.movement_date AS issue_date, i.challan_no AS issue_challan_no, m.remarks
       FROM site_material_movements m
       JOIN sites s ON s.id=m.site_id JOIN products p ON p.id=m.product_id
       LEFT JOIN site_material_movements i ON i.id=m.issue_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY m.movement_date DESC, m.id DESC`,
    ...params,
  )
}

export async function availableSiteIssues(siteId?: number | null, productId?: number | null) {
  const rows = await all<{
    id: number; site_id: number; product_id: number; date: string; challan_no: string
    site_name: string; product_name: string; unit: string; issued: number; returned: number
  }>(
    `SELECT i.id, i.site_id, i.product_id, i.movement_date AS date, i.challan_no,
            s.site_name, p.product_name, p.unit, i.quantity::float8 AS issued,
            COALESCE(SUM(r.quantity),0)::float8 AS returned
       FROM site_material_movements i
       JOIN sites s ON s.id=i.site_id JOIN products p ON p.id=i.product_id
       LEFT JOIN site_material_movements r ON r.issue_id=i.id AND r.movement_type='RETURN'
      WHERE i.movement_type='ISSUE' AND (? IS NULL OR i.site_id=?) AND (? IS NULL OR i.product_id=?)
      GROUP BY i.id, s.site_name, p.product_name, p.unit
      HAVING i.quantity > COALESCE(SUM(r.quantity),0)
      ORDER BY i.movement_date DESC, i.id DESC`,
    siteId ?? null, siteId ?? null, productId ?? null, productId ?? null,
  )
  return rows.map((row) => ({ ...row, remaining: round3(row.issued - row.returned) }))
}

async function assertCentralNonNegative(siteId: number, productId: number, opening: number) {
  const rows = await all<{ id: number; movement_date: string; movement_type: 'ISSUE' | 'RETURN'; quantity: number }>(
    `SELECT id, movement_date, movement_type, quantity FROM site_material_movements
      WHERE site_id=? AND product_id=? ORDER BY movement_date, CASE movement_type WHEN 'ISSUE' THEN 0 ELSE 1 END, id`,
    siteId,
    productId,
  )
  let balance = opening
  for (const row of rows) {
    balance = round3(balance + (row.movement_type === 'RETURN' ? row.quantity : -row.quantity))
    if (balance < 0) {
      throw new InventoryError(`Not allowed: this site's Central Store would have negative stock (${balance}) on ${row.movement_date}.`)
    }
  }
}

export async function saveSiteMovement(body: Body) {
  try {
    const kind = text(body, 'movement_type', 'Movement type', true, 10)
    if (kind !== 'ISSUE' && kind !== 'RETURN') throw new InventoryError('Invalid movement type')
    const siteId = idValue(body, 'site_id', 'Site')
    const productId = idValue(body, 'product_id', 'Item')
    const date = dateValue(body, 'date', 'Issue / return date') as string
    const qty = quantity(body, 'quantity', 'Quantity', { positive: true })
    const challan = text(body, 'challan_no', 'Challan number', true, 60)
    const remarks = text(body, 'remarks', 'Remarks', false, 1000)
    if (!(await get('SELECT id FROM sites WHERE id=?', siteId))) throw new InventoryError('Site not found')
    if (!(await get('SELECT id FROM products WHERE id=?', productId))) throw new InventoryError('Item not found')
    return await transaction(async () => {
      const central = await get<{ id: number; opening_qty: number }>(
        `INSERT INTO site_central_stock (site_id, product_id, opening_qty) VALUES (?,?,0)
         ON CONFLICT (site_id, product_id) DO UPDATE SET site_id=EXCLUDED.site_id
         RETURNING id, opening_qty`, siteId, productId,
      )
      await get('SELECT id FROM site_central_stock WHERE id=? FOR UPDATE', central?.id)
      const smId = await resolveSiteMaterial(siteId, productId, kind === 'ISSUE' ? 'inward' : 'outward', date)
      let issueId: number | null = null
      if (kind === 'ISSUE') {
        const totals = await get<{ issued: number; returned: number }>(
          `SELECT COALESCE(SUM(quantity) FILTER (WHERE movement_type='ISSUE'),0)::float8 AS issued,
                  COALESCE(SUM(quantity) FILTER (WHERE movement_type='RETURN'),0)::float8 AS returned
             FROM site_material_movements WHERE site_id=? AND product_id=?`, siteId, productId,
        )
        const available = round3((central?.opening_qty ?? 0) - (totals?.issued ?? 0) + (totals?.returned ?? 0))
        if (qty > available) throw new InventoryError(`Only ${available} ${((await get<{ unit: string }>('SELECT unit FROM products WHERE id=?', productId))?.unit ?? '')} is available in this site's Central Store.`)
      } else {
        issueId = idValue(body, 'issue_id', 'Original issue')
        const issue = await get<{ quantity: number; site_id: number; product_id: number; movement_date: string }>(
          `SELECT quantity, site_id, product_id, movement_date FROM site_material_movements WHERE id=? AND movement_type='ISSUE' FOR UPDATE`, issueId,
        )
        if (!issue || issue.site_id !== siteId || issue.product_id !== productId) {
          throw new InventoryError('The selected issue does not belong to this site and item')
        }
        if (date < issue.movement_date) throw new InventoryError('Return date cannot be before the original issue date')
        const returned = await get<{ total: number }>(
          `SELECT COALESCE(SUM(quantity),0)::float8 AS total FROM site_material_movements WHERE issue_id=? AND movement_type='RETURN'`, issueId,
        )
        if (round3((returned?.total ?? 0) + qty) > issue.quantity) {
          throw new InventoryError(`Return quantity exceeds the unreturned ${round3(issue.quantity - (returned?.total ?? 0))} remaining on the original issue`)
        }
      }
      const movementId = await run(
        `INSERT INTO site_material_movements (site_id, product_id, movement_type, quantity, movement_date, challan_no, issue_id, remarks)
         VALUES (?,?,?,?,?,?,?,?)`, siteId, productId, kind, qty, date, challan, issueId, remarks,
      )
      await assertCentralNonNegative(siteId, productId, central?.opening_qty ?? 0)
      await assertNonNegative([smId])
      return movementId
    })
  } catch (error) {
    return friendlyDbError(error)
  }
}
