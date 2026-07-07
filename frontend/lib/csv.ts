// Client-safe CSV builder + download helper for admin table exports.
// Server routes with their own CSV formats (attribution, amips) keep theirs;
// this is the shared client-side path for "Export CSV" table actions.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** RFC 4180 quoting; prefixes =+-@ cells with ' to disarm spreadsheet formula injection. */
function csvCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

/** Triggers a browser download of `csv` as `filename` (client-only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
