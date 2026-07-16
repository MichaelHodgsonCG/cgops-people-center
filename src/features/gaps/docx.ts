// Word (.docx) export of gap reports. The docx library is dynamic-imported so
// it only loads when someone actually exports (keeps it out of the main bundle).

export interface GapDocRow {
  position_name: string
  required_count: number
  current: number
  gap: number
  names: string[]
}

export interface CompanyGapDocRow {
  location_name: string
  position_name: string
  gap: number
  reason: 'new-site' | 'backfill' | 'understaffed'
  detail: string
}

const REASON_TEXT: Record<CompanyGapDocRow['reason'], string> = {
  'new-site': 'New site',
  backfill: 'Backfill',
  understaffed: 'Understaffed',
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadCompanyGapDocx(opts: {
  rows: CompanyGapDocRow[]
  generatedOn: string
}): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = await import('docx')

  const cell = (text: string, opts2: { center?: boolean; bold?: boolean } = {}) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: opts2.center ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts2.bold })],
        }),
      ],
    })

  const header = new TableRow({
    tableHeader: true,
    children: [
      cell('Location', { bold: true }),
      cell('Role', { bold: true }),
      cell('Gap', { center: true, bold: true }),
      cell('Type', { bold: true }),
      cell('Detail', { bold: true }),
    ],
  })
  const dataRows = opts.rows.map(
    (r) =>
      new TableRow({
        children: [
          cell(r.location_name),
          cell(r.position_name),
          cell(String(r.gap), { center: true }),
          cell(REASON_TEXT[r.reason]),
          cell(r.detail || '—'),
        ],
      }),
  )

  const totalGap = opts.rows.reduce((s, r) => s + r.gap, 0)
  const byReason = opts.rows.reduce(
    (acc, r) => ((acc[r.reason] = (acc[r.reason] ?? 0) + r.gap), acc),
    {} as Record<string, number>,
  )

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Company-wide Leadership Gaps' }),
          new Paragraph({
            children: [
              new TextRun({ text: `Generated ${opts.generatedOn}`, color: '888888', size: 18 }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Total open roles: ${totalGap}  ·  New-site ${byReason['new-site'] ?? 0}  ·  Backfill ${byReason.backfill ?? 0}  ·  Understaffed ${byReason.understaffed ?? 0}`,
                bold: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [header, ...dataRows],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Backfill = an existing leader is slated to a new site, vacating their current seat. Management roster only. Plan leaders in Bench & Risk.',
                italics: true,
                color: '888888',
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  triggerDownload(await Packer.toBlob(doc), 'Company-wide Leadership Gaps.docx')
}

export async function downloadGapDocx(opts: {
  locationName: string
  upcoming: boolean
  rows: GapDocRow[]
  totals: { required: number; filled: number; gap: number }
  generatedOn: string
}): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = await import('docx')

  const currentLabel = opts.upcoming ? 'Slated' : 'In seat'

  const headerCell = (text: string, align: 'left' | 'center' = 'left') =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: true })],
        }),
      ],
    })

  const cell = (text: string, align: 'left' | 'center' = 'left', bold = false) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold })],
        }),
      ],
    })

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Role'),
      headerCell('Required', 'center'),
      headerCell(currentLabel, 'center'),
      headerCell('Gap', 'center'),
      headerCell(opts.upcoming ? 'Slated' : 'People'),
    ],
  })

  const dataRows = opts.rows.map(
    (r) =>
      new TableRow({
        children: [
          cell(r.position_name),
          cell(String(r.required_count), 'center'),
          cell(String(r.current), 'center'),
          cell(r.gap > 0 ? `short ${r.gap}` : 'OK', 'center'),
          cell(r.names.join(', ') || (opts.upcoming ? 'not yet named' : '—')),
        ],
      }),
  )

  const totalRow = new TableRow({
    children: [
      cell('Total', 'left', true),
      cell(String(opts.totals.required), 'center', true),
      cell(String(opts.totals.filled), 'center', true),
      cell(opts.totals.gap > 0 ? `short ${opts.totals.gap}` : 'fully staffed', 'center', true),
      cell(''),
    ],
  })

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: opts.locationName }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Leadership Gap Analysis — ${opts.upcoming ? 'Upcoming (slated)' : 'Open (in seat)'}`,
                italics: true,
                color: '888888',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Generated ${opts.generatedOn}`, color: '888888', size: 18 }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Required ${opts.totals.required} · ${currentLabel} ${opts.totals.filled} · Gap ${opts.totals.gap}`,
                bold: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...dataRows, totalRow],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Management roster only. Slated leadership is planned in Bench & Risk.',
                italics: true,
                color: '888888',
                size: 18,
              }),
            ],
          }),
        ],
      },
    ],
  })

  triggerDownload(await Packer.toBlob(doc), `${opts.locationName} - Gap Analysis.docx`)
}
