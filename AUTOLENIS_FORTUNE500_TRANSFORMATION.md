# AutoLenis — Fortune 500 Fintech Marketplace Transformation & Operating-Model Enhancement Audit

**Repo:** `AutolenisWebDeveloper/autolenisNewUpdatedfinal` · frontend root `frontend/` · branch `main`
**Method:** Direct code inspection (source of truth). Every claim cites `file:line`. State = Exists / Partial / Missing. Maturity = Basic / Intermediate / Advanced / Enterprise / Fortune-500. Recommendation = KEEP / IMPROVE / CONSOLIDATE / AUTOMATE / EXPAND / REENGINEER / REPLACE.
**Mandate:** Elevate the *existing* platform — favor evolution over rebuild. REPLACE only where the current implementation cannot reach the outcome.

> **Context — remediation already shipped.** A prior Phase-1 audit (`AUTOLENIS_FORTUNE500_AUDIT.md`, merged) produced 12 fixes now in PRs #242–#253 (#241/#253 merged). Where a gap this audit would raise is *already closed by a shipped fix*, it is marked **[SHIPPED F-xxx]**. This report assesses `main` and explicitly distinguishes "open gap" from "fixed, pending merge."

---

## 1. EXECUTIVE SUMMARY

AutoLenis is **not** a thin prototype — it is a deep, production-staged marketplace with genuine enterprise bones: a state-derived buyer journey, a reverse-auction with serializable offer submission, a real dealer scorecard, a 3-level affiliate commission tree, a lead-scoring CRM spine, programmatic market-intelligence (AMIPS), and Prisma-live executive dashboards with **no hardcoded KPIs**. The transformation task is therefore **80% automate/consolidate/expand, 20% build-new** — not redesign.

**The platform already operates at Enterprise level on the happy path.** What separates it from Fortune-500 *autonomous-marketplace* standard is concentrated in four systemic gaps:

| # | Systemic gap | Evidence | Lever |
|---|---|---|---|
| 1 | **No marketplace self-healing.** Auctions are fully reactive — no weak-auction detection, no automatic radius expansion / re-invite / extension / escalation. | `lib/services/auction/dealer-invitation.service.ts:13` (fixed 150mi), one-shot invite at `webhooks/stripe/route.ts:124`; no health logic anywhere | **AUCTION INTELLIGENCE ENGINE** (build-new, highest leverage) |
| 2 | **No buyer propensity intelligence.** Lead *scoring* exists but deposit/close/churn/financing *probability* is entirely absent; recovery cadences ignore the score. | lead scoring `lib/services/crm/lead-action-scoring.service.ts`; probability models [ABSENT]; cadence is time-keyed not score-keyed | **BUYER INTELLIGENCE ENGINE** (expand existing scoring) |
| 3 | **Value math is not actually computed.** `totalCostCents` (all-in cost) is a declared-but-dead field; ranking is cash-OTD-centric with junk-fees mis-counted; only 3 of 6 offer labels exist. | `lib/services/offer/best-price.service.ts:14` (dead field), `:48-49` (raw fee sum), two divergent ranking impls | **OFFER INTELLIGENCE ENGINE** (reengineer existing ranker) |
| 4 | **Communications run on 4 uncoordinated planes** with consent logic triplicated and no cross-channel dedup or push channel. | Make spine `emit.ts`, Inngest `functions.ts`, QStash `notify.ts`, in-app `notification.service.ts`; consent at `functions.ts:289`+`notify.ts:109`+`crm-sms.ts` | **COMMUNICATION ORCHESTRATION** (consolidate) |

**Highest-ROI moves (leverage ÷ effort):** (1) Auction Health + auto-recovery loop — re-uses `inviteDealersToAuction`; (2) populate `totalCostCents` + unify the two rankers; (3) score-driven deposit-recovery cadence on a single plane (the F-037 `deposit_pending` emit, shipped, unblocks this); (4) a compliance-health and automation-success dashboard (both data layers already exist, no UI).

**Operating-model verdict: Enterprise, trending Fortune-500.** The reliability floor was the prior audit's focus and is largely fixed (reconciler, payout integrity, DLQ drainer, compliance). The *intelligence and self-management* ceiling is this audit's focus and is the remaining distance.

---

## 2. CURRENT-STATE OPERATING MODEL ASSESSMENT

| Dimension | Current | Evidence | Verdict |
|---|---|---|---|
| Automation ratio (happy path) | High — deposit→auction→invite→offer→rank→select→fee is automated | `webhooks/stripe/route.ts:81-127`, `auction.service.ts:25`, `best-price.service.ts:29` | Enterprise |
| Exception-only admin | Mostly — but dealer approval + (pre-fix) affiliate settlement were required steps | `admin/dealers/applications/[appId]/approve`; **[SHIPPED F-011/F-010/F-002/3]** | Enterprise (post-merge) |
| Self-healing / autonomy | **Low** — no auction recovery, no propensity-driven orchestration | §10, §6 | Mid-market |
| Reliability-as-felt | Strong post-remediation (reconciler, DLQ drainer) | **[SHIPPED F-001/F-035]** | Enterprise |
| Intelligence | Partial — scoring yes, probability no, ranking shallow | §6, §11 | Mid-market |
| Compliance-as-design | FCRA/audit/lender pass; TCPA/FTC hardened | **[SHIPPED F-005/6/13/14/15]** | Enterprise |
| Executive visibility | Broad, Prisma-live, no hardcoded KPIs; gaps in compliance + automation UI | §15 | Enterprise |

---

## 3. BUYER → DEALER → ADMIN → AFFILIATE WORKFLOW ASSESSMENT

| Actor | Strength (KEEP) | Primary gap | Recommendation |
|---|---|---|---|
| **Buyer** | State-derived journey (`buyer/journey-status/route.ts:18-87`); concierge (Zura); Contract Shield; refundable $99 | No propensity intelligence; recovery cadence not score-driven; early-accept (**[SHIPPED F-007]**) | EXPAND intelligence, AUTOMATE cadence |
| **Dealer** | Real scorecard (win/response/completion rates); serializable offer txn (`offer.service.ts:85`); claim-token onboarding | Score under-influences matching; no vehicle-type match; recruitment midpoint (**[SHIPPED F-010/F-011]**) | IMPROVE matching, AUTOMATE recruitment |
| **Admin** | Prisma-live ops-dashboard + 9 reports; journey overrides; DLQ console | Compliance-health + automation-success have no UI; manual auction recovery | AUTOMATE exception detection, EXPAND dashboards |
| **Affiliate** | Attribution + 3-level tree + dashboard (real data); commission now actual-fee-based + single payout rail (**[SHIPPED F-004/F-002/3]**) | Cookie-only attribution edge; W-9 not gated pre-accrual; Connect payout deferred (F-049) | IMPROVE attribution, EXPAND payout automation |

---

## 4. BUYER DEPOSIT LIFECYCLE — ASSESSMENT & IMPROVEMENT PLAN

**Critical rule validated:** *No auction begins before the $99 deposit is paid.* — **PASS.**
- Auction is created/launched and dealers invited **only** from the Stripe `payment_intent.succeeded` (deposit) handler: `app/api/webhooks/stripe/route.ts:81-127` → `launchAuction` (`auction.service.ts:25`) + `inviteDealersToAuction` (`:124`). No invite path fires pre-payment. Deposit gated on valid prequal + ≥1 shortlist item: `app/api/buyer/deposit/create-intent/route.ts:14-31`.
- **No "stuck after payment" path:** auction upserted idempotently (`webhooks/stripe/route.ts:98-110`); and post-close is now reconciled **[SHIPPED F-001]** so a paid buyer can't be stranded if the close cron misses.

| Stage | State | Maturity | Rec | Evidence |
|---|---|---|---|---|
| Request→validate→deposit gate | Exists | Advanced | KEEP | `create-intent/route.ts:14-31` |
| $99 PI (amount hardcoded server-side; daily idempotency key) | Exists | Advanced | KEEP | `create-intent/route.ts:100-108`, `deposit.service.ts` |
| Auto-launch + auto-invite on paid | Exists | Advanced | KEEP | `webhooks/stripe/route.ts:120-127` |
| Buyer confirmation + countdown | Exists | Intermediate | KEEP | `:114-116`, QStash `auction-active` `:164` |
| **Capture vs hold** ($99 auto-captured, not authorized) | Exists | Intermediate | REENGINEER (deferred F-008) | no `capture_method:"manual"` anywhere → every no-win is a real refund |

**Improvement:** evaluate authorization-hold semantics (F-008) so no-offer auctions release rather than refund — lower fees + lower refund-failure surface.

---

## 5. DEPOSIT RECOVERY — ASSESSMENT & IMPROVEMENT PLAN

**Current reality (live path):** QStash `deposit-reminder` chain at **24h → 48h → 96h, email + SMS only**, self-stopping once paid (`app/api/jobs/deposit-reminder/route.ts:26,46-69`; first touch dispatched at 86 400 s in `create-intent/route.ts:138`). A `deposit_reminder` prebuilt workflow (1h/24h/72h) exists but was **dead** because its `deposit_pending` trigger was never emitted (`lib/services/workflow.prebuilt.ts:114-130`) — **[SHIPPED F-037]** now emits it.

| Target cadence | Exists today | Gap | Rec |
|---|---|---|---|
| 15 min (email/SMS/push/in-app) | No (first touch at 24h) | sub-24h touch + push | AUTOMATE / EXPAND |
| 2 h (AI concierge / trust) | No | Zura outreach absent in jobs | EXPAND |
| 24 h | Yes (email+SMS) | — | KEEP |
| 72 h | Partial (96h) | retune | IMPROVE |
| 7 day nurture | Partial (CRM nurture exists) | wire to deposit segment | CONSOLIDATE |
| Push channel | **[ABSENT]** (no web-push/FCM/VAPID anywhere) | build push | EXPAND |
| AI-concierge recovery | **[ABSENT]** | personalize via Zura | EXPAND |

**Plan (consolidate to ONE engine):** make `deposit_pending` (now emitted) the single trigger; collapse the three overlapping mechanisms (QStash job, prebuilt workflow, nudge cron `nudge.service.ts:61`) into one cadence; add a sub-2h touch, a push channel, and a Zura-personalized 2h message; branch speed/channel on lead temperature (§6).

---

## 6. BUYER INTELLIGENCE — ASSESSMENT & IMPROVEMENT PLAN

| Capability | State | Maturity | Rec | Evidence |
|---|---|---|---|---|
| Cumulative lead/engagement scoring (idempotent, never-downgrade, HOT→task@85) | Exists | Intermediate | KEEP + IMPROVE | `lib/crm/scoring-actions.ts:27-69`, `lead-action-scoring.service.ts:104-228` |
| Event→score wiring on spine | Exists | Intermediate | KEEP | `lib/events/emit.ts:19-28,160-172` |
| Deposit / close / financing **probability** | **[ABSENT]** | — | EXPAND (build) | grep: only a hardcoded "~40%" UI string `dealer-dashboard.service.ts:153` |
| Buyer **churn / intent risk** | **[ABSENT]** (deal-side risk exists post-deal) | Basic | EXPAND | `deal-risk.service.ts:75-78` (post-deal only) |
| Score → comms frequency/escalation | **Partial** (opens 1 CRM task only) | Basic | REENGINEER | `lead-action-scoring.service.ts:223` |
| Score time-decay | **[ABSENT]** (additive only) | — | IMPROVE | `scoring-actions.ts:5-11` |
| Profile completeness | Exists | Basic | KEEP | `profile-completeness.service.ts:5-28` |

**Plan:** (a) add a rules-then-ML propensity layer (deposit-probability, close-probability, churn-risk) off existing signals (lead_score, completeness, stage dwell-time, prequal tier); (b) externalize scoring weights + add recency decay; (c) make propensity drive cadence speed, channel, and escalation (the single biggest concierge-intelligence lift).

---

## 7. BUYER JOURNEY — ASSESSMENT & IMPROVEMENT PLAN

KEEP the state-derived model (`buyer/journey-status/route.ts:18-87`) and the forward-only lifecycle spine (`lib/events/lifecycle-advance.ts:18-98`) — these are genuinely good. **Gap:** the journey is *displayed* from state but nothing *proactively orchestrates* per-stage outreach except the nudge cron. 

| Stage | Automation today | Enhancement |
|---|---|---|
| Lead→Registration | LP capture + exit-intent/abandonment (Inngest, 1h/24h/72h, email-only) `functions.ts:923-1134` | add SMS/push tiers |
| Onboarding | minimal `buyer-onboarding.service.ts:6-25` | smart-default prefill from prequal |
| Vehicle request→Deposit | gated + recovery (§5) | propensity-driven cadence |
| Auction (48h) | live status; **no opaque-wait fix needed** — buyer sees countdown/offer count | add Zura check-in at midpoint |
| Offer→Accept | ranked panel; early-accept guarded **[SHIPPED F-007]** | add "best for you" personalization (§11) |
| Financing→Delivery | admin-assisted | AUTOMATE doc collection + status |
| Post-sale→Referral | review request + affiliate | AUTOMATE referral prompt at delivery |

**Action:** add a thin **Journey Orchestrator** that subscribes to stage-changed events and schedules the right next touch per stage/propensity — reusing the existing emit spine, not a new engine.

---

## 8. DEALER INTELLIGENCE — ASSESSMENT & IMPROVEMENT PLAN

| Metric | State | Evidence |
|---|---|---|
| Response rate, win rate, completion rate | Exists (real computations) | `dealer` scorecard service + `cron/dealer-scorecard-snapshot` |
| Avg response hours | **Hardcoded `8`** (not computed) | dealer dashboard service `:51` |
| Junk-fee ratio | **Dead** (`junkFeeRatio(0, offers)` passes literal 0) | dealer dashboard service `:44` |
| Satisfaction / reputation / offer-quality | **[ABSENT]** | — |
| Score → invitation priority | Partial (tier + winRate + junkFee + load feed `scoreDealerForAuction`) | `dealer-invitation.service.ts:31-60` |
| Score → vehicle-type / make match | **[ABSENT]** (`scoreDealerForAuction(d.id, [])`) | `:97`; `DealerCapacityConfig.preferredMakes` unused `auction-capacity.service.ts:19` |

**Plan:** IMPROVE — compute `avgResponseHours` for real; wire real junk-fee ratio; add a satisfaction signal (post-deal buyer rating) and an offer-quality score; feed **vehicle make/type + capacity config** into `scoreDealerForAuction` so dealers are matched to what they actually sell. This directly lifts offer rate and dealer participation.

---

## 9. DEALER RECRUITMENT — ASSESSMENT & IMPROVEMENT PLAN

The discovery→enrichment→script→outreach→followup funnel is **genuinely automated** (Gemini+Maps discovery, Groq enrichment/scripts, idempotent followup cadence, suppression+rate-limits). The historical break — **no prospect→dealer conversion** and **per-application manual approval** — is now closed by shipped work:
- **[SHIPPED F-010]** tokenized one-click `prospect→application` claim (`/api/dealer/prospect-claim`) embedded in outreach.
- **[SHIPPED F-011]** auto-approval eligibility rule + application annotation; hands-off approval unlocks once Maps-verified prospects flow through (F-010) + captcha (F-022).

**Remaining:** EXPAND — inbound-reply auto-detection (currently manual `webhooks/resend/route.ts:140-145`), a captcha on the public form (F-022), and enabling rules-based auto-approve behind the flag once verification is wired.

---

## 10. AUCTION INTELLIGENCE — ASSESSMENT & IMPROVEMENT PLAN

**This is the single largest build-new opportunity.** Today the auction is fully reactive.

| Capability | State | Rec | Evidence |
|---|---|---|---|
| Lifecycle + close + post-close reconciler | Exists | KEEP | `auction.service.ts:15-248`; **[SHIPPED F-001]** |
| Geo matching | Exists, **fixed 150mi**; dealers w/o coords bypass filter | REENGINEER | `dealer-invitation.service.ts:13,88` |
| Capacity throttle | Exists | KEEP | `auction-capacity.service.ts:4-25` |
| **Weak-auction detection** | **[ABSENT]** | EXPAND | no health logic in `lib/services/auction/*` |
| **Auto radius expansion** | **[ABSENT]** | EXPAND | radius is a const |
| **Auto re-invite mid-auction** | **[ABSENT]** | EXPAND | `inviteDealersToAuction` is one-shot `webhooks/stripe/route.ts:124` |
| **Auto-extend weak auction** | **[ABSENT]** (manual only) | EXPAND | `admin/.../action/route.ts:43` |
| **Auto-escalate to admin** | **[ABSENT]** | EXPAND | only zero-offer refund-fail alert |
| `auction-extension.service.ts` + `AuctionExtensionLog` | **DEAD CODE** (admin reimplements inline, never writes log) | REPLACE/CONSOLIDATE | `auction-extension.service.ts:5-15` (0 callers) |

**Plan — Auction Health Monitor cron** (re-uses existing primitives): every N min, score live auctions on offer count + invitation `respondedAt` rate (`schema.prisma:475`); when at-risk → (a) widen radius tier, (b) re-invoke `inviteDealersToAuction` with the next dealer cohort, (c) auto-extend via the (revived) extension service writing `AuctionExtensionLog`, (d) `SYSTEM_ALERT` to admin if still thin at T-minus. Drives marketplace liquidity — the core network-effect metric.

---

## 11. OFFER INTELLIGENCE — ASSESSMENT & IMPROVEMENT PLAN

| Capability | State | Rec | Evidence |
|---|---|---|---|
| Submission/validation/revision | Exists | KEEP | `offer.service.ts:85-337` |
| Ranking dimensions (Cash/Monthly/Junk) | Exists | IMPROVE | `best-price.service.ts:29-90` |
| **`totalCostCents` (all-in cost)** | **DEAD FIELD** (declared, never assigned) | REENGINEER | `best-price.service.ts:14` |
| Junk-fee → ranking | Mis-counted (sums all fee items; buyer API fabricates `feesCents*0.3`) | REENGINEER | `:48-49`, `best-price/route.ts:84` |
| Two parallel rankers (service vs API) | Divergent | CONSOLIDATE | `best-price.service.ts:29` vs `best-price/route.ts:38-141` |
| Labels: Best Cash / Best Overall / Best Monthly + "Recommended" | Exists | KEEP | `OfferComparisonPanel.tsx:21,154-160` |
| Best Value / Best Financing / Fastest Delivery / true Lowest-Cost | **[ABSENT]** | EXPAND | delivery/warranty not on `Offer` `schema.prisma:483-522` |

**Plan:** populate `totalCostCents` (OTD + financing interest − credits) and rank on it; feed real `detectJunkFees` into ranking; unify on one ranker; enrich the `Offer` model (delivery time, warranty, financing-quality, reputation) to make the missing labels real. Turns a 3-label cash comparison into a true decision engine — the headline buyer value-prop.

---

## 12. AFFILIATE AUTOMATION — ASSESSMENT & IMPROVEMENT PLAN

Mostly addressed by shipped work: **[SHIPPED F-004]** commission = actual fee × rate (+ persisted `basisCents`); **[SHIPPED F-002/3]** one settlement rail (`mark-paid` records a real `AffiliatePayout(PAID)` + `Commission.payoutId`), self-serve `requestPayout` disabled.

| Capability | State | Rec |
|---|---|---|
| Referral capture + 3-level tree + attribution | Exists | KEEP |
| Commission accrual (close-trigger) | Fee-payment-triggered | IMPROVE (gate on `purchase_completed`; auto-reverse on cancel — F-016) |
| Cookie-only attribution edge | Partial loss if code misses signup form | IMPROVE (server-read cookie fallback — F-017) |
| W-9 / FTC gate before accrual | Only gates payout, not accrual | IMPROVE (F-018) |
| Fraud detection | Basic (self-referral block) | EXPAND |
| Payout processor (Connect/ACH) | **[ABSENT]** | EXPAND (F-049, post-launch) |

---

## 13. COMMUNICATION ORCHESTRATION — ASSESSMENT & IMPROVEMENT PLAN

**Four uncoordinated planes:** Make domain-event spine (`emit.ts`), Inngest send fns (`functions.ts`), QStash `notify.ts`, in-app `notification.service.ts` — plus the legacy WorkflowEngine.

| Concern | State | Rec | Evidence |
|---|---|---|---|
| Channels: email / SMS / in-app | Exists | KEEP | Resend / Twilio / `Notification` table |
| Push channel | **[ABSENT]** | EXPAND | no web-push/FCM/VAPID |
| AI-concierge (Zura) as a channel | Inbound only | EXPAND | no outbound Zura in jobs |
| Consent/suppression centralization | **Triplicated** | CONSOLIDATE | `functions.ts:289`, `notify.ts:109`, `crm-sms.ts` (dead `SmsOptOut` read removed **[SHIPPED F-014/15]**) |
| Cross-plane dedup / single owner | **[ABSENT]** — same event can double-send or silently drop | CONSOLIDATE | deposit_paid → QStash + Make (F-012, G1-blocked) |

**Plan:** declare one authoritative plane per notification class behind a kill-switch (F-012 — gated on confirming Make consumption); centralize consent into one module all planes import; add push + outbound-Zura as channels under the same orchestrator. Prevents duplicate messaging (TCPA/CAN-SPAM) and silent gaps.

---

## 14. ADMIN EXCEPTION MANAGEMENT — ASSESSMENT & IMPROVEMENT PLAN

The founder is **not** a required step in a normal buyer transaction (journey is state-derived; auction auto-launches). Residual required-or-manual touchpoints and their disposition:

| Touchpoint | Necessary? | Action | Owner service / trigger |
|---|---|---|---|
| Dealer application approval | Was required | **[SHIPPED F-010/F-011]** → annotate + (flag) auto-approve verified | auto-approval rule + prospect claim |
| Affiliate settlement | Was required/broken | **[SHIPPED F-002/3]** → single rail | mark-paid |
| Weak-auction rescue | Manual | AUTOMATE (§10) | Auction Health cron |
| DLQ retry | Was manual | **[SHIPPED F-035]** → auto-drain | `cron/dlq-drain` |
| Financing/insurance coordination | Assisted | AUTOMATE doc collection | deal service |
| Prequal MANUAL_REVIEW / OFAC | Exception (correct) | KEEP | compliance queue |

**Target:** admin handles escalations, compliance, fraud, disputes, overrides only — reachable by closing §10 + financing automation.

---

## 15. EXECUTIVE INTELLIGENCE — ASSESSMENT & IMPROVEMENT PLAN

Reporting is **production-grade and Prisma-live (no hardcoded KPIs)**: funnel, deposit conversion, dealer performance, revenue (Stripe-backed), affiliate, deal-risk tiers, stage-weighted pipeline forecast, ops-dashboard (12 metrics), AMIPS executive-intelligence (national health index, metro opportunity scores).

| Leadership view | State | Rec | Evidence |
|---|---|---|---|
| Buyer funnel / deposit conversion | Production | KEEP | `app/admin/reports/funnel/page.tsx`, `reports/buyers/page.tsx` |
| Revenue (deposits/fees/refunds/net) | Production | KEEP | `reports/revenue/page.tsx:28-48` |
| Dealer performance | Production | KEEP | `reports/dealers/page.tsx:23-43` |
| Pipeline forecast (stage-weighted) | Production | KEEP | `reports/pipeline/page.tsx:13-48` |
| Deal-risk intelligence | Production | KEEP | `reports/risk/page.tsx:42-70` |
| AMIPS market/executive intelligence | Production | KEEP | `lib/amips/intelligence/executive-intelligence.ts` |
| **Automation success/health** | Data layer built, **no UI** | EXPAND | `analytics.service.ts:327-409` |
| **Compliance health (aggregate)** | **[ABSENT]** (per-record only) | EXPAND | no `reports/compliance` |
| **Auction performance (per-dealer/velocity)** | **Basic** (counts only) | EXPAND | `ops-dashboard/page.tsx:34` |
| Real-time vs snapshot | Reports live; only `mv_funnel_metrics` precomputed (externally refreshed) | IMPROVE | `analytics.service.ts:254` |

**Plan:** ship the two "data-layer-exists, no-UI" dashboards (automation success, compliance health) — fast wins; add auction-performance analytics; add a scheduled refresh for `mv_funnel_metrics` (no in-repo refresher today).

---

## 16. AUTOMATION GAP ANALYSIS (ranked by leverage ÷ effort)

| Rank | Gap | Current | Target | Effort |
|---|---|---|---|---|
| 1 | Auction Health + auto-recovery | reactive | self-healing (radius/re-invite/extend/escalate) | M–L |
| 2 | All-in `totalCostCents` + unified ranker | dead field, cash-centric | true value engine | M |
| 3 | Score-driven deposit recovery on one plane | time-keyed, 3 systems | propensity-keyed, 1 cadence | M (F-037 unblocks) |
| 4 | Buyer propensity models | absent | deposit/close/churn probability | M–L |
| 5 | Automation-success + compliance-health dashboards | data-only | UI | S |
| 6 | Comms consolidation + push + outbound-Zura | 4 planes, no push | 1 orchestrator, +2 channels | M |
| 7 | Dealer match on vehicle-type/capacity | ignored | wired | S–M |
| 8 | Inbound-reply auto-detect (recruitment) | manual | automated | M |

---

## 17. FORTUNE 500 READINESS ASSESSMENT

| Area | Grade |
|---|---|
| Buyer experience | Enterprise (→F500 with propensity + value engine) |
| Dealer experience | Mid-market→Enterprise (matching depth) |
| Affiliate | Enterprise (post-shipped fixes; Connect payout pending) |
| Admin/ops | Enterprise |
| Reliability | Enterprise (post-remediation) |
| Compliance | Enterprise |
| **Marketplace autonomy** | **Mid-market** (the gating dimension) |
| Executive intelligence | Enterprise |

**Overall: Enterprise, trending Fortune-500** — gated by marketplace autonomy (§10) and buyer/offer intelligence (§6/§11).

---

## 18. AUTONOMOUS MARKETPLACE READINESS ASSESSMENT

Autonomy target = "buyers guided, dealers sourced/recruited/engaged, auctions managed, offers ranked, affiliates tracked, comms orchestrated, recovery automated, compliance enforced — admin handles exceptions only."

| Pillar | Autonomous today? |
|---|---|
| Buyers auto-guided | Partial (journey derived; orchestration manualish) |
| Dealers auto-sourced/recruited | **Yes** (discovery→claim, shipped) |
| Dealers auto-engaged | Partial (followup yes; reply-detect manual) |
| Auctions auto-managed | **No** (no recovery) ← biggest gap |
| Offers auto-ranked | Yes (but shallow value math) |
| Affiliates auto-tracked | Yes |
| Comms auto-orchestrated | Partial (4 planes) |
| Recovery automated | Partial (deposit yes; not score-driven) |
| Compliance auto-enforced | Yes |

**Closing §10 (auction autonomy) + §13 (comms orchestration) + §6 (propensity) moves this from "automated" to "self-managing."**

---

## 19. REQUIRED DATABASE IMPROVEMENTS
- `Offer`: add delivery-time, warranty, financing-quality, reputation-snapshot (enables §11 labels). `schema.prisma:483-522`.
- Buyer propensity columns or a `BuyerIntelligence` table (deposit/close/churn scores + computedAt). §6.
- Revive/use `AuctionExtensionLog` (orphaned, `schema.prisma:2443`); add auction-health snapshot fields. §10.
- `PushSubscription` table for the new push channel. §5/§13.
- Keep the shipped additive columns (`postCloseProcessedAt`, `basisCents`, `payoutId`, `auto_retry_count`, prospect `claim_token`).

## 20. REQUIRED EVENT ARCHITECTURE IMPROVEMENTS
- One authoritative plane per notification class + centralized consent (F-012/F-040). §13.
- Emit the now-wired `deposit_pending` everywhere recovery should trigger (F-037 shipped); audit for other declared-but-unemitted events.
- Add `auction_at_risk` / `auction_recovered` domain events for §10.
- Idempotency-keyed reconcilers on every critical background job (pattern from F-001) extended to commission accrual + comms.

## 21. REQUIRED API IMPROVEMENTS
- Consolidate the two offer-ranking endpoints into one service-backed route (§11).
- Add captcha/rate-limit to `public/dealer-application` (F-022) and the prospect-claim form UI (F-010 follow-up).
- Auction-health admin endpoints (manual override of the new automation).

## 22. REQUIRED WORKFLOW IMPROVEMENTS
- Single deposit-recovery cadence (§5); Journey Orchestrator for per-stage outreach (§7); auto-reverse commission on deal cancel (F-016).

## 23. REQUIRED AUTOMATION IMPROVEMENTS
- Auction Health Monitor (§10); propensity-driven cadence (§6); inbound-reply auto-detect (§9); enable rules-based dealer auto-approve once verification wired (§9).

## 24. REQUIRED DASHBOARD IMPROVEMENTS
- Ship automation-success + compliance-health UIs (data exists); per-dealer auction performance; scheduled `mv_funnel_metrics` refresh (§15).

## 25. PHASE 1 — STABILIZATION ROADMAP (mostly shipped)
Merge the 11 open remediation PRs (compliance Gate A first, then Gate B). Add `mv_funnel_metrics` refresh + captcha (F-022). Confirm G1 items (Twilio host, Make consumption, hold-vs-charge) to unblock F-012/F-013-enable/F-008.

## 26. PHASE 2 — AUTOMATION ROADMAP
Auction Health + auto-recovery (§10); unified value-ranking with `totalCostCents` (§11); single score-driven recovery cadence (§5/§6); comms consolidation + push + outbound-Zura (§13); ship the two dashboards (§15); dealer match-on-make (§8).

## 27. PHASE 3 — SCALE ROADMAP
Buyer propensity ML (§6); Stripe Connect affiliate payouts (F-049); adaptive geo + real geocoding (§10); converge dual auction/offer models (F-009); scale reconcilers + queue back-pressure for 10×–100× volume. Validate: discovery (cached/rate-limited) and reconcilers scale sub-linearly; the linear-headcount risks (dealer approval, affiliate settlement) are already removed by shipped work.

---

## 28. FINAL FUTURE-STATE FORTUNE 500 OPERATING MODEL

A **self-managing marketplace** on the existing foundation:
- **Buyers**: a propensity-aware concierge that personalizes cadence/channel and surfaces a true all-in "best for you" offer — anxiety-reduced money moments, no opaque waits.
- **Dealers**: matched to what they actually sell, auto-recruited via one-click claim, engaged by a self-healing auction that finds them more relevant opportunities.
- **Auctions**: self-healing — detect-thin → expand-radius → re-invite → extend → escalate, automatically.
- **Affiliates**: a correct, single-rail financial product with Connect settlement.
- **Comms**: one orchestrated plane across email/SMS/push/in-app/AI with centralized consent and zero double-sends.
- **Admin**: exception-only — escalations, compliance, fraud, disputes, overrides.
- **Leadership**: Prisma-live + market-intelligence dashboards covering funnel→revenue→automation-health→compliance.

The destination is **evolutionary, not a rebuild**: ~80% of it is automating, consolidating, and expanding systems that already exist, with build-new concentrated in the Auction Intelligence Engine and the buyer propensity layer.

---
*Evidence-tagged throughout. Distinguishes shipped remediation (F-xxx) from open gaps. Prioritizes KEEP/IMPROVE/CONSOLIDATE/AUTOMATE/EXPAND over REPLACE per the enhancement mandate.*
