// lib/services/offer/offer-validation.service.ts
const APR_FLAG_THRESHOLD = 29.0;
const JUNK_FEE_KEYWORDS = ["nitrogen", "nitro tire", "vin etch", "paint protection", "ppf", "dealer prep", "advertising fee", "doc fee", "documentation fee"];

export interface OfferValidationResult { valid: boolean; aprFlag: string | null; junkFeeItems: string[]; warnings: string[] }

export function validateOffer(otdPriceCents: number, vehiclePriceCents: number, feesCents: number, aprRate?: number, junkFeeItems?: Array<{name: string; amount: number}>): OfferValidationResult {
  const warnings: string[] = [];
  const aprFlag = aprRate && aprRate > APR_FLAG_THRESHOLD ? "SUSPICIOUS_APR" : null;
  if (aprFlag) warnings.push(`APR of ${aprRate}% exceeds the ${APR_FLAG_THRESHOLD}% threshold`);

  const flaggedJunk: string[] = [];
  if (junkFeeItems) {
    for (const fee of junkFeeItems) {
      const isJunk = JUNK_FEE_KEYWORDS.some(kw => fee.name.toLowerCase().includes(kw));
      if (isJunk) { flaggedJunk.push(fee.name); warnings.push(`Possible junk fee: ${fee.name}`); }
    }
  }

  const calculatedOtd = vehiclePriceCents + feesCents;
  if (Math.abs(calculatedOtd - otdPriceCents) > 100) warnings.push("OTD price does not match vehicle price + fees");

  return { valid: warnings.filter(w => w.includes("exceeds") || w.includes("does not match")).length === 0, aprFlag, junkFeeItems: flaggedJunk, warnings };
}
