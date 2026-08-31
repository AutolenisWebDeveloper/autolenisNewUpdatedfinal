# Operational Apollo-Synced Dealer Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers-executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/admin/dealer-outreach` from a read-mostly prospect list that has never
sent a single outreach into a governed work queue that discovers dealership personnel
through Apollo People Search, enriches them under a hard credit cap, and drives
email/SMS outreach through one auditable log — every real spend and every real send
behind an owner-controlled flag that is OFF by default.

**Architecture:** Extend the three Apollo services that already ship
(`apollo.service.ts` adapter, `apollo-reveal.service.ts` orchestration,
`apollo-credit-ledger.service.ts` atomic ledger) rather than adding a second client.
`dealer_contact_profiles` becomes the canonical personnel store and
`dealer_outreach_log` the single source of outreach truth; the denormalised columns on
`dealer_prospects` stop being written and become derived on read. The queue UI reads a
new read-model service so the page never re-implements resolution logic.

**Tech Stack:** Next.js 16 App Router (RSC) · React 19 · TypeScript strict · Prisma 5 ·
Supabase Postgres · Apollo REST · Resend · Twilio · Playwright · `node:test` via tsx.

**Spec:** The owner task brief, reproduced with corrections in
`docs/superpowers/plans/2026-08-31-dealer-outreach-phase0-findings.md`.

## Global Constraints

- **App root is `frontend/`.** Every path below is relative to it unless stated.
- **No migration is applied in this PR.** Migrations are written to
  `prisma/migrations/<ts>_<name>/migration.sql` with a paired `rollback.sql`, and left
  for owner review alongside the existing unapplied chain.
- **Do NOT add RLS policies.** `dealer_outreach_log`, `dealer_rooftops`,
  `dealer_contact_profiles`, `dealer_intelligence`, `dealer_invitations` have RLS ON
  with zero policies — deny-all for anon/authenticated, bypass for service_role. Adding
  a policy OPENS access.
- **Do NOT drop** `dealer_prospects.contact_name/contact_title/contact_phone/
  contact_linkedin` or `contacted_at/replied_at/sequence_paused_at` in this PR.
- **Flags, all default OFF / closed:**
  `APOLLO_PEOPLE_SEARCH_ENABLED`, `APOLLO_ENRICHMENT_ENABLED`,
  `APOLLO_WATERFALL_ENABLED`, `DEALER_OUTREACH_SEND_ENABLED`,
  `DEALER_OUTREACH_SMS_ENABLED`. Absent env var == disabled.
- **`APOLLO_ENRICHMENT_MAX_CREDITS`** is the hard per-job cap, read from config, never
  hard-coded at a call site. No enrichment loop may run unbounded.
- **Waterfall is OFF by default.** `reveal_phone_number`/waterfall params are only ever
  sent when `APOLLO_WATERFALL_ENABLED === "true"`.
- **Money/credits are integers.** Credit arithmetic never uses floats.
- **`sms_suppression` is the canonical SMS suppression store.** `sms_opt_outs` /
  Prisma `SmsOptOut` has no reader and no writer anywhere in the repo (verified) — do
  NOT wire it back in; that was deliberately removed as F-014.
- **Every test is `node:test` via `tsx`**, registered in a `test:*` script in
  `package.json` so `pnpm test:coverage-check` can reach it, and appended to
  `test:all`.
- **Commit per task, with the TDD boundary visible in history** — the red commit (failing
  test) and the green commit (implementation) are separate, so the PR reads
  commit-by-commit rather than as one diff.
- **`consent_basis = NONE` always refuses SMS.** No combination of DNC-clear, phone-type
  allowed, suppression-clear or flag-enabled may override it. Dealer prospects are NONE
  today, so SMS correctly reaches zero of them — the intended outcome, not a bug to route
  around.
- **`phone_type` gates independently of DNC.** `mobile_phone` is blocked by default.
- **Never fabricate a contact.** Apollo returning nothing means the field stays NULL and
  contactability becomes `UNREACHABLE`.

---

## File Structure

**New files**

| Path | Responsibility |
| --- | --- |
| `lib/services/dealer-recruitment/apollo-people-search.service.ts` | Phase 1.2 — 0-credit People Search pagination + candidate persistence. No HTTP of its own; calls the adapter seam. |
| `lib/services/dealer-recruitment/apollo-org-match.service.ts` | Phase 1.3 — Apollo org → `dealer_rooftops` match using the existing key columns + normalizers; records method + confidence. |
| `lib/services/dealer-recruitment/apollo-enrichment-job.service.ts` | Phase 1.4 — preview + capped execution, per-person idempotency, staleness, persisted `ApolloEnrichmentRun`. |
| `lib/services/dealer-recruitment/dealer-outreach-log.service.ts` | Phase 2 — the ONE unconditional log writer + derived-read helpers. |
| `lib/services/dealer-recruitment/dealer-prospect-status.service.ts` | Phase 2 — status machine: legal transitions, `dead_reason` requirement. |
| `lib/services/dealer-recruitment/dealer-sms-send.service.ts` | Phase 3 — dealer SMS through the existing Twilio client, DNC + suppression + quiet hours at send time. |
| `lib/services/dealer-recruitment/outreach-queue.service.ts` | Phase 5 — the queue read-model (contactability, DNC, last touch, next step). |
| `scripts/backfill-rooftop-geo.ts` | Phase 4 — owner-run geo backfill. Never auto-executed. |
| `app/admin/dealer-outreach/queue/*` | Phase 5 UI. |
| `app/api/admin/dealer-outreach/apollo/{preview,sync,enrich}/route.ts` | Phase 1/5 API surface. |
| `app/api/admin/dealer-outreach/status/route.ts` | Phase 2 status transitions. |
| `app/api/admin/dealer-outreach/send-sms/route.ts` | Phase 3. |
| `tests/e2e/dealer-outreach.spec.ts` | Phase PLAYWRIGHT — extends the existing `playwright.e2e.config.ts` harness. |

**Modified files**

| Path | Change |
| --- | --- |
| `lib/services/dealer-recruitment/apollo.service.ts` | ADD `peopleSearchByCriteria` + async-reveal polling to the existing `ApolloClient` seam. Do not fork the module. |
| `lib/services/dealer-recruitment/apollo-credit-ledger.service.ts` | ADD job-scoped cap helper reusing the same atomic `updateMany` draw. |
| `lib/services/dealer-recruitment/dealer-email-send.service.ts` | Every early return writes exactly one log row first. |
| `lib/services/dealer/dealer-contact-profile.service.ts` | Carry the new Apollo/DNC columns through the upsert merge rules. |
| `app/admin/dealer-outreach/page.tsx` | Point at the queue read-model; keep the existing shell. |
| `prisma/schema.prisma` | Phase 1.1 + 1.6 + 3 model changes. |
| `package.json` | New `test:*` scripts, appended to `test:all`. |
| `.github/workflows/ci.yml` | New `e2e` job running `pnpm test:e2e`. |

---

## Task 0: Phase 0 findings document (no code)

**Files:**
- Create: `docs/superpowers/plans/2026-08-31-dealer-outreach-phase0-findings.md`

- [ ] **Step 1:** Write the findings doc recording, for each brief claim that Phase 0
  contradicted, the claim, the evidence, and the consequence for the plan. At minimum:
  the enum already complete; the Apollo stack already exists; `sms_opt_outs` is dead;
  Playwright already configured; CI does not run Playwright; `sendDealerEmail` has seven
  log-less early returns.
- [ ] **Step 2:** Commit.

```bash
git add docs/superpowers/plans/
git commit -m "docs(dealer-outreach): record Phase 0 inspection findings"
```

---

## Task 1: Schema — personnel store, Apollo run ledger, SMS columns (migration WRITTEN, NOT APPLIED)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261102000000_dealer_outreach_apollo_operational/migration.sql`
- Create: `prisma/migrations/20261102000000_dealer_outreach_apollo_operational/rollback.sql`
- Test: `prisma/__tests__/dealer-outreach-apollo-schema.test.ts`

**Interfaces:**
- Produces: `DealerContactProfile.apolloPersonId/apolloOrganizationId/apolloLastSyncedAt/
  linkedinUrl/dncStatus/dncCheckedAt/phoneType/isPrimaryContact`;
  `DealerOutreachLog.toPhone/fromPhone/twilioSid`; new model `ApolloEnrichmentRun`;
  new model `ApolloPersonCandidate`.

- [ ] **Step 1: Write the failing test**

`prisma/__tests__/dealer-outreach-apollo-schema.test.ts` asserts the migration SQL and
the Prisma schema agree, in the style of the existing `prisma/__tests__` suite:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "prisma");
const SCHEMA = readFileSync(join(ROOT, "schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "migrations", "20261102000000_dealer_outreach_apollo_operational", "migration.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "migrations", "20261102000000_dealer_outreach_apollo_operational", "rollback.sql"),
  "utf8",
);

test("contact profile carries Apollo identity + DNC provenance", () => {
  for (const col of [
    "apollo_person_id", "apollo_organization_id", "apollo_last_synced_at",
    "linkedin_url", "dnc_status", "dnc_checked_at", "phone_type", "is_primary_contact",
  ]) {
    assert.ok(SCHEMA.includes(col), `schema.prisma missing ${col}`);
    assert.ok(MIGRATION.includes(col), `migration.sql missing ${col}`);
  }
});

test("apollo_person_id is unique — the idempotency key for spend", () => {
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX[^;]*dealer_contact_profiles[^;]*apollo_person_id/i,
    "apollo_person_id must be UNIQUE so a person is never enriched twice",
  );
});

test("phone_type and consent_basis exist and are separate fields", () => {
  for (const col of ["phone_type", "consent_basis", "consent_basis_set_at", "consent_basis_source"]) {
    assert.ok(SCHEMA.includes(col), `schema.prisma missing ${col}`);
    assert.ok(MIGRATION.includes(col), `migration.sql missing ${col}`);
  }
  assert.match(MIGRATION, /consent_basis[^;]*DEFAULT\s+'NONE'/i, "consent_basis must default to NONE (fail closed)");
});

test("call-channel columns exist on the outreach log", () => {
  for (const col of ["call_disposition", "call_duration_seconds"]) {
    assert.ok(MIGRATION.includes(col), `migration.sql missing ${col}`);
  }
});

test("outreach log gains SMS columns without losing email columns", () => {
  for (const col of ["to_phone", "from_phone", "twilio_sid"]) {
    assert.ok(MIGRATION.includes(col), `migration.sql missing ${col}`);
  }
  for (const col of ["to_email", "from_email", "resend_id"]) {
    assert.ok(SCHEMA.includes(col), `schema.prisma dropped ${col}`);
  }
});

test("outreach idempotency is enforced by a partial unique index, not by app code alone", () => {
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX[^;]*dealer_outreach_log[^;]*dealer_prospect_id[^;]*outreach_sequence_step[^;]*channel[^;]*WHERE/is,
    "a retry or double-click must be stopped by the database, partial on non-failed rows",
  );
});

test("migration adds no RLS policy to a zero-policy table", () => {
  assert.doesNotMatch(
    MIGRATION, /CREATE POLICY/i,
    "adding a policy to a zero-policy RLS table OPENS access — forbidden",
  );
});

test("migration is additive only — no column drops", () => {
  assert.doesNotMatch(MIGRATION, /DROP COLUMN/i);
});

test("rollback reverses every added object", () => {
  for (const col of [
    "apollo_person_id", "apollo_organization_id", "apollo_last_synced_at",
    "linkedin_url", "dnc_status", "dnc_checked_at", "phone_type", "is_primary_contact",
    "to_phone", "from_phone", "twilio_sid",
  ]) {
    assert.ok(ROLLBACK.includes(col), `rollback.sql does not reverse ${col}`);
  }
  assert.match(ROLLBACK, /DROP INDEX IF EXISTS "dealer_outreach_log_attempt_key"/i);
  assert.match(ROLLBACK, /DROP TABLE IF EXISTS "apollo_enrichment_runs"/i);
  assert.match(ROLLBACK, /DROP TABLE IF EXISTS "apollo_person_candidates"/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && pnpm exec tsx --test prisma/__tests__/dealer-outreach-apollo-schema.test.ts`
Expected: FAIL — `ENOENT` on `migration.sql`.

- [ ] **Step 3: Add the models to `prisma/schema.prisma`**

Append to `model DealerContactProfile` (before the `@@index` block):

```prisma
  // Apollo identity + sync provenance. apolloPersonId is the SPEND idempotency
  // key: a person already enriched is never re-enriched, regardless of how many
  // prospects resolve to them. Unique so the guard cannot be raced.
  apolloPersonId       String?   @unique @map("apollo_person_id")
  apolloOrganizationId String?   @map("apollo_organization_id")
  apolloLastSyncedAt   DateTime? @map("apollo_last_synced_at")
  linkedinUrl          String?   @map("linkedin_url")

  // DNC provenance, persisted VERBATIM from Apollo's dnc_status_cd.
  // "found" = on a do-not-call list. "pending" = NOT cleared. Both block
  // phone-channel outreach at SEND time (see dealer-sms-send.service).
  dncStatus     String?   @map("dnc_status")
  dncCheckedAt  DateTime? @map("dnc_checked_at")
  phoneType     String?   @map("phone_type")

  isPrimaryContact Boolean @default(false) @map("is_primary_contact")

  // Owner direction: phone_type gates INDEPENDENTLY of DNC. mobile_phone carries
  // materially higher risk than a corporate line, so the send service must be able
  // to allow one and block the other. Never collapsed into a single "phone" field.
  // Values are Apollo's, verbatim: mobile_phone | direct_phone | corporate_phone.
  //
  // consentBasis is the TCPA basis for the phone channel:
  //   EXPRESS_WRITTEN | EXPRESS | EXISTING_BUSINESS_RELATIONSHIP | NONE
  // It defaults to NONE and nothing in this PR sets it to anything else — so SMS
  // correctly reaches zero prospects today. That is the intended outcome.
  consentBasis        String    @default("NONE") @map("consent_basis")
  consentBasisSetAt   DateTime? @map("consent_basis_set_at")
  consentBasisSource  String?   @map("consent_basis_source")
```

Append to `model DealerOutreachLog` as well (call-channel columns — the Phase 3
shipping deliverable):

```prisma
  // Phase 3 — manual call logging. `channel` carries "CALL"; these are its payload.
  callDisposition     String? @map("call_disposition")
  callDurationSeconds Int?    @map("call_duration_seconds")
  // The consent basis in force at SEND time, recorded on every phone-channel row so
  // an audit can reconstruct why a message was or was not permitted.
  consentBasis        String? @map("consent_basis")
```

Append to `model DealerOutreachLog` (before the relation block):

```prisma
  // Phase 3 — SMS channel. `channel` already discriminates email|sms|phone;
  // these are the SMS-side analogues of toEmail/fromEmail/resendId.
  toPhone   String? @map("to_phone")
  fromPhone String? @map("from_phone")
  twilioSid String? @map("twilio_sid")
```

Add the index and the two new models:

```prisma
model ApolloPersonCandidate {
  id String @id @default(cuid())

  // 0-credit People Search result. Persisted WITHOUT enrichment: last name is
  // obfuscated at this stage and that is expected, not a defect.
  apolloPersonId       String  @unique @map("apollo_person_id")
  apolloOrganizationId String? @map("apollo_organization_id")
  firstName            String? @map("first_name")
  lastNameObfuscated   String? @map("last_name_obfuscated")
  title                String?
  organizationName     String? @map("organization_name")
  organizationCity     String? @map("organization_city")
  organizationState    String? @map("organization_state")
  organizationZip      String? @map("organization_zip")
  organizationDomain   String? @map("organization_domain")
  linkedinUrl          String? @map("linkedin_url")

  // Rooftop link + how it was made. NULL rooftopId == unmatched (a new rooftop
  // is created by the org-match service, never guessed silently).
  rooftopId       String?        @map("rooftop_id")
  rooftop         DealerRooftop? @relation(fields: [rooftopId], references: [id], onDelete: SetNull)
  matchMethod     String?        @map("match_method")
  matchConfidence String?        @map("match_confidence")

  // Enrichment lifecycle. Terminal states are explicit — nothing is swallowed.
  // NEW | QUEUED | ENRICHED | EMPTY | UNREACHABLE | PENDING_REVEAL | EXPIRED
  //   | UNKNOWN_REQUEST | FAILED | SKIPPED_CAP
  enrichmentStatus String    @default("NEW") @map("enrichment_status")
  enrichmentError  String?   @map("enrichment_error") @db.Text
  revealRequestId  String?   @map("reveal_request_id")
  revealPollCount  Int       @default(0) @map("reveal_poll_count")
  lastSyncedAt     DateTime? @map("last_synced_at")

  searchRunKey String   @map("search_run_key")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([rooftopId])
  @@index([enrichmentStatus])
  @@index([searchRunKey])
  @@map("apollo_person_candidates")
}

model ApolloEnrichmentRun {
  id String @id @default(cuid())

  mode          String   @map("mode")           // "preview" | "execute"
  maxCredits    Int      @map("max_credits")    // the hard cap this run ran under
  candidateCount Int     @default(0) @map("candidate_count")
  estimatedCost Int      @default(0) @map("estimated_cost")
  creditsSpent  Int      @default(0) @map("credits_spent")
  enrichedCount Int      @default(0) @map("enriched_count")
  emptyCount    Int      @default(0) @map("empty_count")
  failedCount   Int      @default(0) @map("failed_count")

  waterfallEnabled Boolean @default(false) @map("waterfall_enabled")

  // RUNNING | COMPLETED | ABORTED_CAP | ABORTED_ERROR | ABORTED_DISABLED
  status     String    @default("RUNNING")
  abortReason String?  @map("abort_reason") @db.Text

  startedAt  DateTime  @default(now()) @map("started_at")
  finishedAt DateTime? @map("finished_at")
  startedBy  String?   @map("started_by")

  @@index([status])
  @@index([startedAt])
  @@map("apollo_enrichment_runs")
}
```

Add `candidates ApolloPersonCandidate[]` to `model DealerRooftop`'s relation block and
`@@index([dncStatus])` to `DealerContactProfile`.

- [ ] **Step 4: Write `migration.sql`** — additive only, `IF NOT EXISTS` everywhere,
  no `CREATE POLICY`, no `DROP COLUMN`, no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  on the zero-policy tables. It MUST include the outreach idempotency index that Task 6
  depends on:

```sql
-- One live attempt per (prospect, step, channel). Partial on non-failed rows so a
-- failed attempt can be retried, while a retry or double-click of a live send is
-- rejected by the DATABASE, not merely by application code.
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_outreach_log_attempt_key"
  ON "dealer_outreach_log" ("dealer_prospect_id", "outreach_sequence_step", "channel")
  WHERE "status" <> 'failed';
```

  Add the matching Prisma attribute to `model DealerOutreachLog`:

```prisma
  // Enforced in SQL as a PARTIAL unique index (WHERE status <> 'failed'); Prisma
  // cannot express the predicate, so the index is declared in migration.sql and
  // this @@index only documents the lookup shape.
  @@index([dealerProspectId, outreachSequenceStep, channel])
```

- [ ] **Step 5: Write `rollback.sql`** — `DROP COLUMN IF EXISTS` for each added column,
  `DROP TABLE IF EXISTS` for the two new tables, `DROP INDEX IF EXISTS` for each index.

- [ ] **Step 6: Run the test — expect PASS**

Run: `cd frontend && pnpm exec tsx --test prisma/__tests__/dealer-outreach-apollo-schema.test.ts`

- [ ] **Step 7: Regenerate the client and typecheck**

Run: `cd frontend && pnpm exec prisma generate && pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add frontend/prisma
git commit -m "feat(dealer-outreach): schema for Apollo personnel sync, DNC, SMS channel (migration NOT applied)"
```

---

## Task 2: Apollo People Search — the 0-credit discovery path

**Files:**
- Modify: `lib/services/dealer-recruitment/apollo.service.ts`
- Create: `lib/services/dealer-recruitment/apollo-people-search.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/apollo-people-search.test.ts`

**Interfaces:**
- Consumes: the existing `ApolloClient` seam and `apolloFetch` from `apollo.service.ts`.
- Produces:
  `DEALER_PERSON_TITLES: readonly string[]`,
  `ApolloClient.peopleSearchByCriteria(input: { sicCodes: readonly string[]; titles: readonly string[]; personLocations?: readonly string[]; organizationLocations?: readonly string[]; page: number; perPage: number }): Promise<{ people: ApolloSearchPerson[]; totalPages: number; totalEntries: number }>`,
  `ApolloSearchPerson { id; firstName; lastNameObfuscated; title; linkedinUrl; organization: { id; name; city; state; zip; domain } | null }`,
  `runPeopleSearch(input: PeopleSearchInput, deps?): Promise<PeopleSearchResult>`.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runPeopleSearch, DEALER_PERSON_TITLES } from "../apollo-people-search.service";

function person(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    firstName: "Dana",
    lastNameObfuscated: "R.",
    title: "General Manager",
    linkedinUrl: null,
    organization: { id: `org-${id}`, name: `Dealer ${id}`, city: "Austin", state: "TX", zip: "78701", domain: null },
    ...over,
  };
}

function fakeDeps(pages: Record<number, ReturnType<typeof person>[]>, totalPages: number) {
  const upserted: unknown[] = [];
  let calls = 0;
  return {
    upserted,
    calls: () => calls,
    deps: {
      enabled: () => true,
      client: {
        async peopleSearchByCriteria({ page }: { page: number }) {
          calls++;
          return { people: pages[page] ?? [], totalPages, totalEntries: 100 * totalPages };
        },
      },
      persistCandidate: async (c: unknown) => { upserted.push(c); },
      now: new Date("2026-08-31T00:00:00Z"),
    },
  };
}

test("search costs zero credits — it never draws from the ledger", async () => {
  let drew = false;
  const f = fakeDeps({ 1: [person("a")] }, 1);
  await runPeopleSearch(
    { sicCodes: ["5511"], titles: DEALER_PERSON_TITLES, personLocations: ["Texas"] },
    { ...f.deps, drawCredits: async () => { drew = true; return { drawn: true }; } } as never,
  );
  assert.equal(drew, false, "People Search must never draw a credit");
});

test("paginates until totalPages and persists every result", async () => {
  const f = fakeDeps({ 1: [person("a"), person("b")], 2: [person("c")] }, 2);
  const r = await runPeopleSearch(
    { sicCodes: ["5511"], titles: DEALER_PERSON_TITLES, personLocations: ["Texas"] },
    f.deps as never,
  );
  assert.equal(f.calls(), 2);
  assert.equal(r.persisted, 3);
  assert.equal(f.upserted.length, 3);
});

test("an obfuscated last name is persisted, not rejected", async () => {
  const f = fakeDeps({ 1: [person("a", { lastNameObfuscated: "R." })] }, 1);
  await runPeopleSearch({ sicCodes: ["5511"], titles: DEALER_PERSON_TITLES }, f.deps as never);
  assert.equal((f.upserted[0] as { lastNameObfuscated: string }).lastNameObfuscated, "R.");
});

test("candidates are persisted WITHOUT enrichment status advancing past NEW", async () => {
  const f = fakeDeps({ 1: [person("a")] }, 1);
  await runPeopleSearch({ sicCodes: ["5511"], titles: DEALER_PERSON_TITLES }, f.deps as never);
  assert.equal((f.upserted[0] as { enrichmentStatus: string }).enrichmentStatus, "NEW");
});

test("disabled flag returns a skipped result and makes no HTTP call", async () => {
  const f = fakeDeps({ 1: [person("a")] }, 1);
  const r = await runPeopleSearch(
    { sicCodes: ["5511"], titles: DEALER_PERSON_TITLES },
    { ...f.deps, enabled: () => false } as never,
  );
  assert.equal(r.skipped, true);
  assert.equal(f.calls(), 0);
});

test("pagination stops at the hard page ceiling even if Apollo reports more", async () => {
  const pages: Record<number, ReturnType<typeof person>[]> = {};
  for (let i = 1; i <= 200; i++) pages[i] = [person(`p${i}`)];
  const f = fakeDeps(pages, 10_000);
  const r = await runPeopleSearch(
    { sicCodes: ["5511"], titles: DEALER_PERSON_TITLES, maxPages: 3 },
    f.deps as never,
  );
  assert.equal(f.calls(), 3);
  assert.equal(r.pagesFetched, 3);
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `cd frontend && pnpm exec tsx --test --experimental-test-module-mocks lib/services/dealer-recruitment/__tests__/apollo-people-search.test.ts`

- [ ] **Step 3: Extend `apollo.service.ts`** — add to the `ApolloClient` interface and
  the `defaultApolloClient()` implementation only. Do not create a second `apolloFetch`.

```ts
export const DEALER_SIC_CODES = ["5511"] as const;

// Phase 1.2 — decision-maker titles for the 0-credit acquisition path.
export const DEALER_PERSON_TITLES = [
  "dealer principal", "general manager", "general sales manager",
  "used car manager", "internet sales manager", "sales manager",
  "inventory manager", "acquisition manager",
] as const;

export interface ApolloSearchPerson {
  id: string;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
  linkedinUrl: string | null;
  organization: {
    id: string | null; name: string | null; city: string | null;
    state: string | null; zip: string | null; domain: string | null;
  } | null;
}
```

Add `peopleSearchByCriteria` to the interface and implement it against
`/mixed_people/search` with `organization_sic_codes`, `person_titles`,
`person_locations` / `organization_locations`, `page`, `per_page`. It is a FREE stage:
call `apolloFetch` WITHOUT `throwOnError`, returning `{ people: [], totalPages: 0,
totalEntries: 0 }` on any failure (fail-closed, matching the module's existing contract).

- [ ] **Step 4: Write `apollo-people-search.service.ts`** — pagination loop bounded by
  `maxPages` (default from `APOLLO_PEOPLE_SEARCH_MAX_PAGES`, hard ceiling 100),
  `enabled()` gate on `APOLLO_PEOPLE_SEARCH_ENABLED`, persisting each result as an
  `ApolloPersonCandidate` with `enrichmentStatus: "NEW"` via an upsert on
  `apolloPersonId` so a re-run is idempotent.

- [ ] **Step 5: Run the test — expect PASS**
- [ ] **Step 6: Register the suite**

In `package.json`, the existing `test` script already globs
`lib/services/dealer-recruitment/__tests__/*.test.ts` — confirm with
`pnpm test:coverage-check`.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/services/dealer-recruitment frontend/package.json
git commit -m "feat(apollo): 0-credit People Search discovery path on the existing adapter"
```

---

## Task 3: Rooftop matching with recorded method and confidence

**Files:**
- Create: `lib/services/dealer-recruitment/apollo-org-match.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/apollo-org-match.test.ts`

**Interfaces:**
- Consumes: `normalizeWebsiteHost`, `normalizeDealerName`, `normalizePhone` from
  `lib/services/dealer/dealer-identity.service` — the SAME normalizers that produced the
  existing `name_key` / `name_zip_key` / `name_city_state_key` / `website_host` /
  `phone_key` columns. Do not write a second normalizer.
- Produces:
  `matchApolloOrgToRooftop(org: ApolloOrgInput, deps?): Promise<{ rooftopId: string; method: MatchMethod; confidence: "high"|"medium"|"low"; created: boolean }>`
  where `MatchMethod = "website_host"|"name_zip"|"name_city_state"|"phone"|"created"`.

- [ ] **Step 1: Write the failing test** covering, each as its own `test()`:
  website_host match (high); name_zip match (high); name_city_state match (medium);
  phone_key match (medium); no match → creates a rooftop with `method:"created"`,
  `created:true`; ambiguity (two rooftops share `name_city_state_key`) → does NOT guess,
  returns the lowest-id deterministic pick with `confidence:"low"` AND records it; every
  return path carries a non-null `method` and `confidence`.

```ts
test("website_host is the strongest key and wins over a weaker name match", async () => {
  const r = await matchApolloOrgToRooftop(
    { name: "Round Rock Toyota", domain: "roundrocktoyota.com", city: "Austin", state: "TX", zip: "78701", phone: null },
    fakeDeps({ byHost: { "roundrocktoyota.com": "rt-1" }, byNameCityState: { "roundrocktoyota|austin|tx": "rt-2" } }),
  );
  assert.equal(r.rooftopId, "rt-1");
  assert.equal(r.method, "website_host");
  assert.equal(r.confidence, "high");
});

test("an unmatched org creates a rooftop rather than silently dropping the person", async () => {
  const d = fakeDeps({});
  const r = await matchApolloOrgToRooftop(
    { name: "Brand New Motors", domain: null, city: "Plano", state: "TX", zip: "75024", phone: null }, d,
  );
  assert.equal(r.created, true);
  assert.equal(r.method, "created");
  assert.equal(d.createdRooftops.length, 1);
});

test("ambiguous name+city+state never silently guesses — confidence is low and recorded", async () => {
  const r = await matchApolloOrgToRooftop(
    { name: "City Auto", domain: null, city: "Austin", state: "TX", zip: null, phone: null },
    fakeDeps({ byNameCityStateMany: { "cityauto|austin|tx": ["a", "b"] } }),
  );
  assert.equal(r.confidence, "low");
  assert.ok(r.method);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**, trying keys strongest-first:
  `website_host` → `name_zip_key` → `name_city_state_key` → `phone_key` → create.
  Every branch returns `method` + `confidence`; the candidate row is updated with both.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(apollo): rooftop entity resolution with recorded match method and confidence"
```

---

## Task 4: Credit-budgeted enrichment — preview, hard cap, per-person idempotency

**Files:**
- Modify: `lib/services/dealer-recruitment/apollo-credit-ledger.service.ts`
- Create: `lib/services/dealer-recruitment/apollo-enrichment-job.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/apollo-enrichment-job.test.ts`

**Interfaces:**
- Consumes: `drawCredits`, `remainingCredits`, `cycleKeyFor`, `daysInCycleFor`.
- Produces:
  `previewEnrichment(input: EnrichmentInput, deps?): Promise<{ candidateCount: number; worstCaseCredits: number; creditsRemaining: number; waterfallEnabled: boolean; maxCredits: number }>`,
  `runEnrichment(input: EnrichmentInput, deps?): Promise<ApolloEnrichmentRunResult>`,
  `resolveMaxCredits(): number`, `ENRICHMENT_STALENESS_DAYS = 90`.

- [ ] **Step 1: Write the failing test.** These are the load-bearing guarantees:

```ts
test("preview spends nothing and reports the worst-case cost", async () => {
  let revealCalls = 0;
  const r = await previewEnrichment({ maxCredits: 100 }, {
    ...fakeDeps({ candidates: 40 }),
    reveal: async () => { revealCalls++; return null; },
  } as never);
  assert.equal(revealCalls, 0);
  assert.equal(r.candidateCount, 40);
  assert.equal(r.worstCaseCredits, 40);       // 1 credit per standard reveal
});

test("preview worst-case reflects the waterfall multiplier when waterfall is ON", async () => {
  const r = await previewEnrichment({ maxCredits: 100 },
    { ...fakeDeps({ candidates: 10 }), waterfallEnabled: () => true } as never);
  assert.ok(r.worstCaseCredits > 10, "waterfall cost is variable and must be over-estimated, never under");
  assert.equal(r.waterfallEnabled, true);
});

test("the run ABORTS at the cap and records why", async () => {
  const d = fakeDeps({ candidates: 50 });
  const r = await runEnrichment({ maxCredits: 5 }, d as never);
  assert.equal(r.status, "ABORTED_CAP");
  assert.equal(r.creditsSpent, 5);
  assert.ok(/cap/i.test(r.abortReason ?? ""));
  assert.equal(d.revealCalls(), 5, "must stop calling Apollo at the cap, not after");
});

test("an apollo_person_id already enriched is never enriched again", async () => {
  const d = fakeDeps({ candidates: 3, alreadyEnriched: ["p1"] });
  await runEnrichment({ maxCredits: 100 }, d as never);
  assert.deepEqual(d.revealedIds().sort(), ["p2", "p3"]);
});

test("the spend guard keys on apollo_person_id, not prospect id", async () => {
  // Two prospects resolve to ONE Apollo person; exactly one reveal happens.
  const d = fakeDeps({ candidates: 1, duplicateProspects: 2 });
  await runEnrichment({ maxCredits: 100 }, d as never);
  assert.equal(d.revealCalls(), 1);
});

test("a fresh candidate inside the staleness window is skipped", async () => {
  const d = fakeDeps({ candidates: 1, lastSyncedDaysAgo: 10 });
  const r = await runEnrichment({ maxCredits: 100 }, d as never);
  assert.equal(d.revealCalls(), 0);
  assert.equal(r.enrichedCount, 0);
});

test("a candidate past the staleness threshold IS re-enriched", async () => {
  const d = fakeDeps({ candidates: 1, lastSyncedDaysAgo: 120 });
  await runEnrichment({ maxCredits: 100 }, d as never);
  assert.equal(d.revealCalls(), 1);
});

test("waterfall is OFF by default — no waterfall param reaches the client", async () => {
  const d = fakeDeps({ candidates: 1 });
  await runEnrichment({ maxCredits: 10 }, d as never);
  assert.equal(d.lastRevealOpts()?.waterfall, false);
});

test("waterfall params are only sent when the flag is explicitly enabled", async () => {
  const d = fakeDeps({ candidates: 1 });
  await runEnrichment({ maxCredits: 10 }, { ...d, waterfallEnabled: () => true } as never);
  assert.equal(d.lastRevealOpts()?.waterfall, true);
});

test("the run record persists actual credits consumed", async () => {
  const d = fakeDeps({ candidates: 4 });
  const r = await runEnrichment({ maxCredits: 100 }, d as never);
  assert.equal(r.creditsSpent, 4);
  assert.equal(d.persistedRun()?.creditsSpent, 4);
  assert.equal(d.persistedRun()?.status, "COMPLETED");
});

test("priority order: buyer-opportunity-linked, then SCRIPTED, then score", async () => {
  const d = fakeDeps({ mixedPriority: true });
  await runEnrichment({ maxCredits: 3 }, d as never);
  assert.deepEqual(d.revealedIds(), ["opp-linked", "scripted", "high-score"]);
});

test("DISCOVERED rows are NOT bulk-enriched by default", async () => {
  const d = fakeDeps({ onlyDiscovered: 100 });
  const r = await runEnrichment({ maxCredits: 100 }, d as never);
  assert.equal(d.revealCalls(), 0);
  assert.equal(r.candidateCount, 0);
});

test("the job aborts cleanly when the enrichment flag is off", async () => {
  const r = await runEnrichment({ maxCredits: 10 },
    { ...fakeDeps({ candidates: 5 }), enabled: () => false } as never);
  assert.equal(r.status, "ABORTED_DISABLED");
  assert.equal(r.creditsSpent, 0);
});

test("a null email from Apollo marks the contact UNREACHABLE and fabricates nothing", async () => {
  const d = fakeDeps({ candidates: 1, revealReturns: { email: null, phone: null } });
  await runEnrichment({ maxCredits: 10 }, d as never);
  assert.equal(d.persistedContact()?.email, null);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "UNREACHABLE");
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add the job-scoped cap helper** to `apollo-credit-ledger.service.ts`,
  reusing the existing atomic `updateMany` draw. The job cap is the MINIMUM of the
  configured `APOLLO_ENRICHMENT_MAX_CREDITS`, the caller's `maxCredits`, and the cycle
  ledger's remaining budget — the job can never exceed the monthly ledger.
- [ ] **Step 4: Implement `apollo-enrichment-job.service.ts`.** Structure:
  select candidates by priority → for each, check `apolloPersonId` enriched-guard and
  staleness → draw one credit → reveal → persist to `dealer_contact_profiles` (never to
  `dealer_prospects`) → increment the run record. Break the loop the moment the draw
  fails or `creditsSpent >= cap`, set `status: "ABORTED_CAP"` and `abortReason`.
- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(apollo): credit-budgeted enrichment job with preview, hard cap, per-person idempotency"
```

---

## Task 5: Async reveal — four distinct terminal states, bounded polling

**Files:**
- Modify: `lib/services/dealer-recruitment/apollo.service.ts`
- Modify: `lib/services/dealer-recruitment/apollo-enrichment-job.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/apollo-async-reveal.test.ts`

**Interfaces:**
- Produces: `pollReveal(requestId: string, deps?): Promise<RevealPollOutcome>` where
  `RevealPollOutcome = { kind: "ready"; email: string|null; phone: string|null; dncStatus: string|null }
   | { kind: "pending" } | { kind: "expired" } | { kind: "unknown_request" } | { kind: "failed"; error: string }`.

- [ ] **Step 1: Write the failing test:**

```ts
test("pending is a distinct non-terminal state and does not mark the candidate done", async () => {
  const r = await pollReveal("req-1", fakeClient({ status: "pending" }));
  assert.equal(r.kind, "pending");
});

test("expired is terminal and persisted as EXPIRED", async () => {
  const d = fakeDeps({ pollReturns: { kind: "expired" } });
  await drainReveal("cand-1", d as never);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "EXPIRED");
});

test("an unknown request_id is terminal and persisted as UNKNOWN_REQUEST", async () => {
  const d = fakeDeps({ pollReturns: { kind: "unknown_request" } });
  await drainReveal("cand-1", d as never);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "UNKNOWN_REQUEST");
});

test("a hard failure is terminal, persisted as FAILED, and records the error", async () => {
  const d = fakeDeps({ pollReturns: { kind: "failed", error: "HTTP 500" } });
  await drainReveal("cand-1", d as never);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "FAILED");
  assert.match(d.persistedCandidate()?.enrichmentError ?? "", /HTTP 500/);
});

test("polling is bounded — it never loops forever on pending", async () => {
  const d = fakeDeps({ pollReturns: { kind: "pending" } });
  await drainReveal("cand-1", d as never);
  assert.ok(d.pollCalls() <= MAX_REVEAL_POLLS);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "PENDING_REVEAL");
});

test("dnc_status_cd is persisted verbatim, not normalised away", async () => {
  const d = fakeDeps({ pollReturns: { kind: "ready", email: "a@b.com", phone: "+15125551212", dncStatus: "found" } });
  await drainReveal("cand-1", d as never);
  assert.equal(d.persistedContact()?.dncStatus, "found");
  assert.ok(d.persistedContact()?.dncCheckedAt instanceof Date);
});

test("a ready reveal with no email and no phone is UNREACHABLE, never fabricated", async () => {
  const d = fakeDeps({ pollReturns: { kind: "ready", email: null, phone: null, dncStatus: null } });
  await drainReveal("cand-1", d as never);
  assert.equal(d.persistedContact()?.email, null);
  assert.equal(d.persistedContact()?.phone, null);
  assert.equal(d.persistedCandidate()?.enrichmentStatus, "UNREACHABLE");
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `pollReveal` on the adapter and `drainReveal` on the job
  service, with `MAX_REVEAL_POLLS = 5` and exponential backoff. Each terminal state
  writes its own `enrichmentStatus`; `pending` after the ceiling writes
  `PENDING_REVEAL` so a later drain can resume — it is never silently dropped.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(apollo): distinct persisted terminal states for async reveal polling"
```

---

## Task 6: The outreach log becomes the single source of truth

**Files:**
- Create: `lib/services/dealer-recruitment/dealer-outreach-log.service.ts`
- Modify: `lib/services/dealer-recruitment/dealer-email-send.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/dealer-outreach-log.test.ts`

**Interfaces:**
- Produces:
  `recordOutreachAttempt(input: OutreachAttempt, deps?): Promise<{ logId: string; deduped: boolean }>`,
  `outreachIdempotencyKey(prospectId: string, step: number, channel: string): string`,
  `deriveContactState(prospectId, deps?): Promise<{ contactedAt: Date|null; repliedAt: Date|null; sequencePausedAt: Date|null; lastTouch: OutreachTouch|null }>`.

**Why this exists (REVISED after stop condition #1 — the writer already exists):**
`dealer-email-send.service.ts:329` already calls `prisma.dealerOutreachLog.create`, and
four call paths reach it. The defect is not a missing writer, it is *gate ordering*:
SEVEN early returns (`not_configured` at L192, `not_found`, `no_email`,
`already_contacted`, `suppressed` at L251, `undeliverable`, `rate_limited`) return before
L329, so six real attempts leave no trace at all. Nobody can tell "never attempted" from
"attempted and blocked" — which is why 0 rows went unnoticed.

**This task is therefore smaller than originally scoped.** It does not build a writer. It
(a) moves the write ahead of the gates so a blocked attempt is recorded, (b) adds the
derived-read helpers, and (c) fixes `frontend/.env.example:70-71`, which labels
`DEALER_OUTREACH_FROM_EMAIL` and `DEALER_OUTREACH_REPLY_TO` `# optional` while
`REQUIRED_EMAIL_ENV_VARS` lists both as required — the most likely reason every send has
returned `not_configured` at L192.

- [ ] **Step 1: Write the failing test:**

```ts
test("a suppressed recipient still produces exactly one log row", async () => {
  const d = fakeSendDeps({ suppressed: true });
  const r = await sendDealerEmail({ dealerProspectId: "p1" }, d as never);
  assert.equal(r.success, false);
  assert.equal(r.reason, "suppressed");
  assert.equal(d.logRows().length, 1);
  assert.equal(d.logRows()[0].status, "failed");
  assert.match(d.logRows()[0].errorMessage, /suppress/i);
});

for (const scenario of [
  { name: "not_configured", setup: { missingEnv: ["RESEND_API_KEY"] } },
  { name: "no_email",       setup: { prospectEmail: null } },
  { name: "undeliverable",  setup: { deliverable: false } },
  { name: "rate_limited",   setup: { rateLimited: true } },
  { name: "send_error",     setup: { providerThrows: true } },
]) {
  test(`a ${scenario.name} failure still produces exactly one log row`, async () => {
    const d = fakeSendDeps(scenario.setup);
    await sendDealerEmail({ dealerProspectId: "p1" }, d as never);
    assert.equal(d.logRows().length, 1, `${scenario.name} wrote ${d.logRows().length} rows`);
    assert.equal(d.logRows()[0].status, "failed");
    assert.ok(d.logRows()[0].errorMessage, "a failure row must carry error_message");
  });
}

test("a double-click cannot produce two log rows or two real messages", async () => {
  const d = fakeSendDeps({});
  const [a, b] = await Promise.all([
    sendDealerEmail({ dealerProspectId: "p1" }, d as never),
    sendDealerEmail({ dealerProspectId: "p1" }, d as never),
  ]);
  assert.equal(d.logRows().length, 1);
  assert.equal(d.providerSends(), 1);
  assert.equal([a.success, b.success].filter(Boolean).length, 1);
});

test("the idempotency key is (prospect, step, channel)", () => {
  assert.equal(outreachIdempotencyKey("p1", 2, "sms"), "p1:2:sms");
  assert.notEqual(outreachIdempotencyKey("p1", 2, "sms"), outreachIdempotencyKey("p1", 2, "email"));
});

test("contacted_at is DERIVED from the log, not read from the column", async () => {
  const d = fakeDeriveDeps({
    prospectColumn: { contactedAt: null },              // column is stale/never written
    logs: [{ channel: "email", status: "sent", sentAt: new Date("2026-08-01") }],
  });
  const s = await deriveContactState("p1", d as never);
  assert.deepEqual(s.contactedAt, new Date("2026-08-01"));
});

test("a failed-only history does not count as contacted", async () => {
  const d = fakeDeriveDeps({ logs: [{ channel: "email", status: "failed", sentAt: new Date("2026-08-01") }] });
  const s = await deriveContactState("p1", d as never);
  assert.equal(s.contactedAt, null);
});

test("replied_at is derived from the log's replied rows", async () => {
  const d = fakeDeriveDeps({
    logs: [
      { channel: "email", status: "sent",    sentAt: new Date("2026-08-01") },
      { channel: "email", status: "replied", sentAt: new Date("2026-08-01"), repliedAt: new Date("2026-08-03") },
    ],
  });
  const s = await deriveContactState("p1", d as never);
  assert.deepEqual(s.repliedAt, new Date("2026-08-03"));
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 2b: Fix `frontend/.env.example`** so the template stops contradicting the
  code. Both vars are required by `REQUIRED_EMAIL_ENV_VARS`:

```diff
-DEALER_OUTREACH_FROM_EMAIL=   # optional
-DEALER_OUTREACH_REPLY_TO=     # optional
+DEALER_OUTREACH_FROM_EMAIL=   # REQUIRED before any dealer send (REQUIRED_EMAIL_ENV_VARS)
+DEALER_OUTREACH_REPLY_TO=     # REQUIRED before any dealer send (REQUIRED_EMAIL_ENV_VARS)
```

  Add a guard test so the template and the code cannot drift again:

```ts
test(".env.example does not describe a REQUIRED_EMAIL_ENV_VAR as optional", () => {
  const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  for (const key of REQUIRED_EMAIL_ENV_VARS) {
    const line = example.split("\n").find((l) => l.startsWith(`${key}=`));
    if (!line) continue;
    assert.doesNotMatch(line, /#\s*optional/i, `${key} is required by the send path but .env.example calls it optional`);
  }
});
```

- [ ] **Step 3: Implement `recordOutreachAttempt`** as the ONE writer. Modelled on
  `withCronRun()`'s unconditional-write pattern: the row is created FIRST (status
  `queued`), the attempt runs, and the row is updated to its terminal status — so a
  crash mid-send still leaves a row. Uniqueness is enforced by a partial unique index on
  `(dealer_prospect_id, outreach_sequence_step, channel)` for non-failed rows, added in
  the Task 1 migration; a duplicate insert is caught and returned as `deduped: true`.
- [ ] **Step 4: Rewrite `sendDealerEmail`** so every early return routes through
  `recordOutreachAttempt`. Keep the existing gate ORDER and the existing
  `SendDealerEmailReason` values — this is a logging fix, not a behaviour change.
- [ ] **Step 5: Run — expect PASS. Then run the whole dealer-recruitment suite**, which
  already covers this service, to catch regressions:
  `pnpm exec tsx --test --experimental-test-module-mocks lib/services/dealer-recruitment/__tests__/*.test.ts`
- [ ] **Step 6: Commit**

```bash
git commit -am "fix(dealer-outreach): every send attempt writes exactly one log row, failures included"
```

---

## Task 7: The status machine, reachable from the UI

**Files:**
- Create: `lib/services/dealer-recruitment/dealer-prospect-status.service.ts`
- Create: `app/api/admin/dealer-outreach/status/route.ts`
- Test: `lib/services/dealer-recruitment/__tests__/dealer-prospect-status.test.ts`

**Interfaces:**
- Produces: `canTransition(from, to): boolean`,
  `transitionProspect(input: { prospectId; to: DealerProspectStatus; deadReason?: string; actorId: string }, deps?): Promise<TransitionResult>`,
  `LEGAL_TRANSITIONS: Readonly<Record<DealerProspectStatus, readonly DealerProspectStatus[]>>`.

**Note:** `DealerProspectStatus` ALREADY contains `DISCOVERED, SCRIPTED, DRAFTED,
CONTACTED, REPLIED, ONBOARDED, DEAD` — verified in `schema.prisma`. **No enum migration
is required.** `DRAFTED` is retained for forward compatibility and is not part of the
happy path.

- [ ] **Step 1: Write the failing test** — enumerate the full matrix so illegal
  transitions are proven illegal, not merely untested:

```ts
const ALL: DealerProspectStatus[] = ["DISCOVERED","SCRIPTED","DRAFTED","CONTACTED","REPLIED","ONBOARDED","DEAD"];

test("the happy path is reachable end to end", () => {
  const path: DealerProspectStatus[] = ["DISCOVERED","SCRIPTED","CONTACTED","REPLIED","ONBOARDED"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]} must be legal`);
  }
});

test("DEAD is reachable from every non-terminal state", () => {
  for (const s of ALL.filter((s) => s !== "DEAD")) {
    assert.ok(canTransition(s, "DEAD"), `${s} -> DEAD must be legal`);
  }
});

test("skipping forward is illegal", () => {
  assert.equal(canTransition("DISCOVERED", "ONBOARDED"), false);
  assert.equal(canTransition("DISCOVERED", "REPLIED"), false);
  assert.equal(canTransition("SCRIPTED", "ONBOARDED"), false);
});

test("ONBOARDED and DEAD are terminal", () => {
  for (const to of ALL) {
    assert.equal(canTransition("ONBOARDED", to), false, `ONBOARDED -> ${to} must be illegal`);
    assert.equal(canTransition("DEAD", to), false, `DEAD -> ${to} must be illegal`);
  }
});

test("a state never transitions to itself", () => {
  for (const s of ALL) assert.equal(canTransition(s, s), false);
});

test("DEAD without a dead_reason is REJECTED", async () => {
  const d = fakeDeps({ current: "SCRIPTED" });
  const r = await transitionProspect({ prospectId: "p1", to: "DEAD", actorId: "admin-1" }, d as never);
  assert.equal(r.ok, false);
  assert.equal(r.error, "DEAD_REASON_REQUIRED");
  assert.equal(d.updates().length, 0, "a rejected transition must not write");
});

test("DEAD with a dead_reason is accepted and stamps dead_at", async () => {
  const d = fakeDeps({ current: "SCRIPTED" });
  const r = await transitionProspect(
    { prospectId: "p1", to: "DEAD", deadReason: "Not interested", actorId: "admin-1" }, d as never);
  assert.equal(r.ok, true);
  assert.equal(d.updates()[0].deadReason, "Not interested");
  assert.ok(d.updates()[0].deadAt instanceof Date);
});

test("a whitespace-only dead_reason is rejected", async () => {
  const r = await transitionProspect(
    { prospectId: "p1", to: "DEAD", deadReason: "   ", actorId: "admin-1" },
    fakeDeps({ current: "SCRIPTED" }) as never);
  assert.equal(r.ok, false);
  assert.equal(r.error, "DEAD_REASON_REQUIRED");
});

test("an illegal transition is rejected without writing", async () => {
  const d = fakeDeps({ current: "DISCOVERED" });
  const r = await transitionProspect({ prospectId: "p1", to: "ONBOARDED", actorId: "admin-1" }, d as never);
  assert.equal(r.ok, false);
  assert.equal(r.error, "ILLEGAL_TRANSITION");
  assert.equal(d.updates().length, 0);
});

test("a concurrent double-transition applies once (guarded update)", async () => {
  const d = fakeDeps({ current: "SCRIPTED" });
  const [a, b] = await Promise.all([
    transitionProspect({ prospectId: "p1", to: "CONTACTED", actorId: "admin-1" }, d as never),
    transitionProspect({ prospectId: "p1", to: "CONTACTED", actorId: "admin-1" }, d as never),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** The write is a guarded `updateMany` with
  `where: { id, status: from }` so a concurrent transition matches zero rows — the same
  pattern the credit ledger uses. Every accepted transition writes an audit row through
  the existing admin audit service.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Add `POST /api/admin/dealer-outreach/status`** using
  `getAdminFromRequest` / `adminSuccess` / `adminError`, matching the existing routes.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(dealer-outreach): guarded status machine with mandatory dead_reason"
```

---

## Task 8: Call logging (ships ENABLED) + consent-gated SMS (ships OFF)

**Owner direction, 2026-08-31 — three constraints that override the original Task 8:**

1. **No second SMS send path.** Building one would bypass `sendCrmSms`'s
   `consent_sms` gate — a consent bypass implemented in architecture, and exactly the
   parallel system the repo forbids. EXTEND the existing path instead.
2. **Phase 3's shipping deliverable is MANUAL CALL LOGGING, not SMS.** `channel="CALL"`
   with disposition, duration and notes, plus click-to-call in the queue. This ships
   ENABLED and is what actually turns 1,527 phone numbers into real outreach.
3. **`phone_type` is gated independently of DNC.** `mobile_phone` carries materially
   higher risk than `corporate_phone`; the send service must be able to allow one and
   block the other. Do not collapse phone types into one field.

**Files:**
- Modify: `lib/services/sms/crm-sms.ts` (add the `consent_basis` gate)
- Create: `lib/services/dealer-recruitment/dealer-call-log.service.ts`
- Create: `app/api/admin/dealer-outreach/log-call/route.ts`
- Create: `app/api/admin/dealer-outreach/send-sms/route.ts`
- Test: `lib/services/dealer-recruitment/__tests__/dealer-call-log.test.ts`
- Test: `lib/services/sms/__tests__/consent-basis-gate.test.ts`

**Interfaces:**
- Produces:
  `type ConsentBasis = "EXPRESS_WRITTEN" | "EXPRESS" | "EXISTING_BUSINESS_RELATIONSHIP" | "NONE"`,
  `evaluateConsentBasis(input): { allowed: boolean; basis: ConsentBasis; reason?: string }`,
  `type PhoneType = "mobile_phone" | "direct_phone" | "corporate_phone" | "unknown"`,
  `type CallDisposition = "CONNECTED" | "VOICEMAIL" | "NO_ANSWER" | "WRONG_NUMBER" | "GATEKEEPER" | "NOT_INTERESTED" | "CALLBACK_REQUESTED"`,
  `logDealerCall(input: { prospectId; disposition; durationSeconds; notes; actorId }, deps?): Promise<{ logId: string }>`,
  `sendDealerSms(input, deps?): Promise<DealerSmsResult>`.

### 8a — the `consent_basis` gate on the EXISTING SMS path

- [ ] **Step 1: Write the failing test** (`lib/services/sms/__tests__/consent-basis-gate.test.ts`):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateConsentBasis } from "../crm-sms";

test("NONE always refuses, whatever else is true", () => {
  const r = evaluateConsentBasis({ basis: "NONE", dncStatus: "not_found", phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "NO_CONSENT_BASIS");
});

test("NONE refuses even when every other signal is maximally permissive", () => {
  const r = evaluateConsentBasis({
    basis: "NONE", dncStatus: "not_found", phoneType: "corporate_phone",
    suppressed: false, quietHours: false, sendEnabled: true,
  });
  assert.equal(r.allowed, false, "no combination of other signals may manufacture consent");
});

test("EXPRESS_WRITTEN is permitted when nothing else blocks", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "corporate_phone" }).allowed, true);
});

test("EXPRESS is permitted when nothing else blocks", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "not_found", phoneType: "direct_phone" }).allowed, true);
});

test("EXISTING_BUSINESS_RELATIONSHIP is permitted when nothing else blocks", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXISTING_BUSINESS_RELATIONSHIP", dncStatus: "not_found", phoneType: "corporate_phone" }).allowed, true);
});

test("an unrecognised basis value fails closed as NONE", () => {
  const r = evaluateConsentBasis({ basis: "SOMETHING_ELSE" as never, dncStatus: "not_found", phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
});

test("DNC blocks independently of a valid consent basis", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "found", phoneType: "corporate_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "DNC_BLOCKED");
});

test("DNC 'pending' is not clear and blocks", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "pending", phoneType: "corporate_phone" }).allowed, false);
});

test("a null dnc_status is unchecked and blocks", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS", dncStatus: null, phoneType: "corporate_phone" }).allowed, false);
});

test("phone_type gates INDEPENDENTLY of DNC — mobile is blocked by default", () => {
  const r = evaluateConsentBasis({ basis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "mobile_phone" });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "PHONE_TYPE_BLOCKED", "mobile carries higher risk than a corporate line");
});

test("mobile is permitted only when explicitly allowed by config", () => {
  const r = evaluateConsentBasis(
    { basis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "mobile_phone" },
    { allowedPhoneTypes: ["mobile_phone", "direct_phone", "corporate_phone"] },
  );
  assert.equal(r.allowed, true);
});

test("an unknown phone_type is blocked", () => {
  assert.equal(evaluateConsentBasis({ basis: "EXPRESS", dncStatus: "not_found", phoneType: "unknown" }).allowed, false);
});

test("every dealer prospect resolves to NONE today — SMS reaches zero of them", async () => {
  // The intended outcome, not a bug: nothing in this PR creates a consent record.
  const basis = await resolveProspectConsentBasis("p1", fakeDeps({ noConsentRecord: true }) as never);
  assert.equal(basis, "NONE");
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `evaluateConsentBasis` in `crm-sms.ts`** and route the existing
  `consent_sms` check through it: `consent_sms === true` maps to `EXPRESS`,
  `do_not_contact === true` maps to `NONE`. This is a widening of the same gate, not a
  new one — existing CRM callers keep their exact current behaviour, proven by re-running
  `pnpm test:crm-services` and `pnpm test:comms-outbox`.
- [ ] **Step 4: Run — expect PASS, and re-run the existing CRM suites for regressions.**

### 8b — dealer call logging (the shipping deliverable, ENABLED)

- [ ] **Step 5: Write the failing test** (`dealer-call-log.test.ts`):

```ts
test("a logged call writes exactly one CALL row with disposition, duration and notes", async () => {
  const d = fakeCallDeps({});
  await logDealerCall({ prospectId: "p1", disposition: "CONNECTED", durationSeconds: 214, notes: "Spoke to GM", actorId: "admin-1" }, d as never);
  const rows = d.logRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "CALL");
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].callDisposition, "CONNECTED");
  assert.equal(rows[0].callDurationSeconds, 214);
  assert.equal(rows[0].body, "Spoke to GM");
});

test("call logging does NOT require the send flag — it records a human action", async () => {
  const d = fakeCallDeps({ sendEnabled: false });
  const r = await logDealerCall({ prospectId: "p1", disposition: "VOICEMAIL", durationSeconds: 0, notes: "", actorId: "admin-1" }, d as never);
  assert.ok(r.logId);
  assert.equal(d.logRows().length, 1);
});

test("call logging is NOT blocked by DNC — DNC blocks DIALING, not recording a call that happened", async () => {
  const d = fakeCallDeps({ dncStatus: "found" });
  const r = await logDealerCall({ prospectId: "p1", disposition: "WRONG_NUMBER", durationSeconds: 12, notes: "", actorId: "admin-1" }, d as never);
  assert.ok(r.logId, "recording history must never be gated on a send-time control");
});

test("an invalid disposition is rejected without writing", async () => {
  const d = fakeCallDeps({});
  await assert.rejects(
    () => logDealerCall({ prospectId: "p1", disposition: "MADE_UP" as never, durationSeconds: 0, notes: "", actorId: "admin-1" }, d as never),
  );
  assert.equal(d.logRows().length, 0);
});

test("a negative duration is rejected without writing", async () => {
  const d = fakeCallDeps({});
  await assert.rejects(
    () => logDealerCall({ prospectId: "p1", disposition: "CONNECTED", durationSeconds: -5, notes: "", actorId: "admin-1" }, d as never),
  );
  assert.equal(d.logRows().length, 0);
});

test("two calls to the same prospect both log — calls are not idempotent by step", async () => {
  const d = fakeCallDeps({});
  await logDealerCall({ prospectId: "p1", disposition: "NO_ANSWER", durationSeconds: 0, notes: "", actorId: "admin-1" }, d as never);
  await logDealerCall({ prospectId: "p1", disposition: "CONNECTED", durationSeconds: 90, notes: "", actorId: "admin-1" }, d as never);
  assert.equal(d.logRows().length, 2, "a second real call is a second real event");
});

test("a CONNECTED call advances DISCOVERED/SCRIPTED to CONTACTED", async () => {
  const d = fakeCallDeps({ currentStatus: "SCRIPTED" });
  await logDealerCall({ prospectId: "p1", disposition: "CONNECTED", durationSeconds: 90, notes: "", actorId: "admin-1" }, d as never);
  assert.equal(d.statusTransitions()[0]?.to, "CONTACTED");
});

test("a NO_ANSWER call does NOT advance status", async () => {
  const d = fakeCallDeps({ currentStatus: "SCRIPTED" });
  await logDealerCall({ prospectId: "p1", disposition: "NO_ANSWER", durationSeconds: 0, notes: "", actorId: "admin-1" }, d as never);
  assert.equal(d.statusTransitions().length, 0);
});
```

- [ ] **Step 6: Run — expect FAIL. Step 7: Implement** through
  `recordOutreachAttempt` with `channel: "CALL"`. Step 8: Run — expect PASS.
- [ ] **Step 9: Add `POST /api/admin/dealer-outreach/log-call`** with admin auth.

### 8c — `sendDealerSms`, built fully, flag OFF

- [ ] **Step 10: Write the failing test.** Same gate coverage as before —
  `dnc_blocked` for `found` / `pending` / `null`; `suppressed` checked at SEND time;
  `quiet_hours`; `send_disabled` by default; a Twilio failure writing one failed row with
  the error; `twilio_sid` persisted on success; the SMS idempotency key distinct from the
  email one at the same step — **plus**:

```ts
test("sendDealerSms delegates the consent decision to evaluateConsentBasis, never its own copy", async () => {
  const d = fakeSmsDeps({ dncStatus: "not_found", basis: "NONE" });
  const r = await sendDealerSms({ prospectId: "p1", body: "hi" }, d as never);
  assert.equal(r.reason, "no_consent_basis");
  assert.equal(d.twilioSends(), 0);
  assert.equal(d.consentEvaluations(), 1, "the shared gate must be the one that decided");
});

test("every dealer SMS attempt records its consent_basis on the log row", async () => {
  const d = fakeSmsDeps({ dncStatus: "not_found", basis: "NONE" });
  await sendDealerSms({ prospectId: "p1", body: "hi" }, d as never);
  assert.equal(d.logRows()[0].consentBasis, "NONE");
});
```

- [ ] **Step 11: Run — expect FAIL. Step 12: Implement**, delegating to
  `evaluateConsentBasis` and reusing the Twilio client from `crm-sms.ts`. No new SDK
  wrapper, no new queue, no new scheduler. Step 13: Run — expect PASS.
- [ ] **Step 14: Add `POST /api/admin/dealer-outreach/send-sms`.**
- [ ] **Step 15: Commit**

```bash
git commit -am "feat(dealer-outreach): call logging (enabled) + consent-basis-gated SMS (off by default)"
```

## Task 9: Contactability resolver for the queue read-model

**Files:**
- Create: `lib/services/dealer-recruitment/outreach-queue.service.ts`
- Test: `lib/services/dealer-recruitment/__tests__/outreach-queue.test.ts`

**Interfaces:**
- Produces:
  `type Contactability = "EMAIL_READY" | "SMS_READY" | "BOTH_READY" | "UNREACHABLE"`,
  `resolveContactability(row: QueueSourceRow): { contactability: Contactability; dncBlocked: boolean; reasons: string[] }`,
  `loadOutreachQueue(filters, deps?): Promise<{ rows: QueueRow[]; counts: QueueCounts }>`.

- [ ] **Step 1: Write the failing test** — all four outcomes plus the interaction with
  DNC and suppression:

```ts
test("send-safe email only -> EMAIL_READY", () => {
  const r = resolveContactability({ email: "a@b.com", emailVerificationStatus: "VERIFIED", phone: null, dncStatus: null, emailSuppressed: false, smsSuppressed: false });
  assert.equal(r.contactability, "EMAIL_READY");
});

test("dnc-clear phone only -> SMS_READY", () => {
  const r = resolveContactability({ email: null, emailVerificationStatus: null, phone: "+15125551212", dncStatus: "not_found", emailSuppressed: false, smsSuppressed: false });
  assert.equal(r.contactability, "SMS_READY");
  assert.equal(r.dncBlocked, false);
});

test("both channels open -> BOTH_READY", () => {
  const r = resolveContactability({ email: "a@b.com", emailVerificationStatus: "ROLE_DERIVED", phone: "+15125551212", dncStatus: "not_found", emailSuppressed: false, smsSuppressed: false });
  assert.equal(r.contactability, "BOTH_READY");
});

test("no email and a DNC-found phone -> UNREACHABLE with a stated reason", () => {
  const r = resolveContactability({ email: null, emailVerificationStatus: null, phone: "+15125551212", dncStatus: "found", emailSuppressed: false, smsSuppressed: false });
  assert.equal(r.contactability, "UNREACHABLE");
  assert.equal(r.dncBlocked, true);
  assert.ok(r.reasons.includes("dnc_found"));
});

test("an UNVERIFIED email is not send-safe and does not make the row contactable", () => {
  const r = resolveContactability({ email: "a@b.com", emailVerificationStatus: "UNVERIFIED", phone: null, dncStatus: null, emailSuppressed: false, smsSuppressed: false });
  assert.equal(r.contactability, "UNREACHABLE");
});

test("a suppressed email is excluded even when VERIFIED", () => {
  const r = resolveContactability({ email: "a@b.com", emailVerificationStatus: "VERIFIED", phone: null, dncStatus: null, emailSuppressed: true, smsSuppressed: false });
  assert.equal(r.contactability, "UNREACHABLE");
  assert.ok(r.reasons.includes("email_suppressed"));
});

test("the default queue filter hides UNREACHABLE but the bucket still COUNTS them", async () => {
  const d = fakeQueueDeps({ reachable: 12, unreachable: 1365 });
  const q = await loadOutreachQueue({}, d as never);
  assert.equal(q.rows.length, 12);
  assert.equal(q.counts.unreachable, 1365, "the unreachable bucket must be visible, not silently filtered");
});

test("the unreachable bucket is openable as its own view", async () => {
  const d = fakeQueueDeps({ reachable: 12, unreachable: 1365 });
  const q = await loadOutreachQueue({ bucket: "unreachable" }, d as never);
  assert.equal(q.rows.length, 1365);
});

test("personnel are read from dealer_contact_profiles, not dealer_prospects columns", async () => {
  const d = fakeQueueDeps({
    prospectColumns: { contactName: "STALE NAME", contactTitle: "STALE TITLE" },
    profile: { name: "Dana Reyes", title: "General Manager", contactSource: "apollo", contactConfidence: "high" },
  });
  const q = await loadOutreachQueue({}, d as never);
  assert.equal(q.rows[0].contactName, "Dana Reyes");
  assert.equal(q.rows[0].contactSource, "apollo");
});

test("a prospect with no profile shows no provenance rather than the unprovenanced column value", async () => {
  const d = fakeQueueDeps({ prospectColumns: { contactName: "Legacy Name" }, profile: null });
  const q = await loadOutreachQueue({}, d as never);
  assert.equal(q.rows[0].contactName, null);
  assert.equal(q.rows[0].contactSource, null);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `SEND_SAFE_STATUSES` is imported from
  `contact-resolution.service` — do not redefine it. Personnel come from
  `dealer_contact_profiles` only: the 594 `contact_name` values on `dealer_prospects`
  have zero provenance (`contact_source` NULL on all 1,532 rows) and are therefore
  treated as unverified and not surfaced.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(dealer-outreach): contactability resolver and queue read-model"
```

---

## Task 10: Geo backfill script (owner-run, never auto-executed)

**Files:**
- Create: `scripts/backfill-rooftop-geo.ts`
- Test: `lib/services/dealer-recruitment/__tests__/rooftop-geo-backfill.test.ts`

**Interfaces:**
- Produces: `planGeoBackfill(deps?): Promise<GeoBackfillPlan>`,
  `applyGeoBackfill(plan, deps?): Promise<GeoBackfillResult>`.

- [ ] **Step 1: Write the failing test:**

```ts
test("dealer_intelligence name+city+state is the first source", async () => {
  const p = await planGeoBackfill(fakeGeoDeps({
    rooftops: [{ id: "r1", displayName: "Round Rock Toyota", city: "Austin", state: "TX", zip: "78701", latitude: null, longitude: null }],
    intelligence: [{ dealerName: "Round Rock Toyota", city: "Austin", state: "TX", latitude: 30.5, longitude: -97.6 }],
  }) as never);
  assert.equal(p.entries[0].source, "dealer_intelligence");
  assert.equal(p.entries[0].latitude, 30.5);
});

test("zip centroid is the fallback for the remainder", async () => {
  const p = await planGeoBackfill(fakeGeoDeps({
    rooftops: [{ id: "r1", displayName: "Nowhere Motors", city: "Plano", state: "TX", zip: "75024", latitude: null, longitude: null }],
    intelligence: [],
    zipCentroids: { "75024": { latitude: 33.07, longitude: -96.75 } },
  }) as never);
  assert.equal(p.entries[0].source, "zip_centroid");
});

test("a rooftop that already has coordinates is left alone", async () => {
  const p = await planGeoBackfill(fakeGeoDeps({
    rooftops: [{ id: "r1", displayName: "X", city: "Austin", state: "TX", zip: "78701", latitude: 1, longitude: 2 }],
    intelligence: [{ dealerName: "X", city: "Austin", state: "TX", latitude: 9, longitude: 9 }],
  }) as never);
  assert.equal(p.entries.length, 0);
});

test("the plan writes nothing — apply is a separate, explicit call", async () => {
  const d = fakeGeoDeps({ rooftops: [{ id: "r1", displayName: "X", city: "Austin", state: "TX", zip: "78701", latitude: null, longitude: null }], intelligence: [] });
  await planGeoBackfill(d as never);
  assert.equal(d.writes(), 0);
});

test("coordinates are written to the rooftop and never duplicated onto the prospect", async () => {
  const d = fakeGeoDeps({ rooftops: [{ id: "r1", displayName: "X", city: "Austin", state: "TX", zip: "78701", latitude: null, longitude: null }], intelligence: [{ dealerName: "X", city: "Austin", state: "TX", latitude: 30.2, longitude: -97.7 }] });
  await applyGeoBackfill(await planGeoBackfill(d as never), d as never);
  assert.equal(d.rooftopWrites().length, 1);
  assert.equal(d.prospectWrites().length, 0, "prospects read geo THROUGH the rooftop");
});
```

- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: Run — expect PASS.**
- [ ] **Step 5:** The script's `main()` requires `--apply` AND
  `GEO_BACKFILL_CONFIRM=yes`; without both it prints the plan and exits 0. It is not
  wired to any cron. Do not run it against production.
- [ ] **Step 6: Commit**

```bash
git commit -am "feat(dealer-outreach): owner-run rooftop geo backfill (plan/apply separated)"
```

---

## Task 11: The queue UI

**Files:**
- Create: `app/admin/dealer-outreach/queue/page.tsx`,
  `OutreachQueueClient.tsx`, `QueueRow.tsx`, `ContactabilityBadge.tsx`,
  `DncBadge.tsx`, `ApolloSyncPanel.tsx`, `BulkActionDialog.tsx`,
  `ProspectDetailPanel.tsx`
- Modify: `app/admin/dealer-outreach/page.tsx`, `lib/admin/nav.ts`

**Design constraints (from `frontend-design` + `autolenis-ui-design-system`):** reuse the
established admin surface — `bg-[#F4F6FA]` page ground, white `rounded-2xl` cards with
`border-[#E2E8F0]`, `text-[#0F172A]` / `text-[#64748B]` type ramp, `text-al-primary` /
`brand.blue #0B5FD1` accent, `lucide-react` icons. This is an operator work queue, not a
marketing page: the visual weight goes on the one thing an operator needs to read at a
glance — the contactability and DNC state of each row — and everything else stays quiet.
No new palette, no restyling of unrelated admin pages, no decorative motion.

- [ ] **Step 1: Build the queue page** as an RSC shell (`requireAdmin()`, then
  `loadOutreachQueue`) with a client component for filtering/selection, matching the
  existing `page.tsx` + `DealerPipelineClient` split.
- [ ] **Step 2: Default filters** — `contactability != UNREACHABLE`,
  `status in (DISCOVERED, SCRIPTED)`, not suppressed, not DNC-blocked, sorted by score
  then proximity to an active `buyer_opportunity`.
- [ ] **Step 3: Row contents** — dealer name, city/state, contact name + title,
  contactability badge, DNC badge, last touch (from the log), next step, ONE primary
  action.
- [ ] **Step 4: Detail panel** — personnel from `dealer_contact_profiles` with Apollo
  provenance (`contact_source`, `contact_confidence`, `apollo_last_synced_at`), the
  script, the full outreach timeline, and status-transition controls including the DEAD
  form with a required `dead_reason` textarea.
- [ ] **Step 5: Apollo sync panel** — candidate count, credits remaining, worst-case cost
  preview, and an explicit confirm. The preview endpoint is called on mount; the spend
  endpoint is called ONLY from the confirm button. Never one-click a spend.
- [ ] **Step 6: Bulk actions** — a confirmation dialog naming the exact channel, the
  recipient count, and every exclusion applied (suppressed / DNC / unreachable), with the
  counts computed server-side and echoed back before anything is queued.
- [ ] **Step 7: All required states** — loading (skeleton), empty (an invitation to run
  an Apollo sync), error (what failed and what to do), partial-failure (an N-of-M banner
  linking to the failed rows), plus a visible UNREACHABLE bucket with its count.
- [ ] **Step 8: Accessibility** — every control reachable by keyboard in visual order,
  visible focus rings, `aria-label` on icon-only buttons, badges carrying text not colour
  alone, the detail panel as a focus-trapped dialog returning focus on close.
- [ ] **Step 9: Add the nav entry** in `lib/admin/nav.ts` under the existing "Dealers"
  group and register the breadcrumb parent, then run `pnpm test:admin-nav`.
- [ ] **Step 10: Run the Impeccable audit** per its own definition on every file touched.
- [ ] **Step 11: Commit**

```bash
git commit -am "feat(dealer-outreach): prioritized operator work queue with Apollo sync and DNC surfacing"
```

---

## Task 12: Playwright E2E — extend the existing harness

**Files:**
- Create: `tests/e2e/dealer-outreach.spec.ts`
- Create: `tests/e2e/fixtures/dealer-outreach-seed.ts`
- Modify: `.github/workflows/ci.yml`

**Harness:** EXTEND `playwright.e2e.config.ts` (`testDir: ./tests/e2e`, desktop + mobile
projects, `E2E_BASE_URL`, `E2E_STORAGE_STATE`). Do NOT add a third config. Follow the
existing convention: a spec SKIPS itself with an explicit reason when its prerequisites
are absent rather than passing vacuously.

**Vendor mocking:** Apollo, Resend and Twilio are mocked at the NETWORK boundary with
`page.route()` on `**/api.apollo.io/**`, `**/api.resend.com/**`,
`**/api.twilio.com/**`. No live vendor call, no real message, no credit spend.

- [ ] **Step 1: Write the seed fixture** creating: 3 reachable prospects (one
  EMAIL_READY, one SMS_READY, one BOTH_READY), 1 DNC-`found` prospect, 1 DNC-`pending`
  prospect, 5 UNREACHABLE prospects, and their rooftops + contact profiles.
- [ ] **Step 2: Spec 1 — queue loads with default filters and a counted UNREACHABLE bucket**

```ts
test("queue applies default filters and counts the unreachable bucket", async ({ page }) => {
  await page.goto("/admin/dealer-outreach/queue");
  await expect(page.getByTestId("outreach-queue")).toBeVisible();
  await expect(page.getByTestId("queue-row")).toHaveCount(3);
  const bucket = page.getByTestId("unreachable-bucket");
  await expect(bucket).toBeVisible();
  await expect(bucket).toContainText("5");
});
```

- [ ] **Step 3: Spec 2 — Apollo preview requires an explicit confirm; cancelling spends nothing**

```ts
test("apollo sync previews cost and cancelling spends nothing", async ({ page }) => {
  let spendCalls = 0;
  await page.route("**/api/admin/dealer-outreach/apollo/enrich", (r) => { spendCalls++; return r.abort(); });
  await page.goto("/admin/dealer-outreach/queue");
  await page.getByTestId("apollo-sync-open").click();
  await expect(page.getByTestId("apollo-candidate-count")).toContainText(/\d+/);
  await expect(page.getByTestId("apollo-credit-estimate")).toContainText(/\d+/);
  await expect(page.getByTestId("apollo-credits-remaining")).toBeVisible();
  await page.getByTestId("apollo-sync-cancel").click();
  expect(spendCalls).toBe(0);
});
```

- [ ] **Step 4: Spec 3 — enrichment respects the cap and aborts with a recorded reason**

```ts
test("enrichment stops at the credit cap and records why", async ({ page }) => {
  await page.goto("/admin/dealer-outreach/queue");
  await page.getByTestId("apollo-sync-open").click();
  await page.getByTestId("apollo-max-credits").fill("2");
  await page.getByTestId("apollo-sync-confirm").click();
  const result = page.getByTestId("apollo-run-result");
  await expect(result).toContainText("ABORTED_CAP");
  await expect(result).toContainText("2");
});
```

- [ ] **Step 5: Spec 4 — a DNC contact cannot be SMSed, enforced SERVER-SIDE**

```ts
test("a DNC-flagged contact is blocked in the UI and again on the server", async ({ page, request }) => {
  await page.goto("/admin/dealer-outreach/queue?bucket=unreachable");
  const row = page.getByTestId("queue-row").filter({ hasText: "DNC Blocked Motors" });
  await expect(row.getByTestId("dnc-badge")).toBeVisible();
  await expect(row.getByTestId("dnc-badge")).toContainText(/do not call/i);
  await expect(row.getByTestId("send-sms-action")).toBeDisabled();

  // The DOM being disabled proves nothing. Call the API directly.
  const res = await request.post("/api/admin/dealer-outreach/send-sms", {
    data: { prospectId: process.env.E2E_DNC_PROSPECT_ID, body: "hello" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error?.code).toBe("DNC_BLOCKED");
});

test("a DNC 'pending' contact is blocked server-side too", async ({ request }) => {
  const res = await request.post("/api/admin/dealer-outreach/send-sms", {
    data: { prospectId: process.env.E2E_DNC_PENDING_PROSPECT_ID, body: "hello" },
  });
  expect(res.status()).toBe(422);
});
```

- [ ] **Step 6: Spec 5 — the full status machine, DEAD requiring dead_reason**

```ts
test("status machine walkthrough, DEAD requires a reason", async ({ page }) => {
  await page.goto(`/admin/dealer-outreach/queue?prospect=${process.env.E2E_PROSPECT_ID}`);
  for (const next of ["SCRIPTED", "CONTACTED", "REPLIED", "ONBOARDED"]) {
    await page.getByTestId(`status-to-${next}`).click();
    await expect(page.getByTestId("prospect-status")).toContainText(next);
  }
  await page.goto(`/admin/dealer-outreach/queue?prospect=${process.env.E2E_PROSPECT_2_ID}`);
  await page.getByTestId("status-to-DEAD").click();
  await page.getByTestId("dead-confirm").click();
  await expect(page.getByTestId("dead-reason-error")).toBeVisible();
  await page.getByTestId("dead-reason").fill("Declined — franchise conflict");
  await page.getByTestId("dead-confirm").click();
  await expect(page.getByTestId("prospect-status")).toContainText("DEAD");
});
```

- [ ] **Step 7: Spec 6 — a failed send writes exactly one log row and shows partial failure**

```ts
test("a failed send produces exactly one log row and a partial-failure banner", async ({ page }) => {
  await page.route("**/api.resend.com/**", (r) => r.fulfill({ status: 500, body: '{"message":"boom"}' }));
  await page.goto("/admin/dealer-outreach/queue");
  await page.getByTestId("queue-row").first().getByTestId("select-row").check();
  await page.getByTestId("bulk-send-email").click();
  await expect(page.getByTestId("bulk-confirm-summary")).toContainText("1 recipient");
  await page.getByTestId("bulk-confirm").click();
  await expect(page.getByTestId("partial-failure-banner")).toBeVisible();
  await page.goto(`/admin/dealer-outreach/queue?prospect=${process.env.E2E_PROSPECT_ID}`);
  await expect(page.getByTestId("outreach-timeline-entry")).toHaveCount(1);
  await expect(page.getByTestId("outreach-timeline-entry").first()).toContainText(/failed/i);
});
```

- [ ] **Step 8: Spec 7 — accessibility on the queue and the detail panel**

```ts
test("queue and detail panel are keyboard navigable with labelled controls", async ({ page }) => {
  await page.goto("/admin/dealer-outreach/queue");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  for (const id of ["apollo-sync-open", "bulk-send-email", "unreachable-bucket"]) {
    await expect(page.getByTestId(id)).toHaveAttribute("aria-label", /.+/);
  }
  await page.getByTestId("queue-row").first().getByTestId("open-detail").click();
  const panel = page.getByTestId("prospect-detail-panel");
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(":focus")).toBeVisible();       // focus moved into the panel
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("queue-row").first().getByTestId("open-detail")).toBeFocused();
});
```

- [ ] **Step 9: Wire Playwright into CI.** Add an `e2e` job to `.github/workflows/ci.yml`
  alongside the existing `ci` / `migrations` / `dependency-audit` jobs: a Postgres
  service container, `prisma migrate deploy`, seed, `pnpm build && pnpm start &`, then
  `pnpm test:e2e` with `PW_CHROMIUM_PATH` set and `playwright install` never run.
- [ ] **Step 10: Commit**

```bash
git add frontend/tests .github/workflows/ci.yml
git commit -m "test(dealer-outreach): E2E coverage on the existing Playwright harness, wired into CI"
```

---

## Task 13: Verification, dual review, draft PR

- [ ] **Step 1:** `cd frontend && pnpm typecheck`
- [ ] **Step 2:** `pnpm lint`
- [ ] **Step 3:** `pnpm test:coverage-check` — every new `*.test.ts` must be reachable.
- [ ] **Step 4:** `pnpm test:all` — the full matrix.
- [ ] **Step 5:** `pnpm build`
- [ ] **Step 6:** `pnpm test:e2e` if a base URL is available; otherwise report the
  specs as NOT VERIFIED, naming the missing `E2E_BASE_URL` and seeded database.
- [ ] **Step 7: FIRST review** — read every changed file and its callers per
  `autolenis-code-verification` STEP 2.
- [ ] **Step 8: SECOND independent review** — re-read the final code as though another
  engineer wrote it, including the fixes made in step 7.
- [ ] **Step 9:** `autolenis-production-readiness` → explicit PASS / PASS WITH
  CONDITIONS / BLOCKED.
- [ ] **Step 10:** Push to `claude/dealer-outreach-operational-jaichm` and open a DRAFT
  PR carrying the verification report, the verdict, and the owner-gated list.

---

## Owner-gated — STOP AND REPORT BEFORE

Merging · deploying · applying ANY migration · running the geo backfill against
production · running ANY Apollo enrichment that spends real credits · enabling waterfall
· enabling `DEALER_OUTREACH_SEND_ENABLED` or `DEALER_OUTREACH_SMS_ENABLED` · sending any
real email or SMS to any real dealer.
