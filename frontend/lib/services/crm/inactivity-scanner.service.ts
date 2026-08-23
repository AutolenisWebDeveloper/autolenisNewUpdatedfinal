// Inactivity scanner — internal Vercel-Cron substrate (migrated off the retired
// Inngest `inactivityScannerFn`). Hourly it finds early-stage contacts whose
// `updated_at` is older than the inactivity window and pushes each through the
// domain-event spine (`emitDomainEvent('buyer_inactive', …)`), exactly as the
// Inngest function did. The spine's forward-only lifecycle advance moves the
// contact to 'inactive', so it falls out of EARLY_STAGES and is never re-emitted
// on the next run — that stage advance IS the idempotency guard, unchanged by the
// transport swap.
//
// No `inngest.send` fan-out lived in the original function body, so there is no
// delay/retry/dedup event to reproduce: this is a pure 1:1 substrate move. Per
// contact isolation is preserved (one contact's emit failure never blocks the
// batch). The scan is bounded to SCAN_LIMIT per run to cap per-tick cost.

import { logger } from "@/lib/logger";
import { getServiceSupabase } from "@/lib/supabase-service";
import { emitDomainEvent } from "@/lib/events/emit";
import type { ContactSource } from "@/lib/types/crm";

const EARLY_STAGES = ["lead", "prequal_started", "prequal_completed", "deposit_pending"];
const INACTIVITY_WINDOW_HOURS = 72;
const SCAN_LIMIT = 500;

export interface InactivityScanResult {
  status: "OK" | "NO_STALE_CONTACTS";
  scanned: number;
  emitted: number;
}

export async function scanInactiveContacts(): Promise<InactivityScanResult> {
  const supabase = getServiceSupabase();
  const cutoff = new Date(Date.now() - INACTIVITY_WINDOW_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, phone, first_name, last_name, source")
    .in("lifecycle_stage", EARLY_STAGES)
    .lt("updated_at", cutoff)
    .is("deleted_at", null)
    .eq("do_not_contact", false)
    .limit(SCAN_LIMIT);

  // A query failure is a real run failure — surface it so withCronRun records the
  // cron FAILED (and the route returns 500), matching the Inngest retry posture.
  if (error) throw new Error(`inactivity_scan_query_failed: ${error.message}`);

  const stale = data ?? [];
  if (stale.length === 0) return { status: "NO_STALE_CONTACTS", scanned: 0, emitted: 0 };

  let emitted = 0;
  for (const row of stale) {
    const email = (row.email as string | null) ?? null;
    const phone = (row.phone as string | null) ?? null;
    // emitDomainEvent resolves the contact by email→phone; a row with neither
    // can't be re-resolved without minting a duplicate, and can't be messaged
    // anyway, so skip it.
    if (!email && !phone) continue;
    try {
      await emitDomainEvent("buyer_inactive", {
        domainEntityId: row.id as string,
        supabase,
        contact: {
          email,
          phone,
          firstName: (row.first_name as string | null) ?? undefined,
          lastName: (row.last_name as string | null) ?? undefined,
          // Ignored on update (existing contact); never overwrites the original
          // source. Only used on the impossible insert path.
          source: (row.source as ContactSource | null) ?? "import",
        },
        data: { source: "inactivity_scanner", scanned_at: new Date().toISOString() },
      });
      emitted++;
    } catch (err) {
      // One contact's failure must not block the rest of the batch.
      logger.error("[inactivity-scanner] emit failed", row.id, err);
    }
  }

  return { status: "OK", scanned: stale.length, emitted };
}
