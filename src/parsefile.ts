import * as XLSX from 'xlsx';

/**
 * Convert an uploaded file (CSV or XLSX/XLS) into CSV text.
 * - CSV: returned as-is (decoded UTF-8).
 * - XLSX/XLS: first sheet is read and serialized to CSV.
 * Throws a clear Error if the file can't be parsed.
 */
/** Decode base64 text to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Streaming base64 decoder: Uint8Array (base64 text) -> Uint8Array (raw bytes).
 * Buffers partial 4-char groups across chunks and ignores whitespace/newlines,
 * so it can decode arbitrarily large uploads without buffering the whole file.
 */
export function base64DecodeStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  const emit = (b64: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!b64) return;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    controller.enqueue(out);
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // strip any whitespace/newlines the encoder or transport may have added
      const text = (carry + decoder.decode(chunk, { stream: true })).replace(/\s+/g, '');
      const usable = text.length - (text.length % 4);
      carry = text.slice(usable);
      emit(text.slice(0, usable), controller);
    },
    flush(controller) {
      const tail = (carry + decoder.decode()).replace(/\s+/g, '');
      emit(tail, controller);
      carry = '';
    },
  });
}

export async function fileToCsv(file: File): Promise<string> {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  let bytes: Uint8Array = new Uint8Array(buf);

  // Client base64-encodes uploads (name ends in .b64) so the request body is
  // only [A-Za-z0-9+/=] and never trips the Cloudflare WAF SQLi ruleset
  // (e.g. '--' in dirty date fields). Decode transparently before parsing.
  if (name.endsWith('.b64')) {
    try {
      bytes = base64ToBytes(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      throw new Error(`Could not decode upload: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
