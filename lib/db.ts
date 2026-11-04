import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool, types, type PoolClient } from 'pg'

// COUNT(*) and other bigint results come back as strings by default; the app expects numbers.
types.setTypeParser(20, (value) => Number.parseInt(value, 10))

type SqlValue = string | number | null

const globalForDb = globalThis as unknown as { __inventoryPool?: Pool }

function getPool(): Pool {
  if (globalForDb.__inventoryPool) return globalForDb.__inventoryPool
  const created = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  globalForDb.__inventoryPool = created
  return created
}

/** Shared by the inventory queries and Better Auth so there is a single connection pool. */
export const pool = getPool()

const txClient = new AsyncLocalStorage<PoolClient>()

const clean = (params: unknown[]): SqlValue[] =>
  params.map((p) => (p === undefined || p === null ? null : (p as SqlValue)))

/** Converts SQLite-style `?` placeholders into Postgres `$1, $2, ...`. */
const toPg = (sql: string) => {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = txClient.getStore() ?? getPool()
  const result = await client.query(toPg(sql), clean(params))
  return result.rows as T[]
}

export function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return query<T>(sql, params)
}

export async function get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const rows = await query<T>(sql, params)
  return rows[0]
}

/** Executes a write. For INSERTs the new row id is returned. */
export async function run(sql: string, ...params: unknown[]): Promise<number> {
  const isInsert = /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)
  const rows = await query<{ id: number }>(isInsert ? `${sql} RETURNING id` : sql, params)
  return Number(rows[0]?.id ?? 0)
}

/** Runs fn atomically. Any thrown error rolls the whole operation back. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txClient.getStore()) return fn()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await txClient.run(client, fn)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
