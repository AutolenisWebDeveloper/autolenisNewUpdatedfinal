// Block A / A2 — canonical dealer identity primitives.
//
// The ONE place dealership matching keys are computed. Both the rooftop resolver
// and Y1's hasContactedDuplicate consume these, so the funnel has a single
// matching strategy (not a second algorithm). Reuses the existing phone
// normalizer (lib/utils/phone) and owns website + name normalization.

import { normalizePhone } from "@/lib/utils/phone";

// Strip protocol, leading www., path, query/fragment, trailing slash; lowercase.
// Returns a bare host, or null when nothing usable remains. (Lifted from Y1's
// prospect-email-enrichment so there is one domain normalizer, not two.)
export function normalizeWebsiteHost(website?: string | null): string | null {
  if (!website) return null;
  let h = website.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/^www\./, "");
  h = h.split("/")[0];
  h = h.split("?")[0].split("#")[0];
  h = h.replace(/\/+$/, "");
  return h || null;
}

// Trailing legal-entity suffixes to drop (whole trailing tokens only). Kept
// deliberately conservative — we strip corporate-form noise, never descriptive
// words like "motors"/"automotive"/"group" (over-stripping would collapse
// distinct dealerships).
const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "corp",
  "corporation",
  "co",
  "ltd",
]);

// Canonicalize a dealership name: lowercase, drop apostrophes, fold all other
// punctuation to spaces, collapse whitespace, then strip trailing legal suffixes.
export function normalizeDealerName(name?: string | null): string | null {
  if (!name) return null;
  let s = name
    .toLowerCase()
    .replace(/['’]/g, "") // O'Reilly -> oreilly
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return null;
  let tokens = s.split(" ");
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  s = tokens.join(" ");
  return s || null;
}

export function nameZipKey(name?: string | null, zip?: string | null): string | null {
  const n = normalizeDealerName(name);
  const z = (zip ?? "").trim();
  if (!n || !z) return null;
  return `${n}|${z}`;
}

export function nameCityStateKey(
  name?: string | null,
  city?: string | null,
  state?: string | null,
): string | null {
  const n = normalizeDealerName(name);
  const c = (city ?? "").trim().toLowerCase();
  const st = (state ?? "").trim().toLowerCase();
  if (!n || !c || !st) return null;
  return `${n}|${c}|${st}`;
}

export function phoneKey(phone?: string | null): string | null {
  const p = normalizePhone(phone);
  return p ? p : null;
}

export interface DealerIdentityInput {
  name?: string | null;
  website?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
}

export interface DealerIdentityKeys {
  host: string | null;
  nameZip: string | null;
  nameCityState: string | null;
  phone: string | null;
}

export function dealerIdentityKeys(input: DealerIdentityInput): DealerIdentityKeys {
  return {
    host: normalizeWebsiteHost(input.website),
    nameZip: nameZipKey(input.name, input.zip),
    nameCityState: nameCityStateKey(input.name, input.city, input.state),
    phone: phoneKey(input.phone),
  };
}

// Two candidates are the same dealership if ANY non-null key matches. Null keys
// never match (so two sparse candidates don't collapse on absent data).
export function identitiesMatch(a: DealerIdentityKeys, b: DealerIdentityKeys): boolean {
  return (
    (!!a.host && a.host === b.host) ||
    (!!a.nameZip && a.nameZip === b.nameZip) ||
    (!!a.nameCityState && a.nameCityState === b.nameCityState) ||
    (!!a.phone && a.phone === b.phone)
  );
}
