'use client'

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export interface ExportColumn {
  header: string
  align?: 'left' | 'right'
}

export type ExportCell = string | number | null | undefined

const stamp = () => new Date().toISOString().slice(0, 10)

const fileName = (title: string, ext: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${stamp()}.${ext}`

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const csvCell = (value: ExportCell) => {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportTable(
  format: ExportFormat,
  title: string,
  columns: ExportColumn[],
  rows: ExportCell[][],
  subtitle?: string,
) {
  if (format === 'csv') {
    const lines = [columns.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => r.map(csvCell).join(','))]
    download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileName(title, 'csv'))
    return
  }

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(title.slice(0, 31) || 'Report')
    const header = sheet.addRow(columns.map((c) => c.header))
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B6B3A' } }
    })
    for (const row of rows) sheet.addRow(row.map((v) => v ?? ''))
    columns.forEach((c, i) => {
      const longest = Math.max(c.header.length, ...rows.map((r) => String(r[i] ?? '').length))
      sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 48)
      if (c.align === 'right') sheet.getColumn(i + 1).alignment = { horizontal: 'right' }
    })
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    const buffer = await workbook.xlsx.writeBuffer()
    download(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      fileName(title, 'xlsx'),
    )
    return
  }

  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(title, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(`${subtitle ? `${subtitle}  |  ` : ''}Generated ${stamp()}`, 40, 56)
  autoTable(doc, {
    startY: 68,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v)))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [11, 107, 58] },
    alternateRowStyles: { fillColor: [240, 248, 242] },
    columnStyles: Object.fromEntries(
      columns.map((c, i) => [i, c.align === 'right' ? { halign: 'right' as const } : {}]),
    ),
    margin: { left: 40, right: 40 },
  })
  doc.save(fileName(title, 'pdf'))
}
