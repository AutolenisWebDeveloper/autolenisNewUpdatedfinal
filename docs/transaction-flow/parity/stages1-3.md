# Parity map — Stages 1–3 (account & verification · onboarding & usable location · MicroBilt prequalification)

Spec: `docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` lines 343–403 (+ §27.1 rows 1298–1308). HTML: `S[0..2]` lines 488–523.
Repo: `/home/user/autolenisNewUpdatedfinal`, HEAD `0cd399f`, app root `frontend/` (all paths below are relative to `frontend/` unless prefixed `docs/`). Read-only static trace; nothing executed.

## Summary (10 lines)

1. **Stage 1 identity is sound on the registration path**: `ensurePrismaUser` keys on `supabaseId`, upserts the Buyer on the `@unique userId`, and `/api/auth/resend-verification` never touches Buyer rows — exactly-one-buyer holds for verify and resend (S1-08). The parallel intake planes (`unified-buyer-intake`, `voice/dispatch-request`) still dedup on email only.
2. **Terms/consent recording is split**: acceptance is stamped on `Buyer.termsAcceptedAt/termsVersion` + Supabase `user_metadata`; the `AcceptedTerms` model (`accepted_terms`, with IP + unique version) has **no writer anywhere**. SMS consent collected in the onboarding wizard is **never sent to any API**.
3. **No 1h/24h/72h verification reminders and no 14-day draft abandonment exist**; the only post-signup chain is the `$99` pre-checkout sequence, which stops when the buyer has no open vehicle request.
4. **Stage 2 is the largest gap**: onboarding does not collect location; `Buyer` has no `latitude/longitude`; the geocoding adapter and `/api/cron/geocode-backfill` cover Dealers/DealerProspects only; buyer coordinates are resolved at invitation time and never stored.
5. **Post-d9243d1, prequal writes `city/state/zip` back to `buyers`** (never `address`) with structural never-overwrite; that is the only journey path that populates location.
6. **No gate blocks money or progression on a null/non-geocoded location**: `deposit/create-intent` checks prequal + shortlist only; journey facts have no location; the only fail-closed predicates are `dealer-invitation.service` (`!buyerCoords → return 0`, post-deposit) and the request coverage gate (soft hold).
7. **Stage 3 [BUILT] claims verified**: FCRA consent persisted before the pull, atomic pull claim with 30s TTL, OFAC tri-state with affirmative-clear requirement (indeterminate → MANUAL_REVIEW), adverse-action delivery outcome recorded as SENT/SUPPRESSED_DUPLICATE/SEND_FAILED.
8. **Admin receipt confirmed as spec says**: sent only when `needsReview || isProviderError`, only if `ADMIN_NOTIFICATION_EMAIL` is set, and its idempotency key (`admin-prequal-{kind}-{prequalId}`) collapses re-applications of the same buyer (1:1 row) into DUPLICATE.
9. **Approval recheck exists only at the payment gate** (and financing); **absent at offer selection and contract request**; no Deal pause state for mid-transaction expiry. Expiry warning exists but the cron emails through a raw `new Resend()` call outside `EmailSendLog`/outbox.
10. **Every Stage 1–3 communication is sent on the direct Resend rail** (`sendIdempotent`) or raw Resend — none through `comms_outbox`; "provider delay" and "correction required" have no distinct buyer communication.

---

## Rows

Field key: **spec_ref** · **requirement** · **status** · **current** · **evidence** · **safeguard to preserve** · **required change** · **legacy path** · **notes**

### Stage 1 — Account and verification (spec 345–360; HTML S[0] 488–499)

**S1-01** · Stage 1 Entry (L347) · "A Lane 1 capture exists, or a visitor registers directly."
- status: ALREADY CORRECT
- current: Direct registration `signUpAction` (`lib/auth/actions.ts`); guest capture creates placeholder `User.supabaseId = guest_<uuid>` + `Buyer.isGuest` (`lib/services/acquisition/unified-buyer-intake.service.ts`), upgraded in place at signup.
- evidence: `lib/auth/actions.ts:310` `export async function signUpAction`; `:114` `if (existingByEmail && existingByEmail.supabaseId.startsWith("guest_"))`; `unified-buyer-intake.service.ts:162-178` guest User + Buyer create.
- safeguard: guest upgrade replaces the placeholder `supabaseId` rather than creating a second User (`actions.ts:115-133`).
- required change: none.
- legacy: `lib/voice/dispatch-request.ts:129-165` also creates User+Buyer (email-keyed, `email_confirm: true`).
- notes: —

**S1-02** · Who does what (L350) · "System captures legal name, email, phone, password"
- status: PARTIAL
- current: Signup captures firstName, lastName, email, password, confirm, referral code, plan. **Phone is not captured at registration**; it is collected at onboarding only when absent.
- evidence: `app/auth/signup/SignUpClient.tsx:313-331` (name/email/password inputs, no phone); `lib/auth/actions.ts:311-317`; `components/buyer/OnboardingWizardClient.tsx:304-318` phone "only when missing".
- safeguard: phone normalised to E.164 at every Buyer writer (`app/api/buyer/profile/route.ts:69`, `unified-buyer-intake.service.ts:153,174`, `lib/voice/dispatch-request.ts:138,161`).
- required change: decide whether phone belongs at Stage 1 (spec + HTML "Provide legal name, email, phone and password") or stays at Stage 2; if Stage 1, add phone (+ SMS consent) to the signup form and pass through `user_metadata` → `ensurePrismaUser`.
- legacy: —
- notes: HTML `S[0].buyer[0]` lists phone at Stage 1.

**S1-03** · L350 · "plan election (Standard at $99, or Premium at $499)"
- status: ALREADY CORRECT
- current: Plan selector on signup; carried in Supabase `user_metadata.plan`; persisted to `Buyer.plan` on callback/provisioning.
- evidence: `SignUpClient.tsx:263-306` selector; `actions.ts:316-317` `plan: BuyerPlan = planInput === "PREMIUM" ? PREMIUM : STANDARD`; `app/auth/callback/route.ts:32-33`; `prisma/schema.prisma:48` `plan BuyerPlan @default(STANDARD)`; enum `:1461-1464`.
- safeguard: server derives plan from metadata, never from a client field post-signup.
- required change: none for election. Copy check: signup card says Standard "Free · $99 deposit — refund on request", Premium "$499 · $400 after deposit credit" (`SignUpClient.tsx:279-298`) — consistent with §23.
- legacy: —
- notes: HTML adds "knowing the election can change later" — upgrade/downgrade surfaces (`components/buyer/PlanUpgradeCard.tsx`) not inspected (§23 owner).

**S1-04** · L350/L352 · "terms and privacy acceptance … `accepted_terms` with version and timestamp"
- status: PARTIAL
- current: Acceptance stamped on `Buyer.termsAcceptedAt` + `Buyer.termsVersion` (from `getCurrentTermsVersion()`), mirrored into Supabase `user_metadata` for the edge gate; re-acceptance via `acceptTermsAction`. The Prisma `AcceptedTerms` model (`accepted_terms`: userId, termsVersion, acceptedAt, ipAddress, `@@unique([userId, termsVersion])`) has **no writer in `app/`, `lib/`, or `scripts/`**.
- evidence: `actions.ts:327-328` (agreeTerms/agreePrivacy required), `:368-371` metadata stamp, `:166-167` Buyer create stamp, `:675-678` acceptTermsAction updateMany; `lib/auth/terms.ts:31-35,46-53`; `prisma/schema.prisma:2003-2013` model; `rg -n "acceptedTerms" app lib scripts` → no matches.
- safeguard: single `needsTermsAcceptance` predicate shared by `proxy.ts:346` and `app/buyer/layout.tsx:133`; `FALLBACK_TERMS_VERSION` prevents split-brain lockout (`terms.ts:28`).
- required change: write an `AcceptedTerms` row (userId, termsVersion, acceptedAt, ipAddress) on first provisioning and on every `acceptTermsAction`, keeping the Buyer/user_metadata stamps as the gate inputs. Privacy-policy acceptance is not stored separately (only `agreePrivacy` validated) — decide whether it needs its own version row.
- legacy: two-store gate (Prisma + user_metadata) must remain in sync (`actions.ts:652-660` comment).
- notes: IP is captured for prequal consent but not for terms.

**S1-05** · L350/L352 · "email and SMS consent … Consent records"
- status: BROKEN (SMS) / PARTIAL (email)
- current: No explicit email/SMS consent controls at signup (only terms/privacy checkboxes). Email consent is written to the CRM `contacts` plane on verification with `consentEmail: true, consentText: 'AutoLenis buyer registration'`. Onboarding wizard renders a TCPA SMS-consent checkbox that gates the submit button but **its value is never posted** — the submit sends name/phone, preferences, and `{accepted:true}` only. `BuyerPreferences.smsNotifications` stays `false` unless changed in settings.
- evidence: `SignUpClient.tsx:400-420` (only `agreeTerms`, `agreePrivacy`); `app/auth/callback/route.ts:129-137` upsertContact consentEmail; `OnboardingWizardClient.tsx:123` `smsConsent` state, `:134` submit gate, `:143-160` handleSubmit posts without `smsConsent`; `app/api/buyer/settings/route.ts:14-16`; `schema.prisma:134` `smsNotifications Boolean @default(false)`.
- safeguard: `sendCrmSms` TCPA hard gate (`consent_sms && !do_not_contact`) and `sms_suppression` checks (communications-consent skill) — do not weaken; wizard cannot submit a new phone without the checkbox (UX only).
- required change: persist SMS consent on wizard submit — `ContactService.upsertContact({consentSms:true, consentText:<verbatim>, consentAt})` + `BuyerPreferences.smsNotifications=true` + IP/UA; add explicit email-consent capture (or document that transactional email is covered by ToS) and store it as a consent record with text + timestamp.
- legacy: `BuyerOpportunity.consentSms/consentAt` (`schema.prisma:3905-3906`) covers public-intake leads only; Prisma `SmsOptOut` table has no writer (do not resurrect).
- notes: The wizard's consent text (`OnboardingWizardClient.tsx:332-340`) is the only place the TCPA language exists for buyers.

**S1-06** · L350/L352 · "referral or affiliate attribution … Attribution carried from the lead"
- status: ALREADY CORRECT (affiliate) / UNVERIFIED (lead-capture attribution beyond affiliate)
- current: Referral code from visible field → `?ref=` → `affiliate_ref` cookie (client), server cookie fallback; carried in `user_metadata.referralCode`; `recordAffiliateAttribution` upserts `AffiliateReferral`, sets `Buyer.affiliateId` set-if-null, closes the click→conversion loop, evaluates milestones; called from every provisioning path.
- evidence: `SignUpClient.tsx:150-154`; `actions.ts:322-326`, `:247-306`, `:99-103`, `:145-147`, `:239-241`; `callback/route.ts:44-46, 88-90`.
- safeguard: self-referral blocked (`actions.ts:255-261`); idempotent upsert; first-touch wins on `Buyer.affiliateId` (`:277-280`).
- required change: none for affiliate. For "carried from the lead": `BuyerOpportunity` carries `source` (`schema.prisma:3909`) but no UTM/referral columns were seen in the model slice read; landing-page attribution lives on `VehicleRequest` ("Attribution — populated when the request originates from a landing page", `schema.prisma:1035`) — Stage 4/§6.5 owner to verify the lead→buyer carry.
- legacy: `affiliate_ref` cookie set by `proxy.ts` (skill), cleared on sign-out (`actions.ts:522`).
- notes: —

**S1-07** · L350 · "System sends a verification link. Buyer verifies."
- status: ALREADY CORRECT
- current: `generateLink({type:"signup"})` via the Supabase admin API (suppresses Supabase's default email); branded welcome/verification email via Resend `sendIdempotent` (`welcome-${to}`); callback exchanges `code` or `token_hash`; sign-in refuses unconfirmed users.
- evidence: `actions.ts:352-373, 396-402`; `lib/services/email/resend.service.ts:252-266`; `lib/services/email/templates/welcome.tsx:5-6, 38-50` ("This link expires in 24 hours"); `callback/route.ts:26-108`; `actions.ts:441-444` `if (!data.user.email_confirmed_at) … return { error: "verify_required" }`.
- safeguard: never falls back to Supabase's own email (avoids double send); sign-in gate on `email_confirmed_at`.
- required change: none functionally. The "24 hours" copy is a template literal — Supabase OTP TTL is UNVERIFIED (no dashboard access); keep in sync.
- legacy: Google OAuth signup path (`SignUpClient.tsx:32-50`) bypasses the branded email and terms metadata stamp — `ensurePrismaUser` gets no `termsAcceptedAt` → buyer is bounced to `/auth/accept-terms` (correct by construction, but UNVERIFIED end-to-end; `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` gated).
- notes: —

**S1-08** · L352 · "The verification link creates or confirms exactly one buyer — resending never creates a second."
- status: ALREADY CORRECT
- current: `ensurePrismaUser` resolves by `supabaseId` first; existing User → `prisma.buyer.upsert({where:{userId}, create:…, update:{}})`; guest by email → in-place upgrade; otherwise `user.create` with nested buyer. `Buyer.userId` is `@unique`. `/api/auth/resend-verification` performs zero Buyer writes (reads buyer for personalisation, `generateLink`, sends email with a per-minute idempotency key, writes an `AdminAuditLog VERIFICATION_RESENT` row for its 60s rate limit). Repeated callback visits are no-ops (`EMAIL_VERIFIED_SENT` audit dedup).
- evidence: `actions.ts:68-71` (findUnique supabaseId), `:84-97` (upsert, `update: {}`), `:110-149` (guest upgrade), `:151-173` (create); `schema.prisma:32` `userId String @unique`; `app/api/auth/resend-verification/route.ts:111-114, 142-146, 154-159, 162-171`; `callback/route.ts:165-196`; test `lib/auth/__tests__/accept-terms-navigation.test.ts:310` "clicking twice is idempotent — no duplicate acceptance row, no second buyer".
- safeguard: `update: {}` guarantees a heal never clobbers buyer data; unique constraint is the mutex for concurrent heals; resend is enumeration-safe and rate-limited.
- required change: none on this path. **Identity caveat (out of Stage 1's registration path but same entity):** `unified-buyer-intake.service.ts:128-179` and `lib/voice/dispatch-request.ts:129-165` create Buyers keyed on **email only**; `buyers.phone` is nullable/non-unique/un-indexed (`schema.prisma:35`, only `@@index([affiliateId])` `:93`) — a phone-first lead with a different email still creates a second Buyer (documented `docs/plans/BUYER-LOCATION-GAP.md` §3; not changed at HEAD). Add phone-aware lookup (email → normalised phone) in `resolveBuyerId`/`dispatch-request` before create.
- legacy: buyer-branch fallback in resend (`route.ts:148-150`) sends an email whose "link" is `/auth/verify-email` (the resend page) when Supabase returns no `action_link` — the affiliate branch refuses instead (`:77-81`); align.
- notes: —

**S1-09** · Buyer sees (L354) · "Verify your email to continue."
- status: PARTIAL (presentation)
- current: Signup success card: "Check your email — We sent a confirmation link to your email address. Click it to activate your {Standard|Premium} account." Verify page: "Verify your email — We sent a verification link to your email address. Click the link to activate your account." Sign-in on unverified returns `verify_required` (UI handling in `SignInClient.tsx` not read).
- evidence: `SignUpClient.tsx:168-172`; `app/auth/(card)/verify-email/page.tsx:41-45`; `actions.ts:443`.
- safeguard: —
- required change: align headline to "Verify your email to continue." (HTML `sees`) — copy only.
- legacy: —
- notes: component paths for the "Buyer sees" table: `SignUpClient.tsx` (success state), `verify-email/page.tsx`, `SignInClient.tsx` (UNVERIFIED).

**S1-10** · Exit (L356) · "Email verified and one buyer record confirmed. Any draft Vehicle Request is attached to it."
- status: PARTIAL
- current: Verified via callback → `ensurePrismaUser`. Guest vehicle requests are re-pointed to the new buyer **only** on the fresh-`user.create` branch, **only** when the guest buyer shares the same email, and **fire-and-forget** (unawaited `.then`, errors logged). Guest-upgrade branch keeps the same Buyer row so its VRs remain attached. There is no "draft" VehicleRequest status (`VehicleRequestStatus` starts at `SUBMITTED`).
- evidence: `actions.ts:193-210`; `:114-148`; `schema.prisma:1654-1666` enum; `lib/services/buyer/request-resume-token.service.ts:38-56` (secure resume deep-link, hashed, single-use).
- safeguard: resume token is hashed at rest, 5-day TTL, single-use, grants no capability (`request-resume-token.service.ts:9-14, 22`).
- required change: await the transfer inside provisioning (or make it a durable job), record a `VehicleRequestEvent`, and define what a "draft" VR is (Stage 4 owner) so attachment is deterministic; consider phone-matched guest transfer once phone dedup exists (S1-08).
- legacy: `/api/public/request-vehicle` guest path (referenced `actions.ts:107`) — not inspected.
- notes: —

**S1-11** · If it fails (L358) · "Owner: system. Reminders at 1 hour, 24 hours, and 72 hours."
- status: MISSING
- current: No email-verification reminder sequence. On fresh signup `ensurePrismaUser` schedules the `form_submitted` lifecycle workload, whose touches (+0, +1h, +24h, +72h) are the **$99 pre-checkout chase** ("Your vehicle request is saved — one step left") and whose guard `preCheckoutResolved` returns *resolved* (stop) when the buyer has **no open vehicle request** — so a plain signup gets no touches at all, and a signup with a VR gets deposit-chase copy, not verification reminders. Nothing checks `email_confirmed_at`.
- evidence: `actions.ts:184-191`; `lib/services/crm/lifecycle-scheduler.ts:185-207`; `lib/services/crm/lifecycle-touch-drain.service.ts:437-455` (+1h), `:474` (+23h), `:494` (+72h); `lib/qstash/state.ts:76-91` `return deposit !== null || openRequest === null`.
- safeguard: `lifecycle_touch_schedule` UNIQUE(base_key, sequence) idempotency; guards re-read live state before every touch (`lifecycle-touch-drain.service.ts:428-430`).
- required change: add a `verify_email` lifecycle sequence (touch 1 +1h, 2 +24h, 3 +72h) keyed `email-verify:{userId}`, guarded on Supabase `email_confirmed_at` (admin `getUserById`) and on `Buyer.isGuest=false`, delivered through the comms outbox with a fresh `generateLink` per touch; ownership: system.
- legacy: QStash path `/api/jobs/form-submitted` when `LIFECYCLE_INTERNAL_FORM_SUBMITTED` flag is off (`lifecycle-scheduler.ts:187,199`).
- notes: The scheduler is invoked with `phone: ""` (`actions.ts:189`) — SMS touches cannot fire for website signups.

**S1-12** · L358 · "Abandon the draft after 14 days, preserving history."
- status: MISSING
- current: No 14-day abandonment for unverified accounts or unattached drafts. `rg "14 \* 24|fourteen|abandon"` finds only the LP form-abandonment nurture (`lib/services/crm/lead-nurture.service.ts`) and `lead-nurture-drain`.
- evidence: `rg` over `app/api/cron`, `lib/services/vehicle-request`, `lib/services/acquisition`, `lib/services/crm` → only `lead-nurture.service.ts:25-49`.
- safeguard: `VehicleRequest` history is event-based (`VehicleRequestEvent`) — abandonment must be a status + event, not a delete.
- required change: cron (or lifecycle touch 4) that marks an unverified buyer's draft VR `EXPIRED` with reason `UNVERIFIED_14D`, writes a `VehicleRequestEvent`, cancels the reminder chain, and leaves the User/Buyer rows intact.
- legacy: Supabase Auth may purge unconfirmed users on its own schedule — UNVERIFIED.
- notes: —

**S1-13** · L358 · "Return point: the verification link may be reissued at any time."
- status: ALREADY CORRECT
- current: `/api/auth/resend-verification` (POST `{email}`), 60s rate limit per buyer/email, enumeration-safe success; `verify-email` page hosts the resend form.
- evidence: `app/api/auth/resend-verification/route.ts:90-178`; `verify-email/page.tsx:12-34`.
- safeguard: rate limit + enumeration safety + minute-window idempotency key.
- required change: see S1-08 legacy note (no-link fallback).
- legacy: —
- notes: —

**S1-14** · Recorded/Tables (L352; HTML `tables:["buyers","accepted_terms","buyer_opportunities"]`)
- status: PARTIAL
- current: `buyers` ✔ (`schema.prisma:30-96`); `buyer_opportunities` ✔ (`:3891`); `accepted_terms` model exists but unwritten (S1-04).
- evidence: as cited.
- required change: S1-04.

**S1-15** · §27.1 L1298 · "Registration submitted → Buyer: Verification link and expiry"
- status: PARTIAL (content ✔, transport ✘)
- current: `sendWelcomeEmail` — subject "Welcome to AutoLenis, {first} — Verify Your Email", body states 24-hour expiry; sent on the **direct** rail (`sendIdempotent` → Resend + `EmailSendLog`), not `comms_outbox`.
- evidence: `resend.service.ts:252-266`; `templates/welcome.tsx:5-6, 50`; §27 L1290-1294 (outbox rule).
- safeguard: `EmailSendLog` idempotency (`resend.service.ts:139-222`).
- required change: route via `enqueueTransactionalEmail` (`lib/services/email/transactional-dispatch.ts:36-46`) with the same key for parity.
- legacy: direct rail.

**S1-16** · §27.1 L1299 · "Verification completed → Buyer: Welcome and onboarding link"
- status: PARTIAL
- current: `sendEmailVerifiedEmail` ("You're Verified ✓ … ready to check your buying power … Complete your pre-qualification") links to the **prequal** URL, not onboarding; dedup via `AdminAuditLog EMAIL_VERIFIED_SENT` **and** `EmailSendLog email-verified-${to}` (two dedup planes); direct rail.
- evidence: `callback/route.ts:165-196`; `resend.service.ts:911-921`; `templates/email-verified.tsx:37-43`.
- required change: point CTA at `/buyer/onboarding` (layout redirects anyway), drop the AdminAuditLog dedup in favour of the outbox dedup key, route via outbox.
- legacy: AdminAuditLog used as a send-dedup store (also `VERIFICATION_RESENT`).

**S1-17** · Security controls (auth-security skill; spec §29 not in range) · rate limiting on registration
- status: PARTIAL
- current: `signInAction` rate-limits by IP + email (fail-open); `forgotPasswordAction` throttles; **`signUpAction` has no limiter** (Supabase-side limits only, UNVERIFIED); `resend-verification` limits via `AdminAuditLog` lookup (DB-backed, 60s).
- evidence: `actions.ts:421-430`, `:536-543`, `:310-405` (no `limitAuthAttempt`); `resend-verification/route.ts:117-132`.
- safeguard: enumeration-safe messaging on sign-in/forgot; duplicate-email disclosure deliberately allowed on sign-up (`actions.ts:341-347`).
- required change: add `limitAuthAttempt` keyed by IP + email to `signUpAction`.

**S1-18** · Audit (spec "Compliance events"/§29) · registration audit trail
- status: PARTIAL
- current: `AdminAuditLog` rows for `VERIFICATION_RESENT`, `EMAIL_VERIFIED_SENT`; `BuyerActivityEvent` written only by `saveOnboardingStep` (`ONBOARDING_*`), which has no caller in the journey (UNVERIFIED — grep shows only the service). No event for "account created" or "terms accepted" beyond column stamps.
- evidence: `resend-verification/route.ts:162-171`; `callback/route.ts:187-196`; `lib/services/buyer/buyer-onboarding.service.ts:20-25`.
- required change: emit `BuyerActivityEvent` (or `ComplianceEvent` for terms) on provisioning and acceptance.

### Stage 2 — Onboarding and usable location (spec 362–379; HTML S[1] 501–511)

**S2-01** · Entry (L364) · "Verified buyer."
- status: ALREADY CORRECT
- current: `/buyer/*` requires a Supabase session (`requireBuyer`), terms acceptance, and (except an allow-list) `onboardingComplete`; unverified users cannot sign in.
- evidence: `app/buyer/layout.tsx:101, 133-135, 159-171`; `lib/auth/session.ts:60-84`; `actions.ts:441-444`; `proxy.ts:333-346, 611-630`.
- safeguard: server-side layout backstop mirrors the edge gate; `requireBuyer` self-heals a missing Buyer via `ensurePrismaUser` (`session.ts:78-84`).

**S2-02** · Who does what (L367) · "System collects complete address, city, state, ZIP"
- status: MISSING (at onboarding) / PARTIAL (platform-wide)
- current: The wizard deliberately excludes address ("No … DOB/address/employment. Those live exclusively on /buyer/prequal"); `/api/buyer/onboarding/complete` gates on terms + name only. Location is collected and validated at **prequal** (`address/city/state/zip` required; state `^[A-Z]{2}$`, zip `^\d{5}$`) and, since `d9243d1`, `city/state/zip` are written back to `buyers` with structural never-overwrite; `address` is intentionally not persisted. `PATCH /api/buyer/profile` accepts all four but no journey caller sends them.
- evidence: `OnboardingWizardClient.tsx:3-13`; `app/api/buyer/onboarding/complete/route.ts:18-48`; `app/api/buyer/prequal/route.ts:44-47`; `lib/services/prequal/prequal.service.ts:300-323` (`updateMany({where:{id, city:null}})` ×3, `.catch` logged); `:297-298` "`address` is deliberately NOT persisted"; `app/api/buyer/profile/route.ts:17-20, 70-73`; wizard submit `:143-160`.
- safeguard: never-overwrite by `<field>: null` guard (concurrent admin edits safe); a failed location write never fails the credit pull; tests `lib/services/prequal/__tests__/prequal-location-backfill.test.ts` (exists; contents not read).
- required change: add an address step to the wizard (address, city, state, ZIP with the prequal regexes) posting to `PATCH /api/buyer/profile`; keep the prequal backfill as the healing path; decide whether `address` (street) must be stored on `buyers` (spec says "complete address").
- legacy: pre-`69bfa2b` profile PATCH nulled location (fixed; `profile/route.ts:58-62` comment).
- notes: A re-submission by an already-approved buyer still runs the backfill before the valid-prequal early return (`prequal.service.ts:315-323`).

**S2-03** · L367 · "communication preferences"
- status: PARTIAL
- current: Email notifications + vehicle prefs saved to `BuyerPreferences` via `PATCH /api/buyer/settings`; SMS consent not persisted (S1-05).
- evidence: `OnboardingWizardClient.tsx:153-157`; `app/api/buyer/settings/route.ts:14-16, 51-53`; `schema.prisma:130-141`.
- required change: S1-05.

**S2-04** · L367 · "initial vehicle preferences"
- status: ALREADY CORRECT
- current: `vehicleTypePreference`, `newOrUsedPreference` on `BuyerPreferences`.
- evidence: `OnboardingWizardClient.tsx:117-118, 153-157`; `schema.prisma:137-138`.

**S2-05** · L367/L369 · "System geocodes the address and stores latitude and longitude … `buyers` address fields populated and geocoded"
- status: MISSING (for buyers)
- current: `Buyer` has **no** `latitude/longitude` columns. Geocoding adapter exists (`geocodeZip`: static `ZIP_COORDS` → `SearchCache` (`searchType:"geocoding"`) → Google only when `GOOGLE_GEOCODING_API_KEY` is set; fails closed otherwise; `lookupCity` static). `backfillCoordinates` + `/api/cron/geocode-backfill` populate **Dealer** and **DealerProspect** coords only. Buyer coordinates are computed at invitation time and discarded.
- evidence: `schema.prisma:30-96` (no lat/lng on Buyer; lat/lng on Dealer `:157-158`); `lib/services/integrations/geocoding.service.ts:5-7, 101-102, 129-165`; `app/api/cron/geocode-backfill/route.ts:1-3, 22`; `lib/services/auction/dealer-invitation.service.ts:245-250`.
- safeguard: geocoder fails closed without a key; results cached long-term (`geocoding.service.ts:38`).
- required change: migration adding `buyers.latitude`, `buyers.longitude`, `geocoded_at`, `geocode_source` (nullable); geocode on every location write (profile PATCH, prequal backfill, admin update, intake zip backfill) via the existing adapter; extend `backfillCoordinates` pools to buyers; record failure for S2-11.
- legacy: static tables `lib/utils/zip-coords.ts` (hand-curated; counts per `docs/plans/BUYER-LOCATION-BACKFILL.md` UNVERIFIED at HEAD).
- notes: `GOOGLE_GEOCODING_API_KEY` presence in production is UNVERIFIED.

**S2-06** · L367/L376 · "Buyer corrects anything unusable … returned to the specific field with a specific message, not a generic error"
- status: PARTIAL
- current: Zod errors return the **first issue message** only (no field path in the payload): profile PATCH (`state` must be length 2), prequal ("State must be a 2-letter code", "ZIP must be 5 digits", DOB rules). No geocodability check at write — a well-formed ZIP that the static table lacks (and no Google key) is accepted and later invites zero.
- evidence: `profile/route.ts:49-53`; `prequal/route.ts:46-47, 89-94`; `errorResponse(code, first?.message)`; `dealer-invitation.service.ts:263-282` (discovery happens post-deposit).
- required change: include `field` (zod path) in the error envelope and render it inline; on location write call `geocodeZip`/`lookupCity` and return `LOCATION_NOT_RESOLVABLE` naming the field ("We couldn't place ZIP 78745 — check it, or add city and state"); buyer-facing correction copy on the profile/onboarding form.
- legacy: —

**S2-07** · Recorded (L369) · "`buyers` address fields populated and geocoded."
- status: PARTIAL — city/state/zip after prequal; `address` only via profile/admin; never geocoded/stored. See S2-02, S2-05.

**S2-08** · L369 · "The location is mirrored onto the Vehicle Request when the request is created."
- status: MISSING
- current: `VehicleRequest` has no zip/city/state/lat/lng columns; the coverage gate reads `vr.buyer.zip` live; `BuyerOpportunity.zip` exists for public intake.
- evidence: `schema.prisma:1022-1073` (no location fields; `buyerOpportunityId` `:1047`); `lib/services/acquisition/request-coverage-gate.service.ts:86, 135` `assessCoverage(vr.buyer?.zip ?? null, …)`; `rg "zip|city|state" lib/services/vehicle-request/vehicle-request.service.ts` → none; `schema.prisma:3935` `zip String?` on BuyerOpportunity.
- required change: add a location snapshot (zip, city, state, lat, lng, geocoded_at) to `vehicle_requests` written at create (Stage 4 / §32 owner); backfill from `buyers`.
- legacy: `buyer_opportunities.zip` is the only sourced location for the 10 NULL rows (`lib/services/buyer/location-backfill.ts:8-13`).

**S2-09** · Buyer sees (L371) · "Progress toward 'ready to request offers,' with the exact missing field named."
- status: PARTIAL
- current: Wizard progress bar (Account / Profile Setup / Pre-Qualification); journey `nextAction` strings ("Complete your profile", "Check your buying power"); `computeProfileCompleteness` lists missing labels incl. "Street address", "City and ZIP" behind `GET /api/buyer/profile/completeness` (no UI consumer found); `getOnboardingSteps` has no location step.
- evidence: `OnboardingWizardClient.tsx:27-31`; `lib/services/buyer/journey.ts:52-68`; `lib/services/buyer/profile-completeness.service.ts:12-21`; `app/api/buyer/profile/completeness/route.ts:8` (only consumer); `buyer-onboarding.service.ts:12-17`.
- required change: add `locationUsable` to `JourneyFacts` and a stage-level "missing: ZIP" reason surfaced by `JourneyNavigator`/dashboard; wire the completeness `missing[]` into the onboarding surface.
- legacy: `getOnboardingSteps` / `saveOnboardingStep` appear uncalled by the journey (UNVERIFIED).

**S2-10** · Exit (L373) · "A usable, geocoded location exists."
- status: MISSING (as a gate)
- current: `onboardingComplete` is set on terms+name; `JourneyFacts` = onboardingComplete, prequalValid, shortlistCount, depositPaid, activeAuction, deal — no location fact; layout treats `onboardingComplete || prequalApproved` as complete.
- evidence: `onboarding/complete/route.ts:40-46`; `journey.ts:34-43, 94-118`; `app/buyer/layout.tsx:152`.
- required change: introduce `locationUsable` fact (city+state+zip present AND coords stored/resolvable) and require it for `prequal → search` progression and for S2-12 gates; do **not** block `/buyer/prequal` itself (prequal is where the location is captured today).

**S2-11** · If it fails (L375) · "Owner: buyer, with a correction task for Operations if geocoding repeatedly fails."
- status: PARTIAL
- current: The only operator-visible artefact is an `AdminAuditLog` `AUCTION_ZERO_INVITATIONS` row with cause `BUYER_NOT_GEOCODABLE` written at auction-invite time (deduped on cause), rendered on the admin auction page. No ops task/queue item, no `PlatformAlert`, no buyer notification.
- evidence: `dealer-invitation.service.ts:153-212, 273-280`.
- safeguard: dedup-on-cause keeps the 30-row admin window readable; cause transition still writes a new row (`:167-176`).
- required change: on geocode failure at write time (S2-05) create an Operations task (`queue_items` per §4.6 once built; until then `PlatformAlert` via `createAlertOnce`) and a buyer notification naming the field; retry count → "repeatedly fails" threshold.
- legacy: —

**S2-12** · L375 · "An unusable address blocks every location-dependent stage — sourcing, distance disclosure, and offer distance ranking."
- status: BROKEN
- current: **No gate blocks progression or payment on a null/non-geocoded location.** Predicates that exist: (a) `inviteDealersToAuction` fail-closed `if (!buyerCoords) { … return 0 }` — runs **after** the $99 deposit; (b) `request-coverage-gate` `assessCoverage(vr.buyer?.zip ?? null)` → coverage 0 → soft hold on the vehicle request (thin coverage), not a buyer-facing block; (c) `coverage.service.ts:87` reads `auction.buyer.zip`. Absent: `POST /api/buyer/deposit/create-intent` checks only `isPrequalValid` + shortlist count; `select-offer` has no location check; journey/onboarding have none.
- evidence: `dealer-invitation.service.ts:263-282`; `request-coverage-gate.service.ts:135-136`; `lib/services/auction/coverage.service.ts:87, 109`; `app/api/buyer/deposit/create-intent/route.ts:63-80` (prequal + shortlist only; no `zip`/`city`/`state` reference — `rg` over `app/api/buyer/deposit` for zip/city/state → none); `journey.ts:34-43`.
- safeguard: **keep** the dealer-invitation fail-closed return (never invite the whole roster) and the zero-invite audit record; keep `pickNearbyDealers` excluding unplaceable dealers.
- required change: add the `locationUsable` predicate (S2-10) to `deposit/create-intent` (return `LOCATION_REQUIRED` naming the field), to vehicle-request submission (`createVehicleRequest`), and to the journey; distance disclosure / offer distance ranking gates belong to Stages 7–9 owners (UNVERIFIED here).
- legacy: `classifyActivation` 'invite'→'close' ladder converges silently on a NULL location (`docs/plans/BUYER-LOCATION-GAP.md` exec summary; `deposit-activation-policy.ts` not re-read at HEAD).

**S2-13** · Note (L378) · "Why this is a hard gate" (auction closed ~2h with null city/state/zip)
- status: PARTIAL (root cause closed for new buyers; gate still missing)
- current: `d9243d1` fixes 1–3 verified in code: prequal location backfill (`prequal.service.ts:300-323`), zero-invite audit (`dealer-invitation.service.ts:153-212`), phone normalisation at Buyer writers (`profile/route.ts:69`, `unified-buyer-intake.service.ts:153,174`, `dispatch-request.ts:138,161`). Fix 4 (`/api/finder` buyer-linking removal) and the admin-schema tightening (BACKFILL §4) were **not inspected** — UNVERIFIED. Backfill tooling: `lib/services/buyer/location-backfill.ts` (`decideBackfill` FILL/ALREADY_SET/NO_SOURCE/CONFLICT) exists; `scripts/backfill-buyer-location.ts` not read.
- evidence: as cited; `location-backfill.ts:57-107`.
- required change: S2-10/S2-12 gate; run the dry-run backfill (owner decision; no DB access here).

**S2-14** · §27.1 L1300 · "Onboarding incomplete → Buyer: The exact unfinished requirement"
- status: MISSING (email/SMS) / PARTIAL (in-app)
- current: In-app nudge `PREQUAL_IDLE` ("Your buying power awaits — Complete your prequalification…") and dashboard nudges; no onboarding-incomplete email naming the missing field.
- evidence: `lib/services/nudge/nudge.service.ts:33, 59`; `app/buyer/dashboard/page.tsx:168-185`.
- required change: lifecycle touch "onboarding_incomplete" via outbox using `computeProfileCompleteness().missing[0]`.
- legacy: `inactivity-scan` cron (`vercel.json:224`) not inspected.

**S2-15** · Admin write path for location (`BUYER-LOCATION-BACKFILL.md` §4 "IMPLEMENTED")
- status: UNVERIFIED — `app/api/admin/buyers/[buyerId]/route.ts` and `updateBuyerProfileByAdmin` not opened in this pass.

### Stage 3 — MicroBilt prequalification (spec 381–403; HTML S[2] 513–523)

**S3-01** · Entry (L383) · "Verified buyer with usable location."
- status: PARTIAL
- current: `/buyer/prequal` is reachable once `onboardingComplete`; there is no location precondition — the prequal form is where location is collected (pre-filled from `buyer.address/city/state/zip`).
- evidence: `app/buyer/layout.tsx:159-171`; `app/buyer/prequal/page.tsx:488-501`; `prequal/route.ts:44-47`.
- required change: none until S2-10 exists; then prequal should consume, not create, the usable location (keep backfill as healing).

**S3-02** · L386 · Non-SSN application fields: "legal name, date of birth, address, income, employment, housing status and cost, monthly debt, budget, expected down payment, co-buyer election, and FCRA consent"
- status: PARTIAL
- current: Schema covers firstName/lastName, DOB (real date, 18–110, not future), address/city/state/zip, `fcraConsent: z.literal(true)`, employmentStatus, employerName, monthlyIncome ($500–$1M), lengthOfEmployment, housingStatus enum, monthlyHousingPayment (required for RENT/MORTGAGE), monthlyOtherDebt (default 0). **Missing:** stated budget (only a prior `maxOtdAmountCents` is passed as fallback), expected down payment, co-buyer election. SSN is never collected (correct).
- evidence: `prequal/route.ts:37-76, 104-142`; `prequal.service.ts:176-201` `PrequalSubmission`; `schema.prisma:306-345` (no downPayment/coBuyer columns).
- safeguard: employment/housing/debt fields are "AutoLenis-internal only, never sent to MicroBilt" (`route.ts:7`, `prequal.service.ts:354-362` PII payload limited to name/DOB/address); income floor/ceiling sanity checks.
- required change: add `statedBudgetCents`, `expectedDownPaymentCents`, `coBuyerElected` to the submission + `PreQualification` (migration; co-buyer is §4b NEW — coordinate); `components/buyer/PrequalBudgetCalculator.tsx` exists but its persistence path is UNVERIFIED.
- legacy: —

**S3-03** · L388 · "System persists FCRA consent **before** the MicroBilt request [BUILT]"
- status: ALREADY CORRECT
- current: `claimPrequalPull` writes `PrequalConsent` (exact `FCRA_CONSENT_TEXT`, ip, userAgent, termsVersion) after claiming the slot and before `callIPredict`; route rejects `fcraConsent !== true` with `FCRA_CONSENT_REQUIRED`; UI renders the verbatim text with an "I AGREE" button; `/legal/prequal-consent` mirrors it.
- evidence: `prequal.service.ts:263-279` (consent create), `:345` (claim) precedes `:364` (`callIPredict`); `route.ts:48-50, 92`; `components/buyer/PrequalFormClient.tsx:10, 615-692`; `app/(public)/legal/prequal-consent/page.tsx:8`; `microbilt.service.ts:1272`.
- safeguard: consent write is un-caught — a failure aborts before the bureau call (`:263-264`); admin path requires an existing `PrequalConsent` or an admin-recorded consent row and blocks with `CONSENT_MISSING` (`admin-prequal.service.ts:340-386, 536-552`).
- required change: none. Hygiene: the consent text is DUPLICATED as three literals (`microbilt.service.ts:1272`, `PrequalFormClient.tsx:10`, `legal/prequal-consent/page.tsx:8`) — import the one constant (client-safe module) or pin equality in a test (test presence UNVERIFIED).
- notes: no `ComplianceEvent` is written for consent capture itself; `PrequalConsent` is the record.

**S3-04** · L388 · "claims the pull to prevent concurrent duplicates [BUILT]"
- status: ALREADY CORRECT
- current: PENDING marker created on the `@unique buyerId` (unique violation → `inflight`); existing row claimed by conditional `updateMany({where:{buyerId, updatedAt}})`; 30s in-flight TTL self-heals crashed pulls; loser returns current record with `inFlight: true` and no second inquiry.
- evidence: `prequal.service.ts:210-261, 336-352`; `schema.prisma:308` `buyerId String @unique`.
- safeguard: TTL (30s) > MicroBilt 10s abort (`microbilt.service.ts:374`); PENDING marker is never `isPrequalValid`.
- required change: none. Note: `prequal-ibv-reminders` nudges any `PENDING` row older than 24h with "Your identity verification is pending" (`app/api/cron/prequal-ibv-reminders/route.ts:16-46`) — a stale crashed-pull marker produces a misleading buyer notification; scope that cron to PENDING rows that are not in-flight markers (or drop it).

**S3-05** · L388 · "runs the pull, runs OFAC screening, and returns exactly one truthful outcome: APPROVED, DECLINED, MANUAL_REVIEW, OFAC_REVIEW, or provider delay"
- status: PARTIAL
- current: `callIPredict` (10s AbortController; TIMEOUT/NETWORK/ERROR/blank-DECISION/config-mismatch → `MANUAL_REVIEW` with a provider `reason`; sandbox mock only with `MICROBILT_SANDBOX=true`; refuses `apitest.` URLs in prod). Decision gates in order: OFAC hit → `OFAC_REVIEW`; OFAC indeterminate on APPROVED → `MANUAL_REVIEW`; deceased, MLA, fraud warning, high-risk address → `MANUAL_REVIEW`; else provider decision (income gate min applied inside). **"Provider delay" has no distinct decision value** — it is `MANUAL_REVIEW` + `ComplianceEvent PREQUAL_PROVIDER_FAILURE` + `PlatformAlert` (P1, P0 after 3 in 24h). Buyer-facing result is identical to a compliance hold.
- evidence: `microbilt.service.ts:373-374, 398-412, 521-545, 754-784, 1073-1100`; `prequal.service.ts:378-437, 75-123, 735-743`; `schema.prisma:1549-1556` enum (no PROVIDER_DELAY).
- safeguard: fail-closed on every provider failure class; P0 escalation; `classifyProviderFailure` REQUEST_REJECTED vs PROVIDER_UNAVAILABLE (`microbilt.service.ts:98`); `PROVIDER_ERROR_REASONS` set (`:29`).
- required change: expose provider delay distinctly to the buyer (e.g. `providerDelay: true` in `toBuyerSafePrequal` derived from the latest `PREQUAL_PROVIDER_FAILURE` event, or a `PROVIDER_DELAY` decision) and send the §27.1 "Processing-delay notice"; keep the record fail-closed.
- legacy: `prequal-message-delivery` cron re-creates the APPROVED notification (DUPLICATED with `prequal.service.ts:566-577`).

**S3-06** · L390 · "An approval requires an affirmative OFAC clear. Missing or indeterminate screening cannot produce an approval [BUILT]"
- status: ALREADY CORRECT
- current: `computeOfacFlag` tri-state (true/false/null) from `IDV.OFACAlert` + `OFAC.ofacresult`; Gate 1 `ofacFlagged === true → OFAC_REVIEW` + SYSTEM_ALERT notification; Gate 1b `ofacFlagged == null && APPROVED → MANUAL_REVIEW`; timeout/error/income-gate-decline results carry `ofacFlagged: null`.
- evidence: `microbilt.service.ts:647-670, 528, 544, 888-896, 1023-1028`; `prequal.service.ts:380-407`.
- safeguard: admin `OFAC CLEAR` requires a reason, only auto-approves when tier + amount already exist, resets `checkOfacAlert`, writes AdminAuditLog + ComplianceEvent, and returns 409 on concurrent action (`app/api/admin/compliance/ofac/[prequalId]/route.ts:26-45, 47-91`).
- required change: none. **Open risk (UNVERIFIED):** `app/api/admin/external-preapprovals/[id]/approve/route.ts:77` upserts `PreQualification` — if it writes `APPROVED` without OFAC screening, `isPrequalValid` becomes true on a plane that never ran OFAC. Not read; see Open questions.

**S3-07** · Recorded (L392) · "`pre_qualifications` with a server-controlled approved amount, tier, and expiry"
- status: ALREADY CORRECT
- current: Upsert on decision; `maxOtdAmountCents` only when APPROVED (else 0), from `min(income gate, credit gate)` inside `callIPredict`; tier from provider; `expiresAt` from result (30 days); buyer API never accepts the amount.
- evidence: `prequal.service.ts:439-514`; `route.ts:108-111` comment; `admin-prequal.service.ts:36` `IPREDICT_EXPIRY_MS = 30d`.
- safeguard: `rawResponse` AES-256-GCM encrypted (`microbilt.service.ts:530` `encryptRawResponse`), scrubbed after 90 days (`prequal-purge/route.ts:39-51`); decision detail exposed only with `includeDecisionDetail` (`prequal.service.ts:143-174`).
- required change: none. Note: a re-application after expiry overwrites the row (1:1 per buyer) — history lives only in `ComplianceEvent`/`AdminAuditLog`; the approval email computes expiry as `now + 30d` (`:596`) rather than `result.expiresAt` — UNVERIFIED equal.

**S3-08** · L392 · "`prequal_consents`" — ALREADY CORRECT (S3-03). Model `schema.prisma:347-360`.

**S3-09** · L392 · "Compliance events"
- status: ALREADY CORRECT
- current: `PREQUAL_APPROVAL_NOTICE_SENT`, `ADVERSE_ACTION_NOTICE_{SENT|SUPPRESSED_DUPLICATE|SEND_FAILED}`, `PREQUAL_UNDER_REVIEW_NOTICE_SENT`, `PREQUAL_PROVIDER_FAILURE` (with class), `OFAC_REVIEW_{CLEARED|ESCALATED}`; admin path mirrors with `consentSource`.
- evidence: `prequal.service.ts:86-98, 611-628, 666-691, 712-727`; `ofac/[prequalId]/route.ts:74`; `admin-prequal.service.ts:612-628, 663-689, 719-732`; model `schema.prisma:363-376`.
- required change: none. Optional: OFAC hit at decision time is recorded only as a `Notification SYSTEM_ALERT` (`prequal.service.ts:384-392`) — add a `ComplianceEvent OFAC_HIT_RECORDED` for the audit chain.

**S3-10** · L392 · "An administrative receipt for every submitted application — reference, summary, submission time, current outcome, and an authenticated admin link — excluding SSN, raw bureau data, raw OFAC data, and raw provider responses [NEW: currently sent only on manual review or provider error]"
- status: PARTIAL (spec's "currently" statement CONFIRMED)
- current: `sendAdminPrequalAlertEmail` is called only `if (needsReview || isProviderError)`; recipient `ADMIN_NOTIFICATION_EMAIL` (skipped with a warn when unset); body: Buyer ID, buyer email, decision, provider reason, links to `/admin/buyers/{id}?tab=prequal` and `/admin/manual-reviews`; footer forbids consumer-report details. Excludes SSN/raw data ✔. No submission time, no summary. Idempotency key `admin-prequal-{kind}-{prequalId}` — because `PreQualification` is one row per buyer, a **second application by the same buyer collapses to DUPLICATE** and no receipt is sent.
- evidence: `prequal.service.ts:745-760`; `resend.service.ts:496-528` (`:504-510` env gate, `:512` key); `templates/admin-prequal-alert.tsx:37-38, 57-67, 71`; `admin-prequal.service.ts:740-747` (same call; condition not fully read).
- safeguard: privacy footer + no PII beyond email/ids; admin links are behind admin JWT+MFA.
- required change: send for **every** outcome (kind `SUBMITTED`/`APPROVED`/`DECLINED`/`REVIEW`/`PROVIDER_ERROR`), key on `${prequalId}-${decisionTimestamp}`, add submittedAt + summary (fields present/absent, no values), route via outbox; consider an in-app admin `Notification` so it is not dependent on `ADMIN_NOTIFICATION_EMAIL`.
- legacy: `ADMIN_NOTIFICATION_EMAIL` unset silently drops ops mail (`prequal.service.ts:31-38` history comment).

**S3-11** · Buyer sees (L394) · "approval with amount and expiration"
- status: ALREADY CORRECT
- current: Email `sendPrequalApprovedEmail` (subject "You're Pre-Qualified — Here's Your Buying Power, {first}"; amount, tier, expiry); in-app `Notification PREQUAL_APPROVED` ("You're pre-qualified — Your approved budget is $X"); `/buyer/prequal` hero "Pre-Qualification Approved", "Approved Max Out-the-Door Budget", expires label, days remaining (near-expiry ≤7).
- evidence: `prequal.service.ts:566-577, 594-606`; `resend.service.ts:441-462`; `app/buyer/prequal/page.tsx:85-200`.
- required change: none (transport → outbox, S3-24).
- legacy: `app/api/cron/prequal-message-delivery/route.ts:12-17` re-creates the same notification (DUPLICATED, harmless dedup on type).

**S3-12** · L394 · "manual review with honest status"
- status: ALREADY CORRECT
- current: `sendPrequalUnderReviewEmail` ("We're reviewing your AutoLenis pre-qualification"); `/buyer/prequal/pending` "Application under review — Your prequalification requires additional manual review. Our compliance team will process your application and notify you within 1-2 business days."; `toBuyerSafePrequal.pending` collapses MANUAL_REVIEW/OFAC_*.
- evidence: `prequal.service.ts:696-728`; `templates/prequal-under-review.tsx:8-9`; `app/buyer/prequal/pending/page.tsx:15-25`; `prequal.service.ts:158-161`.
- required change: none for copy; the "1-2 business days" promise has no enforced reviewer deadline (S3-19).

**S3-13** · L394 · "OFAC or compliance review without exposing restricted information" — ALREADY CORRECT (same surfaces as S3-12; `checkOfacAlert` never in the buyer payload `prequal.service.ts:143-174`; ESCALATE/CLEAR→MANUAL_REVIEW are buyer-silent `ofac route:117`).

**S3-14** · L394 · "provider delay"
- status: PARTIAL — buyer receives the under-review email/page; no processing-delay wording; ops receive `PlatformAlert` + admin email; `/admin/manual-reviews` shows a "PROVIDER FAILED" badge (`app/admin/manual-reviews/page.tsx:49-68`). See S3-05.

**S3-15** · If it fails (L398) · "Provider delay retries and notifies."
- status: PARTIAL (notify) / MISSING (retry)
- current: No automatic re-pull; `rg retry lib/services/prequal` → none. Admin can re-run via `POST /api/admin/buyers/[buyerId]/prequal/run-ipredict` (directory exists; route not read). Buyer may re-submit (a non-valid existing record allows a fresh pull, `prequal.service.ts:325-334`).
- evidence: `prequal.service.ts:730-760`; `ls app/api/admin/buyers/[buyerId]/prequal/` → `history manual-override resend-email route.ts run-ipredict`.
- required change: bounded automatic retry (e.g. 3 attempts, backoff) only for `PROVIDER_UNAVAILABLE` class via a durable job that re-enters `initiatePrsequal` with the stored submission (**requires persisting the non-PII submission or re-collecting** — DOB/address are not stored on `PreQualification`), then buyer + ops notifications.
- legacy: —

**S3-16** · L394 · "correction required"
- status: MISSING
- current: No decision/state or communication for "correction required"; IDV/high-risk address → silent MANUAL_REVIEW; validation errors are pre-submission 400s.
- evidence: `prequal.service.ts:431-437`; `route.ts:89-94`; `app/api/admin/prequal/[id]/decide/route.ts` exists (actions not read).
- required change: admin action "request correction" (which field) → buyer notification + email via outbox, buyer re-submits; decision stays MANUAL_REVIEW until then.

**S3-17** · L394 · "decline with applicable adverse-action information"
- status: ALREADY CORRECT
- current: `sendAdverseActionEmail` with FCRA §615 language + reason codes; `/buyer/prequal/declined` shows CRA (MicroBilt, phone), rights, and confirms the emailed notice; in-app `PREQUAL_DECLINED` notification.
- evidence: `prequal.service.ts:578-590, 638-692`; `resend.service.ts:694-728`; `microbilt.service.ts:1251-1267`; `app/buyer/prequal/declined/page.tsx:17-59`.
- safeguard: reason codes stored (`adverseReasonCodes`), decline never auto-set by expiry (`prequal-stale-cleanup/route.ts:6-18`).

**S3-18** · Exit (L396) · "Approved and unexpired. The buyer is taken to qualified results — vehicles within 100 miles matching their approved amount and criteria, found automatically."
- status: PARTIAL (boundary)
- current: `isPrequalValid` (`decision === APPROVED && expiresAt > now`) is the single gate; journey advances to `search`; `/buyer/search` and `/api/buyer/search` apply `maxOtdAmountCents`; onboarding page redirects approved buyers to `/buyer/search`.
- evidence: `prequal.service.ts:130-135`; `journey.ts:102-105`; `app/buyer/search/page.tsx:41-43`; `app/api/buyer/search/route.ts:65`; `app/buyer/onboarding/page.tsx:24-26`.
- required change: "within 100 miles … found automatically" is §22a (qualified results) — not verified here.

**S3-19** · L398 · "Manual review and OFAC review route to the responsible reviewer with an owner and a deadline."
- status: PARTIAL
- current: `/admin/manual-reviews` FIFO queue (prequal rows in MANUAL_REVIEW/OFAC_*, age in hours; financing tasks flagged stale >24h); `prequal-sla-escalation` cron raises one `SYSTEM_ALERT` per 24h window when OFAC rows exceed 24h (MANUAL_REVIEW rows are **not** SLA-tracked); no owner/assignee/deadline field on `PreQualification`; alerts are untargeted.
- evidence: `app/admin/manual-reviews/page.tsx:21, 80-115, 218-237`; `app/api/cron/prequal-sla-escalation/route.ts:18-59`; `schema.prisma:306-345` (no assignee/dueAt); `rg assignee|dueAt lib/services/financing/review-queue.service.ts` → none.
- required change: `queue_items` (§4.6 NEW) with `ownerAdminId`, `dueAt`, reason, link; create on MANUAL_REVIEW/OFAC_REVIEW; SLA cron over both; assignment UI.
- legacy: `OFAC_ESCALATED` historical enum value accepted by the cron (`:10-14`).

**S3-20** · L398 · "Decline sends the decision and adverse-action notice, and delivery outcome is recorded as sent, duplicate, or failed [BUILT]"
- status: ALREADY CORRECT
- current: `sendIdempotent` returns a discriminated outcome (`SENT|DUPLICATE|FAILED|DEV_SKIPPED`); the service maps it to `ADVERSE_ACTION_NOTICE_SENT` / `_SUPPRESSED_DUPLICATE` / `_SEND_FAILED` (thrown errors and DEV_SKIPPED → SEND_FAILED with `errorMessage`); admin path identical.
- evidence: `resend.service.ts:120-126, 139-222`; `prequal.service.ts:644-691`; `admin-prequal.service.ts:632-689`.
- safeguard: FAILED/DEV_SKIPPED rows are retriable (upsert on key, `resend.service.ts:149-154, 201-206`); per-decision key salt `decisionTimestamp` so re-applications are distinct (`:699-702`); admin resend endpoint may override the key (`:703-707`).
- required change: none.

**S3-21** · L398 · "Approaching expiry warns the buyer"
- status: PARTIAL
- current: `prequal-ibv-reminders` (daily, `vercel.json:72`) warns once in the 7-day window: in-app notification + a **raw `new Resend(...).emails.send`** plain-text email from a hard-coded `noreply@autolenis.com`, bypassing `sendIdempotent`/`EmailSendLog`/suppression/outbox; dashboard nudge at ≤30 days ("Renew pre-qualification"); prequal page `isNearExpiry ≤ 7`.
- evidence: `app/api/cron/prequal-ibv-reminders/route.ts:48-104` (`:91-100` raw Resend); `app/buyer/dashboard/page.tsx:172-185`; `app/buyer/prequal/page.tsx:104-105`.
- safeguard: idempotent per 7-day window via notification title (`:62-72`).
- required change: replace the raw Resend call with a `resend.service` sender (template + key `prequal-expiry-${prequalId}-${expiresAt}`) routed via outbox; unify thresholds (7 vs 30 days) with the dashboard.
- legacy: second email plane (raw Resend) — DUPLICATED with the Resend rail.

**S3-22** · L398 · "expiry requires renewal before the transaction advances"
- status: PARTIAL
- current: Gates using `isPrequalValid`: journey (`prequal → search`), `/buyer/search`, `/buyer/shortlist`, `deposit/create-intent`, `financing/apply`; `financing/route.ts` uses an **expiry-only** check (`!prequal || prequal.expiresAt <= now`) that a future-dated DECLINED/PENDING/MANUAL_REVIEW row passes. Expired → `/buyer/prequal` renders `PrequalFormClient expired={true}`; re-submission re-pulls. `prequal-stale-cleanup` is count-only; `prequal-purge` never deletes ever-APPROVED rows.
- evidence: `journey.ts:102-106`; `app/buyer/shortlist/page.tsx:29`; `app/api/buyer/deposit/create-intent/route.ts:63-71`; `app/api/buyer/financing/apply/route.ts:61-62`; `app/api/buyer/financing/route.ts:33-34`; `app/buyer/prequal/page.tsx:485-501`; `prequal.service.ts:325-334`; `prequal-stale-cleanup/route.ts:6-27`; `prequal-purge/route.ts:6-37`.
- safeguard: expiry is never converted to DECLINED (no false adverse action); purge invariant.
- required change: replace the expiry-only predicate in `financing/route.ts:33` with `isPrequalValid` (DUPLICATED predicate); add mid-transaction rechecks (S3-23).

**S3-23** · L401 · "Approval is rechecked — not merely at the payment gate, but at offer selection and again at contract request. An approval that expires mid-transaction pauses the Deal and asks the buyer to renew"
- status: PARTIAL (payment) / MISSING (offer selection, contract request, Deal pause)
- current: Payment gate ✔ (`create-intent`), **except** the concierge vehicle-offer path with a `conciergeReviewToken` skips the prequal check (`:63`). Offer selection: `app/api/buyer/auctions/[auctionId]/select-offer/route.ts` and `lib/services/deal/select-offer.service.ts` contain no prequal reference. Contract request: `app/api/buyer/deals/[dealId]/contract/` has only `download`; no prequal reference in `lib/services/contract`/`lib/services/deal`. No `DealStatus` value for a prequal hold; only `deal-risk.service.ts` scores "Prequal Expiring Soon".
- evidence: `create-intent/route.ts:63-71`; `rg -i "prequal|isPrequalValid|expires" select-offer route + service` → no matches; `ls app/api/buyer/deals/[dealId]/contract` → `download`; `lib/services/deal/deal-risk.service.ts:60-65`; `rg -i "prequal.*(expired|renew)" lib/services/deal lib/services/esign lib/services/contract` → none.
- safeguard: single predicate `isPrequalValid` — reuse it, do not re-derive.
- required change: call `isPrequalValid` in `select-offer.service` (reject with `PREQUAL_EXPIRED` + renew CTA) and at contract request (Stage 13 owner); add a Deal hold (`DealStatus` or a `prequalHoldAt` column) that pauses advancement and notifies the buyer to renew; decide whether the concierge-token bypass at the payment gate is intended.
- legacy: concierge review-token path (`create-intent/route.ts:41-63`).

**S3-24** · §27 L1290-1294 + §27.1 rows L1303-1308 (Application submitted; approved; under review; provider delay; declined; approval expiring/expired) · transport through the durable outbox
- status: PARTIAL (all rows)
- current: All Stage 3 buyer/admin emails go through the direct `sendIdempotent` rail (Resend + `EmailSendLog`) or raw Resend (expiry cron); `comms_outbox` exists (`lib/services/comms/comms-outbox.service.ts`, drain cron `vercel.json:244`) and `enqueueTransactionalEmail` is used only by `sendDealSelectedEmail` and pickup notifications. In-app `Notification` rows are written at decision time.
- evidence: `resend.service.ts:441-528, 694-728` (`sendIdempotent`); `resend.service.ts:735` + `lib/services/pickup/pickup-notifications.service.ts` (only outbox users); `transactional-dispatch.ts:1-46`; `comms-outbox.service.ts:1-19` ("DORMANT until producers are cut over").
- required change: cut the six Stage 1–3 senders over to `enqueueTransactionalEmail` with key parity; add "provider delay" and "correction required" templates; send-time state recheck in the drain (e.g. do not send expiry warning if renewed).
- legacy: direct rail; `EmailSendLog` remains the audit plane on both rails.

**S3-25** · Security controls (auth-security skill) for Stage 3
- status: ALREADY CORRECT
- current: buyer identity from session (`getRequestBuyer`/`requireBuyer`), never from body; buyer payloads via `toBuyerSafePrequal`; MicroBilt receives only name/DOB/address; consent audit captures IP/UA; rawResponse encrypted; admin OFAC/override actions require reason and write `AdminAuditLog`; `PREQUAL_ENCRYPTION_KEY` fail-fast (skill).
- evidence: `lib/auth/api.ts:132`; `lib/auth/session.ts:60-84`; `prequal/route.ts:79-80, 98-102, 144-146`; `prequal.service.ts:354-362`; `ofac/[prequalId]/route.ts:26, 63`.
- safeguard: all of the above.
- required change: none.

**S3-26** · Tables (HTML `["pre_qualifications","prequal_consents","compliance_events"]`) — present: `schema.prisma:306, 347, 363`. ALREADY CORRECT.

**S3-27** · "Buyer sees" copy inventory (for HTML alignment)

| Outcome | Surface | Copy | Path |
|---|---|---|---|
| Unverified | Signup success card | "Check your email … Click it to activate your {plan} account." | `app/auth/signup/SignUpClient.tsx:168-172` |
| Unverified | Verify page | "Verify your email — We sent a verification link… Click the link to activate your account." | `app/auth/(card)/verify-email/page.tsx:41-45` |
| Onboarding | Wizard header | "Welcome to AutoLenis — A few quick preferences…"; button "Continue to Pre-Qualification" | `components/buyer/OnboardingWizardClient.tsx:177-180, 361` |
| Onboarding | Journey next action | "Complete your profile" / "Check your buying power" | `lib/services/buyer/journey.ts:52-56` |
| No prequal / expired | Form | `PrequalFormClient expired={isExpired}` (expired banner copy not read) | `app/buyer/prequal/page.tsx:485-501`, `components/buyer/PrequalFormClient.tsx` |
| APPROVED | Status page | "Pre-Qualification Approved" · "Approved Max Out-the-Door Budget" · expires {date} · near-expiry ≤7d | `app/buyer/prequal/page.tsx:174-200` |
| APPROVED | Dashboard | "Buying Power … Active approval · Expires {Mon d}"; nudge "Pre-qualification expires in N days — Renew pre-qualification" (≤30d) | `app/buyer/dashboard/page.tsx:303-315, 172-185` |
| APPROVED | In-app notification | "You're pre-qualified — Your approved budget is $X." | `prequal.service.ts:566-577` |
| MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED / provider delay | Pending page | "Application under review — … notify you within 1-2 business days" | `app/buyer/prequal/pending/page.tsx:15-25` |
| DECLINED | Declined page | "Application not approved — We were unable to pre-qualify you at this time. You have the right to know why." + FCRA notice + CRA details | `app/buyer/prequal/declined/page.tsx:17-59` |
| DECLINED | In-app notification | "Prequalification update — … Check your email for details and next steps." | `prequal.service.ts:578-590` |
| PENDING >24h | In-app notification | "Complete your prequalification — Your identity verification is pending." (misleading for a stale marker) | `app/api/cron/prequal-ibv-reminders/route.ts:35-43` |
| Expiring ≤7d | In-app + email | "Your prequalification expires in N days — Complete your vehicle search and pay the deposit…" | `prequal-ibv-reminders/route.ts:76-100` |
| Any | Deep link | `/buyer/prequal/result` redirects by decision | `app/buyer/prequal/result/page.tsx:18-28` |
| Any | API | `GET /api/buyer/prequal` → `{hasPrequal, approved, pending, declined, tier, maxOtdAmountCents, expiresAt}` | `app/api/buyer/prequal/route.ts:157-165` |
| Correction required | — | none | — |
| Provider delay (distinct) | — | none | — |

---

## Duplicates

1. **PreQualification writers (five):** `lib/services/prequal/prequal.service.ts:451-514` (buyer), `lib/services/prequal/admin-prequal.service.ts:475-535` (admin iPredict run — delegates `callIPredict` but re-implements upsert, notifications, compliance events), `app/api/admin/buyers/[buyerId]/prequal/manual-override/route.ts:102`, `app/api/admin/prequal/[id]/decide/route.ts:149`, `app/api/admin/external-preapprovals/[id]/approve/route.ts:77`. Decision-persistence + notification logic is duplicated between the buyer and admin orchestrators; the external plane's OFAC posture is UNVERIFIED.
2. **Approved in-app notification:** decision-time (`prequal.service.ts:566-577`) and `app/api/cron/prequal-message-delivery/route.ts:12-17` (redundant; registered in `vercel.json:88`).
3. **Prequal-validity predicate:** `isPrequalValid` (canonical) vs expiry-only checks in `app/api/buyer/financing/route.ts:33`, `app/buyer/shortlist/page.tsx:29` (inline but equivalent), `app/buyer/onboarding/page.tsx:16-19`, `lib/auth/journey-redirect.ts:43-46`, `app/buyer/prequal/page.tsx:86` (inline equivalents) — only `financing/route.ts` is weaker.
4. **Email planes:** `sendIdempotent` (Resend + EmailSendLog), `enqueueTransactionalEmail` (comms_outbox), raw `new Resend()` in `prequal-ibv-reminders/route.ts:93-100`.
5. **FCRA consent text literal:** `microbilt.service.ts:1272`, `components/buyer/PrequalFormClient.tsx:10`, `app/(public)/legal/prequal-consent/page.tsx:8`.
6. **Send-dedup stores for Stage 1 emails:** `AdminAuditLog` (`EMAIL_VERIFIED_SENT`, `VERIFICATION_RESENT`) alongside `EmailSendLog`.
7. **Buyer identity creation planes:** `ensurePrismaUser` (supabaseId → email), `unified-buyer-intake.resolveBuyerId` (email), `lib/voice/dispatch-request.ts` (email) — no shared identity resolver; phone never a key.
8. **Terms acceptance stores:** `Buyer.termsAcceptedAt/termsVersion`, Supabase `user_metadata`, and the unwritten `AcceptedTerms` model.

## Stronger safeguards to preserve

- `ensurePrismaUser` Buyer upsert with `update: {}` and `supabaseId`-first lookup (`actions.ts:84-97`); `Buyer.userId @unique`.
- Resend-verification: 60s rate limit, enumeration-safe response, zero Buyer writes (`resend-verification/route.ts:117-132, 172-177`).
- Sign-in blocks unconfirmed email (`actions.ts:441-444`); fail-open auth limiter keyed by IP + email (`:421-430`).
- Single `needsTermsAcceptance` predicate + `FALLBACK_TERMS_VERSION` (`lib/auth/terms.ts`); two-store acceptance with loud failure (`actions.ts:652-742`).
- Prequal location backfill: structural never-overwrite, non-blocking, before the valid-prequal early return (`prequal.service.ts:300-323`).
- Dealer-invitation fail-closed (`!buyerCoords → 0`) + `AUCTION_ZERO_INVITATIONS` audit deduped on cause (`dealer-invitation.service.ts:153-212, 263-282`).
- Geocoder fails closed without a key; long-lived cache (`geocoding.service.ts:101-102`).
- FCRA consent persisted before the pull, with IP/UA/termsVersion; route literal-true guard (`prequal.service.ts:263-279`; `route.ts:48-50`).
- Pull claim mutex + 30s TTL (`prequal.service.ts:210-261`).
- OFAC tri-state, affirmative-clear requirement, Gates 2–5, sandbox opt-in only, `apitest.` refusal, 10s abort (`microbilt.service.ts`, `prequal.service.ts:378-437`).
- `maxOtdAmountCents` server-controlled, only on APPROVED; `toBuyerSafePrequal` hides OFAC/score.
- Adverse-action outcome honesty (SENT/DUPLICATE/FAILED, never fake success) (`resend.service.ts:120-222`; `prequal.service.ts:644-691`).
- Provider failure recorded distinctly + P1/P0 alert (`prequal.service.ts:75-123`); manual-reviews "PROVIDER FAILED" badge.
- Expiry never converted to DECLINED; purge never deletes ever-APPROVED; raw bureau blob scrubbed at 90d (`prequal-stale-cleanup`, `prequal-purge`).
- Admin OFAC actions: reason required, optimistic concurrency, audit + compliance events (`ofac/[prequalId]/route.ts`).
- Phone normalised to E.164 (`normalizePhone(...) || null`) at every Buyer writer.
- Resume token hashed, single-use, capability-free (`request-resume-token.service.ts`).

## Legacy paths

- `AcceptedTerms` model (`accepted_terms`) — unwritten; `SmsOptOut` — unwritten (do not resurrect).
- `PreQualification.isExternal` — never set by the submit route (`external-status/route.ts:7-9` comment); `ExternalPreApproval` is the real record.
- `app/api/cron/prequal-message-delivery` — redundant with decision-time notification.
- `prequal-ibv-reminders` "identity verification is pending" nudge — no IBV exists; targets stale PENDING markers.
- Raw Resend send in `prequal-ibv-reminders/route.ts:91-100`.
- `form_submitted` QStash path `/api/jobs/form-submitted` behind `LIFECYCLE_INTERNAL_FORM_SUBMITTED`.
- `AdminAuditLog` used as send-dedup/rate-limit store for verification emails.
- `getOnboardingSteps`/`saveOnboardingStep` (`buyer-onboarding.service.ts`) — no journey caller found.
- Concierge review-token bypass of the prequal gate at `deposit/create-intent`.
- Google OAuth signup path (flag-gated) without the branded verification email / terms metadata stamp.
- `/api/finder` buyer-linking removal (commit message) — not inspected.

## Out-of-scope findings (for other owners)

- `financing/route.ts:33` weaker prequal predicate (Stage 12 owner) — fix to `isPrequalValid`.
- `select-offer` and contract-request lack prequal recheck; no Deal pause state (Stages 9/13, §28).
- `VehicleRequest` has no location snapshot (Stage 4 / §32).
- Buyer identity dedups on email only in intake/voice planes; `buyers.phone` non-unique/un-indexed (§25 identity firewall / §32).
- `queue_items` (§4.6) needed for reviewer owner/deadline and Operations correction tasks.
- `signUpAction` lacks a rate limiter (auth-security).
- Approval email expiry computed as `now+30d` instead of `result.expiresAt` (`prequal.service.ts:596`) — verify equality.
- External pre-approval approve route upserts `PreQualification` — OFAC posture unverified (§29 safeguards).

## UNVERIFIED items

- Supabase signup-link OTP TTL vs the "24 hours" template copy; whether Supabase purges unconfirmed users.
- `GOOGLE_GEOCODING_API_KEY` set in production; static table counts in `lib/utils/zip-coords.ts` at HEAD.
- `app/api/admin/buyers/[buyerId]/route.ts` state/ZIP validation + `updateBuyerProfileByAdmin` uppercase (BACKFILL §4 "IMPLEMENTED").
- `scripts/backfill-buyer-location.ts` `--apply` semantics; `scripts/check-buyer-location-backfill.ts`.
- `/api/finder` buyer-linking block removal (d9243d1 fix 4).
- `SignInClient.tsx` handling of `verify_required`.
- `PrequalFormClient` expired-state copy; `PrequalBudgetCalculator` persistence.
- `admin-prequal.service.ts:740-747` exact admin-alert condition; `run-ipredict`, `decide`, `manual-override`, `resend-email`, `external-preapprovals/approve` route bodies.
- `microbilt.service.ts` `expiresAt` derivation line for the buyer path (30d assumed from admin path).
- Lead→buyer attribution fields beyond affiliate (BuyerOpportunity UTM columns not seen in the slice read).
- Test coverage pinning the FCRA consent literal equality across the three copies.
- `inactivity-scan` cron content; nudge engine registration in `vercel.json`.
- Production data (10 NULL-location buyers, auction `dc009660`) — no DB access; taken from `docs/plans/*` as dated evidence.

## Open questions for the owner

1. Should phone (+SMS consent) move to Stage 1 registration per spec/HTML, or stay in the onboarding wizard? Either way, SMS consent must be persisted (currently dropped).
2. Store street `address` on `buyers` from prequal (spec "complete address") or keep the narrower city/state/zip write? Impacts PII scope and the geocoding input.
3. Where should the "usable location" gate bite first — vehicle-request submission, journey `prequal → search`, or `deposit/create-intent`? (Recommendation: all three, sharing one `locationUsable` predicate; keep dealer-invitation fail-closed.)
4. Is the concierge review-token bypass of the prequal gate at the payment step intentional?
5. Does the external pre-approval approve route need OFAC screening before it can satisfy `isPrequalValid`?
6. Admin receipt for every application: email-only (dependent on `ADMIN_NOTIFICATION_EMAIL`) or also an in-app admin notification / queue item?
7. Provider-delay auto-retry requires re-running the pull without the buyer present — persist the non-PII submission (already mostly on `PreQualification`) plus encrypted DOB/address, or ask the buyer to resubmit?
8. Verification reminders and 14-day abandonment: implement on the internal lifecycle plane (`lifecycle_touch_schedule`) or directly on `comms_outbox`? (§27 says outbox is the prerequisite.)

---

## Verification corrections (adversarial pass)

Independent re-check at HEAD `0cd399f`, static read of running code only (no tests, typecheck, DB, or MCP). Every cited line was re-opened. Paths relative to `frontend/` unless prefixed. Format: `spec_ref | original status → corrected status | reason | evidence`.

### Status corrections

1. **S1-01 (L347 Entry: "A Lane 1 capture exists, or a visitor registers directly")** | ALREADY CORRECT → **BROKEN** (Lane-1-capture → direct-registration path) | A Lane 1 guest capture creates a `User` row with the lead's email (`supabaseId: guest_<uuid>`, `role: BUYER`). `signUpAction` refuses any email that already has a `User` row — *before* the guest-upgrade branch of `ensurePrismaUser` can ever run — so the captured lead cannot register with the email they used, and "Sign in instead" cannot succeed (no Supabase auth user exists). The guest-upgrade branch (`actions.ts:106-149`) is reachable only through Google OAuth (flag-gated `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`), i.e. the callback, never through the email/password form. The §27.1 L1301 "Guest capture → claim link" is therefore also BROKEN: the resume deep-link lands on auth-gated `/buyer/deposit` (`app/api/public/request/resume/[token]/route.ts:53`) which requires the account the guest cannot create. No test covers guest→signup (`rg -i guest lib/auth/__tests__` → 0 hits). | `lib/auth/actions.ts:343-347` `const existingUser = await prisma.user.findUnique({ where: { email } }); if (existingUser) { return { error: "An account with this email already exists. Sign in instead →" }; }`; `lib/services/acquisition/unified-buyer-intake.service.ts:161-177` guest `user.create` + `buyer.create({ isGuest: true })`; `actions.ts:114` `if (existingByEmail && existingByEmail.supabaseId.startsWith("guest_"))` (only reachable after the block above is bypassed); `app/auth/signup/SignUpClient.tsx:32-50` OAuth path. **Required change:** in `signUpAction`, treat an existing `guest_*` User as upgradeable (skip the duplicate rejection, pass through to `generateLink` and let `ensurePrismaUser` upgrade in place), with a failing-first test for "guest lead registers with the same email".

2. **S1-10 (L356 Exit: "Any draft Vehicle Request is attached to it")** | PARTIAL → **BROKEN** | The only registration-time transfer (`actions.ts:193-210`) lives in the fresh-`user.create` branch and matches a guest Buyer by the *same* email — but a same-email guest User makes `signUpAction` refuse the registration (correction 1), and when the OAuth guest-upgrade branch runs there is no transfer to do (same Buyer row). The branch is therefore unreachable for the one case it handles. The only working attach path is lazy and post-hoc: `app/buyer/requests/[requestId]/offer/page.tsx:33-49` re-links a request by email on first visit to the offer page — which again requires an account for that email. `VehicleRequestStatus.EXPIRED` has no writer anywhere (`rg "status: \"EXPIRED\""` → only dealer invitations), so no "draft" lifecycle exists to attach or abandon. | `lib/auth/actions.ts:193-210`; `actions.ts:343-347`; `app/buyer/requests/[requestId]/offer/page.tsx:33-49`; `prisma/schema.prisma:1654-1666`.

3. **S1-07 (L350 "System sends a verification link. Buyer verifies.")** | ALREADY CORRECT → **PARTIAL** | Three gaps: (a) the voice-receptionist plane creates the Supabase auth user with `email_confirm: true` and a temp password — the buyer is marked verified without ever verifying, no link is sent; (b) `signUpAction` swallows a failed welcome/verification email (`catch` → `logger.error`) and still returns success — the registration completes with no link sent, no retry, no outbox row, and the buyer must self-serve a resend; (c) the resend route substitutes `/auth/verify-email` (the resend form itself) as the CTA when Supabase returns no `action_link`, sending a dead-end email. The affiliate branch of the same route refuses instead (`:77-81`). Supabase link TTL vs the "24 hours" literal remains UNVERIFIED. | `lib/voice/dispatch-request.ts:143-150` `email_confirm: true`; `lib/auth/actions.ts:396-402` `catch (e) { logger.error("[signUpAction] welcome email failed:", e); }` then `return { success: true, … }`; `app/api/auth/resend-verification/route.ts:148-150` `linkData?.properties?.action_link ?? \`${getAppUrl()}/auth/verify-email\``; `lib/services/email/templates/welcome.tsx:50`.

4. **S1-13 (L358 "the verification link may be reissued at any time")** | ALREADY CORRECT → **PARTIAL** | Same dead-end fallback as (3c); the 60 s rate-limit lookup fails open (`.catch(() => null)`); a second click on an already-consumed link lands on `/auth/signin?error=callback_failed` rather than an "already verified" state; and a Lane-1 guest has no Supabase user, so `generateLink({type:"signup"})` cannot mint a link for them (→ the dead-end fallback fires). | `app/api/auth/resend-verification/route.ts:118-125, 148-150`; `app/auth/callback/route.ts:110`.

5. **S1-05 (L350/L352 SMS consent)** | BROKEN (SMS) → **BROKEN + DUPLICATED** | Confirmed the wizard never posts `smsConsent` (`handleSubmit` sends name/phone, prefs, `{accepted:true}` only). Additionally, SMS opt-out/consent state is held in **four** stores, only one of which is canonical: `sms_suppression` (canonical, `SuppressionService`), `contacts.consent_sms`/`do_not_contact` (`ContactService.upsertContact` — sticky `existing.consent_sms || !!input.consentSms`), `BuyerPreferences.smsNotifications` (default false), and `Buyer.optedOutSms` (written by the Twilio inbound STOP handler with `updateMany({ where: { phone: from } })`). The previous row omitted `Buyer.optedOutSms`. | `components/buyer/OnboardingWizardClient.tsx:123, 134, 143-160`; `prisma/schema.prisma:65` `optedOutSms Boolean @default(false)`; `app/api/twilio/sms/inbound/route.ts:100-103`; `lib/services/contact.service.ts:80-91, 126`; `schema.prisma:134`.

6. **S1-04 (L352 "`accepted_terms` with version and timestamp")** | PARTIAL → **PARTIAL (worse than recorded)** | Beyond the unwritten `AcceptedTerms` model: the acceptance timestamp is **not immutable and not consent-backed at its second writer**. `/api/buyer/onboarding/complete` re-stamps `termsAcceptedAt: new Date()` + current version on every completion, driven by a hard-coded client parameter `{ accepted: true }` from a wizard that renders **no terms-acceptance control** (the only `/legal/terms` link is inside the SMS-consent text, shown only while a phone is being collected). Net effect: the signup-time acceptance moment is overwritten, and a version bump between signup and onboarding is silently "accepted" without the buyer seeing the new terms. Also: no IP/UA captured for terms (captured for FCRA consent). Stronger safeguard confirmed: `acceptTermsAction` writes Prisma first and treats a metadata-sync failure as a hard error (`SYNC_FAILED`), never a half-accepted state. | `app/api/buyer/onboarding/complete/route.ts:40-46`; `components/buyer/OnboardingWizardClient.tsx:160` `api.post("/api/buyer/onboarding/complete", { accepted: true })`, `:339`; `lib/auth/actions.ts:670-688, 719-737`; `rg -n acceptedTerms app lib scripts` → schema only.

7. **S2-12 (L375 "An unusable address blocks every location-dependent stage")** | BROKEN → **BROKEN (evidence corrected)** | The previous row said the request-time coverage gate soft-holds an ungeocodable buyer ("coverage 0 → soft hold"). It does the **opposite**: `assessCoverageForZip` explicitly **fails OPEN toward inclusion** when the buyer cannot be geocoded — `withinRadius` returns `true` for every candidate, so coverage is counted as adequate, no hold is placed, and the request proceeds; the `:ungeocoded` tag is only appended to a hold reason if a hold happens for another reason. So the **only** fail-closed location predicate in Stages 1–8 is `inviteDealersToAuction` (post-deposit). Sourcing is therefore *not* blocked by an unusable address at any pre-deposit point. | `lib/services/auction/coverage.service.ts:109-118` "Fail OPEN toward inclusion when the buyer can't be geocoded … `if (!buyerCoords) return true;`"; `lib/services/acquisition/request-coverage-gate.service.ts:100-104, 135-136`; `lib/services/auction/dealer-invitation.service.ts:263-282`; `app/api/buyer/deposit/create-intent/route.ts:63-80` (prequal + shortlist only); `lib/services/buyer/journey.ts:34-43`. Stronger safeguard to preserve: the *documented* reason for fail-open is to avoid wrongly soft-holding a paid deposit — any new `locationUsable` gate must bite **before** payment, not by flipping this primitive.

8. **S2-15 (admin write path for location)** | UNVERIFIED → **ALREADY CORRECT (admin path)** | Admin PATCH validates `state` with `^[A-Z]{2}$`-style regex (blank allowed for NULL-row repair) and `zip` 5-digit/ZIP+4, requires a reason, and `updateBuyerProfileByAdmin` uppercases state and maps blank→NULL with an `AdminAuditLog` row; the backfill script is dry-run by default and writes only through this audited path. No geocoding at write (S2-05 still MISSING). | `app/api/admin/buyers/[buyerId]/route.ts:43-44, 57`; `lib/services/admin/admin-buyer-command-center.service.ts:714-741`; `scripts/backfill-buyer-location.ts:4-17`.

9. **S2-13 (d9243d1 fixes)** | PARTIAL (fix 4 UNVERIFIED) → **PARTIAL (fix 4 VERIFIED)** | `/api/finder` no longer performs the phone-keyed Buyer lookup/mutation; `LeadScore` is written with `buyerId: null` and the comment cites Fix 4. | `app/api/finder/route.ts:179-193`.

10. **S3-06 open risk (external pre-approval approve route)** | UNVERIFIED → **VERIFIED — mitigated by human attestation, with two new notes** | The route requires `ofacAttested: z.literal(true)` and writes `ComplianceEvent EXTERNAL_PREQUAL_OFAC_ATTESTED` before upserting `APPROVED` — an admin attestation, not automated screening (record as a stronger safeguard to preserve, and as a policy question: is attestation an "affirmative OFAC clear" per L390?). New: (a) expiry is `submission.expiryDate ?? now + 90d` — a 90-day ceiling vs the 30-day iPredict window; (b) `maxOtdAmountCents: submission.approvedAmountCents ?? 0` can persist `APPROVED` with a $0 ceiling that `isPrequalValid` accepts. The admin decide route refuses decisions on uncleared OFAC rows (`decide/route.ts:85-95`) — preserve. | `app/api/admin/external-preapprovals/[id]/approve/route.ts:22-28, 56-67, 76-99`; `app/api/admin/prequal/[id]/decide/route.ts:85-95`.

11. **S3-07 (expiry in approval email)** | UNVERIFIED equality → **VERIFIED equal (cosmetic drift only)** | Every `callIPredict` result path sets `expiresAt = Date.now() + 30d`; the email/compliance-event value is recomputed as `Date.now() + 30d` a few hundred ms later, so the two differ by the request latency only. The `PREQUAL_APPROVAL_NOTICE_SENT` metadata records the recomputed value rather than `prequal.expiresAt`. | `lib/services/prequal/microbilt.service.ts:510, 529, 545, 897, 1168`; `lib/services/prequal/prequal.service.ts:596, 620`; `admin-prequal.service.ts:36, 593`.

12. **S3-02 (stated budget / calculator)** | UNVERIFIED (calculator persistence) → **VERIFIED: not persisted** | `PrequalBudgetCalculator.tsx` makes no API call; the `statedBudgetCents` passed to `callIPredict` is the buyer's *previous* `PreQualification.maxOtdAmountCents`, not a stated budget. Confirms MISSING for "budget, expected down payment, co-buyer election". | `components/buyer/PrequalBudgetCalculator.tsx` (`grep "api\.\|fetch("` → none); `app/api/buyer/prequal/route.ts:108-111`; `prequal.service.ts:369`.

13. **S3-03 (FCRA text equality test)** | UNVERIFIED → **VERIFIED: no test pins equality** | The three suites that touch `FCRA_CONSENT_TEXT` mock it to `"consent"`; nothing asserts the client/legal literals equal the service constant. | `lib/services/prequal/__tests__/prequal-decisioning.test.ts:77`, `prequal-provider-failure.test.ts:107`, `prequal-location-backfill.test.ts:62`; literals at `microbilt.service.ts:1272`, `components/buyer/PrequalFormClient.tsx:10`, `app/(public)/legal/prequal-consent/page.tsx:8`.

14. **S3-19 (reviewer owner + deadline)** | PARTIAL → **PARTIAL (narrower than recorded)** | The SLA cron filters `checkOfacAlert: true`, so Gate-1b "OFAC indeterminate → MANUAL_REVIEW" rows (which deliberately do **not** set the flag) and every risk/provider MANUAL_REVIEW row are outside any SLA tracking. | `app/api/cron/prequal-sla-escalation/route.ts:26-31`; `prequal.service.ts:394-407` ("no checkOfacAlert is set").

15. **S3-20 / S3-24 / S1-15 / S1-16 (direct Resend rail)** | ALREADY CORRECT (S3-20) → **ALREADY CORRECT for outcome-recording, with a shared PARTIAL on the rail** | Two properties of `sendIdempotent` the file did not record: (a) the `EmailSendLog` idempotency lookup **fails open** ("proceeding with send") on a DB error, so a transient blip can double-send the FCRA §615 notice while recording `SENT`; (b) the direct rail performs **no `email_suppression` check** — only the outbox drain (`comms-outbox.service.ts:184`) and the nurture/lead-magnet/dealer sequences consult `SuppressionService.isEmailSuppressed`. Every Stage 1–3 buyer email (welcome, email-verified, approved, under-review, adverse-action, admin alert) is sent without consulting the canonical suppression store, contrary to `autolenis-communications-consent` rule 2. | `lib/services/email/resend.service.ts:139-147` `logger.error("[EMAIL] EmailSendLog check failed — proceeding with send:", err)`; `rg -n "Suppression|isEmailSuppressed" lib/services/email/resend.service.ts` → only a comment at `:231`; `lib/services/comms/comms-outbox.service.ts:184`.

16. **S1-06 (attribution "carried from the lead")** | UNVERIFIED → **PARTIAL** | Lead attribution (utmSource/utmMedium/utmCampaign/sourceUrl/landingSource/referrer) is accepted by the intake plane and lives on `BuyerOpportunity`/`VehicleRequest`; `Buyer` carries only `affiliateId`. Nothing copies lead UTM onto the buyer at registration. | `lib/services/acquisition/unified-buyer-intake.service.ts:101-107`; `prisma/schema.prisma:30-96` (no UTM columns), `:1035`.

17. **S1-09 (`SignInClient` handling of `verify_required`)** | UNVERIFIED → **VERIFIED present** | `app/auth/signin/SignInClient.tsx:102, 125-126` reads `verify_required` and redirects to `/auth/signin?error=verify_required`. Copy alignment to "Verify your email to continue." still PARTIAL.

18. **S2-09 / legacy (`getOnboardingSteps` / `saveOnboardingStep`)** | UNVERIFIED → **VERIFIED dead** | No caller in `app/`, `lib/`, `components/` (only the unrelated affiliate `saveOnboardingStep`). `computeProfileCompleteness` has exactly one consumer (its API route) and no UI consumer; its "Email verified" check is `!!buyer.user.email` (always true). | `rg -n "getOnboardingSteps|saveOnboardingStep" app lib components` → `buyer-onboarding.service.ts` + affiliate only; `lib/services/buyer/profile-completeness.service.ts:13`; `app/api/buyer/profile/completeness/route.ts:8`.

19. **S3-04 (`prequal-ibv-reminders` note)** | ALREADY CORRECT (kept) — note sharpened | `callIPredict` converts credential/OAuth/network/timeout failures into `errorResult`/`timeoutResult` (never throws), so the claim cannot ordinarily strand a PENDING marker beyond 30 s; the 24 h "identity verification is pending" nudge therefore targets only rows left PENDING by a genuinely unexpected throw. | `lib/services/prequal/microbilt.service.ts:915-945` (`catch` → `errorResult("OAUTH_FAILED")`, `timeoutResult()`, `errorResult("NETWORK_ERROR")`); `prequal.service.ts:210-261`.

### Rows re-checked and confirmed as written (no status change)

S1-03, S1-08 (structural guarantee holds; note: two concurrent first callbacks race on `user.create` → unique violation → `callback_failed`, no second buyer), S1-11 (re-confirmed: no `email_confirmed_at` reader outside `session.ts:17,66` / `actions.ts:441`; the `form_submitted` +0 touch is also guarded by `preCheckoutResolved` at `lifecycle-touch-drain.service.ts:437-439`, so a plain signup receives zero touches), S1-12, S1-14, S1-17, S1-18, S2-01, S2-02, S2-03, S2-04, S2-05 (re-confirmed: no `latitude/longitude` on `Buyer`; migrations add coordinates only to inventory/AMIPS/dealer tables), S2-06 (add: admin PATCH also returns only `issues[0].message`, `admin/buyers/[buyerId]/route.ts:57`), S2-08, S2-10, S2-11, S2-14, S3-01 (add: prequal form pre-fills address/city/state/zip from `buyer.*`, `app/buyer/prequal/page.tsx:491-496`), S3-05, S3-08, S3-09, S3-10 (template confirmed: no submission time, no summary; `admin-prequal-alert.tsx:57-67`), S3-11, S3-12, S3-13, S3-14, S3-15, S3-16 (decide route actions are exactly `APPROVE | DECLINE | OVERRIDE`, `decide/route.ts:38`), S3-17, S3-18, S3-21, S3-22, S3-23, S3-25, S3-26. Duplicates #1–#8 confirmed; add `Buyer.optedOutSms` to #4's SMS-state list (see correction 5).

### Spec requirements in L343–403 / §27.1 the file did not cover

- **§27.1 L1301 "Guest capture → Buyer: Claim link to finish the request"** — **BROKEN** (see correction 1): the resume token exists (`request-resume-token.service.ts`, hashed, single-use, 5 d) but its landing page requires an account the guest cannot create with the captured email.
- **§27.1 L1302 "Draft abandoned recovery → Buyer: Four-touch resume sequence"** — **PARTIAL**: the `form_submitted → check_form_completion_1/2/3` chain (+0 / +1 h / +24 h / +72 h) is a four-touch resume sequence with a fresh resume link per touch, keyed `form-submitted:{buyerId}` with `UNIQUE(base_key, sequence)`; but it is the $99-deposit chase (not a verification/draft recovery), runs on the lifecycle plane rather than `comms_outbox`, and website signups enrol with `phone: ""` so SMS touches can never fire. | `lib/services/crm/lifecycle-touch-drain.service.ts:437-500`; `lifecycle-scheduler.ts:185-207`; `lib/auth/actions.ts:184-191`.
- **Stage 1 "Buyer verifies" as a universal invariant** — bypassed for voice-created accounts (`email_confirm: true`, correction 3a).
- **Stage 2 "System collects … complete address" vs prequal write-back** — prequal persists city/state/zip only; street `address` is written to `buyers` solely by the self-serve profile PATCH (no journey caller) and the admin PATCH. Owner decision recorded in Open question 2.
- **Stage 3 "OFAC screening" on the external pre-approval plane** — satisfied by admin attestation only (correction 10); the spec's "affirmative OFAC clear" is a screening result, not an attestation — policy decision required.

### Additional stronger safeguards to preserve (found in this pass)

- `assessCoverageForZip` fail-open is intentional and documented to protect a paid deposit from a wrong soft-hold (`coverage.service.ts:109-113`) — do not flip it; add the location gate upstream of payment.
- External pre-approval approve route: `ofacAttested` literal-true + `EXTERNAL_PREQUAL_OFAC_ATTESTED` compliance event (`approve/route.ts:22-28, 56-67`); decide route refuses action on uncleared OFAC rows (`decide/route.ts:85-95`).
- `callIPredict` never throws on provider/config/OAuth/network/timeout classes — every failure is a typed `errorResult` (`microbilt.service.ts:795-830, 915-945`).
- `acceptTermsAction` Prisma-first write with loud `SYNC_FAILED` on metadata drift (`actions.ts:719-737`).
- Admin buyer PATCH: validated, reason-required, audited, uppercase/blank→NULL normalisation (`admin/buyers/[buyerId]/route.ts:43-57`; `admin-buyer-command-center.service.ts:726-741`).
