import { parseSheetItems, type ParsedSheet, type PdfItem } from './sheetParse'

/**
 * קורא קובץ PDF של תעודת ציונים בתוך הדפדפן (בלי לשלוח אותו לשום מקום).
 * pdf.js נטען רק כשמעלים קובץ; ה-worker מוטמע בקובץ ה-HTML ונפתח מ-Blob, כך שזה עובד גם מ-file://
 */
export async function readSheetPdf(file: File): Promise<ParsedSheet> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }))
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const items: PdfItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    for (const it of content.items) {
      if (!('str' in it)) continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p })
    }
  }
  await doc.destroy()
  const parsed = parseSheetItems(items)
  parsed.sheet.file = file.name
  parsed.sheet.loadedAt = new Date().toISOString()
  return parsed
}
