---
name: autolenis-domain-model
description: >
  The canonical domain model for AutoLenis — the authoritative catalogue of entities, their
  ownership, relationships, identifiers, status enumerations, and state-transition rules across the
  buyer, dealer, affiliate, and admin domains. Backed by the Prisma schema
  (frontend/prisma/schema.prisma). Use this skill whenever a change adds or modifies a database
  entity, a status field, a relationship, or a state transition, or when you need the source-of-truth
  definition of Buyer, Dealer, Auction, Offer, Deal, Deposit, Contract, Financing, Insurance,
  Trade-in, Affiliate, Commission, Document, or Audit records. It overrides ad-hoc field invention.
---

# AutoLenis — Domain Model

## Purpose & Authority

This skill is the **canonical data dictionary** for AutoLenis. The Prisma schema
(`frontend/prisma/schema.prisma`, ~200 models) is the physical source of truth; this skill is the
*conceptual* contract that prevents inconsistent fields, competing state models, and duplicate
entities. When a task needs to know "what is a Deal, what states can it be in, what owns it," this
skill answers — and its answers override improvised naming.

## When this skill activates

- Adding/altering a Prisma model, enum, relation, or status field.
- Writing a state transition (auction → deal → contract → signing → pickup).
- Any question about entity ownership, referential integrity, or the meaning of a status value.
- Designing a query that joins across domains (buyer ↔ auction ↔ offer ↔ deal).

## Architecture & key files

- **Schema:** `frontend/prisma/schema.prisma`. **Migrations:** `frontend/prisma/migrations/`.
- **Access:** always through `lib/prisma.ts` (singleton) or a domain service in `lib/services/**`.
- Status transitions are owned by services (e.g. `lib/services/deal`, `lib/services/auction`),
  never mutated ad hoc from a route handler or component.

## Canonical entities (ownership & role)

| Entity (Prisma model) | Owns / belongs to | Purpose |
| --- | --- | --- |
| `Buyer` | root buyer identity | person requesting a vehicle |
| `BuyerPreferences`, `BuyerInventoryPreference` | Buyer | search/preference data |
| `VehicleRequest` | Buyer | a concrete request that drives an auction |
| `Auction` | VehicleRequest | reverse auction dealers compete in (~48h) |
| `AuctionInvitation` | Auction ↔ Dealer | dealer invited to bid |
| `AuctionVehicle` | Auction | vehicle(s) in scope |
| `Offer` (table `offers`) | Auction ↔ Dealer | a dealer's competing reverse-auction offer (the entity `OfferStatus` applies to). **Not** `DealerOfferSubmission`/`VehicleOffer`, which are the separate concierge track — never conflate them |
| `Dealer` | root dealer identity | competing dealership |
| `DealerApplication`, `DealerVerification`, `DealerInvitation` | Dealer | onboarding & vetting |
| `DealerScorecardSnapshot`, `DealerScorecardWeights` | Dealer | performance scoring |
| `Deal` | Buyer ↔ Dealer (from accepted offer) | the transaction lifecycle |
| `Deposit` | Buyer/Deal | $99 refundable deposit (buyer → AutoLenis) |
| `DealerPayment` | Dealer/Deal | dealer's fee (dealer → AutoLenis) |
| `Financing`, `FinancingScenario`, `ExternalPreApproval` | Deal | financing path |
| `Insurance*` (Policy/Quote) | Deal/Buyer | insurance verification |
| `TradeIn` | Deal/Buyer | trade-in valuation |
| `ContractVersion`, `ContractScan`, `ContractScanRule` | Deal | Contract Shield review |
| `ESignEnvelope` | Deal | DocuSign e-signature |
| `Document`, `DocumentRequest`, `DocumentVersion` | Deal/Buyer/Dealer | uploaded evidence |
| `Pickup` (`PickupStatus`) | Deal | handoff scheduling |
| `Affiliate`, `AffiliateReferral`, `Commission`, `AffiliatePayout` | Affiliate | referral revenue |
| `Admin`, `AdminSession`, `AdminImpersonation`, `AdminAuditLog` | Admin | operations & oversight |
| `AuditLog`, `ComplianceEvent`, `AcceptedTerms`, consent records | cross-cutting | evidence & compliance |
| `Notification`, `EmailSendLog`, messaging/consent models | cross-cutting | communications |

> This table is a map, not the full schema. Confirm exact field names against
> `schema.prisma` before writing code — never invent columns.

## Core rules & invariants (state machines — use EXACT enum values)

1. **`VehicleRequestStatus`:** `SUBMITTED → INTAKE → ACTIVE_SOURCING → OFFER_READY → OFFER_SENT →
   OFFER_ACCEPTED | OFFER_DECLINED → DEAL_CREATED`; terminal: `CLOSED_NO_MATCH`, `CANCELLED`, `EXPIRED`.
2. **`AuctionStatus`:** `PENDING → ACTIVE → CLOSED`; off-path: `EXPIRED`, `CANCELLED`, `REOPENED`.
3. **`OfferStatus`** (`Offer`, table `offers`): `DRAFT → SUBMITTED → ACCEPTED | DECLINED | WITHDRAWN | EXPIRED`.
4. **`DealStatus`:** `PENDING → ACTIVE → FINANCING_PENDING → FEE_PENDING → FEE_PAID →
   INSURANCE_PENDING → CONTRACT_PENDING → CONTRACT_REVIEW → CONTRACT_APPROVED → SIGNING_PENDING →
   SIGNED → PICKUP_SCHEDULED → PICKUP_COMPLETE → COMPLETED`; off-path: `CANCELLED`, `REFUNDED`.
5. **`DepositStatus`:** `PENDING → PAID → REFUNDED | FAILED`.
6. **`ESignStatus`:** `PENDING → SENT → DELIVERED → COMPLETED`; off-path: `DECLINED`, `VOIDED`.
7. **`PickupStatus`:** `NOT_SCHEDULED → SCHEDULED → CHECKED_IN → COMPLETED`; `RESCHEDULED`, `EXCEPTION`.
8. **`InsuranceStatus`:** `NOT_STARTED → QUOTE_REQUESTED → QUOTE_RECEIVED → POLICY_SELECTED →
   POLICY_BOUND | EXTERNAL_UPLOADED → VERIFIED | FAILED`.
9. **`TradeInStatus`:** `SUBMITTED → REVIEWING → VALUED → ACCEPTED | DECLINED`.
10. **`FinancingStatus`:** `PENDING → SELECTED → APPROVED | DECLINED`.
11. **`PreQualDecision`:** `APPROVED`, `DECLINED`, `PENDING`, `MANUAL_REVIEW`, `OFAC_ESCALATED`, `OFAC_REVIEW`.
12. **`DealerStatus`:** `PENDING → ACTIVE → SUSPENDED → TERMINATED`.
13. **`ContractScanRuleType`:** `FEE_CAP`, `JUNK_FEE_KEYWORD`, `APR_VALIDATION`, `PAYMENT_PACKING`,
    `DISCLOSURE_CHECK`, `FINANCE_MARKUP`.
14. **`UserRole`:** `BUYER`, `DEALER`, `AFFILIATE`, `SUPER_ADMIN`, `OPERATIONS_ADMIN`,
    `COMPLIANCE_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_ADMIN`. **`AffiliateTier`:** `STANDARD`, `SILVER`,
    `GOLD`, `PLATINUM`.

**Invariants:**
- **Single source of truth per fact.** A status lives on exactly one owning entity; do not mirror
  it onto another table as a second writable copy.
- **Only forward/off-path transitions defined above are legal.** Reject illegal transitions in the
  owning service; do not "fix" bad state by writing an out-of-band status.
- **Referential integrity via FKs + `onDelete` rules**; no dangling references. Cross-domain links
  (Buyer↔Auction↔Offer↔Deal) are FK-backed.
- **Soft-delete / archival, not hard-delete,** for records with audit or financial significance
  (deposits, deals, contracts, payouts, audit logs). Respect data-retention requirements.
- **Every state transition writes an audit trail** (`AuditLog` / `AdminAuditLog` / domain history
  tables like `DealStatusHistory`, `AuctionExtensionLog`, `ContractScanHistory`).
- **Unique identifiers:** use the model's primary id; enforce natural-key uniqueness with unique
  constraints (e.g. one active auction per open VehicleRequest) rather than app-only checks.

## Workflows

**Transition a status safely (pattern):**
```ts
await prisma.$transaction(async (tx) => {
  const deal = await tx.deal.findUniqueOrThrow({ where: { id } });
  assertTransition(deal.status, next);          // reject illegal DealStatus moves
  await tx.deal.update({ where: { id }, data: { status: next } });
  await tx.dealStatusHistory.create({ data: { dealId: id, from: deal.status, to: next, actor } });
});
after(() => notificationsService.onDealStatus(id, next)); // side effects off the request path
```

**Add a new entity/field:** confirm no existing model covers it → add model/enum in
`schema.prisma` → migration with constraints + indexes + RLS + backfill + rollback (see
`autolenis-supabase-postgres`) → expose through the owning service → test.

## Boundaries — do / never

**Do:** reuse existing models/enums; enforce transitions in the owning service; write history/audit
rows; use exact enum spellings above.

**Never:** invent a field or status that duplicates an existing one; store the same fact in two
writable places; mutate status directly from a route handler/component; hard-delete
financial/audit/compliance records; introduce a competing enum for a state that already exists.

## Acceptance criteria

- [ ] New/changed fields confirmed against `schema.prisma`; no duplicate representation of an existing fact.
- [ ] Status changes go through the owning service and only follow legal transitions.
- [ ] Referential integrity enforced with FKs/unique constraints, not app-only checks.
- [ ] Audit/history row written for every meaningful state change.
- [ ] Retention/soft-delete rules honored for financial & compliance data.
- [ ] Migration includes constraints, indexes, RLS, backfill, and rollback.

## Cross-skill links

- `autolenis-system-architecture` — where services/data access live.
- `autolenis-supabase-postgres` — migrations, constraints, RLS, rollback.
- Domain skills that own specific transitions: `autolenis-auction-engine`, `autolenis-buyer-journey`,
  `autolenis-dealer-marketplace`, `autolenis-payments-and-ledger`, `autolenis-contract-shield`.
