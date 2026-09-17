// §8.2 defect (6) — pickup notifications are keyed PER ROUND, not per deal.
//
// WHAT WENT WRONG. FOUR of the five outbox keys in `pickup-notifications.service.ts` appended
// `roundKey(p)`; the dealer confirmation key read `dealer-pickup-scheduled-${dealId}`.
//
// (Five, not six. The first draft of this test asserted six and its own anti-vacuity floor
// caught the miscount — which is the argument for putting a floor under a scan rather than
// trusting the number you remember.) The outbox
// dedup is `ON CONFLICT (dedup_key) DO NOTHING`, so once a deal had been confirmed ONCE the
// dealership could never receive a second "pickup confirmed" email — and §Stage 17 requires
// exactly that after a missed pickup returns the deal to a new proposal round (L920).
//
// §29 lists "Pickup emails dispatch durably with round-specific idempotency keys" among the
// safeguards that already held. It was true of four sends out of five, which is how a blanket
// claim survives: nobody checks the fifth.
//
// WHY THIS IS A SOURCE SCAN AND NOT FIVE ASSERTIONS. Five hand-written assertions protect the
// five keys that exist today and say nothing about the sixth. The defect was not "this key is
// wrong", it was "a key was added without the round and nothing noticed". A scan fails on the
// next one too.
//
// Run with:
//   npx tsx --test "lib/services/pickup/__tests__/pickup-notification-keys.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = join(process.cwd(), "lib", "services", "pickup", "pickup-notifications.service.ts");

test("every outbox idempotencyKey in the pickup rail is round-scoped", () => {
  const src = readFileSync(SERVICE, "utf8");

  // Only the keys handed to the dispatcher — the literal after `idempotencyKey:` on one line.
  const keys = [...src.matchAll(/idempotencyKey:\s*`([^`]+)`/g)].map((m) => m[1]!);

  // ANTI-VACUITY. A regex that matched nothing would make the loop below pass against a file
  // with every key per-deal — which is the exact shape of the defect this test exists for.
  assert.ok(
    keys.length >= 5,
    `found only ${keys.length} idempotency keys in pickup-notifications.service.ts — the scan is broken, not the file`,
  );

  const perDeal = keys.filter((k) => !k.includes("${roundKey(p)}"));
  assert.deepEqual(
    perDeal,
    [],
    `these pickup keys are not round-scoped: ${perDeal.join(", ")}. The outbox dedup is ` +
      `ON CONFLICT DO NOTHING, so a per-deal key means the SECOND round never notifies — and ` +
      `§Stage 17 L920 requires a notice on every new proposal round after a missed pickup.`,
  );
});

test("the round token comes from proposedAt, which the confirm CAS does not clear", () => {
  // The fix only works because `roundKey` still has something to read at the moment the
  // confirmation email is queued. The confirm compare-and-swap sets `status` and `scheduledAt`
  // and leaves `proposedAt` in place; if a future change cleared it there, every key would
  // collapse to the same `-0` suffix and the defect would be back with the fix still visible in
  // the source. This pins the reason, not just the result.
  const coord = readFileSync(
    join(process.cwd(), "lib", "services", "pickup", "pickup-coordination.service.ts"),
    "utf8",
  );
  const confirmSwap = coord.match(
    /status: PickupStatus\.PROPOSED, proposedAt: expectedProposedAt \},\s*data: \{([^}]*)\}/,
  );
  assert.ok(confirmSwap, "the confirm compare-and-swap could not be located — this scan is stale");
  assert.equal(
    confirmSwap[1]!.includes("proposedAt"),
    false,
    "the confirm CAS now writes proposedAt; roundKey reads it, so every round would share a key",
  );
});

test("roundKey is defined once and used, not reimplemented per call site", () => {
  const src = readFileSync(SERVICE, "utf8");
  const definitions = [...src.matchAll(/const roundKey\s*=/g)];
  assert.equal(definitions.length, 1, "roundKey must have exactly one definition");
  assert.ok(
    (src.match(/roundKey\(p\)/g) ?? []).length >= 5,
    "every send should use the shared roundKey rather than inlining proposedAt",
  );
});


// ── defect (6)'s second half: the in-app notice had no key at all ───────────────────────────

const rows: Array<Record<string, unknown>> = [];
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      notification: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const wanted = (where.metadata as { equals?: string } | undefined)?.equals;
          return rows.find((r) => (r.metadata as { idempotencyKey?: string })?.idempotencyKey === wanted) ?? null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); return data; },
      },
    },
  },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

test("a RETRIED confirmation does not notify the buyer twice", async () => {
  // The buyer's confirmation notice was `prisma.notification.create(...).catch(() => {})` with no
  // key. The confirmation side effects have a compensating retry path, so a transient failure
  // after the create left the buyer with the same notice twice.
  rows.length = 0;
  const { createNotificationOnce } = await import("../pickup-notifications.service");
  const key = "pickup-confirmed:deal_1:2026-02-10T18:00:00.000Z";

  assert.equal(await createNotificationOnce({ buyerId: "b1", type: "PICKUP_SCHEDULED", title: "t", body: "b", idempotencyKey: key }), true);
  assert.equal(await createNotificationOnce({ buyerId: "b1", type: "PICKUP_SCHEDULED", title: "t", body: "b", idempotencyKey: key }), false, "the retry must be a no-op");
  assert.equal(rows.length, 1, "exactly one in-app row for one confirmation");
});

test("a SECOND ROUND does notify again — the guard is per round, not per deal", async () => {
  // The mirror of the email fix. A guard keyed per DEAL would make this the same defect in the
  // in-app channel: after a missed pickup and a new proposal round, §Stage 17 requires a fresh
  // confirmation and the buyer would never see one.
  rows.length = 0;
  const { createNotificationOnce } = await import("../pickup-notifications.service");
  await createNotificationOnce({ buyerId: "b1", type: "PICKUP_SCHEDULED", title: "t", body: "b", idempotencyKey: "pickup-confirmed:deal_1:2026-02-10T18:00:00.000Z" });
  await createNotificationOnce({ buyerId: "b1", type: "PICKUP_SCHEDULED", title: "t", body: "b", idempotencyKey: "pickup-confirmed:deal_1:2026-03-01T09:00:00.000Z" });
  assert.equal(rows.length, 2, "a new round is a new notice");
});
