export type SiteStatus = 'Active' | 'On Hold' | 'Completed'

export interface Site {
  id: number
  site_name: string
  site_code: string
  client_name: string
  location: string
  start_date: string | null
  status: SiteStatus
  remarks: string
  product_count: number
}

export interface Product {
  id: number
  product_code: string
  product_name: string
  category: string
  description: string
  unit: string
  brand: string
  model: string
  min_stock: number
  site_count: number
}

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock'

/** One row per Site Material ID (site + product). Also used as the allocation record. */
export interface StockRow {
  id: number
  sm_code: string
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
  total_received: number
  total_issued: number
  available: number
  pending_boq: number
  status: StockStatus
  txn_count: number
}

export type LedgerType = 'Inward' | 'Outward' | 'Transfer In' | 'Transfer Out'

export interface LedgerRow {
  key: string
  sm_id: number
  sm_code: string
  site_id: number
  site_name: string
  product_id: number
  product_code: string
  product_name: string
  unit: string
  date: string
  type: LedgerType
  opening: number
  in_qty: number
  out_qty: number
  closing: number
  challan_no: string
  person: string
  party: string
  remarks: string
  transfer_code: string
}

export interface TxnRow {
  id: number
  date: string
  site_id: number
  site_name: string
  product_id: number
  product_code: string
  product_name: string
  unit: string
  sm_id: number
  sm_code: string
  quantity: number
  challan_no: string
  remarks: string
  transfer_code: string
  /** inward: supplier / outward: issued to */
  party: string
  /** inward: received by / outward: issued by */
  person: string
  purpose: string
}

export interface TransferRow {
  id: number
  transfer_code: string
  date: string
  from_site_id: number
  from_site: string
  to_site_id: number
  to_site: string
  product_id: number
  product_code: string
  product_name: string
  unit: string
  quantity: number
  reference_no: string
  approved_by: string
  remarks: string
  from_sm_code: string
  to_sm_code: string
}

export interface DashboardData {
  totals: {
    sites: number
    products: number
    boq: number
    received: number
    issued: number
    available: number
    pending: number
  }
  siteSummary: {
    site_id: number
    site_name: string
    site_code: string
    products: number
    boq: number
    received: number
    issued: number
    available: number
    pending: number
  }[]
  monthly: { month: string; inward: number; outward: number }[]
  recent: LedgerRow[]
  lowStock: StockRow[]
}

export interface ReportColumn {
  key: string
  header: string
  align?: 'left' | 'right'
}

export interface ReportData {
  title: string
  columns: ReportColumn[]
  rows: Record<string, string | number>[]
}

export interface DeleteResult {
  deleted: number
  errors: string[]
}
