# Dealer Entry Funnel Remediation — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execute task-by-task;
> each task ends with an independently testable deliverable and a commit.

**Goal:** Make the dealer entry funnel actually traversable end to end — application/invite/prospect
→ claim → onboarding → ACTIVE → working inventory upload — by fixing twelve verified defects (D1–D12)
without introducing a parallel auth, token, or onboarding system.

**Architecture:** Admin approval grants *permission to onboard*, not portal access. The dealer stays
`PENDING` and holds an **onboarding-scoped session**; every non-onboarding `/dealer/*` path redirects
to `/dealer/onboarding`. `ACTIVE` is set exactly once, when the agreement step records a signature via
`recordDealerAgreementSignature`. Scope is derived from `Dealer.status` server-side (authoritative) and
mirrored into the dealer JWT for an edge-level redirect (defense in depth, never the sole gate).

**Tech Stack:** Next.js 16.2.9 App Router · React 19 · TypeScript strict · Prisma 5 · Supabase Postgres ·
zod · Playwright · node:test

**Spec:** This document. The lifecycle model was decided by the owner and is implemented, not re-opened.

## Global Constraints

- Edge routing lives in `frontend/proxy.ts`. **Never** introduce `middleware.ts`.
- Business logic lives in `frontend/lib/services/**`; route handlers stay thin.
- Prisma singleton via `lib/prisma.ts` only.
- Tokens are **hashed at rest**, single-use, TTL-bounded, never logged. Extend
  `lib/services/dealer-recruitment/account-claim.service.ts` — do **not** write a second token system.
- `Dealer.tier` stays a `String`. `DealerStatus` = `PENDING → ACTIVE → SUSPENDED → TERMINATED`.
- Money is integer minor units (`*Cents`) end to end.
- No raw hex in components — use `--color-al-*` tokens; reuse `components/admin/crm/ui/`.
- Every success response must correspond to a verified persisted state change. A handler that cannot
  persist returns an error.
- **No migration is applied to production in this branch.** Migration SQL is written and committed;
  application awaits owner approval.
- No real email/SMS (`DEV_SKIPPED` path only), no Stripe calls, no writes to project `aieybibvewmvrubcpthm`.

---

## 1. Verification of seeded defects (Phase 0 result)

All twelve confirmed present on `e7ede4e`. **None already fixed.**

| ID | Confirmed at | Production corroboration |
| --- | --- | --- |
| D1 | `proxy.ts:461-467` exempts only `/dealer/invite/claim`, `/dealer/invite/complete`, `/dealer/onboarding/fast-track`; `/dealer/claim` absent from `PUBLIC_ROUTES` and `DEALER_AUTH_ROUTES:137-143` → page redirects at `:474`, API 401s at `:468-472` before its own token check | `dealer_account_claim_tokens`: 1 issued, 0 consumed, 1 expired |
| D2 | `lib/auth/dealer-session.ts:15` `BLOCKED_STATUSES` includes `PENDING` (applied `:32`, `:50`); creators set PENDING at `admin/dealers/applications/[appId]/approve/route.ts:86`, `dealer/invite/claim/route.ts:85`, `prospect-claim.service.ts:129`; `app/dealer/layout.tsx:23` → `requireDealer()`; only `app/api/dealer/onboarding/route.ts:209` sets ACTIVE; signin 403s at `auth/signin/route.ts:67-70` | — |
| D3 | `schema.prisma` `DealerInvitation.token String @unique` + `@@index([token])` (plaintext, no `consumedAt`); TTL `72*60*60*1000` at `admin/dealers/invite/route.ts:46`; plaintext lookup `findUnique({where:{token}})` at `dealer/invite/claim/route.ts:42,152`; lazy expiry only on hit at `:47,162` | 11 invitations — `PENDING=1, EXPIRED=6, ACCEPTED=4`; **7** rows past `expiresAt` and unaccepted (the extra one *is* the lazy-expiry gap); 3 of 4 ACCEPTED point at deleted `dealer_id`s |
| D4 | `app/dealer/onboarding/fast-track/page.tsx:20` asserts the shortlist; the file's only `await` is `requireDealer()` at `:10`; zero inbound links; exempted at `proxy.ts:464` | — |
| D5 | `getDealerOnboardingStatus` — zero callers; required set at `dealer-onboarding.service.ts:23-24` includes `inventory` vs live chain `BUSINESS_INFO→LICENSE→INVENTORY→AGREEMENT→COMPLETE` | — |
| D6 | `app/dealer/apply/page.tsx:119` and `app/(public)/dealer-application/page.tsx:85` both POST `/api/public/dealer-application`; shims at `route.ts:20,31,61-64,85` | `dealer_applications` = 1 |
| D7 | `app/api/cron/dealer-scorecard-snapshot/route.ts:22` exports `POST`; `vercel.json:136-137` schedules GET | 0 `cron_job_logs` rows, 0 `dealer_scorecard_snapshots` |
| D8 | `add/page.tsx:8,26` sends `condition:"Good"` + `description`; `api/dealer/inventory/route.ts:32,34` `.strict()` + `z.enum(["NEW","USED","CPO"])` | `source_adapter='dealer_manual'` = 0 rows |
| D9 | `app/dealer/inventory/[id]/edit/page.tsx:25,31` sync `params` in a `"use client"` file under Next 16.2.9 | — |
| D10 | cookie `path:"/dealer"` at `column-mapping/route.ts:199`; read at `bulk/route.ts:42` on `/api/dealer/inventory/bulk` | — |
| D11 | `bulk-upload/page.tsx:33` `num < 10000 ? num*100 : num` vs `bulk/route.ts:93` `parseFloat(...)*100` | `source_adapter='dealer_csv'` = 0 rows |
| D12 | `contracts/upload/route.ts:6` `documentUrl: z.string().url()` → `extract-text.ts:18-21` bare `fetch(documentUrl)` | — |

---

## 2. The lifecycle state machine

### 2.1 State variables

| Variable | Domain |
| --- | --- |
| `Dealer.status` | `PENDING` · `ACTIVE` · `SUSPENDED` · `TERMINATED` |
| `Dealer.onboardingStep` | `BUSINESS_INFO` · `LICENSE` · `INVENTORY` · `AGREEMENT` · `COMPLETE` |
| Claim token | *none* · `ISSUED` · `CONSUMED` · `EXPIRED` (from `DealerAccountClaimToken.consumedAt`/`expiresAt`) |
| Invitation token | *none* · `PENDING` · `ACCEPTED` · `EXPIRED` · `CANCELLED` (`DealerInvitationStatus`) |
| Session scope | `NONE` · `ONBOARDING` · `FULL` — **derived**, never stored: `NONE` if no valid JWT or status ∈ {SUSPENDED, TERMINATED}; `ONBOARDING` if status = PENDING; `FULL` if status = ACTIVE |

**Session scope is derived from `Dealer.status` on every request** (`lib/auth/dealer-session.ts`). The JWT
carries a mirrored `scope` claim used **only** for the edge redirect in `proxy.ts`; it is never the
authorization decision. A stale claim can therefore widen nothing — the server re-derives.

### 2.2 Composite states

| # | State | status | onboardingStep | Session scope |
| --- | --- | --- | --- | --- |
| S0 | Applicant (no Dealer row) | — | — | NONE |
| S1 | Approved, unclaimed | PENDING | BUSINESS_INFO | NONE (no password) |
| S2 | Claimed, onboarding: business info | PENDING | BUSINESS_INFO | ONBOARDING |
| S3 | Onboarding: license | PENDING | LICENSE | ONBOARDING |
| S4 | Onboarding: inventory | PENDING | INVENTORY | ONBOARDING |
| S5 | Onboarding: agreement | PENDING | AGREEMENT | ONBOARDING |
| S6 | Active dealer | ACTIVE | COMPLETE | FULL |
| S7 | Suspended | SUSPENDED | any | NONE |
| S8 | Terminated | TERMINATED | any | NONE |
| S9 | **Legacy active** (grandfathered) | ACTIVE | ≠ COMPLETE | FULL |

> **S9 exists in production today** (`AutoLenis Dealers`: ACTIVE, `onboardingStep = BUSINESS_INFO`).
> This plan **never demotes an existing ACTIVE dealer**. S9 keeps FULL scope; the model binds new
> dealers only. Stated so the reader does not mistake this for an oversight.

### 2.3 Transitions

| T | From → To | Trigger | Guard | Effect |
| --- | --- | --- | --- | --- |
| T1 | S0 → S1 | Admin approves `DealerApplication` | `app.status === "PENDING"`; admin authenticated | Create user + `Dealer{status:PENDING, onboardingStep:BUSINESS_INFO}`; `issueClaimToken()`; email raw link |
| T2 | S0 → S1 | Dealer opens invite link, sets password | invitation token valid, unconsumed, unexpired | Create user + `Dealer{PENDING}`; mark invitation `ACCEPTED` + `consumedAt` |
| T3 | S0 → S1 | Prospect claims via `prospect-claim.service` | prospect claim token valid | Create user + `Dealer{PENDING}` |
| T4 | S1 → S2 | `POST /api/dealer/claim` with raw token + password | `validateClaimToken().ok`; `consumeClaimToken()` wins the race | Set Supabase password; mint ONBOARDING-scoped JWT |
| T5 | S2 → S3 | `PATCH /api/dealer/onboarding {step:"BUSINESS_INFO"}` | scope ≥ ONBOARDING; zod valid | Persist profile; `onboardingStep = "LICENSE"` |
| T6 | S3 → S4 | `PATCH … {step:"LICENSE"}` | `recordDealerLicense().ok` | Persist license; `onboardingStep = "INVENTORY"` |
| T7 | S4 → S5 | `PATCH … {step:"INVENTORY"}` | scope ≥ ONBOARDING | Optional feed config; `onboardingStep = "AGREEMENT"` |
| T8 | S5 → S6 | `PATCH … {step:"AGREEMENT"}` | scope ≥ ONBOARDING; signature recorded | `recordDealerAgreementSignature()` → `status:"ACTIVE"`, `onboardingStep:"COMPLETE"`; **re-mint JWT at FULL scope**; `after()` certificate + `dealer_activated` |
| T9 | S2..S5 → S2..S5 | Dealer signs in again | credentials valid; status = PENDING | Mint ONBOARDING JWT; land on `/dealer/onboarding` at the persisted step |
| T10 | S6 → S7 | Admin suspends | `setDealerStatus` | scope → NONE |
| T11 | S7 → S6 | Admin reinstates | `setDealerStatus` | scope → FULL |
| T12 | any → S8 | Admin terminates | `setDealerStatus` | scope → NONE (terminal) |
| T13 | S1 → S1 | Claim token expires / is re-issued | admin action | Old hash unusable; new token issued |
| T14 | invitation PENDING → EXPIRED | **sweep** in `dealer-invitation-reminder` cron, or lazy on hit | `expiresAt < now()` | `status = "EXPIRED"` |

### 2.4 Reachability proof — no state can strand a dealer

The obligation is: **from every state a dealer can occupy, `/dealer/onboarding` is reachable, or the
state is a deliberate terminal one.**

- **S1 (approved, unclaimed).** Reachable via the emailed claim link. D1 currently breaks this; Task 1
  adds `/dealer/claim` and `/api/dealer/claim` to the public surface, so T4 fires. If the token expired
  (T13), the claim page renders an explicit *expired* state with a "request a new link" action rather
  than a redirect to sign-in. **No dead end.**
- **S2–S5 (PENDING, mid-onboarding).** T9 lets the dealer sign in; sign-in no longer 403s PENDING
  (Task 3). `requireDealerForOnboarding()` admits PENDING, so `/dealer/onboarding` renders at the
  persisted `onboardingStep`. Every other `/dealer/*` redirects *to* onboarding rather than to
  sign-in — so a misdirected link cannot strand them. **No dead end.**
- **S6 (ACTIVE).** Full portal. Visiting `/dealer/onboarding` while COMPLETE returns the idempotent
  `redirect: "/dealer/dashboard"` already present at `onboarding/route.ts:171-173`.
- **S7/S8 (SUSPENDED/TERMINATED).** Deliberately terminal; sign-in returns the existing 403 with the
  suspension message. Onboarding is *intentionally* unreachable. This is the only unreachable case and
  it is by design.
- **S9 (legacy ACTIVE).** FULL scope; unaffected.

**The specific loop this design must not create:** `app/dealer/layout.tsx` redirecting PENDING → 
`/dealer/onboarding`, which is itself under that layout, which redirects again. Broken by having the
layout consult the current pathname (forwarded by `proxy.ts` as `x-al-pathname`) and skip the redirect
for `/dealer/onboarding*`. Task 2 asserts this with a test that follows the redirect chain to a fixed
point.

### 2.5 Reconciling the contradictory comments

- `app/api/admin/dealers/applications/[appId]/approve/route.ts:86` — comment already matches the decided
  model ("dealer must complete onboarding to become ACTIVE"). Keep; extend to name the scope.
- `app/api/dealer/onboarding/route.ts:204-206` — "the dealer is typically already ACTIVE from admin
  approval" is **false** under the decided model. Rewrite: activation happens here and only here.
- `lib/services/dealer/dealer-auction-eligibility.service.ts:6-10` — "a dealer is made ACTIVE by admin
  approval BEFORE onboarding (PENDING dealers can't sign in)" is **false** on both clauses. Rewrite to:
  approval grants onboarding permission; PENDING dealers sign in at onboarding scope; ACTIVE is set at
  agreement. The verification gate's own role (auction eligibility, flag-off) is unchanged.

---

## 3. Decisions the plan fixes

**D11 — unit convention.** *All CSV price columns are **dollars**, parsed as a decimal and multiplied by
100 to yield `priceCents`.* Rationale: it matches the server raw-rows path already
(`bulk/route.ts:93`), matches the column-mapping path (`column-mapping/route.ts:83`), matches the admin
form, and matches what dealers export from a DMS. The magnitude heuristic at `bulk-upload/page.tsx:33`
is deleted outright — a heuristic that silently divides by 100 is worse than a rejected row. A CSV
wanting cents must use an explicitly named `price_cents` header, which the parser maps without scaling.

**D3 — token hashing + TTL.** `DealerInvitation` gains `tokenHash` (unique), `consumedAt`, and keeps
`token` temporarily nullable for backfill. TTL 72h → **7 days**, matching `CLAIM_TOKEN_TTL_MS`.
Hash/validate/consume reuse the *same* helpers as the claim token by extending
`account-claim.service.ts` with a generic `hashToken`, rather than a second implementation.

**D3 — backfill strategy (migration NOT applied; awaits approval).**
1. `ALTER TABLE dealer_invitations ADD COLUMN token_hash text, ADD COLUMN consumed_at timestamp;`
2. Backfill: `UPDATE dealer_invitations SET token_hash = encode(digest(token,'sha256'),'hex') WHERE token IS NOT NULL;`
   (`pgcrypto` required — the migration `CREATE EXTENSION IF NOT EXISTS pgcrypto`.) This preserves every
   live link: the raw token in an unopened email still hashes to the stored value.
3. Backfill `consumed_at = accepted_at` where `status = 'ACCEPTED'`.
4. `CREATE UNIQUE INDEX dealer_invitations_token_hash_key ON dealer_invitations(token_hash);`
5. `DROP INDEX dealer_invitations_token_idx; ALTER TABLE dealer_invitations DROP COLUMN token;`
   **Step 5 is a separate, later migration** — deploy 1–4, verify, then drop. Never in one shot.
6. Data hygiene, separate and owner-approved: the 3 `ACCEPTED` rows with dangling `dealer_id` should be
   nulled (`dealer_id = NULL`) — **not** deleted, they are consent evidence.
   **Rollback:** steps 1–4 are additive and reversible by dropping the two columns and the index.

---

## 4. File structure

**Create**
- `frontend/lib/auth/dealer-scope.ts` — derives `NONE|ONBOARDING|FULL` from a Dealer row. Single source.
- `frontend/app/api/dealer/claim/__tests__/` — not applicable (route tests live under `lib`), see Task 1.
- `frontend/lib/services/dealer-recruitment/__tests__/invitation-token.test.ts`
- `frontend/lib/auth/__tests__/dealer-scope.test.ts`
- `frontend/lib/utils/__tests__/csv-price.test.ts`
- `frontend/lib/utils/csv-price.ts` — the one price parser both CSV paths import.
- `frontend/lib/security/__tests__/safe-fetch.test.ts`
- `frontend/lib/security/safe-fetch.ts` — allowlisted outbound fetch (D12).
- `frontend/prisma/migrations/<ts>_dealer_invitation_token_hash/migration.sql` — **not applied**.
- `frontend/tests/e2e/dealer-funnel.spec.ts` — Playwright specs (a)–(f).

**Modify**
- `frontend/proxy.ts` — public claim surface; `x-al-pathname`; drop the fast-track exemption.
- `frontend/lib/auth/dealer-session.ts` — PENDING out of `BLOCKED_STATUSES`; add onboarding helper.
- `frontend/app/dealer/layout.tsx` — scope-aware redirect.
- `frontend/app/api/dealer/auth/signin/route.ts` — stop 403ing PENDING.
- `frontend/lib/dealer-auth.ts` — `scope` claim; re-mint on activation.
- `frontend/app/api/admin/dealers/invite/route.ts` — hashed token, 7-day TTL.
- `frontend/app/api/dealer/invite/claim/route.ts` — hash lookup + consume.
- `frontend/app/api/cron/dealer-invitation-reminder/route.ts` — expiry sweep (T14).
- `frontend/app/api/cron/dealer-scorecard-snapshot/route.ts` — `POST` → `GET`.
- `frontend/app/dealer/inventory/add/page.tsx`, `app/api/dealer/inventory/route.ts` — D8.
- `frontend/app/dealer/inventory/[id]/edit/page.tsx`, `app/api/dealer/inventory/[id]/route.ts` — D9.
- `frontend/app/api/dealer/inventory/column-mapping/route.ts` — cookie path (D10).
- `frontend/app/dealer/inventory/bulk-upload/page.tsx`, `app/api/dealer/inventory/bulk/route.ts` — D11.
- `frontend/lib/services/contract-shield/extract-text.ts` — D12.
- `frontend/app/dealer/apply/page.tsx` → redirect; `app/api/public/dealer-application/route.ts` — D6.
- `frontend/app/api/dealer/onboarding/route.ts` + `lib/services/dealer/dealer-auction-eligibility.service.ts` — comments (§2.5).

**Delete**
- `frontend/app/dealer/onboarding/fast-track/` (D4)
- `frontend/lib/services/dealer/dealer-onboarding.service.ts` (D5)

---

## 5. Tasks

### Task 1 — Open the claim surface (D1)

**Files:** Modify `frontend/proxy.ts`; Test `frontend/lib/__tests__/proxy-routes.test.ts` (create).

**Interfaces:** Produces — `isPublicRoute`, `isDealerAuthRoute` behavior for `/dealer/claim`.

- [ ] **Step 1: Write the failing test**
```ts
// lib/__tests__/proxy-routes.test.ts
import test from "node:test"; import assert from "node:assert/strict";
import { __routeTestHooks } from "@/proxy";
test("dealer claim page is reachable without a dealer session", () => {
  assert.equal(__routeTestHooks.isDealerAuthRoute("/dealer/claim"), true);
});
test("dealer claim API is not blanket-401'd", () => {
  assert.equal(__routeTestHooks.isDealerAuthRoute("/api/dealer/claim"), true);
});
test("fast-track is no longer an exemption", () => {
  assert.equal(__routeTestHooks.isTokenExemptDealerPath("/dealer/onboarding/fast-track"), false);
});
```
- [ ] **Step 2: Run it — expect FAIL** (`pnpm test:security` or the node runner; `__routeTestHooks` undefined).
- [ ] **Step 3:** In `proxy.ts` add `"/dealer/claim"` and `"/api/dealer/claim"` to `DEALER_AUTH_ROUTES`
      (they are token-authenticated, exactly like `/dealer/invite/claim`); remove
      `"/dealer/onboarding/fast-track"` from the exemption block at `:461-467`; export
      `__routeTestHooks = { isDealerAuthRoute, isTokenExemptDealerPath }`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `fix(dealer): open /dealer/claim to unauthenticated token holders (D1)`

### Task 2 — Onboarding-scoped session (D2)

**Files:** Create `lib/auth/dealer-scope.ts`, `lib/auth/__tests__/dealer-scope.test.ts`;
Modify `lib/auth/dealer-session.ts:15,32,50`, `app/dealer/layout.tsx:23`,
`app/api/dealer/auth/signin/route.ts:67-70`, `lib/dealer-auth.ts`, `proxy.ts`.

**Interfaces:** Produces —
```ts
export type DealerScope = "NONE" | "ONBOARDING" | "FULL";
export function dealerScope(d: { status: string }): DealerScope;
export const ONBOARDING_PATH = "/dealer/onboarding";
export function isOnboardingPath(pathname: string): boolean;
```

- [ ] **Step 1: Write the failing test**
```ts
import { dealerScope, isOnboardingPath } from "@/lib/auth/dealer-scope";
test("PENDING yields onboarding scope", () => assert.equal(dealerScope({status:"PENDING"}), "ONBOARDING"));
test("ACTIVE yields full scope",       () => assert.equal(dealerScope({status:"ACTIVE"}),  "FULL"));
test("SUSPENDED yields none",          () => assert.equal(dealerScope({status:"SUSPENDED"}),"NONE"));
test("TERMINATED yields none",         () => assert.equal(dealerScope({status:"TERMINATED"}),"NONE"));
test("onboarding path matches its own subtree, nothing else", () => {
  assert.equal(isOnboardingPath("/dealer/onboarding"), true);
  assert.equal(isOnboardingPath("/dealer/onboarding/agreement"), true);
  assert.equal(isOnboardingPath("/dealer/inventory"), false);
});
```
- [ ] **Step 2: Run — expect FAIL** (module not found).
- [ ] **Step 3: Implement** `lib/auth/dealer-scope.ts`:
```ts
export type DealerScope = "NONE" | "ONBOARDING" | "FULL";
export const ONBOARDING_PATH = "/dealer/onboarding";
export function dealerScope(d: { status: string } | null): DealerScope {
  if (!d) return "NONE";
  if (d.status === "PENDING") return "ONBOARDING";
  if (d.status === "ACTIVE") return "FULL";
  return "NONE"; // SUSPENDED, TERMINATED
}
export function isOnboardingPath(pathname: string): boolean {
  return pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** `dealer-session.ts` — `BLOCKED_STATUSES = new Set(["SUSPENDED","TERMINATED"])`; add
      `requireDealerForOnboarding()` (admits ONBOARDING and FULL) and make `requireDealer()` redirect
      `ONBOARDING` → `/dealer/onboarding` **only when the current path is not itself onboarding**,
      reading `x-al-pathname` from `headers()`.
- [ ] **Step 6:** `proxy.ts` — forward `x-al-pathname` on dealer paths.
- [ ] **Step 7:** `signin/route.ts` — delete the PENDING 403 at `:67-70`; PENDING now signs in and the
      response carries `redirect: "/dealer/onboarding"`.
- [ ] **Step 8:** `app/api/dealer/onboarding/route.ts` — swap `requireDealerFromRequest` for the
      onboarding-scoped helper; on the AGREEMENT step set `onboardingStep: "COMPLETE"` alongside
      `status: "ACTIVE"` and re-mint the JWT at FULL scope.
- [ ] **Step 9:** Every other `/api/dealer/*` returns `403 ONBOARDING_REQUIRED` for ONBOARDING scope.
- [ ] **Step 10: Run** `pnpm test:security && pnpm typecheck`.
- [ ] **Step 11: Commit** `fix(dealer): onboarding-scoped session breaks the PENDING deadlock (D2)`

### Task 3 — Hash invitation tokens, 7-day TTL, expiry sweep (D3)

**Files:** Modify `lib/services/dealer-recruitment/account-claim.service.ts`,
`app/api/admin/dealers/invite/route.ts:45-58`, `app/api/dealer/invite/claim/route.ts:42,47,152,162`,
`app/api/cron/dealer-invitation-reminder/route.ts`, `prisma/schema.prisma`;
Create the migration + `lib/services/dealer-recruitment/__tests__/invitation-token.test.ts`.

**Interfaces:** Produces —
```ts
export function hashToken(raw: string): string;                    // generalized from hashClaimToken
export const INVITATION_TOKEN_TTL_MS: number;                      // 7 * 24 * 60 * 60 * 1000
export async function expireStaleInvitations(now?: Date): Promise<number>;
```

- [ ] **Step 1: Write the failing test**
```ts
test("hashToken is sha256 hex and stable", () => {
  assert.equal(hashToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("hashClaimToken delegates to hashToken", () => {
  assert.equal(hashClaimToken("abc"), hashToken("abc"));
});
test("invitation TTL is 7 days", () => {
  assert.equal(INVITATION_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3:** Add `hashToken` to `account-claim.service.ts`; redefine
      `hashClaimToken = hashToken`; export `INVITATION_TOKEN_TTL_MS`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** `schema.prisma` — `DealerInvitation` gains `tokenHash String? @unique @map("token_hash")`,
      `consumedAt DateTime? @map("consumed_at")`; `token` becomes `String?`. Write the migration SQL
      per §3 steps 1–4. **Do not run `prisma migrate deploy`.**
- [ ] **Step 6:** `invite/route.ts` — mint raw token, store only `tokenHash`, `expiresAt = now + INVITATION_TOKEN_TTL_MS`.
- [ ] **Step 7:** `invite/claim/route.ts` — look up by `tokenHash: hashToken(raw)`; consume via a
      conditional `updateMany({ where: { id, consumedAt: null } })` mirroring `consumeClaimToken`.
- [ ] **Step 8:** Add `expireStaleInvitations()` and call it from the **existing**
      `dealer-invitation-reminder` cron (no new job), returning the count in its result payload.
- [ ] **Step 9: Run** `pnpm test:security && pnpm typecheck`.
- [ ] **Step 10: Commit** `fix(dealer): hash invitation tokens at rest, 7-day TTL, expiry sweep (D3)`

### Task 4 — Delete dead surfaces (D4, D5) and de-duplicate the application form (D6)

**Files:** Delete `app/dealer/onboarding/fast-track/`, `lib/services/dealer/dealer-onboarding.service.ts`;
Modify `app/dealer/apply/page.tsx`, `app/api/public/dealer-application/route.ts:20,31,61-64,85`.

- [ ] **Step 1:** `grep -rn "dealer-onboarding.service\|getDealerOnboardingStatus\|onboarding/fast-track"`
      across `app lib components tests` — expect only the proxy exemption already removed in Task 1.
- [ ] **Step 2:** Delete both paths.
- [ ] **Step 3:** Replace `app/dealer/apply/page.tsx` with a permanent redirect:
```tsx
import { redirect } from "next/navigation";
export default function DealerApplyRedirect() { redirect("/dealer-application"); }
```
- [ ] **Step 4:** Remove the back-compat shims: make `dealershipType` required, drop the
      `streetAddress`-into-notes merge at `:61-64`, drop `?? "Independent"` at `:85`.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm build` (build proves no dangling import).
- [ ] **Step 6: Commit** `refactor(dealer): remove fast-track and dead onboarding service; single application form (D4,D5,D6)`

### Task 5 — Scorecard cron verb (D7)

**Files:** Modify `app/api/cron/dealer-scorecard-snapshot/route.ts:22`.

- [ ] **Step 1:** Compare against a working sibling: `app/api/cron/dealer-invitation-reminder/route.ts`
      exports `GET(request)` and calls `authorizeCronRequest(request)` first.
- [ ] **Step 2:** Change `export async function POST` → `export async function GET`, keeping
      `authorizeCronRequest` as the first statement and the `withCronRun("dealer-scorecard-snapshot", …)`
      wrapper intact.
- [ ] **Step 3:** Assert `vercel.json:136-137` still points at the same path (it does).
- [ ] **Step 4: Run** `pnpm typecheck`.
- [ ] **Step 5: Commit** `fix(cron): dealer-scorecard-snapshot must export GET to match Vercel cron (D7)`

### Task 6 — Manual inventory add (D8) and edit (D9)

**Files:** Modify `app/dealer/inventory/add/page.tsx:8,26,67-70`,
`app/api/dealer/inventory/route.ts:22-34`, `app/dealer/inventory/[id]/edit/page.tsx:24-31`,
`app/api/dealer/inventory/[id]/route.ts:8`.

- [ ] **Step 1: Write the failing test** — `lib/services/dealer/__tests__/inventory-create-schema.test.ts`
```ts
test("the payload the add form actually sends is accepted", () => {
  const body = { vin:"1HGCM82633A123456", year:2020, make:"Honda", model:"Accord",
    trim:"EX", mileage:40000, condition:"USED", priceCents:2_500_000, description:"clean" };
  assert.equal(createSchema.safeParse(body).success, true);
});
```
- [ ] **Step 2: Run — expect FAIL** (`description` unrecognized).
- [ ] **Step 3:** Add `description: z.string().max(2000).optional()` to `createSchema`; persist it.
      In `add/page.tsx` change `CONDITIONS` to `[{value:"NEW",label:"New"},{value:"USED",label:"Used"},
      {value:"CPO",label:"Certified Pre-Owned"}]` and default state to `"USED"`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** `edit/page.tsx` — `params: Promise<{id:string}>`; resolve with
      `const { id } = use(params)` (client component, React 19 `use`). Widen the PATCH schema at
      `[id]/route.ts:8` to the fields the form edits (`vin, year, make, model, trim, condition`) so a
      save is not a silent no-op, and make it `.strict()` so an unknown field errors rather than
      vanishing.
- [ ] **Step 6: Run** `pnpm typecheck && pnpm test`.
- [ ] **Step 7: Commit** `fix(dealer): manual inventory add and edit actually persist (D8,D9)`

### Task 7 — CSV mapping cookie (D10) and one price convention (D11)

**Files:** Create `lib/utils/csv-price.ts` + test; Modify `column-mapping/route.ts:199`,
`bulk-upload/page.tsx:27-34`, `bulk/route.ts:93`.

**Interfaces:** Produces — `export function parseCsvPriceToCents(raw: string, isCentsColumn?: boolean): number | null;`

- [ ] **Step 1: Write the failing test**
```ts
test("whole dollars scale by 100", () => assert.equal(parseCsvPriceToCents("25000"), 2_500_000));
test("currency formatting is stripped", () => assert.equal(parseCsvPriceToCents("$25,000"), 2_500_000));
test("decimals are respected",       () => assert.equal(parseCsvPriceToCents("25000.00"), 2_500_000));
test("small values are still dollars",() => assert.equal(parseCsvPriceToCents("9500"), 950_000));
test("an explicit cents column does not scale",
  () => assert.equal(parseCsvPriceToCents("2500000", true), 2_500_000));
test("junk returns null", () => assert.equal(parseCsvPriceToCents("abc"), null));
test("non-positive returns null", () => assert.equal(parseCsvPriceToCents("0"), null));
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
export function parseCsvPriceToCents(raw: string, isCentsColumn = false): number | null {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return isCentsColumn ? Math.round(num) : Math.round(num * 100);
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** Delete `convertToPriceCents` from `bulk-upload/page.tsx` and import the shared parser;
      map a `price_cents`/`pricecents` header to `isCentsColumn = true`. Replace the inline parse at
      `bulk/route.ts:93` with the same import. Preview must render from the parsed cents, not the raw cell.
- [ ] **Step 6:** `column-mapping/route.ts:199` — `path: "/"` so the cookie reaches `/api/dealer/...`.
- [ ] **Step 7: Run** `pnpm test && pnpm typecheck`.
- [ ] **Step 8: Commit** `fix(dealer): one CSV price convention and a reachable mapping cookie (D10,D11)`

### Task 8 — SSRF allowlist (D12)

**Files:** Create `lib/security/safe-fetch.ts` + test; Modify `lib/services/contract-shield/extract-text.ts:17-21`.

**Interfaces:** Produces —
```ts
export class BlockedUrlError extends Error {}
export function assertAllowedContractUrl(url: string): URL;  // throws BlockedUrlError
export async function fetchAllowedContract(url: string): Promise<Response>;
```

- [ ] **Step 1: Write the failing test**
```ts
test("https on the storage host is allowed", () => {
  assert.ok(assertAllowedContractUrl("https://abc.supabase.co/storage/v1/object/x.pdf"));
});
for (const bad of [
  "http://169.254.169.254/latest/meta-data/",
  "https://127.0.0.1/x.pdf", "https://localhost/x.pdf",
  "https://10.0.0.5/x.pdf", "https://192.168.1.1/x.pdf", "https://[::1]/x.pdf",
  "file:///etc/passwd", "gopher://evil/x", "https://evil.example.com/x.pdf",
]) test(`blocked: ${bad}`, () => assert.throws(() => assertAllowedContractUrl(bad), BlockedUrlError));
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — scheme must be `https:`; hostname must equal the host of
      `NEXT_PUBLIC_SUPABASE_URL` (or an entry in `CONTRACT_FETCH_ALLOWED_HOSTS`); reject literal IPs,
      loopback, link-local `169.254.0.0/16`, RFC1918, and `::1`/ULA; `redirect: "error"` on the fetch so
      a 302 cannot escape the allowlist; 10s `AbortSignal.timeout`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5:** `extract-text.ts:18-21` — replace the bare `fetch(documentUrl)` with
      `fetchAllowedContract(documentUrl)`. The Supabase storage-path branch is unchanged and remains
      the preferred path.
- [ ] **Step 6: Run** `pnpm test:security && pnpm typecheck`.
- [ ] **Step 7: Commit** `fix(security): allowlist contract document fetches to close SSRF (D12)`

### Task 9 — Reconcile lifecycle comments (§2.5)

- [ ] **Step 1:** Rewrite the comment at `app/api/dealer/onboarding/route.ts:204-206`.
- [ ] **Step 2:** Rewrite the header at `lib/services/dealer/dealer-auction-eligibility.service.ts:6-10`.
- [ ] **Step 3:** Extend the comment at `admin/dealers/applications/[appId]/approve/route.ts:86` to name
      the onboarding scope.
- [ ] **Step 4: Commit** `docs(dealer): reconcile lifecycle comments to the decided model`

### Task 10 — Playwright E2E (Phase 4)

**Files:** Create `frontend/tests/e2e/dealer-funnel.spec.ts` and a seeded-DB fixture.

Specs (a)–(f) exactly as briefed; **every one asserts database state**, not just status or text.
Run against a local seeded database only. Email uses the existing `DEV_SKIPPED` path. No Stripe.

- [ ] (a) approve → claim link → set password → onboarding → 4 steps → ACTIVE → dashboard.
      Assert `dealers.status='ACTIVE'`, `onboarding_step='COMPLETE'`, one
      `dealer_agreement_signatures` row, `dealer_account_claim_tokens.consumed_at IS NOT NULL`.
- [ ] (b) same via the invite path. Assert `dealer_invitations.status='ACCEPTED'` **and**
      `consumed_at IS NOT NULL` **and** `token_hash` present with `token` NULL.
- [ ] (c) PENDING dealer signs in → lands on `/dealer/onboarding`; `GET /dealer/inventory` redirects to
      onboarding; `GET /api/dealer/inventory` returns 403 `ONBOARDING_REQUIRED`.
- [ ] (d) expired claim token → 410 + expired UI; reused (consumed) token → 409; both assert no second
      `dealers` row was created.
- [ ] (e) manual add persists: assert one `inventory_items` row with `dealer_id` = the dealer,
      `source_adapter='dealer_manual'`, `price_cents` exact.
- [ ] (f) both CSV paths import the same fixture file and produce **identical** `price_cents` — assert
      equality between the two runs, not just plausibility.

- [ ] **Commit** `test(e2e): dealer funnel end-to-end against a seeded database`

---

## 6. Self-review of this plan

**Spec coverage.** D1→T1 · D2→T2 · D3→T3 · D4,D5,D6→T4 · D7→T5 · D8,D9→T6 · D10,D11→T7 · D12→T8 ·
comment reconciliation→T9 · E2E→T10. All twelve covered plus the two explicit sub-requirements
(state machine §2, D11 convention §3).

**Placeholder scan.** No "TBD"/"add error handling"/"similar to Task N". Every code step carries real code.

**Type consistency.** `dealerScope`/`isOnboardingPath`/`ONBOARDING_PATH` (T2) are consumed by name in
T2 steps 5–9. `hashToken`/`INVITATION_TOKEN_TTL_MS`/`expireStaleInvitations` (T3) are consumed in T3
steps 6–8. `parseCsvPriceToCents` (T7) is consumed in T7 step 5 with the same signature.
`assertAllowedContractUrl`/`fetchAllowedContract`/`BlockedUrlError` (T8) are consumed in T8 steps 3–5.

**Known gap, stated rather than hidden.** The onboarding-scope redirect depends on `x-al-pathname`
being forwarded by `proxy.ts`. If that header is stripped by the hosting layer, `requireDealer()` must
fail *open to onboarding* (never a redirect loop). Task 2 Step 5 must implement the null-header case as
"render, do not redirect", and Task 10(c) must cover it.

---

## 7. Out of scope (surfaced, not fixed)

Per the brief: dealer/inventory matching, `VehicleRequestMatchResult` consumers, LANE_1 provenance,
admin `launch-auction` minting PAID deposits, `geocode-backfill` registration, buyer location NULLs,
quick-offer's `_count`/`offerCount` crash. All remain documented in
`docs/dealer-inventory-matching-investigation.md`.
