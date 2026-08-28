// The ONE price convention for dealer CSV import.
//
// CONVENTION: a price column holds DOLLARS. "25000" means $25,000.00 and is
// stored as 2_500_000 cents. A column explicitly named price_cents/pricecents
// holds integer cents and is not scaled.
//
// This replaces a client-side magnitude heuristic that read "25000" as 25000
// cents ($250.00) whenever the value was >= 10000 and had no decimal point —
// while the server's raw-rows path parsed the same string as dollars. The two
// import paths therefore disagreed by 100x on ordinary car prices, and the
// upload preview showed the correct figure while the wrong one was persisted.
//
// A heuristic that silently divides a price by 100 is worse than a rejected row,
// so there is no heuristic: the caller states the unit, and anything unparseable
// returns null for the caller to surface as a row error.

/** Header names (lowercased, non-alphanumerics stripped) that mean integer cents. */
const CENTS_HEADERS = new Set(["pricecents", "pricecent", "amountcents"]);

/** Does this CSV header denote an already-in-cents column? */
export function isCentsHeader(header: string): boolean {
  return CENTS_HEADERS.has(String(header ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Parse a CSV price cell to integer cents.
 * @param raw           the cell as written ("25000", "$25,000", "25000.00")
 * @param isCentsColumn true when the source column is already integer cents
 * @returns integer cents, or null when the cell is not a usable positive price
 */
export function parseCsvPriceToCents(raw: string, isCentsColumn = false): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  // Reject a negative BEFORE stripping punctuation. Stripping first turns "-5"
  // into "5", which would silently flip the sign — the same class of silent
  // coercion this module exists to remove.
  if (/^[(-]/.test(text) || text.includes("-")) return null;

  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;

  // More than one decimal point is not a number we should guess at.
  if ((cleaned.match(/\./g) ?? []).length > 1) return null;

  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return isCentsColumn ? Math.round(num) : Math.round(num * 100);
}

/** Format integer cents back to a display string, for previews that must match the write. */
export function formatCentsAsUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
