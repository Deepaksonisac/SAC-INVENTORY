// Usage: node scripts/import-stock.mjs [path-to-xlsx]
// Loads the "Site Consumable Material Dispatch & Receipt" tracker into the inventory database.
// Each RECEIVED row becomes a Stock IN entry on its received date; rows still pending receipt are skipped.
import { readFileSync } from 'node:fs'
import { read, utils } from 'xlsx'
import { all, get, run, transaction } from '../lib/db.ts'

const file = process.argv[2] ?? 'data/111-f75687.xlsx'
const workbook = read(readFileSync(file), { cellDates: true })
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = utils.sheet_to_json(sheet, { header: 1, defval: '' })

const headerIndex = rows.findIndex((r) => String(r[1]).toLowerCase().startsWith('site'))
if (headerIndex < 0) throw new Error('Could not find the header row')

const UNIT_ALIASES = {
  mtr: 'Mtr',
  mtrs: 'Mtr',
  meter: 'Mtr',
  meters: 'Mtr',
  rm: 'Mtr',
  pkt: 'Pkt',
  packet: 'Pkt',
  packets: 'Pkt',
  roll: 'Roll',
  rolls: 'Roll',
  nos: 'Nos',
  pcs: 'Pcs',
}
const normalizeUnit = (raw) => UNIT_ALIASES[String(raw).trim().toLowerCase()] ?? String(raw).trim()
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const toNumber = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')) || 0)
const toDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : clean(v))
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)

const nextCode = async (table, column, prefix) => {
  let n = ((await get(`SELECT MAX(id) AS m FROM ${table}`))?.m ?? 0) + 1
  let code
  do {
    code = `${prefix}-${String(n).padStart(3, '0')}`
    n += 1
  } while (await get(`SELECT 1 FROM ${table} WHERE ${column} = ?`, code))
  return code
}

const siteIds = new Map()
const productIds = new Map()
const links = new Map()
const summary = { inward: 0, skippedPending: 0, sites: new Set(), items: new Set() }

await transaction(async () => {
  for (const r of rows.slice(headerIndex + 1)) {
    const siteName = clean(r[1])
    const itemName = clean(r[2])
    if (!siteName || !itemName) continue

    const received = toNumber(r[8])
    const receivedDate = toDate(r[7])
    if (!(received > 0) || !isDate(receivedDate)) {
      summary.skippedPending += 1
      continue
    }

    const siteKey = siteName.toLowerCase()
    if (!siteIds.has(siteKey)) {
      const existing = await get('SELECT id FROM sites WHERE lower(site_name) = ?', siteKey)
      siteIds.set(
        siteKey,
        existing?.id ??
          await run(
            `INSERT INTO sites (site_name, site_code, status) VALUES (?,?, 'Active')`,
            siteName,
            await nextCode('sites', 'site_code', 'SITE'),
          ),
      )
    }

    const itemKey = itemName.toLowerCase()
    if (!productIds.has(itemKey)) {
      const existing = await get('SELECT id FROM products WHERE lower(product_name) = ?', itemKey)
      productIds.set(
        itemKey,
        existing?.id ??
          await run(
            'INSERT INTO products (product_code, product_name, unit) VALUES (?,?,?)',
            await nextCode('products', 'product_code', 'ITM'),
            itemName,
            normalizeUnit(r[3]) || 'Nos',
          ),
      )
    }

    const siteId = siteIds.get(siteKey)
    const productId = productIds.get(itemKey)
    const linkKey = `${siteId}:${productId}`
    const boq = toNumber(r[4])
    if (!links.has(linkKey)) {
      const existing = await get('SELECT id FROM site_materials WHERE site_id = ? AND product_id = ?', siteId, productId)
      links.set(
        linkKey,
        existing?.id ??
          await run(
            'INSERT INTO site_materials (site_id, product_id, boq_qty, allocation_date) VALUES (?,?,?,?)',
            siteId,
            productId,
            boq,
            receivedDate,
          ),
      )
    }
    const smId = links.get(linkKey)
    await run('UPDATE site_materials SET boq_qty = GREATEST(boq_qty, ?) WHERE id = ?', boq, smId)

    await run(
      'INSERT INTO material_inward (site_material_id, txn_date, quantity, challan_no, remarks) VALUES (?,?,?,?,?)',
      smId,
      receivedDate,
      received,
      clean(r[11]),
      clean(r[12]),
    )
    summary.inward += 1
    summary.sites.add(siteName)
    summary.items.add(itemKey)
  }
})

console.log(
  `Imported ${summary.inward} Stock IN entries across ${summary.sites.size} sites and ${summary.items.size} items.`,
)
console.log(`Skipped ${summary.skippedPending} rows that are still pending receipt.`)
console.log(
  await all(
    `SELECT s.site_name, COUNT(DISTINCT sm.product_id) AS items, ROUND(SUM(i.quantity)) AS received
       FROM material_inward i
       JOIN site_materials sm ON sm.id = i.site_material_id
       JOIN sites s ON s.id = sm.site_id
      GROUP BY s.id, s.site_name ORDER BY s.site_name`,
  ),
)
process.exit(0)
