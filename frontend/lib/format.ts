// lib/format.ts — the single source of truth for currency / number / date
// formatting across the four dashboards (Phase 2.2).
//
// Replaces ~8 divergent formatters and hundreds of inline `toLocaleString`
// call sites. Call-site migration is incremental and per-dashboard; this module
// is purely additive until adopted. All amounts on the platform are stored in
// integer CENTS — `formatCurrency` takes cents, never dollars.

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format an integer-cents amount as USD.
 * - default: whole dollars ("$1,234") — matches the dominant existing behavior
 *   (lib/utils.formatCents, lib/constants.formatCentsAsUsd for round amounts).
 * - { cents: true }: always two decimals ("$1,234.50") — for exact balances.
 */
export function formatCurrency(
  amountCents: number,
  opts: { cents?: boolean } = {},
): string {
  const dollars = amountCents / 100;
  return opts.cents ? USD_CENTS.format(dollars) : USD_WHOLE.format(dollars);
}

/** Locale-grouped integer/decimal number ("1,234", "12.5"). */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en-US", opts).format(n);
}

type DateInput = Date | string | number;

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date. Defaults to "Jan 5, 2026". Returns "—" for null/invalid input
 * so callers never render "Invalid Date".
 */
export function formatDate(
  value: DateInput | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (value == null) return "—";
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat("en-US", opts).format(d) : "—";
}

/** Compact relative time ("just now", "5m ago", "3d ago", else a date). */
export function formatRelative(value: DateInput | null | undefined, now: Date = new Date()): string {
  if (value == null) return "—";
  const d = toDate(value);
  if (!d) return "—";
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(d);
}
