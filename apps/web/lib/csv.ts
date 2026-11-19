/** RFC 4180-CSV, met bescherming tegen formule-injectie in spreadsheets. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("; ") : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
