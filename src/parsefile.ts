import * as XLSX from 'xlsx';

/**
 * Convert an uploaded file (CSV or XLSX/XLS) into CSV text.
 * - CSV: returned as-is (decoded UTF-8).
 * - XLSX/XLS: first sheet is read and serialized to CSV.
 * Throws a clear Error if the file can't be parsed.
 */
export async function fileToCsv(file: File): Promise<string> {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const looksZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" -> xlsx (zip)
  const looksXls = name.endsWith('.xls') || name.endsWith('.xlsx');

  if (looksZip || looksXls) {
    try {
      const wb = XLSX.read(bytes, { type: 'array' });
      const first = wb.SheetNames[0];
      if (!first) throw new Error('workbook has no sheets');
      const sheet = wb.Sheets[first];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (!csv.trim()) throw new Error('sheet is empty');
      return csv;
    } catch (e) {
      throw new Error(`Could not read spreadsheet: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Treat as CSV/text.
  const text = new TextDecoder('utf-8').decode(bytes);
  // Guard: null bytes mean it was actually binary we didn't recognize.
  if (text.includes('\u0000')) {
    throw new Error('File appears to be binary and is not a CSV or supported spreadsheet.');
  }
  return text;
}
