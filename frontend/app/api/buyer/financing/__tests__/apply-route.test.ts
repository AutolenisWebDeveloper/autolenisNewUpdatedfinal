// Route contract for POST /api/buyer/financing/apply — RETIRED, answers 303 to the
// external-financing screen.
//
// PHASE 7 CHANGED THE STATUS UNDER A RULING (§8.2 Phase 7: "The Phase 0 410 handler becomes a
// redirect to the external-financing screen"). 410 was the right answer while there was nowhere to
// send anyone; §12's three paths are now real and reachable, so the route points at them.
//
// EVERY SECURITY ASSERTION BELOW IS UNCHANGED, because the status was never the control. The
// controls are: the handler accepts no parameter, it never reads a body, it returns no body, and
// it imports nothing. What the status change adds is one more: the redirect must be 303 See Other,
// which makes the client re-issue as GET and DROP the body. 307 and 308 preserve the method and
// body, so a client still POSTing an SSN payload would have the browser re-send it to the
// redirect target — the Phase 0 exposure, reopened through the redirect.
//
// This suite previously asserted the credit-application intake: auth, the
// PII-encryption fail-closed gate, deal ownership + FINANCING_PENDING, the prequal
// affordability cap, duplicate handling, and that a submitted SSN reached the
// encrypting service. That intake is gone, so those assertions are gone with it —
// what replaces them is the proof that the route now accepts nothing at all.
//
// The security invariant behind it (no transaction route collects an SSN) is
// enforced repo-wide in lib/security/__tests__/no-ssn-intake.test.ts.
//
// Run: pnpm test:financing-routes

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROUTE = "app/api/buyer/financing/apply/route.ts";

/** The exact shape the retired intake used to accept, SSN and all. */
const LEGACY_PAYLOAD = {
  dealId: "11111111-1111-1111-1111-111111111111",
  amountRequestedCents: 2_500_000,
  termMonths: 60,
  ssn: "123-45-6789",
  annualIncomeCents: 9_000_000,
  employment: "Acme",
};

async function handler(): Promise<(req?: Request) => Promise<Response>> {
  const mod = await import("@/app/api/buyer/financing/apply/route");
  // The handler declares no parameters; the cast lets a request be offered anyway,
  // which is the point of the "never reads the body" test below.
  return mod.POST as unknown as (req?: Request) => Promise<Response>;
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/buyer/financing/apply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

test("POST answers 303 See Other, pointing at the external-financing screen", async () => {
  const res = await (await handler())();
  assert.equal(res.status, 303, "303 makes the client re-issue as GET and drop the body");
  assert.equal(res.headers.get("location"), "/buyer/financing");
});

test("the redirect is NEVER 307 or 308 — those re-send the body", async () => {
  // The one assertion that is genuinely new in Phase 7, and the reason the redirect is safe.
  const res = await (await handler())();
  assert.notEqual(res.status, 307, "307 preserves the method AND the body");
  assert.notEqual(res.status, 308, "308 preserves the method AND the body");
});

test("the response carries no body", async () => {
  const res = await (await handler())();
  assert.equal(await res.text(), "", "nothing to echo a submitted value back in");
});

test("a legacy SSN payload is never read", async () => {
  const req = request(LEGACY_PAYLOAD);
  const res = await (await handler())(req);

  assert.equal(res.status, 303, "an SSN payload is redirected away, not processed");
  assert.equal(
    req.bodyUsed, false,
    "the body must never be consumed — an SSN that is not parsed cannot be buffered, " +
      "logged, attached to a Sentry breadcrumb, or echoed by a validation error",
  );
});

test("the answer does not depend on the caller — no session lookup, no 401 branch", async () => {
  // The answer describes the resource, not the actor. With no auth import there is no path
  // that could answer differently for an anonymous caller than for a signed-in one.
  const first = await (await handler())();
  const second = await (await handler())(request(LEGACY_PAYLOAD));
  assert.equal(first.status, 303);
  assert.equal(second.status, 303);
});

test("the route reaches no service, database, or encryption dependency", () => {
  const source = readFileSync(ROUTE, "utf8");
  // Import statements only — the header comment names these files while explaining
  // the retirement, and prose must not be mistaken for a dependency.
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

  assert.deepEqual(imports, ["next/server"], "the retired route depends on nothing else");
  for (const forbidden of [
    "@/lib/prisma",
    "@/lib/auth/api",
    "@/lib/security/field-encryption",
    // Deleted in Phase 7 — the file no longer exists, and the guard keeps naming it so a
    // restored copy cannot be imported here without failing.
    "@/lib/services/financing/credit-application.service",
    "@/lib/services/prequal/prequal.service",
    "zod",
  ]) {
    assert.equal(imports.includes(forbidden), false, `${forbidden} must no longer be imported`);
  }
});

test("no CreditApplication can be created through this route", async () => {
  // The service is unreachable from here (asserted above), so the strongest
  // behavioural statement is that a full, previously-valid submission produces a
  // refusal and no response payload that could carry an application id.
  const res = await (await handler())(request(LEGACY_PAYLOAD));
  assert.equal(res.status, 303);
  assert.equal(await res.text(), "", "no applicationId is ever returned");
});
