// Route contract for POST /api/buyer/financing/apply — RETIRED, answers 410 Gone.
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

test("POST answers 410 Gone", async () => {
  const res = await (await handler())();
  assert.equal(res.status, 410);
});

test("the 410 carries no response body", async () => {
  const res = await (await handler())();
  assert.equal(await res.text(), "", "nothing to echo a submitted value back in");
});

test("a legacy SSN payload is never read", async () => {
  const req = request(LEGACY_PAYLOAD);
  const res = await (await handler())(req);

  assert.equal(res.status, 410, "an SSN payload is refused, not processed");
  assert.equal(
    req.bodyUsed, false,
    "the body must never be consumed — an SSN that is not parsed cannot be buffered, " +
      "logged, attached to a Sentry breadcrumb, or echoed by a validation error",
  );
});

test("the answer does not depend on the caller — no session lookup, no 401 branch", async () => {
  // 410 describes the resource, not the actor. With no auth import there is no path
  // that could answer differently for an anonymous caller than for a signed-in one.
  const first = await (await handler())();
  const second = await (await handler())(request(LEGACY_PAYLOAD));
  assert.equal(first.status, 410);
  assert.equal(second.status, 410);
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
  assert.equal(res.status, 410);
  assert.equal(await res.text(), "", "no applicationId is ever returned");
});
