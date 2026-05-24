// Shared date-range parsing for admin report pages. Defaults to the last 30
// days when no range is supplied. Returns both Date bounds (for Prisma `where`)
// and the yyyy-mm-dd strings for prefilling the filter inputs.
export interface ReportRange {
  from: Date;
  to: Date;
  fromInput: string;
  toInput: string;
}

export function parseReportRange(sp: { from?: string; to?: string }): ReportRange {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000);

  const from = sp.from ? new Date(sp.from) : defaultFrom;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : now;

  return {
    from,
    to,
    fromInput: sp.from ?? defaultFrom.toISOString().slice(0, 10),
    toInput: sp.to ?? now.toISOString().slice(0, 10),
  };
}
