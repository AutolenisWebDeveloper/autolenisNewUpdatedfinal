# Parity map — Contract area (Stages 13–15: contract request, Contract Shield, e-sign, dealer execution, financing completion / funding clearance, insurance)

Spec: docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md lines 776–876 · HTML S[12..14] lines 639–676 · HEAD 0cd399f · read-only static inspection (no tsc, no DB, no MCP). All paths are relative to `frontend/` unless prefixed.

## Summary (10 lines)

1. **Contract request (14a) is not dispatched from the central transition.** `advanceDealStatus(CONTRACT_PENDING)` emits only a buyer in-app message; the dealer "upload sale contract" email exists but is sent solely from the admin manual action route. No 24h deadline, no reminder, no Ops escalation. `document_requests` has a `dueAt` column but `requestDocument()` never sets it and has zero callers — the table is unused.
2. **Contract Shield does not compare the contract to the offer/reaffirmation/recap.** `scanContract` runs only junk-fee keyword heuristics, a $150 doc-fee cap, a $300 add-on packing cap, and DB `JUNK_FEE_KEYWORD`/`FEE_CAP` rules. `APR_VALIDATION`, `PAYMENT_PACKING`, `DISCLOSURE_CHECK`, `FINANCE_MARKUP` rule types are listed in the admin UI but never evaluated. VIN/mileage/price/trade/financing/optional-product comparison is MISSING; `compareContracts()` is a 5-label text diff with no callers.
3. **Fail-closed extraction, create-before-supersede versioning, private dealer-owned storage, and version-bound admin approval are ALREADY CORRECT in code** — but `contract_scans.contract_version_id` (migration 20261016) is marked LOCAL/STAGING ONLY; until applied every admin APPROVE refuses with `NO_LINKED_VERSION` (fail-closed, but the review queue cannot approve). Uploads during review are not rejected; the stale approval is refused instead.
4. **`contract_versions.document_hash` does not exist.** The only hash is `e_sign_envelopes.document_hash`, computed at envelope prepare, not at approval.
5. **In-house e-sign (14c) is ALREADY CORRECT in code**: hash-bound envelope, four affirmative consent acknowledgments + adopted name, frozen consent snapshot + policy version, server-side IP/UA/timestamps, tamper check that voids on change, 14-day TTL with hourly sweep + lazy expiry, immutable terminal records archived to history. It is entirely dormant: `ESIGN_EXECUTED_ARTIFACT_ENABLED` defaults off and migrations 20261014/20261015 are annotated as NOT APPLIED to production; with the flag off every prepare/sign/resend returns 503. Co-buyer signer is MISSING (single `signerRole = "BUYER"`, one envelope per deal).
6. **Dealer execution (14d) is MISSING and its central rule is BROKEN.** There is no dealer countersignature or executed-copy upload; the "executed contract" is a system-generated PDF from the buyer's signature; the buyer signature alone drives the deal to `SIGNED`, the dealer is told "Purchase contract executed", and `SIGNED → PICKUP_SCHEDULED` is open (pickup scheduling even uses `force: true`).
7. **Stage 14 (financing completion & funding clearance) is MISSING end-to-end.** `FinancingStatus` has no `COMPLETED`/`NOT_REQUIRED_CASH`; no `financing_completed_at`, `funding_cleared_at`, verifier, evidence reference, down-payment method, dealer funding confirmation, trade-payoff good-through, dispute/chargeback hold, Premium-window close, or send-back on financing change. Release requires only `SIGNED` + insurance.
8. **Stage 15 defect confirmed at exact lines:** `app/api/buyer/insurance/upload-proof/route.ts:136-139` sets `EXTERNAL_UPLOADED`, `:155` calls `advanceOnInsuranceSatisfied` → `lib/services/deal/deal.service.ts:320-330` advances to `CONTRACT_PENDING`; `deal.service.ts:41-45` puts `EXTERNAL_UPLOADED` in `INSURANCE_SATISFIED`, enforced at `:134-138` for `COMPLETED`. No `UNDER_REVIEW`/`REJECTED`/`EXPIRED` statuses, no verify/reject route, no proof-viewer route, no expiry tracking; `VERIFIED` is written only by admin journey shortcut routes without touching `InsurancePolicy.verifiedBy/verifiedAt`.
9. **Ordering conflict:** code gates `CONTRACT_PENDING` on insurance (`INSURANCE_PENDING → CONTRACT_PENDING`), whereas the spec says insurance is requested *at* contract request and never blocks contract preparation.
10. **Duplicates / bypasses to retire:** `contract-upload.service.ts::uploadContract` (second ContractVersion writer, no supersede/scan, zero callers); admin `CONTRACT_SHIELD_OVERRIDDEN` action (unlinked synthetic PASS scan v999, direct `deal.update`, never approves a ContractVersion → dead end; reachable from `AdminDealTabs.tsx:521`); admin journey `complete`/`complete-all` "contract"/"sign" cases force-advance to `SIGNING_PENDING`/`PICKUP_SCHEDULED` with no ContractVersion, scan, or signature; `admin-queue.service` CONTRACT_FAIL resolve mutates a prior scan `FAIL → WARNING` (append-only violated); two identical `verifyDocument` helpers.

---

## Rows

Legend — status: ALREADY CORRECT | PARTIAL | BROKEN | MISSING | DUPLICATED | UNVERIFIED. "Legacy path" = existing code that the required change touches/retires.

### Stage 13 entry

**C-01** · spec §Stage 13 Entry (L778) · HTML S[12].entry
- Requirement: Entry = financing terms locked or cash confirmed; plan level never blocks.
- Status: **BROKEN**
- Current: `CONTRACT_PENDING` is entered only from `INSURANCE_PENDING` via the insurance gate; no financing-lock check; `Financing.status` (`PENDING|SELECTED|APPROVED|DECLINED`) is not consulted at this edge. Plan level is not checked anywhere in the contract stage (correct).
- Evidence: `lib/services/deal/deal.service.ts:20-22` `FEE_PAID: ["INSURANCE_PENDING"], INSURANCE_PENDING: ["CONTRACT_PENDING"], CONTRACT_PENDING: ["CONTRACT_REVIEW"]`; `deal.service.ts:309-333` `advanceOnInsuranceSatisfied` (only driver into CONTRACT_PENDING); `prisma/schema.prisma:1711-1716` `enum FinancingStatus { PENDING SELECTED APPROVED DECLINED }`.
- Stronger safeguard: `expectedFrom` CAS guard (`deal.service.ts:127,140-165`) — keep.
- Required change: make entry to contract request depend on financing lock (`Financing.status ∈ {APPROVED (locked), NOT_REQUIRED_CASH}`), decouple from insurance (see C-04/C-40).
- Legacy path: `INSURANCE_PENDING → CONTRACT_PENDING` transition; `advanceOnInsuranceSatisfied`; `prisma/backfill-insurance-gate.ts`; `manual_supabase_sql/backfill_insurance_gate.sql`.

### 14a — Contract request

**C-02** · §14a (L782) · HTML S[12].system[0] · claim **[BUILT — EXTEND]**
- Requirement: Secure upload request to winning dealership with **24-hour deadline**, dispatched **durably from the central transition** (not admin manual action), with reminder and escalation attached.
- Status: **BROKEN** (claim not proven)
- Current: The only dealer contract-request email is sent from the admin manual `DEAL_STAGE_ADVANCED` action. The central seam `advanceDealStatus` → `emitDealStatusComms` is buyer-only ("Your contract is being prepared"). Automatic arrival at `CONTRACT_PENDING` (insurance gate) sends the dealer nothing. No deadline, reminder, or escalation exists for the dealer; dealer sees a passive CTA on their deal page.
- Evidence: `app/api/admin/deals/[dealId]/action/route.ts:88-98` `if (newStatus === "CONTRACT_PENDING" ...) sendDealerContractPendingEmail(...)`; grep `sendDealerContractPendingEmail` callers → only that route + `lib/services/email/resend.service.ts:1686`; `lib/services/notifications/acquisition-comms.ts:153-164` CONTRACT_PENDING plan (buyer in-app only, `sms: null`); `lib/services/deal/deal.service.ts:194` `await emitDealStatusComms(dealId, newStatus)`; `app/dealer/deals/[dealId]/page.tsx:47-48` `case "CONTRACT_PENDING": return { label: "Upload purchase agreement", href: "/dealer/contracts" }`; `lib/services/email/templates/dealer-contract-pending.tsx:44-45` (no deadline text).
- Stronger safeguard: `emitDealStatusComms` idempotency key per (deal,status,buyer) (`acquisition-comms.ts:189-194`) — reuse for dealer dispatch.
- Required change: dispatch a dealer `DocumentRequest` (SALES_CONTRACT, `dueAt = now+24h`) + dealer email/in-app from the `CONTRACT_PENDING` arrival hook in `deal.service.ts` (durable, idempotent); add a cron reminder (e.g. at 12h/24h) and an Ops escalation at deadline; concierge track (no dealer) routes the request to Ops.
- Legacy path: admin action route lines 87-99 (becomes redundant); `dealer-contract-pending.tsx` template (add deadline).

**C-03** · §14a (L782) · HTML S[12].tables `document_requests`
- Requirement: `document_requests` models a deal-scoped request with a due date and **is used here**.
- Status: **MISSING** (model exists, unused)
- Current: `DocumentRequest` has `dealId`, `documentType`, `dueAt`, `status`, `fulfilledAt`; the only writer `requestDocument()` does not set `dueAt` and has **zero callers**. No row is ever created; nothing reads the table.
- Evidence: `prisma/schema.prisma:2191-2202` `model DocumentRequest { ... dueAt DateTime? @map("due_at") ... }`; `lib/services/documents/document.service.ts:28-32` `requestDocument(dealId, documentType, requestedBy, reason?)` → `prisma.documentRequest.create({ data: { dealId, documentType, requestedBy, reason } })`; grep `documentRequest|DocumentRequest` across app/lib/components/scripts → only that file.
- Required change: extend `requestDocument` with `dueAt`/`buyerId`; create the SALES_CONTRACT request from the central transition (C-02); mark `SUBMITTED` on ContractVersion create, `VERIFIED` on approval; drive reminders/escalation off `dueAt`.
- Legacy path: none (greenfield use of existing model).

**C-04** · §14a (L788) · HTML S[12].system[1] · Stage 15 entry (L861)
- Requirement: Insurance is **requested at the contract-request moment** so the buyer has time to bind before release.
- Status: **BROKEN** (ordering)
- Current: Insurance is requested at `INSURANCE_PENDING`, which *precedes and gates* `CONTRACT_PENDING`. The buyer must upload proof before the dealer is even asked for a contract.
- Evidence: `lib/services/deal/deal.service.ts:20-21`; `deal.service.ts:319-320` `if (deal.status !== DealStatus.INSURANCE_PENDING) return false; if (!INSURANCE_SATISFIED.includes(deal.insuranceStatus)) return false;`; `acquisition-comms.ts:143-151` INSURANCE_PENDING plan "Add your proof of insurance".
- Required change: remove insurance from the contract-entry path; fire the insurance request notification from the same `CONTRACT_PENDING` arrival hook as C-02; keep insurance as a *release* gate only (C-46/C-51).
- Legacy path: `INSURANCE_PENDING` DealStatus and `advanceOnInsuranceSatisfied`; `INSURANCE_EXCEPTION` queue (`admin-queue.service.ts:13-18`) keyed on `INSURANCE_PENDING`; journey stage derivation `lib/services/buyer/journey.ts:83-87`.

**C-05** · §14a (L784-786) · HTML S[12].dealer[1], note
- Requirement: Dealership determines/prepares its own complete package (order, financing contract, odometer, title/reg, trade docs, optional products, we-owe, delivery ack…); AutoLenis does not determine forms; **dealership confirms the package is complete**.
- Status: **PARTIAL**
- Current: One PDF per `ContractVersion`; no multi-document package, no "package complete" attestation, no document-type manifest. AutoLenis correctly does not prescribe forms.
- Evidence: `app/api/dealer/contracts/upload-file/route.ts:37-64` single `file` field → one storage object; `lib/services/dealer/dealer-contract.service.ts:165-167` one `documentUrl` per version; `prisma/schema.prisma:2624-2640` `ContractVersion { documentUrl String ... }`.
- Required change: allow a package (multiple stored objects per version or a combined PDF) plus a dealer completeness confirmation flag/timestamp recorded on the version/document request.
- Legacy path: `ContractUploadButton.tsx`, `app/dealer/contracts/upload/page.tsx`.

### 14b — Contract Shield

**C-06** · §14b (L792) · HTML S[12].system[2]
- Requirement: Compare the uploaded contract against the winning offer, dealer reaffirmation, and confirmed recap: vehicle & VIN, mileage, price and every OTD component, doc fee, taxes, title/registration, trade allowance & payoff, down payment, financing terms, **each accepted optional product**, pickup/delivery commitments.
- Status: **MISSING**
- Current: `scanContract(dealId, contractText, dealerId, cvId)` never loads the Offer/recap/reaffirmation; it only pattern-matches junk fees/doc fee/add-ons in the text. `compareContracts()` diffs two *text versions* on 5 labels and has no callers.
- Evidence: `lib/services/contract-shield/contract-shield.service.ts:127-181` (no prisma.offer / deal.offer read; only `contractScanRule.findMany`); `lib/services/contract/contract-comparison.service.ts:4-15` `fields = ["Documentation Fee","APR","Total Price","Monthly Payment","Trade-In Value"]`; grep `compareContracts(` → definition only.
- Required change: add a structured extraction + comparison step in `contract-shield.service.ts` that reads the accepted Offer (`otdPriceCents`, `feesCents`, `aprRate`, `termMonths`, VIN via vehicle), the recap/reaffirmation records (owned by the acceptance area), and accepted optional products; produce per-field discrepancy findings feeding the same `fixList`.
- Legacy path: `contract-comparison.service.ts` (retire or repurpose).

**C-07** · §14b (L794) · HTML S[12].system[3]
- Requirement: Hold on any unexplained increase, addition, inconsistent total, changed VIN, changed financing term, changed trade figure — for correction or documented review.
- Status: **MISSING** (depends on C-06)
- Current: Holds exist only for junk-fee score < 85 (WARNING/FAIL → `REJECTED`, admin review). No comparison-based hold.
- Evidence: `lib/services/dealer/dealer-contract.service.ts:247-255`; `lib/constants.ts:73-77` `getContractShieldResult`.
- Stronger safeguard: WARNING and FAIL both hold (non-PASS never auto-approves) — keep.
- Required change: comparison findings must force a non-PASS classification (hold) regardless of junk-fee score, with a documented-review path in the admin queue.

**C-08** · §14b (L794) · HTML S[12].system[4] · claim **[BUILT]**
- Requirement: Junk-fee patterns, fee caps, APR validation, payment packing, disclosure checks applied from the existing rule set.
- Status: **PARTIAL**
- Current: Built-in: doc-fee cap $150, add-on packing cap $300 on 8 keywords, disclosure-without-price on those keywords. DB rules: only `JUNK_FEE_KEYWORD` and `FEE_CAP` are evaluated. `APR_VALIDATION`, `PAYMENT_PACKING`, `DISCLOSURE_CHECK`, `FINANCE_MARKUP` appear only in the admin rules UI seed list and type selector; the scanner has no branch for them → APR validation is not implemented.
- Evidence: `contract-shield.service.ts:30-44` caps/keywords; `:60-115` `runBuiltinHeuristics`; `:145` `if (rule.ruleType === "JUNK_FEE_KEYWORD")`; `:162` `if (rule.ruleType === "FEE_CAP" ...)` (no other ruleType branch); `app/admin/contract-shield/rules/page.tsx:43-46,215` list the four unevaluated types.
- Stronger safeguard: built-ins always run and DB FEE_CAP is skipped when built-in already flagged (no double deduction) — keep; factual, non-legal wording of findings — keep.
- Required change: implement `APR_VALIDATION` (against `config.maxApr` and vs. locked financing APR), `PAYMENT_PACKING`, `DISCLOSURE_CHECK` (`requiredTerms`), `FINANCE_MARKUP` (`maxMarkupBps` vs. buy rate) in `scanContract`; or remove the dead types from the UI. Add tests per rule type.

**C-09** · §14b (L796) · HTML S[12].system[5] · claim **[BUILT]**
- Requirement: Extraction failure is retryable and never treated as approval.
- Status: **ALREADY CORRECT**
- Current: Empty/image-only extraction throws; `scanContractVersion` resets the row to `UPLOADED`; hourly cron re-scans up to 20 `UPLOADED` rows.
- Evidence: `lib/services/contract-shield/extract-text.ts:50-52` `if (trimmed.length < 20) throw new Error("Contract text could not be extracted ...")`; `lib/services/dealer/dealer-contract.service.ts:256-263` `catch ... update({ data: { status: "UPLOADED" } })`; `app/api/cron/contract-shield/route.ts:15-26`; `vercel.json:64-65` `"/api/cron/contract-shield", "schedule": "0 * * * *"`.
- Stronger safeguard: cron only touches `UPLOADED`; `scanContract` without a `contractVersionId` is deliberately un-approvable (`contract-shield.service.ts:117-126`).
- Required change: none. (Optional: bounded retry count + Ops alert after N failures — currently retries forever silently.)

**C-10** · §14b (L796) · HTML S[12].system[6] · claim **[BUILT]**
- Requirement: Uploads are private, dealer-owned, versioned, **create-before-supersede**.
- Status: **ALREADY CORRECT** (with one DUPLICATED writer — see D-1)
- Current: PDF stored via service-role client in private bucket `dealer-contracts` under `${dealer.id}/${dealId}/uuid.pdf`; stored value is a bare path validated by `contractDocumentPathSchema` (absolute URLs refused — SSRF fix); new version created first, then every other non-superseded version set `SUPERSEDED`; dealer reads scoped by `uploadedBy = dealer.id`; dealer upload gated by `assertDealerOwnsDeal`. Admin/concierge uploads go under `admin/<dealId>/` with `uploadedBy = adminId` (not dealer-owned by design).
- Evidence: `app/api/dealer/contracts/upload-file/route.ts:24,58-64`; `prisma/manual_supabase_sql/wave1_private_buckets.sql:28` `'dealer-contracts'`; `lib/services/contract-shield/contract-document-ref.ts:38-55`; `dealer-contract.service.ts:163-178` "Create the replacement BEFORE retiring what it replaces"; `dealer-contract.service.ts:21-27,189-192`; `app/dealer/contracts/[id]/page.tsx:50-51` `where: { id, uploadedBy: dealer.id }`; `app/api/admin/deals/[dealId]/contract/upload-file/route.ts:39,51,72`.
- Stronger safeguard: SSRF-safe path schema; `SAFE_ID` regex on dealId before key interpolation; ownership re-asserted inside the service; `requirePermissionStrict("deals.esign.void")` on admin upload.
- Required change: none for the rule. Retire `lib/services/contract/contract-upload.service.ts::uploadContract` (D-1).

**C-11** · §14b (L796) · HTML S[12].system[7] · claim **[BUILT]**
- Requirement: Approval binds to the exact reviewed version.
- Status: **PARTIAL** (code correct; enabling migration not applied → admin approval non-functional in production)
- Current: Auto path: `scanContractVersion` passes `cv.id` to `scanContract`, which stores `ContractScan.contractVersionId`; PASS approves that exact row. Admin path: route passes `scan.contractVersionId` to `approveContractVersionByAdmin`, which refuses `NO_LINKED_VERSION` / `VERSION_NOT_FOUND` / `SUPERSEDED_BY_NEWER_UPLOAD` and claims the row with a CAS `status != SUPERSEDED`. Migration `20261016000000_contract_scan_version_link` is annotated "LOCAL / STAGING ONLY — NOT APPLIED TO PRODUCTION"; until applied, every scan row has a NULL link and every admin APPROVE returns 409.
- Evidence: `dealer-contract.service.ts:245-248`; `contract-shield.service.ts:187-189` `contractVersionId: contractVersionId ?? null`; `app/api/admin/contract-shield/[reviewId]/route.ts:88-91`; `dealer-contract.service.ts:78-148`; `prisma/migrations/20261016000000_contract_scan_version_link/migration.sql:1-16` header; mirror `prisma/manual_supabase_sql/contract_scan_version_link.sql` (identical). Test: `app/api/admin/contract-shield/__tests__/approve-binds-to-reviewed-version.test.ts`.
- Stronger safeguard: hard refusal on NULL link (no heuristic backfill); CAS claim; one-APPROVED-per-deal invariant (`:141-145`).
- Required change: apply migration 20261016 in production (owner-approved), verify column present, then re-scan pending reviews. Production state **UNVERIFIED** here.
- Legacy path: pre-migration `contract_scans` rows (permanently unapprovable by design).

**C-12** · §14b (L796) · HTML S[12].system[7] · claim **[BUILT]**
- Requirement: An upload arriving during review is **rejected** rather than silently swapped.
- Status: **PARTIAL**
- Current: The upload is always accepted and supersedes every other version (including the one under review). What is refused is the *stale approval* (`SUPERSEDED_BY_NEWER_UPLOAD`). Not silent, but the spec's "reject the upload" is inverted. No `CONTRACT_REVIEW`-state check exists in the upload routes.
- Evidence: `dealer-contract.service.ts:169-178` "Supersede EVERY other version"; `:100-117,128-139`; `app/api/dealer/contracts/upload-file/route.ts:43-49` (ownership only, no status gate).
- Stronger safeguard: the approval-side CAS refusal must be kept even after adding an upload-side reject (belt and braces).
- Required change: in `createContractVersionAndScan` (or the routes) refuse a new upload while a scan for the current version is in human review (`ContractScan.status ∈ {WARNING,FAIL,FLAGGED}` awaiting decision and deal `CONTRACT_REVIEW`) unless Ops has requested a revision (`REVISION_REQUESTED`), returning 409 with the reason.

**C-13** · §14b (L798) · HTML S[12].tables `contract_versions`, rec
- Requirement: `contract_versions` gains `document_hash` so the approved bytes are identifiable.
- Status: **MISSING**
- Current: No hash on `ContractVersion`. SHA-256 is computed only when the signing envelope is prepared (`ESignEnvelope.documentHash`) and re-computed at sign time.
- Evidence: `prisma/schema.prisma:2624-2640` (fields: documentUrl, version, uploadedBy, status, scanRunAt, approvedAt, rejectedAt, rejectionReason, uploadedAt — no hash); `lib/services/esign/buyer-signing.service.ts:92-95,212`; grep `document_hash` in migrations → only `e_sign_envelopes` / `e_sign_envelope_history`.
- Required change: add `contract_versions.document_hash` (nullable, additive migration), compute in `createContractVersionAndScan` from the same bytes `extractContractText` loads, verify at approval and at envelope prepare (envelope hash must equal version hash).
- Legacy path: existing ContractVersion rows (backfill by re-hashing stored objects).

### 14c — Buyer and co-buyer signing

**C-14** · §14c bullet 1 (L802) · HTML S[12].system[8] · claim **[BUILT]**
- Requirement: Approved document bytes bound to the envelope by hash.
- Status: **ALREADY CORRECT** (dormant behind schema flag — see C-20)
- Evidence: `buyer-signing.service.ts:209-221` `const documentHash = await computeDocumentHash(contract.documentUrl)` … `documentVersionId: contract.id, documentHash`; `:398-412` re-hash + `voidEnvelopeInternal` on mismatch; `loadContractPdfBytes` shared with Contract Shield (`extract-text.ts:15-34`). Migration `20261013000000_esign_inhouse_evidence` adds `document_hash`. Test `lib/services/esign/__tests__/buyer-signing.test.ts:240,295`.
- Stronger safeguard: hash recomputed immediately before completion; consent snapshot bound to that hash.
- Required change: none (add version-hash cross-check once C-13 lands).

**C-15** · §14c bullet 2 (L803) · HTML S[12].note
- Requirement: A page view is not a signature.
- Status: **ALREADY CORRECT**
- Evidence: `app/api/buyer/esign/[dealId]/route.ts:49-52` GET only writes `viewedAt`; `app/api/buyer/esign/[dealId]/sign/route.ts:26-31` POST requires all acknowledgments + typed name; `buyer-signing.service.ts:373-375`; `components/buyer/SigningCeremony.tsx:189,204-227` submit disabled until all acknowledged + name typed.
- Required change: none.

**C-16** · §14c bullet 3 (L804) · HTML S[12].buyer[1] · claim **[BUILT]**
- Requirement: Affirmative electronic-records consent + adopted name, with consent policy version and snapshot stored.
- Status: **ALREADY CORRECT** (dormant; columns from unapplied migration 20261015)
- Evidence: `lib/services/esign/consent-policy.ts:20-29` `CONSENT_POLICY_VERSION = "DRAFT_V1"`, four `CONSENT_ACK_KEYS`; `buyer-signing.service.ts:82-89,374,418-452` `validateConsentOrThrow`, `buildConsentSnapshot`, `consentPolicyVersion: CONSENT_POLICY_VERSION, consentSnapshot`; `:460-481` `CONSENT_ACCEPTED` audit; `prisma/schema.prisma:733-744`; `prisma/migrations/20261015000000_esign_consent_and_executed_artifact/migration.sql:41-46`.
- Stronger safeguard: append-only policy registry; snapshot never rewritten; consent cleared on every new attempt (`:239-246`).
- Required change: none in code. Consent copy is marked DRAFT pending attorney review — activation is an owner decision.

**C-17** · §14c bullet 4 (L805) · HTML S[12].system[9] · claim **[BUILT]**
- Requirement: Identity, IP, device information, timestamps recorded server-side.
- Status: **ALREADY CORRECT**
- Evidence: `lib/security/request-attribution.ts:16-26` (x-forwarded-for / x-real-ip / user-agent, never body); `sign/route.ts:51,56-65` `signerUserId: buyer.id` from session; `buyer-signing.service.ts:436-452` `signedAt/consentedAt = now`, `ipAddress`, `userAgent`, `signerUserId`; certificate embeds them (`buyer-contract-certificate.service.ts:26-38`).
- Stronger safeguard: buyer/dealer DTO allow-list never returns IP/UA (`esign-dto.ts:1-13`, `esign-schema-gate.ts:111-122`); admin evidence export is audited (`app/api/admin/deals/[dealId]/esign/evidence/route.ts:40-45`).
- Required change: none.

**C-18** · §14c bullet 5 (L806) · HTML S[12].exit · claim **[NEW]**
- Requirement: The buyer signs; the **co-buyer signs when named as a required signer**.
- Status: **MISSING** (as expected)
- Current: Single signer: `SIGNER_ROLE = "BUYER"`; one `ESignEnvelope` per deal (`dealId @unique`); no co-buyer identity anywhere in Deal/Buyer/ESignEnvelope. Vehicle request captures only a `coBuyer` boolean.
- Evidence: `buyer-signing.service.ts:42`; `prisma/schema.prisma:686` `dealId String @unique`; `app/api/public/request-vehicle/route.ts:106` `coBuyer: z.boolean().optional()`; grep `coBuyer|co-buyer|cosigner` → only request form/admin display.
- Required change: model co-buyer as a named required signer (new `ESignSigner` rows or a second envelope keyed by signerRole), separate consent snapshot/hash binding per signer, COMPLETED only when all required signers signed; co-buyer authentication path (separate user or invited signer link).
- Legacy path: `ESignEnvelope` single-signer columns; `ensureDealSigned` (must wait for all signers).

**C-19** · §14c bullet 6 (L807) · HTML S[12].system[10] · claim **[BUILT]**
- Requirement: A changed document voids the envelope and requires fresh consent and fresh signatures.
- Status: **ALREADY CORRECT** (void is lazy — see note)
- Evidence: `buyer-signing.service.ts:398-412` void + `DocumentChangedError` when the bound version is no longer APPROVED or the hash differs; `:250-276` a terminal attempt is archived to `ESignEnvelopeHistory` and a fresh attempt clears every consent field; test `buyer-signing.test.ts:295,441,518`.
- Note: nothing voids the envelope *at upload time* — `createContractVersionAndScan` does not touch `ESignEnvelope`; the buyer may still see "ready to sign" until they attempt to sign (then 409 DOCUMENT_CHANGED). A live SENT envelope is also silently re-bound to the newest APPROVED version by `prepare` (`:278-305`), which is safe only because consent is captured at sign time.
- Required change: optional hardening — in `createContractVersionAndScan` call `voidEnvelopeInternal(dealId, "Contract re-uploaded")` when a live envelope exists, and notify the buyer.

**C-20** · §14c bullet 7 (L808) · HTML S[12].system[11] · fail (L823)
- Requirement: Signing period expires after 14 days; may be reissued against the still-approved version; buyer is reminded.
- Status: **ALREADY CORRECT**
- Evidence: `buyer-signing.service.ts:41` `SIGNING_TTL_MS = 14 * 24 * 60 * 60 * 1000`; `:392-395` lazy expiry at sign; `:571-590` `sweepExpiredEnvelopes` (CAS, audited); `app/api/cron/esign-envelope-expiry/route.ts` + `vercel.json:144-145` hourly; reissue: `prepareBuyerSigningEnvelope` on an EXPIRED record archives it and starts attempt N+1 bound to the current APPROVED version (`:257-276`); admin resend correctly refuses EXPIRED (`app/api/admin/deals/[dealId]/esign/resend/route.ts:22-24`); reminder: `lib/services/nudge/nudge.service.ts:117-124` SIGNING_PENDING 24h nudge; Ops visibility `admin-queue.service.ts:19-24` ESIGN_EXCEPTION (48h at SIGNING_PENDING).
- Stronger safeguard: CAS on every expiry write; COMPLETED never expired; terminal records immutable.
- Required change: none (extend reminder/expiry to co-buyer when C-18 lands).

**C-21** · §14c bullet 8 (L809) · HTML S[12].system · claim **[BUILT]**
- Requirement: Signing fails closed when required evidence storage is unavailable; the enabling schema must be applied and verified in production before activation.
- Status: **PARTIAL** (schema gate fails closed correctly; storage-bucket unavailability does not)
- Current: Flag `ESIGN_EXECUTED_ARTIFACT_ENABLED` must be exactly `"true"`; default off. "Closed" = `prepareBuyerSigningEnvelope` and `recordBuyerSignature` throw `ESignSchemaUnavailableError` → buyer/admin routes return 503 `ESIGN_UNAVAILABLE`, admin send/resend refuse, buyer GET reports `signable: false`, reconcile cron reports `skipped`. Migrations 20261014/20261015 are annotated NOT APPLIED to production. However, if the *storage bucket* (`contracts`/`legal-documents`) is unavailable after the DB commit, the signature still COMPLETES and the deal advances to SIGNED; artifact/certificate/confirmations are deferred to the 5-minute reconcile cron and logged as "stuck" after 1h.
- Evidence: `lib/services/esign/esign-schema-gate.ts:37-47`; `buyer-signing.service.ts:56-73,196,373`; `app/api/buyer/esign/[dealId]/route.ts:46-48,120-123`; `sign/route.ts:85-88`; `app/api/admin/deals/[dealId]/esign/route.ts:49-57`; `esign.service.ts:34`; `app/api/cron/esign-artifact-reconcile/route.ts:8-15`; `buyer-signing.service.ts:501-506,748-773,613-665`; `.env.example:142`; migration headers `20261014…/migration.sql:6-7`, `20261015…/migration.sql:3-7`.
- Stronger safeguard: gate is also applied to reads (legacy 28-column projection) so a closed gate never 42703s; `RETURNING` narrowed on every write — keep.
- Required change: decide whether "evidence storage" includes the artifact bucket; if so, make `recordBuyerSignature` verify bucket writability (or persist the executed artifact inside the same completion step) before flipping COMPLETED. Production schema application is **UNVERIFIED** here (no DB access).

### 14d — Dealer execution

**C-22** · §14d (L813-815) · HTML S[12].dealer[2]
- Requirement: Dealership executes on its side and returns the **fully executed copy**; AutoLenis verifies it corresponds to the approved transaction, stores it, records its hash, generates completion evidence, grants access to buyer/dealer/admins.
- Status: **MISSING** (dealer execution) — storage/hash/access exist only for the *buyer-signed system artifact*
- Current: No dealer signature ceremony and no executed-copy upload route. The "executed contract" is generated by AutoLenis from the buyer's signature + frozen evidence, hashed (`executedDocumentHash`), stored in bucket `contracts`, and downloadable by buyer (`/api/buyer/deals/[dealId]/contract/download`), dealer (`/api/dealer/deals/[dealId]/contract`), and admins (evidence export). Dealer UI states the dealer does not sign.
- Evidence: `lib/services/esign/executed-contract.service.ts:1-16`; `buyer-signing.service.ts:782-826`; `app/api/dealer/deals/[dealId]/contract/route.ts:1-8,42-48`; `app/dealer/deals/[dealId]/page.tsx:53-55,189-190` "The BUYER signs the purchase contract — the dealer does not sign it"; `app/api/admin/deals/[dealId]/esign/route.ts:65-66`; grep `countersign|fully executed|executedCopy|dealerSigned` → only dealer-agreement template.
- Required change: add a dealer execution step (dealer-signed upload of the executed package or dealer countersign ceremony on the same hashed version), a verification step (hash/version correspondence to the approved ContractVersion + buyer envelope), storage under the private bucket with hash, evidence record, and access grants; new terminal `CONTRACT_EXECUTED` fact on the Deal.
- Legacy path: `executed-contract.service.ts` (keep as the buyer-side artifact; rename/label accurately), dealer notification copy `buyer-signing.service.ts:903-906` "Purchase contract executed" (currently false).

**C-23** · §14d (L817) · HTML S[12].note, exit
- Requirement: The transaction is **not contract-executed merely because the buyer signed**; release remains blocked until the dealership's fully executed copy is stored.
- Status: **BROKEN**
- Current: Buyer signature alone drives the deal to `SIGNED`; `SIGNED → PICKUP_SCHEDULED` has no executed-copy gate; `schedulePickup` advances with `force: true`; dealer is notified "Purchase contract executed" on buyer signature.
- Evidence: `buyer-signing.service.ts:504` `await ensureDealSigned(params.dealId, ...)`; `:514-526`; `lib/services/deal/deal.service.ts:26` `SIGNED: ["PICKUP_SCHEDULED"]`; `lib/services/pickup/pickup.service.ts:49` `advanceDealStatus(dealId, "PICKUP_SCHEDULED", { actorRole: "ADMIN", force: true })`; `buyer-signing.service.ts:903-906`.
- Required change: split `SIGNED` (buyer signed) from a dealer-executed fact; gate `PICKUP_SCHEDULED`/release in `canTransition`/`advanceDealStatus` on executed-copy stored (and on Stage-14 funding clearance, C-39); remove `force: true` from `schedulePickup`.
- Legacy path: `ensureDealSigned`, `pickup.service.ts:49`, journey `complete` "sign" case (`app/api/admin/buyers/[buyerId]/journey/complete/route.ts:218-222` force-advances to PICKUP_SCHEDULED with no signature at all).

**C-24** · §14d Recorded (L819) · HTML S[12].rec
- Requirement: Recorded — contract versions with hashes; scan results and decisions; envelopes with consent snapshot and certificate; executed artifact and its hash.
- Status: **PARTIAL**
- Current: Versions: no hash (C-13). Scans: `ContractScan` append-only versions with `fixList`, `changeLog` of admin decisions (APPROVED/FLAGGED/REVISION_REQUESTED) + `AdminAuditLog CONTRACT_SHIELD_*` — correct. Envelope consent + certificate: correct (gated). Executed artifact + hash: only the buyer-side artifact (C-22).
- Evidence: `contract-shield.service.ts:184-189`; `app/api/admin/contract-shield/[reviewId]/route.ts:94-97,155-162,207-210,254-264`; `prisma/schema.prisma:733-757`; `buyer-signing.service.ts:813-820`.
- Stronger safeguard: append-only scans (except D-4 violation), null-only guarded artifact write.
- Required change: C-13 + C-22.

**C-25** · §14d Buyer sees (L821) · HTML S[12].sees
- Requirement: "Contract under review" → "Ready to sign" → "Signed — waiting on the dealership's countersignature".
- Status: **PARTIAL**
- Current: Labels: CONTRACT_PENDING/CONTRACT_REVIEW "Contract Review", CONTRACT_APPROVED "Contract Approved", SIGNING_PENDING "Awaiting Signature", SIGNED "Signed". Comms at SIGNED: "Your documents are signed. We're coordinating the final steps to pickup." No countersignature-wait state exists.
- Evidence: `lib/domain/status-labels.ts:77-81`; `acquisition-comms.ts:198-205`; `app/buyer/contracts/[contractId]/page.tsx:56-61` timeline (received/scan/sent/signed).
- Required change: add the countersignature-wait copy and timeline step once C-22/C-23 exist.

**C-26** · §14d If it fails (L823) · HTML S[12].fail, staff[2]
- Requirement: A mismatch requires correction and a rescan, with the **specific discrepancies named to both parties**.
- Status: **PARTIAL**
- Current: Admin FLAG/REQUEST_REVISION name issues to buyer (in-app + email) and dealer (in-app + email) and REQUEST_REVISION sends the deal back to CONTRACT_PENDING. Automated WARNING/FAIL: buyer gets an alert email with only an *issue count*; dealer gets `rejectionReason` (first 6 items) on the ContractVersion row but **no dealer email/in-app** on automated rejection. Rescan requires a new upload (fine).
- Evidence: `app/api/admin/contract-shield/[reviewId]/route.ts:150-248`; `contract-shield.service.ts:350-372` `sendContractShieldAlertEmail({... issueCount })`; `dealer-contract.service.ts:250-254`; grep dealer notifications on automated REJECTED → none.
- Required change: on automated non-PASS, notify the dealer with the fixList (existing `sendDealerContractIssuesEmail`) and the buyer with the named items; on comparison mismatches (C-06) name the field/expected/found.

**C-27** · §14d If it fails (L823) · HTML S[12].staff[1], fail
- Requirement: An overdue upload reminds the dealership and escalates to Operations.
- Status: **MISSING**
- Current: Only a *buyer* nudge at CONTRACT_PENDING after 24h ("We're preparing your purchase contract"); no dealer reminder; no Ops queue for contract-pending overdue (queues: CONTRACT_FAIL, INSURANCE_EXCEPTION 72h, ESIGN_EXCEPTION 48h, PICKUP_EXCEPTION 7d).
- Evidence: `lib/services/nudge/nudge.service.ts:100-116`; `lib/services/admin/admin-queue.service.ts:5-40`.
- Required change: dealer reminder + `CONTRACT_OVERDUE` Ops queue keyed on `DocumentRequest.dueAt` (C-02/C-03).

**C-28** · §14d If it fails (L823) · HTML S[12].fail
- Requirement: A buyer or co-buyer who does not sign is reminded, the envelope expires, and it may be reissued.
- Status: **PARTIAL** (buyer ALREADY CORRECT; co-buyer MISSING)
- Evidence: see C-20; C-18.
- Required change: extend to co-buyer.

**C-29** · §14d If it fails (L823) · HTML S[12].fail
- Requirement: A dealership that does not execute is escalated, and release stays blocked.
- Status: **MISSING**
- Evidence: no dealer-execution state (C-22); no queue.
- Required change: `DEALER_EXECUTION_OVERDUE` escalation + release gate (C-23).

### Stage 14 — Financing completed and funding cleared

**C-30** · §Stage 14 Entry (L829) · HTML S[13].entry
- Requirement: Entry = contract fully executed by both sides.
- Status: **MISSING**
- Evidence: no dealer-executed fact; `SIGNED` = buyer only (`buyer-signing.service.ts:514-526`).
- Required change: gate on C-22 fact.

**C-31** · §Stage 14 Who (L832) · HTML S[13].staff[0..1], system[0]
- Requirement: An authorized Finance/Ops administrator records financing completion against external evidence, and separately confirms funding clearance; completion by anyone else refused; buyer can never mark financing completed.
- Status: **MISSING**
- Current: No route/service/action for financing completion or funding clearance. `FinancingStatus` lacks `COMPLETED`/`NOT_REQUIRED_CASH`. Financing is written by the buyer (`SELECTED`) and by the lender orchestrator (`APPROVED`) *before* the fee stage; the buyer route also accepts Financing edits at any later deal stage (no stale-contract protection).
- Evidence: `prisma/schema.prisma:1711-1716`; grep `fundingCleared|financing_completed|NOT_REQUIRED_CASH` → no hits; `app/api/buyer/financing/route.ts:64-92`; `lib/services/financing/financing-orchestrator.service.ts:105-127`; `app/api/admin/financing-reviews/[taskId]/resolve/route.ts:13-21` (decisions limited to APPROVED/DECLINED/CONDITIONAL/WITHDRAWN/HUMAN_REVIEW; `OPERATIONAL_ROLES` gate).
- Stronger safeguard: `FinancingAuditEvent` hash-chained audit trail (`schema.prisma:5697-5720`) and `OPERATIONAL_ROLES` gating on financing reviews — reuse.
- Required change: add `FinancingStatus.COMPLETED` + `NOT_REQUIRED_CASH`; new admin route (Finance/Ops role) `POST /api/admin/deals/[dealId]/financing/complete` and `/funding/clear` writing `financing_completed_at`, `funding_cleared_at`, verifier id, evidence ref, and appending `FinancingAuditEvent`; refuse buyer/dealer writes to Financing after contract approval.
- Legacy path: `app/api/buyer/financing/route.ts:85-92` (persists path change after financing stage).

**C-32a–f** · §Stage 14 Funding clearance requires all of (L834-841) · HTML S[13].note
- (a) Financing approval current and unexpired — **MISSING**: `ExternalPreApproval.expiryDate` exists (`schema.prisma:2024`) but no gate reads it; `Financing` has no expiry.
- (b) Every lender condition/stipulation satisfied — **PARTIAL**: `CreditApplication.stipulations` + `FinancingReviewTask STIP_REVIEW` human clearance exist (`schema.prisma:5760,5782-5786`; `review-queue.service.ts`) but are not consulted by any release gate.
- (c) Down-payment arrangement complete, method recorded by dealership — **MISSING**: no field on Deal/Financing (`schema.prisma:2059-2073`).
- (d) Dealership confirms funding / funding authorization — **MISSING**: no dealer route/field.
- (e) Trade payoff quote within good-through date where a lien exists — **MISSING**: `TradeInSubmission` has `loanBalanceCents` only (`schema.prisma:2040-2058`); grep `payoff|good_through` → `buyerTradePayoff` string only (`schema.prisma:3772`).
- (f) No funding hold, payment dispute, or chargeback on the $99 or Premium fee — **MISSING**: no dispute/chargeback model (`DepositStatus { PENDING PAID REFUNDED FAILED }` `schema.prisma:1566-1571`; grep `dispute|chargeback` → none).
- Required change: a `FundingClearance` checklist (six booleans + evidence + actor + timestamps) on the Deal or a new model, all six required before `funding_cleared_at`; Stripe dispute webhook → hold flag (payments area).

**C-33** · §Stage 14 (L843) · HTML S[13].system[3]
- Requirement: Premium upgrade window closes at clearance; unpaid Premium election reverts to Standard.
- Status: **MISSING**
- Evidence: grep `premium.*window|upgrade.*window|revert.*standard` → none; `lib/services/deal/service-fee.service.ts:5,26,104,182` treat the fee as a single `PREMIUM_FEE_CENTS` with no election state.
- Required change: model Premium election + window; close at `funding_cleared_at` (payments area owns the fee).

**C-34** · §Stage 14 Recorded (L845) · HTML S[13].rec, tables
- Requirement: `financing.status = COMPLETED | NOT_REQUIRED_CASH`, `financing_completed_at`, `funding_cleared_at`, verifier identity, evidence reference on the Deal; audit trail entries with source, external reference, amounts, APR, term, payment, expiration, VIN, verifier, verification time.
- Status: **MISSING** (audit-trail model PARTIAL)
- Evidence: `prisma/schema.prisma:574-620` Deal (no such fields); `:2059-2073` Financing; `FinancingAuditEvent` exists but only lender-decision events are appended (`financing-orchestrator.service.ts:73-83`).
- Required change: C-31 fields + new `FinancingAuditEventType` values for completion/clearance.

**C-35** · §Stage 14 Buyer sees (L847) · HTML S[13].sees
- Requirement: "Financing complete — preparing your vehicle for delivery" or the outstanding condition and its owner.
- Status: **MISSING**
- Evidence: no corresponding DealStatus/plan in `acquisition-comms.ts:140-215`.
- Required change: add comms plan + buyer status surface once C-31 exists.

**C-36** · §Stage 14 Exit (L849)
- Requirement: Exit = financing completed and funding cleared.
- Status: **MISSING** (see C-31/C-32).

**C-37** · §Stage 14 If it fails (L851) · HTML S[13].system[4]
- Requirement: A financing change affecting the contract sends the transaction back through recap, contract, Shield, and signatures; never proceeds on a stale contract.
- Status: **MISSING** (expected absent) — and a stale-contract path is open
- Evidence: `app/api/buyer/financing/route.ts:85-92` upserts Financing and `financingPath` even when the deal is past financing, with no envelope void or rescan; `app/api/buyer/deal/financing/route.ts:22-29` same; no listener on Financing changes.
- Required change: on any Financing/terms write after `CONTRACT_APPROVED`, void the envelope (`voidEnvelopeInternal`), supersede the approved ContractVersion, and drive the deal back to `CONTRACT_PENDING` with a documented reason; block buyer edits once contract requested.

**C-38** · §Stage 14 If it fails (L851) · HTML S[13].fail
- Requirement: A stale trade payoff requires a refreshed quote before clearance.
- Status: **MISSING** (see C-32e).

**C-39** · §Stage 14 If it fails (L851) · HTML S[13].fail, tables `queue_items`
- Requirement: Unresolved clearance holds the Deal and creates an Operations exception with an owner and a deadline.
- Status: **MISSING**
- Evidence: no `QueueItem`/`OperationsException` model (`grep "^model (QueueItem|OperationsException…"` → none); admin queues are derived from deal status + age (`admin-queue.service.ts:5-40`).
- Required change: persisted Ops exception record (owner, deadline, reason, resolution) — shared with other areas.

**C-40** · §Stage 14 callout (L853) · HTML S[13].gate "No conditional or spot delivery"
- Requirement: Release requires funding cleared; funding clearance requires completed financing — enforced structurally.
- Status: **MISSING**
- Current: Release (`PICKUP_SCHEDULED`, `COMPLETED`) is gated only on `SIGNED` and `INSURANCE_SATISFIED`; `schedulePickup` forces.
- Evidence: `deal.service.ts:26-30,134-138`; `pickup.service.ts:49,100`.
- Required change: add `fundingClearedAt` (and executed-copy) preconditions inside `advanceDealStatus` for `PICKUP_SCHEDULED`/`COMPLETED` (not at call sites), with a failing-first test in `deal-state-machine.test.ts`; remove `force: true` from `schedulePickup`.

### Stage 15 — Insurance

**C-41** · §Stage 15 Entry (L861) · HTML S[14].entry
- Requirement: Entry = contract requested; insurance requested at the same moment.
- Status: **BROKEN** (see C-04).

**C-42** · §Stage 15 Who (L864) · HTML S[14].buyer[0], note · claim **[BUILT — optional]**
- Requirement: Buyer uploads proof or binds externally; AutoLenis may assist with quotes but does not sell, bind, or broker insurance.
- Status: **ALREADY CORRECT** (quote assist present; binding never performed by AutoLenis)
- Evidence: `app/api/buyer/insurance/upload-proof/route.ts` (proof upload); `app/api/buyer/insurance/request-quote/route.ts:99-129` `QUOTE_REQUESTED` + `INSURANCE_QUOTE_REQUESTED` audit; `app/api/admin/insurance-requests/respond/route.ts:57-60` `QUOTE_RECEIVED`; `InsuranceQuote.isMock` (`schema.prisma:2104`); no writer for `POLICY_SELECTED`/`POLICY_BOUND` (grep of `insuranceStatus:` writes).
- Note: `POLICY_SELECTED`/`POLICY_BOUND` are dead enum values today — buyers cannot report an externally bound policy except via proof upload.
- Required change: none for the boundary; clarify/retire dead statuses in C-43.

**C-43** · §Stage 15 Status model (L866) · HTML S[14]
- Requirement: `EXTERNAL_UPLOADED → UNDER_REVIEW → VERIFIED | POLICY_BOUND | REJECTED | EXPIRED`.
- Status: **PARTIAL**
- Current: `InsuranceStatus { NOT_STARTED QUOTE_REQUESTED QUOTE_RECEIVED POLICY_SELECTED POLICY_BOUND EXTERNAL_UPLOADED VERIFIED FAILED }` — no `UNDER_REVIEW`, `REJECTED`, `EXPIRED`. `InsurancePolicyStatus { ACTIVE CANCELLED EXPIRED }` is a separate, never-updated enum on `InsurancePolicy`.
- Evidence: `prisma/schema.prisma:1493-1502`; `:1706-1710`; `:2111-2126`.
- Required change: additive enum values `UNDER_REVIEW`, `REJECTED`, `EXPIRED` on `InsuranceStatus`; upload writes `UNDER_REVIEW` (or keep `EXTERNAL_UPLOADED` as the pre-review state but remove it from the satisfied set); map `FAILED` → `REJECTED` semantics.
- Legacy path: UI maps `app/buyer/insurance/page.tsx:83-86`, `AdminBuyerCommandCenter.tsx:857`, `backfill_insurance_gate.sql:44,64,87`.

**C-44** · §Stage 15 (L868) · HTML S[14].system[0] · claim **[NEW]** (defect)
- Requirement: An upload is not approval. *Today an upload is treated as satisfied, advances the Deal automatically, and passes the release gate.*
- Status: **BROKEN** (defect confirmed at exact lines)
- Current: Upload sets `EXTERNAL_UPLOADED` and immediately advances `INSURANCE_PENDING → CONTRACT_PENDING`; `EXTERNAL_UPLOADED` is a member of `INSURANCE_SATISFIED`, which is the only insurance check on `COMPLETED`; admin UI and buyer UI render it as satisfied; the backfill SQL treats it as satisfied.
- Evidence: `app/api/buyer/insurance/upload-proof/route.ts:136-139` `tx.deal.update({ data: { insuranceStatus: "EXTERNAL_UPLOADED" } })`; `:155` `await advanceOnInsuranceSatisfied(dealId, { actorId: buyer.id, actorRole: "BUYER" })`; `lib/services/deal/deal.service.ts:41-45` `INSURANCE_SATISFIED = [VERIFIED, POLICY_BOUND, EXTERNAL_UPLOADED]`; `:134-138` `if (newStatus === COMPLETED && !opts.force) { if (!INSURANCE_SATISFIED.includes(deal.insuranceStatus)) throw new InsuranceRequiredError(); }`; `:320-330`; `app/admin/buyers/[buyerId]/AdminBuyerCommandCenter.tsx:857`; `app/buyer/insurance/page.tsx:74,180` ("Proof submitted — under review" while the gate is already open); `prisma/manual_supabase_sql/backfill_insurance_gate.sql:44`; test `app/api/buyer/insurance/__tests__/upload-proof-gate.test.ts` pins the current (defective) wiring.
- Stronger safeguard: proof pointer persisted in the same transaction as the status flip (`upload-proof/route.ts:112-140`); re-upload supersedes in place and clears `verifiedAt/verifiedBy` (`:119-124`) — keep.
- Required change: remove `EXTERNAL_UPLOADED` from `INSURANCE_SATISFIED` (only `VERIFIED`/`POLICY_BOUND`); upload → `UNDER_REVIEW` + Ops queue item; do **not** advance the deal on upload; update the two UI satisfied-sets and the backfill SQL; rewrite `upload-proof-gate.test.ts` failing-first.
- Legacy path: `advanceOnInsuranceSatisfied` (only meaningful while insurance gates contract entry — retire with C-04), `prisma/backfill-insurance-gate.ts`.

**C-45** · §Stage 15 (L868) · HTML S[14].staff[0], tables `queue_items` · claim **[NEW]**
- Requirement: Review workflow with an Operations queue and a decision trail.
- Status: **MISSING**
- Current: No verify/reject route. `VERIFIED` is written only by admin *journey shortcut* routes that do not read the proof or touch `InsurancePolicy.verifiedBy/verifiedAt`. No route mints a signed URL for `insurance-proofs` (the upload route's comment says "reads are served via short-lived signed URLs generated by an authorized route" — no such route exists), so no reviewer can open the uploaded proof. `INSURANCE_EXCEPTION` queue lists deals stuck ≥72h at `INSURANCE_PENDING`, not uploaded proofs.
- Evidence: `app/api/admin/buyers/[buyerId]/journey/complete/route.ts:195-202` `data: { insuranceStatus: "VERIFIED" }` + `advanceDeal("CONTRACT_PENDING")` (force=true via `moveBuyerWorkflowStage`, `:68-79`); `complete-all/route.ts:126-130`; grep `insurance-proofs` → only the upload route; `upload-proof/route.ts:91-92`; `admin-queue.service.ts:13-18`; grep `insurancePolicy.(update|create)` → only upload-proof.
- Required change: admin route(s) `POST /api/admin/insurance/[policyId]/verify|reject` (Ops role, audit-logged, writes `verifiedAt/verifiedBy`, provider, policyNumber, effective/expiry, VIN match) + a signed-URL viewer route for `insurance-proofs`; an `INSURANCE_REVIEW` queue keyed on `UNDER_REVIEW`; buyer notification on each decision.
- Legacy path: journey shortcut routes (must stop writing `VERIFIED` without a policy record).

**C-46** · §Stage 15 (L870) · HTML S[14].staff[1]
- Requirement: Verification confirms the policy is active, names the buyer (and co-buyer), and matches the VIN.
- Status: **MISSING**
- Evidence: no verification logic; `InsurancePolicy` has no VIN/named-insured fields (`schema.prisma:2111-2126`).
- Required change: add `vin`, `namedInsured` (and co-buyer) to `InsurancePolicy`; verify checklist in C-45.

**C-47** · §Stage 15 (L870) · HTML S[14].system[1]
- Requirement: Only `VERIFIED` or `POLICY_BOUND` permits release.
- Status: **BROKEN** (see C-44 — `EXTERNAL_UPLOADED` also permits release).
- Evidence: `deal.service.ts:41-45,134-138`.
- Required change: C-44.

**C-48** · §Stage 15 Recorded (L872) · HTML S[14].rec
- Requirement: `insurance_policies` with provider, policy number, effective/expiry dates, proof document, verifier, verification time.
- Status: **PARTIAL**
- Current: Model has every field; the only writer stores `proofUrl`, `isExternal`, `status: ACTIVE` and nulls `verifiedAt/verifiedBy`. `providerName`, `policyNumber`, `effectiveDate`, `expiryDate`, `verifiedAt`, `verifiedBy` are never written.
- Evidence: `schema.prisma:2111-2126`; `upload-proof/route.ts:121-134`.
- Required change: capture provider/policy number/dates at upload (buyer form) and verifier/time at verification (C-45).

**C-49** · §Stage 15 Exit (L874) · HTML S[14].exit
- Requirement: Exit = verified or policy bound.
- Status: **BROKEN** (exit happens at upload — C-44).

**C-50** · §Stage 15 If it fails (L876) · HTML S[14].fail, buyer[1]
- Requirement: Rejection names the specific defect and requests a corrected document.
- Status: **MISSING**
- Evidence: no rejection path; `FAILED` status has no writer; re-upload path exists (`upload-proof/route.ts:119-124`).
- Required change: reject action with reason → `REJECTED` + buyer notification naming the defect; re-upload returns to `UNDER_REVIEW`.

**C-51** · §Stage 15 If it fails (L876) · HTML S[14].system[2]
- Requirement: Expiry before pickup blocks release until corrected.
- Status: **MISSING**
- Evidence: `InsurancePolicy.expiryDate` never written or read; `INSURANCE_SATISFIED` is a static status set with no date check (`deal.service.ts:41-45,134-138`).
- Required change: release gate must check `expiryDate > pickup date`; cron to flip `EXPIRED` and notify.

**C-52** · §Stage 15 If it fails (L876) · HTML S[14].note
- Requirement: Insurance never blocks contract preparation; it blocks the vehicle leaving the lot.
- Status: **BROKEN** (see C-04: insurance gates `CONTRACT_PENDING`).
- Required change: C-04 + C-40.

### HTML-only presentation items (S[12..14])

**C-53** · HTML S[12].tables `contract_scans`, `e_sign_envelopes` — present (`schema.prisma:631-655,684-773`). ALREADY CORRECT. `document_requests` unused (C-03).
**C-54** · HTML S[13].tables `financing`, `external_pre_approvals`, `financing_audit_events`, `deals` — models exist (`schema.prisma:2059,2015,5697,574`) but carry none of the Stage-14 fields (C-34). PARTIAL.
**C-55** · HTML S[14].tables `insurance_policies` present; `queue_items` MISSING (C-39/C-45).
**C-56** · HTML S[14].sees "Insurance requirements and a secure submission link, then under review, then cleared" — buyer page shows "Proof submitted — under review" (`app/buyer/insurance/page.tsx:180`) while the gate is already open; no "cleared" transition message exists (no VERIFIED comms). PARTIAL.

---

## Duplicates

- **D-1 ContractVersion writers (DUPLICATED):** `lib/services/dealer/dealer-contract.service.ts:159-187` `createContractVersionAndScan` (canonical: supersede + fail-closed scan) vs `lib/services/contract/contract-upload.service.ts:5-13` `uploadContract` (no supersede, no scan, validates mime/size; **zero callers**). Retire the latter or fold its `validateUpload` into the routes.
- **D-2 Contract Shield override paths (DUPLICATED, one is a dead end):** (i) `POST /api/admin/contract-shield/[reviewId]` APPROVE — version-bound, audited, prepares envelope (`route.ts:70-148`); (ii) `POST /api/admin/deals/[dealId]/action` `CONTRACT_SHIELD_OVERRIDDEN` — creates an **unlinked** synthetic PASS scan `version: 999`, writes `deal.contractShieldStatus` directly, never approves a `ContractVersion` and never advances the deal (`action/route.ts:137-165`), reachable from `components/admin/AdminDealTabs.tsx:521`; `contract-shield.service.ts:374-379` asserts (i) is "the ONLY sanctioned override" — false while (ii) exists; (iii) admin journey `complete`/`complete-all` "contract" case writes `contractShieldStatus: "PASS"` and force-advances to `SIGNING_PENDING`, bypassing `CONTRACT_APPROVED` and any ContractVersion/scan (`journey/complete/route.ts:205-212`; `complete-all/route.ts:132-136`); "sign" case force-advances to `PICKUP_SCHEDULED` with no envelope (`complete/route.ts:218-222`). Retire (ii); make (iii) require an APPROVED version / COMPLETED envelope or be removed.
- **D-3 `verifyDocument` (DUPLICATED, identical):** `lib/services/documents/document.service.ts:21-26` and `lib/services/documents/document-verification.service.ts:36-38`.
- **D-4 ContractScan status mutation (append-only violated):** `lib/services/admin/admin-queue.service.ts:57-59` `CONTRACT_FAIL` resolve does `contractScan.update({ status: "WARNING" })` on a prior scan — conflicts with the append-only rule that `[reviewId]` route + `scanContract` otherwise follow (they append `changeLog` / new versions). Not a duplicate feature, but a second, unaudited-in-scan-history decision path.
- **D-5 Insurance "satisfied" set restated in three places:** `deal.service.ts:41-45` (authoritative), `AdminBuyerCommandCenter.tsx:857`, `app/buyer/insurance/page.tsx:74` and `backfill_insurance_gate.sql:44` — all must change together for C-44.

## Stronger safeguards to preserve

1. Fail-closed extraction (`extract-text.ts:50-52`) and retryable `UPLOADED` reset (`dealer-contract.service.ts:256-263`); `scanContract` without a version link is un-approvable.
2. Admin approval bound to `ContractScan.contractVersionId` with hard refusal on NULL link and CAS claim on `status != SUPERSEDED` (`dealer-contract.service.ts:78-148`); route fails closed with 409 and writes nothing (`[reviewId]/route.ts:88-92`).
3. Create-before-supersede versioning; one APPROVED version per deal invariant.
4. SSRF-safe `contractDocumentPathSchema` (absolute URLs refused) and `SAFE_ID` dealId check on admin upload; `fetchAllowedContract` for legacy http rows.
5. Dealer ownership chokepoint `assertDealerOwnsDeal` inside the service, not only the route; dealer contract reads scoped by `uploadedBy`.
6. RBAC: `requirePermissionStrict("deals.esign.void")` (OPS) on admin contract upload, esign void, evidence export; `SUPER_ADMIN|OPERATIONS_ADMIN` on Shield review and deal actions.
7. E-sign: hash re-verified at completion; four affirmative acknowledgments validated server-side; server-side attribution; CAS on every envelope transition; terminal records immutable and archived; COMPLETED never reset; null-only guarded executed-artifact write; confirmations only after artifact + certificate; buyer/dealer DTO allow-lists; audited admin forensic export; `no-docusign-runtime.test.ts` guard.
8. Schema gate `ESIGN_EXECUTED_ARTIFACT_ENABLED` (strict `"true"`, default off) with legacy 28-column projection and narrowed `RETURNING`.
9. `advanceDealStatus` CAS + `expectedFrom` from-guard; `SIGNING_PENDING` reachable only from `CONTRACT_APPROVED`; Contract Shield gate asserted in `deal-state-machine.test.ts`.
10. Buyer Contract Shield surface is read-only (self-approval hole closed; e2e `deal-autopilot.spec.ts:30-50`).
11. Insurance proof pointer persisted transactionally with the status flip; re-upload clears verifier fields; private `insurance-proofs` bucket.
12. 24h nudge cooldown per buyer per stage; hourly cron cadence with `withCronRun` monitoring; reconcile cron logs "stuck" after 1h.

## Legacy paths

- `INSURANCE_PENDING → CONTRACT_PENDING` edge + `advanceOnInsuranceSatisfied` + `prisma/backfill-insurance-gate.ts` + `manual_supabase_sql/backfill_insurance_gate.sql` (all assume insurance precedes contract and that `EXTERNAL_UPLOADED` satisfies).
- `app/api/admin/deals/[dealId]/action/route.ts:87-99` manual dealer contract-pending email (superseded by central dispatch); `:137-165` `CONTRACT_SHIELD_OVERRIDDEN`.
- Admin journey `complete`/`complete-all`/`reopen` shortcut cases for insurance/contract/sign (force transitions, direct `insuranceStatus`/`contractShieldStatus` writes).
- `lib/services/contract/contract-upload.service.ts`, `contract-comparison.service.ts` (unused).
- `ESignEnvelope.docusignEnvelopeId` / `documentKey` legacy columns (retained for pre-cutover rows; download route falls back to `documentKey`).
- Pre-migration `contract_scans` rows with NULL `contract_version_id` (unapprovable by design).
- `ContractScan.status` free-text values `FLAGGED`, `REVISION_REQUESTED` (buyer UI colour map handles only PASS/WARNING/FAIL — `app/buyer/contracts/[contractId]/page.tsx:50-54`; list page paints anything else red `page.tsx:45-49`).

## Out-of-scope findings (for other areas)

- `lib/services/pickup/pickup.service.ts:49` `schedulePickup` advances with `force: true` (bypasses every guard incl. insurance) — pickup/release area.
- `app/api/buyer/financing/route.ts:48-52` and `app/api/buyer/deal/financing/route.ts:16` pick "most recent deal" by `createdAt`, not the active one — financing area.
- `admin-queue.service.ts:57-59` mutates a prior `ContractScan` (D-4) — admin/ops area.
- `app/api/admin/deals/[dealId]/contract/upload-file/route.ts:20-24` comment claims shadow-mode RBAC but the code uses `requirePermissionStrict` — stale comment only.
- Dealer notification copy "Purchase contract executed" on buyer-only signature (`buyer-signing.service.ts:903-906`) — communications accuracy.
- Concierge (vehicle-request) deals have no dealer identity, so any dealer-facing contract request/execution must route to Ops for that track (`dealer-contract.service.ts:195-213`).

## UNVERIFIED items

- Whether migrations `20261013`, `20261014`, `20261015`, `20261016` are applied in production (headers say 20261014/15/16 are NOT; `esign-schema-gate.ts:16-18` claims production `e_sign_envelopes` has 28 columns) — no DB access in this session.
- Whether `ESIGN_EXECUTED_ARTIFACT_ENABLED` is set in any environment (`.env.example:142` is blank).
- Whether Supabase bucket `contracts` and `legal-documents` exist and are private (only `dealer-contracts`/`insurance-proofs` appear in `wave1_private_buckets.sql`; `contracts` referenced by migration comment `20260919000005…:5`).
- Whether any `ContractScanRule` rows of type `APR_VALIDATION`/`PAYMENT_PACKING`/`DISCLOSURE_CHECK`/`FINANCE_MARKUP` exist in production (they would be silently ignored by the scanner).
- Whether the hourly `contract-shield` cron and `esign-*` crons are actually running (`CronJobLog` not inspected).
- Runtime behaviour of any test suite — none executed (static read only).

## Open questions for the owner

1. Should insurance move out of the contract-entry path entirely (spec) — accepting that deals currently parked at `INSURANCE_PENDING` need a migration of status — or should `INSURANCE_PENDING` be retained as a parallel, non-blocking track flag?
2. Dealer execution: countersign ceremony on the same hashed version in-app, or upload of a dealer-executed package? Either needs a new Deal fact and a release gate.
3. Co-buyer identity: separate authenticated user, or invited-signer link on the primary buyer's deal? Affects consent evidence and PII scope.
4. Is `EXTERNAL_UPLOADED` to be retired or repurposed as the pre-review state (vs. a new `UNDER_REVIEW`)? Backfill of existing `EXTERNAL_UPLOADED` deals that already passed release must be decided.
5. Which role is "Finance" for Stage 14 — reuse `OPERATIONAL_ROLES` / `COMPLIANCE_ADMIN`, or a new `FINANCE_ADMIN` role in `lib/auth/permissions.ts`?
6. Apply migration 20261016 (`contract_version_id`) now so the admin review queue can approve, or keep it staged with the rest of the e-sign migrations (in which case every non-PASS scan is currently unresolvable except by re-upload)?
7. Should the upload-during-review rule reject the dealer upload (spec) or keep the current accept-and-refuse-stale-approval behaviour (safer for dealer UX, weaker audit)?

---

## Verification corrections (adversarial pass)

Method: every ALREADY CORRECT / MISSING / BROKEN / DUPLICATED row (C-01…C-56, D-1…D-5) and the PARTIAL rows C-05, C-08, C-11, C-12, C-21, C-26, C-43, C-48 were re-opened at the cited paths/lines without trusting the row text; MISSING rows were re-searched under alternative names (camelCase/snake_case/synonyms) across `app`, `lib`, `components`, `prisma/schema.prisma`, `prisma/migrations`, `prisma/manual_supabase_sql`, `scripts`. Static reading only (no tsc, no DB, no MCP). Paths relative to `frontend/`.

Format: `spec_ref | original status → corrected status | reason | evidence path:line`

1. **§14b L796 (C-09, extraction retryable)** | ALREADY CORRECT → **PARTIAL** | Retry only covers the `catch` path. `scanContractVersion` first writes `status: "SCANNING"` and only the in-process `catch` resets it to `UPLOADED`; a hard kill between those writes (Vercel function timeout/OOM on a large PDF, deploy) leaves the row `SCANNING` forever, and the hourly cron selects **only** `UPLOADED`. Nothing in the repo sweeps `SCANNING` (whole-repo `rg SCANNING` → schema enum, dealer list colour, the one write). Not "never approval" violated — but not "retryable" either. Required change: cron (or `scanContractVersion` entry) must also pick up `SCANNING` rows older than N minutes; bounded retry count + Ops alert. | `lib/services/dealer/dealer-contract.service.ts:236-239` `data: { status: "SCANNING", scanRunAt: new Date() }`; `:256-263` reset only in `catch`; `app/api/cron/contract-shield/route.ts:15-19` `where: { status: "UPLOADED" }`.

2. **§14b L796 (C-10, private / dealer-owned uploads)** | ALREADY CORRECT → **PARTIAL + DUPLICATED entry point** | "Dealer-owned" is enforced for the *deal* but not for the *object* on the second, live dealer route. `POST /api/dealer/contracts/upload` takes a client-supplied `documentUrl` validated only by **shape** (`<seg>/<seg>/<file>.pdf`, no scheme, no `..`); it never requires the key to sit under `${dealer.id}/${dealId}/`, so a dealer who owns deal A can attach any existing key in the shared private bucket (`admin/<otherDeal>/…`, `<otherDealer>/<otherDeal>/…`) as A's `ContractVersion`, after which Contract Shield downloads/scans it with the service-role client and the buyer's signing GET mints a signed view URL for it. Guessing UUID keys is impractical, but the boundary is not enforced in code. The route also has **zero UI callers** (`ContractUploadButton` posts only to `upload-file`; the JSON route is the retired step two of the old two-step flow) — a second dealer entry point to the same fact. Required change: either delete the JSON route or enforce prefix ownership (`documentUrl.startsWith(\`${dealer.id}/${dealId}/\`)`) and verify the object exists. Keep: SSRF-safe schema, `assertDealerOwnsDeal`. | `app/api/dealer/contracts/upload/route.ts:9` `documentUrl: contractDocumentPathSchema`, `:19`; `lib/services/contract-shield/contract-document-ref.ts:38-55` (shape only); `components/dealer/ContractUploadButton.tsx:32` (`upload-file` only); `app/api/dealer/contracts/__tests__/upload-completes-pipeline.test.ts:5-7` "that second route has ZERO callers".

3. **§14c bullet 6 L807 (C-19, changed document voids envelope)** | ALREADY CORRECT → **PARTIAL** | Two gaps against "voids the envelope": (a) the void is **lazy** — a new upload supersedes the bound version but never touches `ESignEnvelope`; until the buyer actually submits, `GET /api/buyer/esign/[dealId]` still reports `signable: true` and mints `contractViewUrl` from `envelope.documentVersionId`, i.e. the buyer is shown the **superseded** document as "ready to sign" and only learns of the change via a 409 on submit; (b) a live SENT/DELIVERED/PENDING envelope is **re-bound in place** by `prepareBuyerSigningEnvelope` (admin send/resend after a new APPROVED version): `documentVersionId`/`documentHash` are overwritten, no VOIDED record, no history archive, `attemptNumber` not incremented, `viewedAt` not cleared — the document changed under the same attempt without a void. Consent is still captured at sign time against the current hash (so the *signature* binds correctly), but the envelope is not voided and the "fresh" requirement is satisfied only by accident of ordering. Required change: `createContractVersionAndScan` → `voidEnvelopeInternal(dealId, "Contract re-uploaded")` when a live envelope exists; prepare must archive + new attempt (or refuse) when the bound version differs, and clear `viewedAt`. | `lib/services/esign/buyer-signing.service.ts:278-305` upsert `update:` rebinding a live attempt; `:398-412` void only inside `recordBuyerSignature`; `app/api/buyer/esign/[dealId]/route.ts:46-54` `signable` + view URL from the envelope's (possibly superseded) version; `lib/services/dealer/dealer-contract.service.ts:159-187` no envelope write on upload.

4. **§14d Buyer sees L821 (C-25)** | PARTIAL → **BROKEN** | The first required state, "Contract under review", is unreachable as a resting state. `CONTRACT_REVIEW` is entered **only transiently** inside the PASS auto-advance (`CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED` in one call); on WARNING/FAIL — the only case that *is* a review — the deal stays at `CONTRACT_PENDING`, whose comms say "Your contract is being prepared" and whose nudge says "There's nothing you need to do right now". `status-labels` even labels `CONTRACT_PENDING` "Contract Review", so the label and the message disagree. The "Signed — waiting on the dealership's countersignature" state does not exist (C-22/C-23). | `lib/services/contract-shield/contract-shield.service.ts:228-235` `if (scanStatus !== "PASS") return { transitions: [] … }`; `lib/services/notifications/acquisition-comms.ts:153-164`; `lib/services/nudge/nudge.service.ts:108-114`; `lib/domain/status-labels.ts:77-78`; `rg CONTRACT_REVIEW` → no other driver into that status.

5. **§Stage 14 L841 (C-32f, no dispute/chargeback on $99/Premium)** | MISSING → MISSING (**evidence corrected**) | The row says `grep dispute|chargeback → none`; that is false. The Stripe webhook already handles `charge.dispute.created` — but only writes an `AdminAuditLog STRIPE_DISPUTE_CREATED` row; it sets no hold on `Deal`/`Deposit` and no release gate reads it. Required change stands (hold flag written by the webhook, consulted by clearance); the webhook hook point exists and must be extended, not duplicated. | `app/api/webhooks/stripe/route.ts:769-796`; `prisma/schema.prisma:1566-1571` `DepositStatus { PENDING PAID REFUNDED FAILED }` (no DISPUTED/HELD).

6. **§Stage 14 L843 (C-33, Premium window closes at clearance)** | MISSING → MISSING (**evidence corrected**) | The row claims "no election state". A Premium **election** exists: `Buyer.plan` (`BuyerPlan STANDARD|PREMIUM`) + `planUpgradedAt`, written by `POST /api/buyer/plan/upgrade` with a race-safe `updateMany` guard and audit — but with **no stage/window guard at all**: a buyer can flip to PREMIUM at any deal stage, including after pickup/COMPLETED, and nothing reverts an unpaid election. What is missing is the window close + revert, not the election. Required change: gate the upgrade route on the deal not yet funding-cleared, and revert unpaid PREMIUM→STANDARD at `funding_cleared_at` (payments area owns the fee). | `prisma/schema.prisma:47-48` `plan BuyerPlan @default(STANDARD)`, `planUpgradedAt`; `:1461` `enum BuyerPlan`; `app/api/buyer/plan/upgrade/route.ts:31-37` (no deal-status check); `lib/services/deal/service-fee.service.ts:26,104,182`.

7. **§Stage 14 L851 / HTML S[13].tables `queue_items` (C-39, C-55)** | MISSING → MISSING (**evidence corrected**) | `QueueItemStatus` and `QueueItemType` **enums already exist** in the Prisma schema and in the baseline migration, but no `QueueItem` model/table uses them (dead enums; `admin-queue.service.ts` hand-codes the same eight type strings). Reuse-before-create: the persisted Ops exception record should be built on these enums, not new ones. | `prisma/schema.prisma:1890-1907`; `prisma/migrations/20260423180146_complete_schema/migration.sql:86,89`; `lib/services/admin/admin-queue.service.ts:5`.

8. **§14c bullet 1 L802 (C-14, hash-bound envelope)** | ALREADY CORRECT → ALREADY CORRECT (**note corrected**) | The row files this under "dormant behind schema flag". The hash columns (`document_version_id`, `document_hash`) come from migration **20261013**, which carries no "not applied" annotation and whose columns are in the gate's 28-column *production* projection — so the binding columns are expected to exist in production; what is dormant is the ceremony itself (`prepare`/`sign` throw `ESignSchemaUnavailableError` while `ESIGN_EXECUTED_ARTIFACT_ENABLED !== "true"`). Production column state remains UNVERIFIED (no DB access). | `prisma/migrations/20261013000000_esign_inhouse_evidence/migration.sql:1-8,36-37`; `lib/services/esign/esign-schema-gate.ts:14-18,69-98` (`documentHash: true` inside `LEGACY_ENVELOPE_SELECT`); `buyer-signing.service.ts:196,373`.

9. **§14d If it fails L823 (C-26, discrepancies named to both parties)** | PARTIAL → PARTIAL (**confirmed, evidence tightened**) | Automated WARNING/FAIL: buyer email carries only `issueCount` (signature confirmed), dealer receives **nothing** (the only `sendDealerContractIssuesEmail` callers are the admin FLAG / REQUEST_REVISION actions and the `CONTRACT_SHIELD_OVERRIDDEN` admin action). The dealer learns of the rejection only by opening `/dealer/contracts` and reading `rejectionReason`. | `lib/services/email/resend.service.ts:942-947`; `rg sendDealerContractIssuesEmail(` → `[reviewId]/route.ts:182,221`, `deals/[dealId]/action/route.ts:153` only; `dealer-contract.service.ts:250-254`.

10. **§14b L796 / HTML S[12].staff[0] "Review held contracts" — NEW row C-57** | (not covered) → **BROKEN** | The admin contract viewer `GET /api/admin/contracts/[versionId]/signed-url` signs against bucket **`"contracts"`**, but every `ContractVersion.documentUrl` written by the dealer/admin upload routes lives in **`"dealer-contracts"`** (also what Contract Shield and the buyer view URL read). Unless a mirror `contracts` object exists (UNVERIFIED, no code writes one), the admin cannot open the held contract they are asked to review — `createSignedUrl` fails → 500. The route is also gated only by `getAdminFromRequest` (any admin), weaker than the `requirePermissionStrict("deals.esign.void")` on the admin upload route. Required change: sign against `dealer-contracts` via the shared `getContractViewUrl`/`loadContractPdfBytes` bucket constant; add a role/permission check; add a route test. | `app/api/admin/contracts/[versionId]/signed-url/route.ts:18` `createSignedDocumentUrl("contracts", version.documentUrl)`; `app/api/dealer/contracts/upload-file/route.ts:24` `BUCKET = "dealer-contracts"`; `app/api/admin/deals/[dealId]/contract/upload-file/route.ts:33`; `lib/services/contract-shield/extract-text.ts:13`; `lib/services/esign/buyer-signing.service.ts:40`.

11. **HTML S[12].staff[0] "Review held contracts" — NEW row C-58** | (not covered) → **PARTIAL** | The admin Contract Shield page lists the last 50 `ContractScan` rows and treats every `status !== "PASS"` as pending — so WARNING, FAIL, FLAGGED, REVISION_REQUESTED **and superseded/historical** scans all appear with no link to the current `ContractVersion` and no per-deal de-dup; the `CONTRACT_FAIL` Ops queue lists only `status: "FAIL"`, so a WARNING hold (score 70–84, version REJECTED, deal parked) is in no Ops queue. Required change: queue keyed on the deal's *current* version with a non-PASS, undecided scan; include WARNING. | `app/admin/contract-shield/page.tsx:72-86`; `lib/services/admin/admin-queue.service.ts:10`.

12. **§14b L796 "approval binds to the exact reviewed version" / §Stage 14 L851 "never proceeds on a stale contract" — NEW row C-59** | (not covered) → **PARTIAL** | Signing is deal-status-agnostic. `recordBuyerSignature` checks only envelope status, version status and hash — never `Deal.status`. Admin `REQUEST_REVISION` and journey `reopen("contract")` force the deal back to `CONTRACT_PENDING` **without** superseding the APPROVED `ContractVersion` or voiding the envelope, so a live SENT envelope stays signable and can complete while the deal sits at `CONTRACT_PENDING` (`ensureDealSigned` then no-ops because the deal is neither CONTRACT_APPROVED nor SIGNING_PENDING → COMPLETED envelope, deal not SIGNED). `REQUEST_REVISION` does not check `scan.status`, so it is callable on an already-APPROVED review (UNVERIFIED whether the admin UI exposes that). Required change: rollback paths must supersede the approved version and `voidEnvelopeInternal`; `recordBuyerSignature` should require `Deal.status ∈ {CONTRACT_APPROVED, SIGNING_PENDING}`. | `lib/services/esign/buyer-signing.service.ts:377-412,514-526`; `app/api/admin/contract-shield/[reviewId]/route.ts:203-218` (scan + deal only); `app/api/admin/buyers/[buyerId]/journey/reopen/route.ts:98-104`.

13. **§14a L782 (C-02)** | BROKEN → BROKEN (**confirmed**) | Re-verified: the only dealer contract-request send is inside the admin `DEAL_STAGE_ADVANCED` action; `emitDealStatusComms` is buyer-only and email-free by design; `runArrivalHooks` has no `CONTRACT_PENDING` branch; `dealer-award-dispatch.service.ts` contains no contract/upload instruction; no cron references `CONTRACT_PENDING` for dealers. | `app/api/admin/deals/[dealId]/action/route.ts:87-99`; `lib/services/deal/deal.service.ts:225-241`; `lib/services/notifications/acquisition-comms.ts:47-50,153-164`; `rg -i "contract|upload" lib/services/deal/dealer-award-dispatch.service.ts` → none.

14. **§14a L782 `document_requests` (C-03)** | MISSING → MISSING (**confirmed**) | Whole-repo search (`documentRequest.`, `DocumentRequest`, `document_requests`, `requestDocument`, `request-document`) → only the model, its baseline migration DDL, and the uncalled `requestDocument()` (which never sets `dueAt`). | `lib/services/documents/document.service.ts:28-32`; `prisma/schema.prisma:2191-2204`.

15. **§14b L792-794 (C-06, C-07)** | MISSING → MISSING (**confirmed**) | `scanContract` reads only `contractScanRule.findMany`; no `offer`/`vehicle`/recap read; `compareContracts` has no callers. | `lib/services/contract-shield/contract-shield.service.ts:127-181`; `rg "compareContracts\("` → definition only.

16. **§14b L798 (C-13)** | MISSING → MISSING (**confirmed**) | `rg document_hash|documentHash` across prisma/lib/app → only `e_sign_envelopes` / `e_sign_envelope_history`; `ContractVersion` model has no hash column; no manual SQL adds one. | `prisma/schema.prisma:2624-2640`.

17. **§14c bullet 5 L806 (C-18, co-buyer)** | MISSING → MISSING (**confirmed**) | Alternative names (`coBuyer`, `co_buyer`, `cosigner`, `co_signer`, `secondSigner`, `additionalSigner`, `signerRole`) → only the request-form boolean, its admin display, and the constant `SIGNER_ROLE = "BUYER"`; no migration/manual SQL adds a signer table. | `lib/services/esign/buyer-signing.service.ts:42`; `prisma/schema.prisma:686` `dealId @unique`.

18. **§14d L813-817 (C-22, C-23)** | MISSING / BROKEN (**confirmed**) | `countersign|fully executed|executedCopy|dealerSign|dealerExecut|CONTRACT_EXECUTED` → only the dealer-agreement email template; dealer UI states the dealer does not sign; dealer notified "Purchase contract executed" on buyer-only signature; `SIGNED → PICKUP_SCHEDULED` open; `schedulePickup` uses `force: true`. | `app/dealer/deals/[dealId]/page.tsx:50-55,187-190`; `lib/services/esign/buyer-signing.service.ts:903-906`; `lib/services/deal/deal.service.ts:26`; `lib/services/pickup/pickup.service.ts:49`.

19. **§Stage 14 (C-30…C-38, C-40)** | MISSING (**confirmed**) | `fundingClear|funding_clear|financingComplet|financing_complet|NOT_REQUIRED_CASH|spot.?deliver` → no hits in app/lib/prisma/scripts; `FinancingStatus { PENDING SELECTED APPROVED DECLINED }`; buyer financing routes upsert `Financing`/`financingPath` at any stage (`DealTransitionError` swallowed → direct `deal.update`); the credit-application route *is* stage-gated (`FINANCING_PENDING` only) — a stronger safeguard to mirror. | `prisma/schema.prisma:1711-1716,2059-2073`; `app/api/buyer/financing/route.ts:48-52,64-92`; `app/api/buyer/deal/financing/route.ts:16-28`; `app/api/buyer/financing/apply/route.ts:51`.

20. **§Stage 15 (C-44, C-45, C-47, C-49, C-51)** | BROKEN / MISSING (**confirmed at exact lines**) | Upload → `EXTERNAL_UPLOADED` + `advanceOnInsuranceSatisfied`; `INSURANCE_SATISFIED` includes `EXTERNAL_UPLOADED`; `VERIFIED` written only by journey shortcuts; no `insurancePolicy.update` other than the upload route; `insurance-proofs` bucket referenced only by the upload route — the generic admin document viewer resolves `Document` rows to `dealer-documents`/`buyer-documents` only, so no reviewer can open a proof; `InsurancePolicy.expiryDate` never read; `POLICY_BOUND`/`POLICY_SELECTED`/`FAILED` have no writers. | `app/api/buyer/insurance/upload-proof/route.ts:136-139,155`; `lib/services/deal/deal.service.ts:41-45,134-138,309-333`; `app/api/admin/buyers/[buyerId]/journey/complete/route.ts:196-200`; `app/api/admin/documents/[documentId]/signed-url/route.ts:19`; `rg insurance-proofs` → upload route + `wave1_private_buckets.sql:25` only.

21. **Duplicates D-1…D-5** | DUPLICATED (**confirmed**) | D-1 `uploadContract` has zero callers and no supersede/scan; D-2 `CONTRACT_SHIELD_OVERRIDDEN` creates an unlinked `version: 999` PASS scan and never approves a version (reachable from `AdminDealTabs.tsx:520-521`), journey `complete`/`complete-all`/`reopen` force stages; D-3 the two `verifyDocument` bodies are byte-identical; D-4 `CONTRACT_FAIL` resolve mutates a prior scan FAIL→WARNING; D-5 the satisfied set is restated in `deal.service.ts:41-45`, `AdminBuyerCommandCenter.tsx:857`, `app/buyer/insurance/page.tsx:74`, `backfill_insurance_gate.sql:44,51,64,87,93` (and `prisma/backfill-insurance-gate.ts`). | as cited.

22. **Rows re-verified with no change** | C-01, C-04, C-05, C-08, C-11, C-12, C-15, C-16, C-17, C-20, C-21, C-24, C-27, C-28, C-29, C-41, C-42, C-43, C-46, C-48, C-50, C-52, C-53, C-54, C-56 — cited lines say what the rows claim. Minor: C-11's admin APPROVE advances with `force: true` (needed because `CONTRACT_PENDING → CONTRACT_APPROVED` skips `CONTRACT_REVIEW`), so `DealStatusHistory` records the hop with `reason` only when the admin supplied one (`[reviewId]/route.ts:101-107`).

### Spec requirements the original file did not cover (now added above)
- HTML S[12].staff[0] "Review held contracts" — C-57 (admin viewer wrong bucket, BROKEN), C-58 (queue completeness, PARTIAL).
- §14b/§Stage 14 "never proceeds on a stale contract" from the *signing* side — C-59 (deal-status-agnostic signing after revision/reopen, PARTIAL).

### Corrected summary lines
- Summary #3 "private dealer-owned storage … ALREADY CORRECT" → dealer-owned is enforced per deal, **not per object**, on the live JSON upload route (correction 2); extraction retry does not cover `SCANNING` (correction 1).
- Summary #5 "hash-bound envelope … voids on change" → void is lazy and in-place rebind bypasses it (correction 3).
- Summary #7 add: Premium election exists (`Buyer.plan`) with no window; Stripe dispute webhook exists with no hold.
- Summary #10 add: admin contract signed-URL route targets the wrong bucket.
