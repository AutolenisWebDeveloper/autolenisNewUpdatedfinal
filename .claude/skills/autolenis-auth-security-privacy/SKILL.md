---
name: autolenis-auth-security-privacy
description: >-
  The security constitution for AutoLenis — authentication, authorization,
  session/JWT handling, MFA, CSRF, rate limiting, webhook signature
  verification, PII classification, secrets, audit logging, impersonation, and
  data retention/deletion. Use this skill when touching anything under
  frontend/lib/security/, frontend/lib/auth/, lib/admin-auth.ts,
  lib/dealer-auth.ts, frontend/proxy.ts, admin/dealer/buyer sign-in, MFA/TOTP,
  recovery codes, CSRF tokens, rate limiters, cron/webhook auth, RLS, roles and
  permissions, secret handling, encryption of PII (SSN, credit reports, TOTP
  secrets), account deletion, or any audit-log / impersonation change. Also use
  when writing an API route that reads or mutates a buyer, dealer, admin, or
  affiliate record. Overrides generic auth advice.
---

## Purpose & Authority

This skill owns AutoLenis's identity, authorization, and privacy surface. It is
the source of truth for how sessions are issued and verified, how the three
separate auth systems (buyer/Supabase, dealer JWT, admin JWT+MFA) stay isolated,
how state-mutating requests are protected (CSRF, rate limits, signatures), how
PII is classified and encrypted, and how every privileged action is audited.
Where generic guidance ("just use NextAuth", "check the role on the client",
"one JWT for everyone") conflicts with anything below, this skill wins. Security
regressions are launch-blocking; treat every rule here as a hard invariant.

## When this skill activates

- Editing `frontend/proxy.ts` (the ONLY active middleware — never
  `middleware.ts`, `middleware.ts.bak`, or `middleware.ts.txt`).
- Editing `lib/admin-auth.ts`, `lib/dealer-auth.ts`, or anything in
  `frontend/lib/auth/` or `frontend/lib/security/`.
- Any admin/dealer/buyer/affiliate sign-in, sign-out, session refresh, MFA/TOTP
  setup or verification, recovery codes, or password change.
- Writing/altering an API route under `app/api/{admin,dealer,buyer,affiliate}/`.
- Touching CSRF, rate limiting, cron auth, or webhook signature verification.
- Handling PII: SSN, DOB, driver's license, credit/prequal reports, TOTP
  secrets, bank data, or anything that maps to a real person.
- Account deletion, data export, retention, impersonation, or audit logging.
- Keywords: JWT, MFA, TOTP, RLS, CSRF, OFAC, PII, impersonation, kill switch,
  service-role key, rate limit, webhook signature.

## Architecture & key files

Three cryptographically isolated auth systems — never mix them:

1. **Buyer/affiliate = Supabase Auth.** Cookie-based session (`sb-*`, HttpOnly,
   SameSite=Lax). Server clients in `lib/supabase.ts`
   (`createServerSupabaseClient`, browser client, service client) and
   `lib/supabase-service.ts` (`getServiceSupabase` — service role, `server-only`,
   bypasses RLS). Request-scoped helpers live in `lib/auth/` (`getRequestBuyer`,
   `getRequestAffiliate`, `session.ts`, `permissions.ts`).
2. **Dealer = custom JWT** (`lib/dealer-auth.ts`). `signDealerJwt`/
   `verifyDealerJwt`, issuer `autolenis-dealer`, cookie `dealer_token`, HS256,
   TTL 7d (30d with remember-me). Secret precedence `DEALER_JWT_SECRET ??
   JWT_SECRET`. No MFA — credential-only after Supabase credential verification.
3. **Admin = custom JWT + mandatory MFA** (`lib/admin-auth.ts`). `signAdminJwt`/
   `verifyAdminJwt`, issuer `autolenis-admin`, cookie `admin_token`, TTL 24h,
   secret precedence `ADMIN_JWT_SECRET ?? JWT_SECRET`. Pre-MFA token
   (`signPreMfaToken`, scope `pre-mfa`, 10m, cookie `admin_premfa`) grants access
   to the verify-mfa page only. `mfaVerified: true` is required in the payload.

`frontend/proxy.ts` is the edge gate: maintenance-mode gate → test-route block
in prod → cron auth (`CRON_SECRET` bearer) → CSRF for mutating API routes →
public routes → auth routes → admin JWT check → dealer JWT check → Supabase
`getUser()` refresh + role routing (BUYER/DEALER/AFFILIATE/admin variants),
terms-acceptance gate, suspended-buyer gate, admin-preview-token bypass. It must
mirror the exact secret precedence used by the signers.

Roles — `UserRole` enum: `BUYER, DEALER, AFFILIATE, SUPER_ADMIN,
OPERATIONS_ADMIN, COMPLIANCE_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN`. `AdminRole` =
the five admin variants (`ADMIN_ROLE_LABELS` in `lib/admin-auth.ts`).

Security models in `prisma/schema.prisma`: `Admin` (totpSecret encrypted,
recoveryCodes[], pendingRecoveryCodes[], failedMfaAttempts, mfaLockedUntil),
`AdminMfaEmailToken` (hashed, single-use, 10m TTL), `AdminSession`,
`AdminLoginLog`, `CsrfToken`, `RateLimitEvent`, `WebhookEvent`,
`AdminImpersonation` (`ImpersonationStatus` ACTIVE|ENDED),
`IdentityFirewallEntry` + `CircumventionAttempt` (`AntiCircumventionFlag`:
CONTACT_ATTEMPT, EXTERNAL_DEAL, IDENTITY_MISMATCH, PAYMENT_BYPASS), `AuditLog`
(`AdminActionType`), `AdminAuditLog` (previousState/newState snapshots),
`AiKillSwitchLog`, `ComplianceEvent` (FCRA/regulatory), `PreQualification` +
`PrequalConsent`.

Rate limiting: `frontend/lib/security/rate-limit.ts` — Upstash Redis
(`limitAuthAttempt`, `limitPaymentIntent`, `limitGeneral`, `clientIpKey`). MFA
lockout is DB-backed per-account in `lib/admin-auth.ts` (`checkMfaRateLimit`,
`recordMfaFailure`, `clearMfaFailures`).

## Core rules & invariants

1. **Server-side authorization always.** Never trust a client-supplied role,
   `user_metadata.role` alone for privileged actions, or a frontend guard. Every
   mutating route re-derives the actor server-side (`getRequestBuyer`/
   `getRequestDealer`/`verifyAdminJwt`) and checks ownership + role.
2. **Never mix the three auth systems.** Admin code uses `admin_token` +
   MFA; dealer uses `dealer_token`; buyer/affiliate uses Supabase. Each has its
   own secret so a leak of one cannot forge another. `proxy.ts` must keep the
   same `X_JWT_SECRET ?? JWT_SECRET` precedence as the signer.
3. **MFA is mandatory for every admin role — no skip path.** TOTP via the
   `otpauth` library (RFC 6238, never hand-rolled). Secrets stored AES-256-GCM
   encrypted with `MFA_ENCRYPTION_KEY` (legacy decrypt-only fallback to
   `PREQUAL_ENCRYPTION_KEY`). Recovery codes bcrypt-hashed (rounds 10),
   single-use. Lockout after 5 failed attempts for 15 minutes, per account.
4. **CSRF for all state-mutating requests** except the documented exemptions in
   `proxy.ts` (webhooks, cron, Twilio, `/api/crm/dispatch/*`, public auth/AI
   endpoints, and role-API routes protected by the HttpOnly SameSite=Lax
   Supabase session). Never add a new POST/PUT/PATCH/DELETE route that silently
   skips CSRF; if it must, it needs its own signature scheme.
5. **Every inbound webhook verifies a signature before acting.** Stripe
   `constructEvent` (`STRIPE_WEBHOOK_SECRET`, fail loud with 500 if unset),
   Twilio `validateRequest` (`lib/voice/twilio-verify.ts`), QStash
   `receiver.verify` (`lib/qstash/verify.ts`), DocuSign HMAC
   (`DOCUSIGN_WEBHOOK_SECRET`), Make.com/CRM HMAC (`CRM_DISPATCH_SECRET`,
   `X-AutoLenis-Signature` + timestamp skew). Cron routes require
   `Authorization: Bearer ${CRON_SECRET}`.
6. **PII is encrypted at rest and never logged.** SSN/DOB/credit-report bodies →
   AES-256-GCM with `PREQUAL_ENCRYPTION_KEY` (64-hex, fail-fast, no default
   key). TOTP secrets → `MFA_ENCRYPTION_KEY`. Never send AutoLenis-internal
   fields (employment, DTI, housing) to MicroBilt. Never write PII to logs,
   Sentry, audit metadata, or LLM prompts.
7. **Service-role Supabase bypasses RLS — server-only, post-authz.** Only call
   `getServiceSupabase`/`createServiceSupabaseClient` from a route that has
   already verified the actor. Never ship the service-role key to the client;
   never use it to sidestep an ownership check.
8. **Secrets come from `process.env`, loaded lazily, never at module top.**
   Missing critical secrets fail loud (Stripe, webhook secrets, encryption
   keys), never fall back to a placeholder that lets bad requests through.
9. **Privileged actions are audited.** Admin mutations write `AdminAuditLog`
   (with previousState/newState) or `AuditLog` (`AdminActionType`).
   Impersonation writes `AdminImpersonation` + `IMPERSONATION_STARTED`. FCRA
   events write `ComplianceEvent`.
10. **Anti-circumvention is enforced, not advisory.** Off-platform contact,
    external-deal, identity-mismatch, and payment-bypass signals write
    `CircumventionAttempt`/`IdentityFirewallEntry`.

## Workflows

**Admin sign-in + MFA.** Verify email/password (bcrypt) → rate-limit the
attempt (`limitAuthAttempt` keyed by email AND `clientIpKey`) → issue pre-MFA
token (`signPreMfaToken`, `admin_premfa` cookie) → on verify page call
`checkMfaRateLimit(adminId)` first → verify TOTP (`verifyTotpCodeFromEncrypted`)
or recovery code (`verifyRecoveryCode`, remove the matched hash) → on success
`clearMfaFailures` and `signAdminJwt({ adminId, role, email, mfaVerified: true })`
into `admin_token`; on failure `recordMfaFailure` (locks after 5). Log to
`AdminLoginLog`/`AdminAuditLog`.

**MFA enrollment.** `generateMfaEmailToken` (hashed, single-use, 10m) emailed →
confirm → `generateTotpSecret` → `encryptTotpSecret` before persisting →
`getTotpQrCode` (local `qrcode`, no external API) → verify a live code →
`generateRecoveryCodes` (show plaintext once, store bcrypt hashes).

**Writing a protected API route.** Derive the actor server-side; reject with the
same `{ error: { code, message }, correlationId }` shape `proxy.ts` uses;
enforce ownership (the buyer/dealer id from the session, not the request body);
rate-limit self-service mutations (`limitGeneral`) and payment intents
(`limitPaymentIntent`, which FAILS CLOSED on store outage); audit if privileged.

**Account deletion / retention.** Deletes cascade via Prisma
`onDelete: Cascade` from `User`→`Admin`/`Buyer` and dependents. Preserve legally
required records (`ComplianceEvent`, `AuditLog`, payment/`WebhookEvent` history)
even when the subject is deleted — anonymize references rather than dropping
audit trails. Any new PII table must declare its retention and deletion path.

## Boundaries — do / never

**Do**
- Re-verify the actor and ownership on the server for every mutation.
- Key rate limiters by BOTH identifier and IP at the call site (two calls).
- Fail loud on missing security secrets; fail closed for payment throttling.
- Encrypt every new PII column and document its retention.
- Audit every admin/impersonation/compliance action.

**Never**
- Add or reference `middleware.ts*`; `proxy.ts` is the only middleware.
- Trust `user_metadata.role`, a client role, or a frontend check for authz.
- Share one JWT/secret across admin, dealer, and buyer systems.
- Add an admin MFA bypass, weaken lockout, or hand-roll TOTP/crypto.
- Ship the Supabase service-role key or any secret to the client, or use it to
  skip an ownership check.
- Log, Sentry-capture, or put PII into audit metadata or LLM prompts.
- Add a mutating route that skips CSRF without its own signature scheme.
- Process a webhook before verifying its signature and idempotency key.

## Best practices & examples

- Auth-tier limiters FAIL OPEN (time-boxed) so a Redis outage never locks out
  sign-in; the payment-intent limiter FAILS CLOSED to block card-testing. Do not
  invert these.
- CSRF check is `header === cookie` (double-submit); the token is minted per
  session and mirrored in an HttpOnly cookie — never reflect a request value.
- Admin preview of the buyer portal uses a short-lived `admin_preview_token`
  signed with the SHARED `JWT_SECRET` (its own token family) and re-verified in
  `app/buyer/layout.tsx` — not the admin session secret.
- Prequal calls MicroBilt as a SOFT pull only; `rawResponse` is stored
  AES-256-GCM encrypted; timeouts/errors downgrade to `MANUAL_REVIEW`, never
  throw to the buyer, and never expose the report. `PreQualDecision` includes
  `OFAC_ESCALATED`/`OFAC_REVIEW` — route those to the compliance queue.

## Acceptance criteria

- [ ] Actor derived and authorized server-side; ownership enforced; no reliance
      on client role or frontend guard.
- [ ] Correct auth system used; secrets isolated; `proxy.ts` precedence matches
      the signer if changed.
- [ ] Admin paths keep mandatory MFA; lockout/recovery-code semantics intact.
- [ ] Mutating routes are CSRF-protected or carry an equivalent signature.
- [ ] Any webhook verifies signature + idempotency before side effects.
- [ ] New PII is AES-256-GCM encrypted, never logged, retention documented, and
      excluded from LLM prompts and MicroBilt payloads.
- [ ] Rate limiting keyed by identifier + IP; payment throttle fails closed.
- [ ] Privileged/compliance/impersonation actions write the correct audit model.
- [ ] No new `middleware.ts*`; `proxy.ts` remains the only middleware.
- [ ] Tests cover the authz denial path, not just the happy path.

## Cross-skill links

- `autolenis-supabase-postgres` — RLS policy standards, migrations for security
  tables and PII columns.
- `autolenis-integrations` — webhook signature verification, secret isolation,
  provider adapters.
- `autolenis-payments-and-ledger` — Stripe webhook idempotency, deposit/fee
  authorization.
- `autolenis-observability-sre` — audit logging, Sentry (PII scrubbing),
  on-call paging from the limiter.
- `autolenis-communications-consent` — Twilio/Resend consent, suppression, and
  anti-circumvention on messaging.
- `autolenis-system-architecture` — cross-cutting
  standards and the DO-NOT-MODIFY perimeter.
