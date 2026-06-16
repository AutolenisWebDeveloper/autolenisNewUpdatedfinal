// ---------------------------------------------------------------------------
// CONTACT INTEREST TAGS (Layer 5 — Vehicle & Finance segments) — pure, no I/O
// ---------------------------------------------------------------------------
// Projects vehicle/finance interest onto the CRM contact's `tags` array from a
// domain event + its payload, so the seeded Vehicle (SUV/Truck/EV/Luxury/Family)
// and Finance (Refinance/Trade-In/Financing/Lease) segments (migration 12) can
// target it via has_tag rules. Tags are multi-valued by design — one buyer can
// be SUV + Family + financing at once. Pure + deterministic so the mapping is
// unit-testable without touching the DB.
//
// Tag namespace: `vehicle:<class>` and `finance:<kind>`.

import type { WorkflowTriggerType } from '@/lib/types/crm';

// Makes whose requests imply a luxury interest (lowercased match).
const LUXURY_MAKES = new Set([
  'bmw', 'mercedes', 'mercedes-benz', 'audi', 'lexus', 'porsche', 'jaguar',
  'land rover', 'range rover', 'cadillac', 'infiniti', 'acura', 'genesis',
  'maserati', 'bentley', 'volvo', 'lincoln', 'alfa romeo', 'tesla',
]);

// Makes that are EV-only / EV-first.
const EV_MAKES = new Set(['tesla', 'rivian', 'lucid', 'polestar']);

// Model-name fragments that signal an EV regardless of make.
const EV_MODEL_HINTS = [
  'model 3', 'model y', 'model s', 'model x', 'mach-e', 'mache', 'ioniq',
  'id.4', 'id4', 'bolt', 'leaf', 'ev6', 'niro ev', 'e-tron', 'etron', 'lyriq',
  'blazer ev', 'equinox ev', 'lightning', 'prologue', 'solterra', 'bz4x',
  'ariya', 'electric', ' ev',
];

// Budget at/above which a vehicle request implies a luxury interest.
const LUXURY_BUDGET_MIN = 55_000;

function lc(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

// Parse a free-text budget ("$55,000", "50000-60000", "$60k") to its largest
// dollar figure. Returns 0 when nothing parseable is present.
export function parseBudgetMax(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const hasK = /k/i.test(raw);
  const nums = raw
    .replace(/,/g, '')
    .match(/\d+(?:\.\d+)?/g);
  if (!nums) return 0;
  const values = nums
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .map((n) => (hasK && n < 1000 ? n * 1000 : n));
  return values.length ? Math.max(...values) : 0;
}

// Compute the interest tags for a domain event. Events that carry no
// vehicle/finance signal return an empty array.
export function interestTagsForEvent(
  event: WorkflowTriggerType,
  data: Record<string, unknown>,
): string[] {
  const tags = new Set<string>();

  // Finance interest keyed off the event type.
  if (event === 'refinance_inquiry') tags.add('finance:refinance');
  if (event === 'trade_in_submitted') tags.add('finance:trade_in');
  if (event === 'calculator_completed') tags.add('finance:financing');

  if (event === 'vehicle_request_submitted') {
    // Vehicle class from the requested body type.
    const type = lc(data.vehicle_type);
    if (type === 'suv') {
      tags.add('vehicle:suv');
      tags.add('vehicle:family');
    } else if (type === 'truck') {
      tags.add('vehicle:truck');
    } else if (type === 'van') {
      tags.add('vehicle:family');
    }

    // EV / luxury from make+model and budget.
    const make = lc(data.make);
    const model = lc(data.model);
    if (make && EV_MAKES.has(make)) tags.add('vehicle:ev');
    if (model && EV_MODEL_HINTS.some((h) => model.includes(h))) tags.add('vehicle:ev');
    if (make && LUXURY_MAKES.has(make)) tags.add('vehicle:luxury');
    if (parseBudgetMax(data.budget) >= LUXURY_BUDGET_MIN) tags.add('vehicle:luxury');

    // Finance interest from the request's financing path.
    const fin = lc(data.financing_option);
    if (fin === 'need_financing') tags.add('finance:financing');
    if (fin === 'lease' || lc(data.payment_method) === 'lease') tags.add('finance:lease');
  }

  return [...tags];
}
