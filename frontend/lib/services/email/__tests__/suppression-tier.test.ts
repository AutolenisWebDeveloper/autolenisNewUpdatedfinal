// S3 decision 2 — transactional sends bypass the marketing/soft suppression tier
// but still honor HARD suppression. Tests isEmailHardSuppressed, the function
// emailSendFn calls for type:'transactional'. A fake supabase models the reason
// filter so the two required cases are asserted directly:
//   • a marketing-unsubscribed address is NOT hard-suppressed → deal email sends
//   • a hard-bounced address IS hard-suppressed → deal email is blocked
//
// Run with:
//   npx tsx --test lib/services/email/__tests__/suppression-tier.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { SuppressionService } from "@/lib/services/suppression.service";

// Minimal chainable fake of the supabase query builder that models a single
// email_suppression row {email, reason} and honors .in('reason', [...]).
function fakeSupabase(row: { email: string; reason: string } | null) {
  return {
    from(_table: string) {
      let reasonFilter: string[] | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: (_col: string, values: string[]) => {
          reasonFilter = values;
          return builder;
        },
        maybeSingle: async () => {
          if (!row) return { data: null };
          if (reasonFilter && !reasonFilter.includes(row.reason)) return { data: null };
          return { data: { id: "sup_1" } };
        },
      };
      return builder;
    },
  };
}

test("a hard-bounced address IS hard-suppressed (transactional deal email blocked)", async () => {
  const sb = fakeSupabase({ email: "b@x.com", reason: "bounced" });
  assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, "b@x.com"), true);
});

test("a complaint / spam-trap address is hard-suppressed", async () => {
  for (const reason of ["complained", "spam_trap"]) {
    const sb = fakeSupabase({ email: "h@x.com", reason });
    assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, "h@x.com"), true, reason);
  }
});

test("a marketing-unsubscribed address is NOT hard-suppressed (deal email still sends)", async () => {
  const sb = fakeSupabase({ email: "u@x.com", reason: "unsubscribed" });
  assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, "u@x.com"), false);
});

test("an admin_added (soft) address is NOT hard-suppressed", async () => {
  const sb = fakeSupabase({ email: "a@x.com", reason: "admin_added" });
  assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, "a@x.com"), false);
});

test("a non-suppressed address is not hard-suppressed", async () => {
  const sb = fakeSupabase(null);
  assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, "clean@x.com"), false);
});

test("an unparseable address fails closed (hard-suppressed)", async () => {
  const sb = fakeSupabase(null);
  assert.equal(await SuppressionService.isEmailHardSuppressed(sb as never, ""), true);
});

test("the hard-reason set matches the reasons that flag do_not_contact", () => {
  assert.deepEqual(
    [...SuppressionService.HARD_EMAIL_SUPPRESSION_REASONS].sort(),
    ["bounced", "complained", "spam_trap"].sort(),
  );
});

// ── suppressEmail no-downgrade guard (MEDIUM-2) ──────────────────────────────
// email_suppression holds ONE row per address, so a naive upsert lets a later
// SOFT reason overwrite an existing HARD reason — silently un-blocking
// transactional deal emails to a bounced address. Hard reasons must always win.

// Fake supabase for suppressEmail: models the existing email_suppression row's
// reason (via select().eq().maybeSingle()) and records whether the upsert (the
// write that would change the reason) actually fired. No contact row.
function suppressFake(existingReason: string | null) {
  const state = { upsertCalled: false, upsertPayload: null as Record<string, unknown> | null };
  const sb = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () => {
          if (table === "email_suppression") {
            return { data: existingReason ? { reason: existingReason } : null };
          }
          return { data: null }; // contacts lookup → no contact
        },
        upsert: async (payload: Record<string, unknown>) => {
          if (table === "email_suppression") {
            state.upsertCalled = true;
            state.upsertPayload = payload;
          }
          return { data: null, error: null };
        },
        update: () => builder,
        insert: async () => ({ data: null, error: null }),
      };
      return builder;
    },
  };
  return { sb, state };
}

test("a SOFT reason does NOT overwrite an existing HARD reason (no downgrade)", async () => {
  for (const existing of ["bounced", "complained", "spam_trap"]) {
    const { sb, state } = suppressFake(existing);
    await SuppressionService.suppressEmail(sb as never, "b@x.com", "unsubscribed");
    assert.equal(state.upsertCalled, false, `soft over ${existing} must be a no-op`);
  }
});

test("a SOFT reason DOES write when no hard reason is on file", async () => {
  const { sb, state } = suppressFake(null);
  await SuppressionService.suppressEmail(sb as never, "u@x.com", "unsubscribed");
  assert.equal(state.upsertCalled, true);
  assert.equal((state.upsertPayload as Record<string, unknown>).reason, "unsubscribed");
});

test("a SOFT reason DOES overwrite an existing SOFT reason", async () => {
  const { sb, state } = suppressFake("admin_added");
  await SuppressionService.suppressEmail(sb as never, "u@x.com", "unsubscribed");
  assert.equal(state.upsertCalled, true);
});

test("a HARD reason ALWAYS writes — even over an existing hard reason (upgrade/refresh)", async () => {
  const { sb, state } = suppressFake("bounced");
  await SuppressionService.suppressEmail(sb as never, "b@x.com", "complained");
  assert.equal(state.upsertCalled, true);
  assert.equal((state.upsertPayload as Record<string, unknown>).reason, "complained");
});

test("a HARD reason writes over an existing SOFT reason (upgrade)", async () => {
  const { sb, state } = suppressFake("unsubscribed");
  await SuppressionService.suppressEmail(sb as never, "b@x.com", "bounced");
  assert.equal(state.upsertCalled, true);
  assert.equal((state.upsertPayload as Record<string, unknown>).reason, "bounced");
});
