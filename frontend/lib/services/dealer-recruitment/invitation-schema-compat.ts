// Physical-schema capability probe for `dealer_invitations`.
//
// WHY THIS EXISTS
// ---------------
// The Prisma model for DealerInvitation declares `tokenHash` and `consumedAt`,
// but the migration that adds those physical columns
// (prisma/migrations/20260828000000_dealer_invitation_token_hash) has NOT been
// applied to production. Prisma selects EVERY model scalar by default, so with
// the columns missing, any findUnique/findMany/create/update on the model fails
// at runtime (P2022) and the whole invite path — mint, list, resend, cancel,
// claim — is dead. `token` is additionally still NOT NULL there, so an insert
// that omits it violates the constraint.
//
// This module reads the ACTUAL columns from information_schema once per process
// and lets the invitation service pick a query shape the database can answer.
// It is a migration-window shim, not a permanent abstraction: once the migration
// is applied everywhere, the probe reports MODERN, the legacy branches go cold,
// and this file (plus the legacy branches) should be deleted.
//
// FAIL-SAFE DIRECTION. On any probe error we report the LEGACY shape, because
// legacy queries are valid against both physical schemas (they touch only
// columns that exist in either), whereas modern queries against the legacy
// schema are a hard failure. Degraded is survivable; crashed is not.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface InvitationSchemaCapabilities {
  /** `token_hash` exists — tokens can be stored and looked up hashed. */
  hasTokenHash: boolean;
  /** `consumed_at` exists — single use can be enforced on the timestamp. */
  hasConsumedAt: boolean;
  /** `token` exists at all (dropped by the follow-up migration). */
  hasToken: boolean;
  /** `token` exists AND is NOT NULL — every insert must supply a value. */
  tokenRequired: boolean;
}

/** What production looks like today, and the fail-safe answer. */
export const LEGACY_CAPABILITIES: InvitationSchemaCapabilities = Object.freeze({
  hasTokenHash: false,
  hasConsumedAt: false,
  hasToken: true,
  tokenRequired: true,
});

/** What the schema looks like after 20260828000000 is applied. */
export const MODERN_CAPABILITIES: InvitationSchemaCapabilities = Object.freeze({
  hasTokenHash: true,
  hasConsumedAt: true,
  hasToken: true,
  tokenRequired: false,
});

interface ColumnRow {
  column_name: string;
  is_nullable: string;
}

/**
 * Derive capabilities from raw information_schema rows. Pure — unit-testable
 * without a database, and the only place the mapping rules live.
 */
export function capabilitiesFromColumns(rows: ColumnRow[]): InvitationSchemaCapabilities {
  const nullability = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
  return {
    hasTokenHash: nullability.has("token_hash"),
    hasConsumedAt: nullability.has("consumed_at"),
    hasToken: nullability.has("token"),
    // Absent column => nothing to supply; present-and-NOT NULL => must supply.
    tokenRequired: nullability.get("token") === "NO",
  };
}

let cached: Promise<InvitationSchemaCapabilities> | null = null;
let warned = false;

async function probe(): Promise<InvitationSchemaCapabilities> {
  try {
    // to_regclass resolves through the connection's search_path, so this reads
    // the same physical table Prisma's own queries hit — a hardcoded schema name
    // would lie whenever the datasource URL carries a ?schema= override.
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT a.attname AS column_name,
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
        FROM pg_attribute a
       WHERE a.attrelid = to_regclass('dealer_invitations')
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND a.attname IN ('token', 'token_hash', 'consumed_at')
    `;
    const caps = capabilitiesFromColumns(rows ?? []);
    if (!caps.hasTokenHash && !warned) {
      warned = true;
      logger.warn(
        "[invitation-schema] dealer_invitations.token_hash is missing — running the legacy " +
          "plaintext-token path. Apply prisma/migrations/20260828000000_dealer_invitation_token_hash " +
          "to store invitation tokens hashed at rest.",
      );
    }
    return caps;
  } catch (err) {
    // Do not poison the cache: a transient failure must not pin the process to
    // LEGACY for its lifetime. The next call re-probes.
    cached = null;
    logger.error("[invitation-schema] capability probe failed — assuming legacy schema:", err);
    return LEGACY_CAPABILITIES;
  }
}

/** Cached per process. Never called at import time — the DB may not be reachable then. */
export async function getInvitationSchemaCapabilities(): Promise<InvitationSchemaCapabilities> {
  if (!cached) cached = probe();
  return cached;
}

/** Test seam: drop the cache, or pin a known shape without touching a database. */
export function __setInvitationSchemaCapabilities(
  caps: InvitationSchemaCapabilities | null,
): void {
  cached = caps ? Promise.resolve(caps) : null;
  warned = false;
}
