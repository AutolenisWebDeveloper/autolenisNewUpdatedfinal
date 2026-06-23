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

## Document-to-deal association mechanism (added)

**Problem:** The `Document` model already carried `dealId` / `buyerId` /
`dealerId` / `type` columns, but the dealer documents-upload route never
populated them — every dealer-uploaded document was orphaned from its deal,
untyped (`OTHER`), and unsearchable by deal/buyer.

**Implemented** (`lib/services/dealer/deal-document-link.service.ts` +
`app/api/dealer/documents/upload/route.ts` + documents UI):

- **Verified association, never guessed.** A document is linked to a deal only
  after `resolveOwnedDealAssociation()` confirms the deal's accepted offer
  belongs to the authenticated dealer (`offer.dealerId`). A `dealId` that does
  not resolve to an owned deal is rejected (`403`/`404`) — orphaned and
  cross-dealer associations are impossible.
- **Multi-identifier cross-validation.** Optional client-supplied **Buyer ID**,
  **VIN**, and **Transaction ID** are checked against the deal's authoritative
  values (buyer = `Deal.buyerId`, transaction = `Deal.stripeFeePIId`, VIN =
  the deal's auction-vehicle inventory VINs). A correct deal id paired with the
  wrong buyer/vehicle/transaction is rejected (`409 *_MISMATCH`) rather than
  mis-filed. VIN/transaction checks are skipped when the deal has no known
  value, never blocking legitimately.
- **Duplicate prevention.** An identical re-upload (same deal + dealer + type +
  name + size) returns the existing record idempotently and removes the
  redundant storage object — no duplicate `Document` rows from double-click /
  retry. (Zero-migration: dedup uses existing columns; a content-hash column is
  a future hardening.)
- **Full traceability + audit.** The link is persisted as `Document.dealId` +
  `buyerId` + `dealerId` + `type` (searchable via the existing
  `getDealDocuments` / `getDocumentsByDeal`), and every link writes a
  `DEALER_DEAL_DOCUMENT_LINKED` audit record capturing dealId, buyerId,
  transactionId, and VINs.
- **Orphan-safe storage.** The deal is validated *before* the file is written to
  the bucket, and any rejected/deduped upload removes its storage object, so the
  bucket mirrors the document records.
- **UX.** The documents page now offers a document-type selector and an optional
  deal selector (the dealer's own deals), and each row shows its type + linked
  deal. Uploading with "No deal (general)" preserves the prior dealer-scoped
  behavior.

The pre-existing contract-upload path (`ContractVersion`) was already deal-linked
and gained dealer-ownership validation in the security fixes above.

## Verification

- `npx tsc --noEmit` — passes (0 errors).
- `npx eslint` on all changed files — passes.
- `npx tsx --test lib/services/dealer-recruitment/__tests__/*.test.ts` — 14/14 pass.
- `npx tsx --test lib/services/dealer/__tests__/deal-document-link.test.ts` — 8/8 pass
  (identifier cross-validation + VIN normalization contract).
