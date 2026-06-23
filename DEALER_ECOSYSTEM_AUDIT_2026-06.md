# Dealer Registration & Onboarding Ecosystem — Audit & Remediation (June 2026)

**Scope:** Dealer sign-up / sign-in, authentication, password recovery, account
claim/invite/prospect flows, onboarding, e-contract & digital-signature, admin
review workflows, status tracking, notifications, and the dealer↔deal contract
surface.

**Method:** Direct code inspection of the dealer auth, onboarding, e-sign,
contract, and admin-review code paths plus their Prisma relationships. Every
finding below was verified against the source before any change. Fixes are
deliberately minimal and surgical; each was validated with `tsc --noEmit`,
ESLint, and the existing test suite (all green).

This pass intentionally prioritizes **security, access-control, and
data-integrity defects** over cosmetic polish. Lower-severity items found during
the audit are listed under "Deferred" with rationale so they remain auditable.

---

## Fixed in this change

### P0 — Security

**1. Contract-upload IDOR (broken access control).**
`POST /api/dealer/contracts/upload` and `/upload-file` accepted an
attacker-controlled `dealId` and wrote a new `ContractVersion` (superseding the
deal's `APPROVED` versions and triggering a Contract-Shield scan) with **no
check that the deal belonged to the authenticated dealer**. A `Deal` is linked
to a dealer only indirectly via `Offer.dealerId`, and nothing in the path
resolved that link.
*Fix:* added `assertDealerOwnsDeal()` as an authorization chokepoint inside
`uploadDealerContract()` (protects every caller) — scoped via `offer.dealerId`,
matching the ownership model already used by `dealer-deals.service`. Both routes
now return `403 FORBIDDEN` for non-owned deals. Files:
`lib/services/dealer/dealer-contract.service.ts`,
`app/api/dealer/contracts/upload/route.ts`,
`app/api/dealer/contracts/upload-file/route.ts`.

**2. Privilege-escalation inconsistency on dealer mutation routes.**
`approve`, `reactivate`, `suspend`, and `compliance/flag` used
`getAdminFromRequest()` (any active MFA'd admin, **including read-only
`SUPPORT_ADMIN`**), while the parallel `/tier` and `/status` routes correctly
gated on `OPERATIONAL_ROLES`. The same suspend action was blocked on `/status`
but allowed on `/suspend`.
*Fix:* the four routes now use `getAdminWithRole(request, OPERATIONAL_ROLES)`
and return `403` for read-only support staff, consistent with `/tier`.

### P0 — Functional

**3. Dead recruited-prospect claim funnel (404).**
Outreach emails link to `/dealer/claim-prospect?token=…`
(`prospect-claim.service.ts` `buildClaimUrl`), but **no such page existed** — the
only handler was the API route at `/api/dealer/prospect-claim`. Every recruited
prospect who clicked "Claim your dealership" hit a 404, breaking the F-010
one-click conversion funnel.
*Fix:* added `app/dealer/claim-prospect/page.tsx` — a client page matching the
existing invite-claim design that GETs the prefill and POSTs the claim (license
number + contact), with graceful fallback to the public dealer application on an
invalid/expired token.

### P1 — Correctness / integrity

**4. Double-sign race on the agreement e-signature.**
`POST /api/dealer/agreement/sign` did a non-atomic `findUnique` → `create`
against a `@unique` `dealerId`. Two concurrent submits (double-click/retry) both
passed the check; the loser threw an uncaught Prisma `P2002` → **500 on a
legally-completed signature**.
*Fix:* the create transaction is now wrapped to treat `P2002` as the idempotent
"already signed" success path, and the existing fast-path was refactored into a
shared `markAlreadySigned()` helper.

**5. Audit-timestamp drift on the idempotent sign path.**
The "already signed" branch stamped `agreedToTermsAt` with `new Date()` instead
of the original signature time, producing an audit timestamp that disagreed with
the signature record.
*Fix:* `markAlreadySigned()` now falls back to the signature's `signedAt`.

**6. Weekly scorecard cron ran daily.**
`/api/cron/dealer-scorecard-snapshot` is keyed and emailed per ISO `weekKey`, but
was scheduled `0 3 * * *` (daily), inserting ~7 "weekly" snapshot rows per dealer
per week and skewing trend reads.
*Fix:* schedule changed to `0 3 * * 1` (weekly, Monday) in `vercel.json`,
matching the route's intent and the repo's other weekly crons.

### P2 — Hardening

**7. Replayable onboarding AGREEMENT step.**
`PATCH /api/dealer/onboarding` (AGREEMENT) re-stamped consent and re-fired the
DocuSign envelope + `dealer_activated` event on every replay.
*Fix:* added an idempotency guard — returns success without side effects when
`onboardingStep === "COMPLETE"`. (Downstream DocuSign send and domain-event
emit were already idempotent; this removes the redundant work and timestamp
churn.)

---

## Deferred (found, not changed this pass — rationale)

- **Duplicate `DealerApplication` race** — `findFirst`→`create` on `contactEmail`
  is non-atomic. A proper fix requires a partial unique constraint + migration
  (P2002 handling), out of scope for a no-migration change. Low live risk
  (pre-revenue, low write volume).
- **Password-policy inconsistency** — claim/invite-claim accept 8-char passwords
  while `set-password`/`reset-password` require 12 + complexity. Worth
  centralizing into one schema; deferred to avoid changing the activation UX in
  the same pass as security fixes.
- **`/status` route emits no dealer notification and writes a degraded audit
  row** — the dedicated approve/suspend/reactivate/terminate routes already do
  this correctly; the generic `/status` route should be deprecated or reworked to
  emit the matching action + email. Deferred (behavioral/product decision).
- **Application-approve "user already exists" branch** dead-ends without creating
  the Dealer / claim token / approval email. Needs the same provenance as the
  main path; deferred pending product confirmation of the intended recovery.
- **Reset-password role check** — the dealer-namespaced reset endpoint is
  token-gated but does not assert `role === "DEALER"`. Defense-in-depth; deferred.

---

## Verification

- `npx tsc --noEmit` — passes (0 errors).
- `npx eslint` on all changed files — passes.
- `npx tsx --test lib/services/dealer-recruitment/__tests__/*.test.ts` — 14/14 pass.
