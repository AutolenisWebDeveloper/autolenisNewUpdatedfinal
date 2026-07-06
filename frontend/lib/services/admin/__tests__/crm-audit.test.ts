// Durable-intent guard (T4 flag #4): CRM/AI audit rows MUST carry the invoking
// HUMAN admin's identity, never a service principal. This pins that contract so
// a future refactor can't silently start attributing copilot/AI actions to a
// system account.
//
// Run with: npx tsx --test lib/services/admin/__tests__/crm-audit.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { writeCrmAuditLog, type CrmAuditActor } from "../crm-audit";

// Minimal Supabase stub capturing the inserted row.
function stubSupabase() {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    client: {
      from(_table: string) {
        return {
          async insert(row: Record<string, unknown>) {
            inserts.push(row);
            return { error: null };
          },
        };
      },
    } as never,
  };
}

const HUMAN: CrmAuditActor = { adminId: "admin_human_1", adminEmail: "ops@autolenis.com" };

test("audit row is attributed to the human actor, not a service principal", async () => {
  const sb = stubSupabase();
  await writeCrmAuditLog(sb.client, HUMAN, {
    action: "CRM_COPILOT_GENERATE",
    entity_type: "contact",
    entity_id: "c1",
  });
  assert.equal(sb.inserts.length, 1);
  const row = sb.inserts[0];
  assert.equal(row.admin_id, "admin_human_1");
  assert.equal(row.admin_email, "ops@autolenis.com");
  // Guard against a service-principal regression.
  assert.notEqual(row.admin_id, "system");
  assert.notEqual(row.admin_email, "system@autolenis.com");
});

test("null actor writes nothing (system-initiated jobs are not mis-attributed)", async () => {
  const sb = stubSupabase();
  await writeCrmAuditLog(sb.client, null, { action: "X", entity_type: "y" });
  assert.equal(sb.inserts.length, 0);
});
