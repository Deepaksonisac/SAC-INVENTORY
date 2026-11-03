import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type SqlValue = string | number | null

const globalForDb = globalThis as unknown as { __siteStockDb?: DatabaseSync }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_name TEXT NOT NULL,
  site_code TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Completed')),
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per site + product = the Site Material ID. All stock logic keys off this id.
CREATE TABLE IF NOT EXISTS site_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  boq_qty REAL NOT NULL DEFAULT 0 CHECK (boq_qty >= 0),
  opening_stock REAL NOT NULL DEFAULT 0 CHECK (opening_stock >= 0),
  min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  allocation_date TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, product_id)
);

CREATE TABLE IF NOT EXISTS material_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_date TEXT NOT NULL,
  from_site_material_id INTEGER NOT NULL REFERENCES site_materials(id) ON DELETE RESTRICT,
  to_site_material_id INTEGER NOT NULL REFERENCES site_materials(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  reference_no TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_site_material_id <> to_site_material_id)
);

CREATE TABLE IF NOT EXISTS material_inward (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_material_id INTEGER NOT NULL REFERENCES site_materials(id) ON DELETE RESTRICT,
  txn_date TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  supplier TEXT NOT NULL DEFAULT '',
  challan_no TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  transfer_id INTEGER REFERENCES material_transfers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_outward (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_material_id INTEGER NOT NULL REFERENCES site_materials(id) ON DELETE RESTRICT,
  txn_date TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  issued_to TEXT NOT NULL DEFAULT '',
  issued_by TEXT NOT NULL DEFAULT '',
  challan_no TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  transfer_id INTEGER REFERENCES material_transfers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inward_sm ON material_inward(site_material_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_outward_sm ON material_outward(site_material_id, txn_date);
`

function resolveDbFile(): string {
  const candidates = [path.join(process.cwd(), 'data'), path.join(os.tmpdir(), 'sitestock')]
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      return path.join(dir, 'inventory.db')
    } catch {
      continue
    }
  }
  throw new Error('No writable location available for the inventory database')
}

export function getDb(): DatabaseSync {
  if (globalForDb.__siteStockDb) return globalForDb.__siteStockDb
  const db = new DatabaseSync(resolveDbFile())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  globalForDb.__siteStockDb = db
  return db
}

const clean = (params: unknown[]): SqlValue[] =>
  params.map((p) => (p === undefined || p === null ? null : (p as SqlValue)))

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...clean(params)) as T[]
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb()
    .prepare(sql)
    .get(...clean(params)) as T | undefined
}

export function run(sql: string, ...params: unknown[]): number {
  const result = getDb()
    .prepare(sql)
    .run(...clean(params))
  return Number(result.lastInsertRowid)
}

/** Runs fn atomically. Any thrown error rolls the whole operation back. */
export function transaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
