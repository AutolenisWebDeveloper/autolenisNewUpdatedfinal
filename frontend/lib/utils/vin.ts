// lib/utils/vin.ts
// Server-side VIN validation.
//
// Modern VINs (post-1981) are exactly 17 characters, uppercase alphanumeric,
// excluding the letters I, O, and Q to avoid confusion with 1 and 0.
// Reference: ISO 3779.

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isValidVin(vin: string): boolean {
  return VIN_REGEX.test(vin.toUpperCase());
}

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase();
}
