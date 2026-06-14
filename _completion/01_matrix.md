# Phase 1 — Completion Matrix (system of record)

_Method: static verification (route exists, UI fetches the correct API, handler enforces authz, required states, compliance wording). Full multi-role **runtime** walkthrough requires a seeded Supabase DB + live Stripe/Resend/Twilio + authenticated sessions per role, which is not safely available in this ephemeral environment. Rows depending on that are marked **UNVERIFIED (static-only)**._

## Scale note
The platform is large and mature: ~305 pages, 508 API routes. A per-route 16-stage × 4-role table for all 305 pages is impractical to runtime-verify in one pass. This matrix is organized by the **16-stage buyer lifecycle** (the spec's north star) plus role-portal coverage summaries, with status grounded in concrete static evidence. Where a stage's route/UI/API/authz all check out statically, it is **Complete (static)**; runtime-only behaviors are flagged.

## Buyer lifecycle — 16 stages
| # | Stage | Route(s) | UI wired | API + authz | Compliance | Status |
|---|---|---|---|---|---|---|
| 1 | Signup/login | `app/auth/signup`, `app/auth/signin` | ✅ | `api/auth/*`, Supabase session; proxy redirects | OK | Complete (static) |
| 2 | Onboarding | `app/buyer/onboarding` | ✅ | `api/buyer/*` guarded by `getRequestBuyer` | OK | Complete (static) |
| 3 | Prequalification / external preapproval intake | `app/buyer/prequal`, `/prequal/external`, `/prequal/result`, `/prequal/declined`, `/prequal/pending`, `/prequal/manual-preapproval/status` | ✅ | guarded; FCRA adverse-action on decline (`api/admin/prequal/[id]/decide`) | OK — "prequalification/approval" correctly disclaimed (no lender language) | Complete (static) |
| 4 | Eligibility-constrained vehicle search | `app/buyer/search`, `/searches`, `/inventory/[vehicleId]` | ✅ | guarded | Gated by eligibility/affordability, **not** lender approval | Complete (static) |
| 5 | Shortlist | `app/buyer/shortlist` | ✅ | `shortlist.service` readiness = prequal + count; **not** insurance | OK | Complete (static) |
| 6 | Auction activation | `app/buyer/auction/[auctionId]`, `/auctions` | ✅ | deposit ($99) gates activation; idempotency key on deposit intent | Insurance explicitly NOT required to activate (UI disclaimer present) | Complete (static) |
| 7 | Dealer offers | `app/buyer/auction/[auctionId]/offers`, `app/dealer/offers/*`, `app/dealer/quick-offer/[auctionId]` | ✅ | guarded | OK | Complete (static) |
| 8 | Best-price evaluation | `lib/services/offer/best-price.service.ts`; buyer offers view | ✅ | ranks by dealer OTD only (AutoLenis fee excluded) | Fee separated from pricing | Complete (static) |
| 9 | Selected deal | `app/buyer/deal`, `/deal/[dealId]/*` | ✅ | guarded | OK | Complete (static) |
| 10 | Financing coordination | `app/buyer/deal/financing`, `/financing/pre-approval` | ✅ | guarded | "financing selected after deal" disclosed | Complete (static) |
| 11 | AutoLenis fee handling | `app/buyer/fee`, `/deposit`, `/deposit/success` | ✅ | separate Stripe PI; idempotency keys; audit on admin paths | Fee ≠ vehicle price; "$99 refundable" copy | Complete (static) |
| 12 | Insurance completion | `app/buyer/insurance` | ✅ | `api/buyer/insurance/upload-proof` (proof upload path exists) | Blocks only final release, not early shopping | Complete (static) |
| 13 | Contract review (Contract Shield) | `app/buyer/contract-shield`, `/contracts/[contractId]`, admin `contract-shield/*` | ✅ | guarded | OK | Complete (static) |
| 14 | E-sign | `app/buyer/esign`, admin `deals/[dealId]/esign` | ✅ | guarded; Docusign/esign envelope status | OK | Complete (static) |
| 15 | Pickup/delivery | `app/buyer/pickup`, admin `deals/[dealId]/pickup` | ✅ | pickup requires eSign COMPLETED; QR check-in; audit logged | OK | Complete (static) |
| 16 | Completion + post-close follow-up | `app/buyer/deal/[dealId]/complete`, `/receipt`; CRM nurture | ✅ | guarded | OK | Complete (static) |

## Role-portal coverage (static)
| Role | Pages | API auth pattern | Authz coverage result |
|---|---|---|---|
| Buyer | 47 | `getRequestBuyer` (113 uses) + `requireBuyer` | No unguarded handlers found |
| Dealer | 49 | `getRequestDealer` (65) + `requireDealer` | No unguarded handlers found |
| Affiliate | 19 | `getRequestAffiliate` (45) | No unguarded handlers found |
| Admin | 133 | `getAdminFromRequest`/`getAdminWithRole`/`getAdminActor` (+ MFA via JWT) | **18 unguarded GET handlers found & fixed** (see 02_gaps) |

## Cross-role propagation (static)
Status transitions write to shared Prisma models (`Deal`, `Auction`, `Offer`, `Deposit`, `AdminAuditLog`, `Notification`); admin dashboards read these models, so buyer/dealer transitions surface to Admin. Verified by service-layer reads, not runtime — **UNVERIFIED (static-only)** at runtime.

## Honest limits
- Per-page empty/loading/error/blocked-state completeness and live link integrity across all 305 pages are **UNVERIFIED (static-only)**; not individually exercised at runtime.
- The lifecycle-stage rows above are grounded in concrete file evidence but their end-to-end runtime behavior per role is **UNVERIFIED (static-only)**.
