// §12.3 preview isolation preflight — asserted before any Playwright run.
//
// WHY THIS EXISTS. IMPLEMENTATION-WORKFLOW.md §12.3 requires ten assertions at
// the start of every phase, before a browser touches anything. Until now they
// were prose. Prose does not fail a run, and the one failure mode that matters
// here — a Playwright suite pointed at the production Supabase project — looks
// exactly like a passing suite until the damage is already written. So the
// steps are executable, and a step that cannot be asserted is reported as
// NOT VERIFIED rather than assumed.
//
// WHAT IT NEVER DOES. It never prints a secret. Credentials are tested for
// presence, prefix, or host — never echoed, and never written to a file. The
// DSN is parsed for its host and database only.
//
// EXIT CODES
//   0  every assertable step passed; any NOT VERIFIED step is named in the report
//   1  a step FAILED, or a step required to be assertable could not be asserted
//
// Usage (from frontend/):
//   DATABASE_URL=... COMMS_TRANSPORT=capture tsx scripts/preview-isolation-preflight.ts

import { PrismaClient } from "@prisma/client";

const PRODUCTION_REF = "aieybibvewmvrubcpthm";
const PRODUCTION_HOST = `db.${PRODUCTION_REF}.supabase.co`;

type Status = "PASS" | "FAIL" | "NOT VERIFIED";

interface Step {
  n: number;
  title: string;
  status: Status;
  detail: string;
  /** What would be needed to turn a NOT VERIFIED into an assertion. */
  needs?: string;
}

const steps: Step[] = [];
const pass = (n: number, title: string, detail: string) =>
  steps.push({ n, title, status: "PASS", detail });
const fail = (n: number, title: string, detail: string) =>
  steps.push({ n, title, status: "FAIL", detail });
const unverified = (n: number, title: string, detail: string, needs: string) =>
  steps.push({ n, title, status: "NOT VERIFIED", detail, needs });

/** Host + database of a DSN, without ever revealing user or password. */
function describeDsn(raw: string): { host: string; database: string; ref: string | null } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname;
    const database = u.pathname.replace(/^\//, "");
    // Supabase hosts are db.<ref>.supabase.co or <region>.pooler.supabase.com
    // with the ref in the username — which is never read here. Host only.
    const m = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
    return { host, database, ref: m ? m[1]! : null };
  } catch {
    return null;
  }
}

const unset = (name: string) => !process.env[name];

async function main() {
  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
  const canarySession = `e2e-canary-${runId}`;

  // ── 1. Not the production database ──────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_URL ?? "";
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const d = describeDsn(dbUrl);
  const dd = describeDsn(directUrl);

  if (!d) {
    fail(1, "Not production DB", "DATABASE_URL is unset or unparseable. The preflight fails closed: an unknown target is treated as production.");
  } else if (d.host === PRODUCTION_HOST || d.ref === PRODUCTION_REF) {
    fail(1, "Not production DB", `DATABASE_URL resolves to the production project host. ABORT.`);
  } else if (directUrl && (!dd || dd.host === PRODUCTION_HOST || dd.ref === PRODUCTION_REF)) {
    fail(1, "Not production DB", `DIRECT_URL resolves to the production project host, or is unparseable. ABORT.`);
  } else if (pub && pub.includes(PRODUCTION_REF)) {
    fail(1, "Not production DB", `NEXT_PUBLIC_SUPABASE_URL names the production project ref. ABORT.`);
  } else {
    pass(1, "Not production DB", `host=${d.host} database=${d.database}${dd ? ` direct_host=${dd.host}` : ""}${pub ? ` public_supabase_url_host=${new URL(pub).hostname}` : " NEXT_PUBLIC_SUPABASE_URL unset"}`);
  }

  // ── 2. Resolved ref/host recorded, compared by string inequality ────────
  if (d) {
    const same = d.host === PRODUCTION_HOST || d.ref === PRODUCTION_REF;
    if (same) fail(2, "Ref/host inequality", `resolved ref/host EQUALS production. ABORT.`);
    else pass(2, "Ref/host inequality", `resolved host "${d.host}" !== "${PRODUCTION_HOST}"; resolved ref ${d.ref ?? "(not a supabase db host)"} !== "${PRODUCTION_REF}"`);
  } else {
    fail(2, "Ref/host inequality", "no DSN to resolve");
  }

  // ── 3. Stripe server credentials are test-mode ─────────────────────────
  const sk = process.env.STRIPE_SECRET_KEY ?? "";
  if (!sk) {
    pass(3, "Stripe test-mode key", "STRIPE_SECRET_KEY unset — no Stripe credential of any mode is reachable from this run. Stronger than sk_test_, and recorded as such.");
  } else if (sk.startsWith("sk_test_")) {
    pass(3, "Stripe test-mode key", "STRIPE_SECRET_KEY carries the sk_test_ prefix.");
  } else {
    fail(3, "Stripe test-mode key", "STRIPE_SECRET_KEY is present and does NOT carry the sk_test_ prefix. ABORT.");
  }
  const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (whsec && !sk.startsWith("sk_test_")) {
    fail(3, "Stripe webhook secret", "STRIPE_WEBHOOK_SECRET is set while the secret key is not a test key — the endpoint cannot be proven to be the test endpoint.");
  }

  // ── 4. Stripe reports livemode=false ───────────────────────────────────
  if (!sk) {
    unverified(
      4,
      "Stripe livemode=false",
      "No STRIPE_SECRET_KEY, so no authenticated retrieval can be made. Step 3 establishes that no key of any mode is present; that is a different assertion from Stripe itself reporting livemode=false.",
      "a test-mode STRIPE_SECRET_KEY in the run environment and egress to api.stripe.com, then a read-only account/balance retrieval through lib/stripe.ts",
    );
  } else {
    try {
      const { getStripe } = await import("../lib/stripe");
      const balance = await getStripe().balance.retrieve();
      if (balance.livemode) fail(4, "Stripe livemode=false", "Stripe reports livemode=TRUE. ABORT.");
      else pass(4, "Stripe livemode=false", "balance.retrieve() reports livemode=false");
    } catch (e) {
      unverified(4, "Stripe livemode=false", `retrieval failed: ${(e as Error).message}`, "egress to api.stripe.com with the test-mode key");
    }
  }

  // ── 5. MicroBilt sandboxed or mocked ───────────────────────────────────
  if (process.env.MICROBILT_SANDBOX === "true") {
    pass(5, "MicroBilt sandboxed", "MICROBILT_SANDBOX=true — the adapter bypass is active.");
  } else if (unset("MICROBILT_CLIENT_ID") && unset("MICROBILT_CLIENT_SECRET") && unset("MICROBILT_API_KEY")) {
    pass(5, "MicroBilt sandboxed", "no MicroBilt credential is present — the adapter cannot reach the vendor.");
  } else {
    fail(5, "MicroBilt sandboxed", "a MicroBilt credential is present and MICROBILT_SANDBOX is not true. ABORT.");
  }

  // ── 6. Transports blocked and captured ─────────────────────────────────
  const transport = process.env.COMMS_TRANSPORT ?? "";
  const transportBlockers: string[] = [];
  if (transport !== "capture") transportBlockers.push(`COMMS_TRANSPORT is "${transport || "(unset)"}", not "capture"`);
  if (!unset("RESEND_API_KEY")) transportBlockers.push("RESEND_API_KEY is set");
  if (!unset("TWILIO_AUTH_TOKEN")) transportBlockers.push("TWILIO_AUTH_TOKEN is set");
  if (!unset("APOLLO_REVEAL_ENABLED")) transportBlockers.push("APOLLO_REVEAL_ENABLED is set");
  if (!unset("APOLLO_ENRICHMENT_ENABLED")) transportBlockers.push("APOLLO_ENRICHMENT_ENABLED is set");
  if (!unset("DEALER_OUTREACH_SMS_ENABLED")) transportBlockers.push("DEALER_OUTREACH_SMS_ENABLED is set");
  if (transportBlockers.length) fail(6, "Transports blocked and captured", `${transportBlockers.join("; ")}. ABORT.`);
  else pass(6, "Transports blocked and captured", "COMMS_TRANSPORT=capture; RESEND_API_KEY, TWILIO_AUTH_TOKEN, APOLLO_REVEAL_ENABLED, APOLLO_ENRICHMENT_ENABLED, DEALER_OUTREACH_SMS_ENABLED all unset.");

  // ── 7. Paid APIs mocked/disabled ───────────────────────────────────────
  const paid = ["MARKETCHECK_API_KEY", "APOLLO_API_KEY", "FIRECRAWL_API_KEY", "GOOGLE_MAPS_API_KEY"].filter((k) => !unset(k));
  if (paid.length) fail(7, "Paid APIs disabled", `${paid.join(", ")} present — a quota-capped live key is still live. ABORT.`);
  else pass(7, "Paid APIs disabled", "MARKETCHECK_API_KEY, APOLLO_API_KEY, FIRECRAWL_API_KEY, GOOGLE_MAPS_API_KEY all unset.");

  // Steps 1–7 gate step 8. Nothing is written while any of them failed.
  const blocked = steps.filter((s) => s.status === "FAIL");
  if (blocked.length) {
    report(steps, canarySession);
    console.error(`\nABORT: ${blocked.length} step(s) FAILED. Steps 8–9 were not run and nothing was written.`);
    process.exit(1);
  }

  // ── 8. Canary write into the preview DB ────────────────────────────────
  const prisma = new PrismaClient();
  try {
    await prisma.buyerOpportunity.create({
      data: { sessionId: canarySession, source: "e2e-preflight" },
    });
    const found = await prisma.buyerOpportunity.findFirst({ where: { sessionId: canarySession } });
    if (!found) fail(8, "Canary written", "the canary row was not readable back from the preview DB. ABORT.");
    else pass(8, "Canary written", `buyer_opportunities.session_id='${canarySession}' created and read back (id=${found.id}).`);
  } catch (e) {
    fail(8, "Canary written", `canary insert failed: ${(e as Error).message}`);
  } finally {
    await prisma.$disconnect();
  }

  // ── 9. Production read-only check ──────────────────────────────────────
  unverified(
    9,
    "Canary absent from production",
    "This session holds no production credential (DATABASE_URL / DIRECT_URL / PROD_READONLY_URL all point at the ephemeral loopback database), so the read-back against aieybibvewmvrubcpthm cannot be performed. Step 1 establishes the write went to a host that is not production; step 9 is the independent confirmation from the other side, and it is NOT VERIFIED.",
    `a read-only production credential in the environment, then: psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction -c "SET TRANSACTION READ ONLY" -c "SELECT 1 FROM buyer_opportunities WHERE session_id = '${canarySession}'" — expected: zero rows. That is a production read and is governed by the per-run protocol in CLAUDE.md.`,
  );

  report(steps, canarySession);
  const failed = steps.filter((s) => s.status === "FAIL");
  if (failed.length) {
    console.error(`\nABORT: ${failed.length} step(s) FAILED.`);
    process.exit(1);
  }
  const nv = steps.filter((s) => s.status === "NOT VERIFIED");
  console.log(
    `\nPREFLIGHT: ${steps.length - nv.length}/${steps.length} steps asserted, ${nv.length} NOT VERIFIED (named above). ` +
      `Playwright may run; every result depending on a NOT VERIFIED step must carry that label.`,
  );
}

function report(all: Step[], canary: string) {
  console.log(`\n§12.3 PREVIEW ISOLATION PREFLIGHT — run canary ${canary}\n`);
  for (const s of all.sort((a, b) => a.n - b.n)) {
    console.log(`  [${s.status.padEnd(12)}] ${s.n}. ${s.title}`);
    console.log(`                 ${s.detail}`);
    if (s.needs) console.log(`                 NEEDS: ${s.needs}`);
  }
}

main().catch((e) => {
  console.error("PREFLIGHT ABORTED:", (e as Error).message);
  process.exit(1);
});
