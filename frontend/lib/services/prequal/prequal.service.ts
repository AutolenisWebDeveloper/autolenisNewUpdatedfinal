// lib/services/prequal/prequal.service.ts
// Buyer prequalification orchestrator.
// - OFAC gate is hard: ofacFlagged === true → MANUAL_REVIEW + admin queue,
//   internal status OFAC_REVIEW, no buyer-visible explanation.
// - maxOtdAmountCents is set ONCE on APPROVED via fallback chain
//   (recommended → max → buyer's stated budget) and is immutable thereafter.
// - Stores employment fields (AutoLenis-internal only) and the EXACT FCRA
//   consent text on PrequalConsent for legal audit.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { PreQualDecision, PreQualTier } from "@prisma/client";
import {
  callIPredict,
  FCRA_CONSENT_TEXT,
  type MicroBiltBuyerPII,
} from "./microbilt.service";
import {
  sendPrequalApprovedEmail,
  sendAdverseActionEmail,
  sendPrequalUnderReviewEmail,
  sendAdminPrequalAlertEmail,
} from "@/lib/services/email/resend.service";

const PROVIDER_ERROR_REASONS = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "OAUTH_FAILED",
  "IPREDICT_ERROR",
  "CONFIG_ERROR",
  "CONFIG_MISMATCH",
  "URL_NOT_CONFIGURED",
]);

function isProviderErrorReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return PROVIDER_ERROR_REASONS.has(reason) || reason.startsWith("HTTP_");
}

// Single source of truth for prequal approval gating across the platform.
// A prequal is "valid" only when the buyer is currently approved AND that
// approval has not expired. Any other decision state (DECLINED / PENDING /
// MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED) returns false so the buyer
// remains gated to the prequal step and can re-apply if applicable.
export function isPrequalValid(
  prequal: { decision: string; expiresAt: Date } | null,
): boolean {
  if (!prequal) return false;
  return prequal.decision === "APPROVED" && prequal.expiresAt > new Date();
}

// Buyer-safe summary — never expose raw iPredict scores or OFAC flag.
//
// Decision detail (back-end DTI + benchmark APR) is opt-in via
// `includeDecisionDetail` so an admin surface can choose to surface the math
// for transparency. It is NEVER exposed by default and never includes the raw
// credit score or OFAC flag.
export function toBuyerSafePrequal(
  prequal: {
    decision: string;
    tier: string | null;
    maxOtdAmountCents: number;
    expiresAt: Date;
    checkOfacAlert: boolean;
    backEndDtiBps?: number | null;
    benchmarkAprBps?: number | null;
  },
  options?: { includeDecisionDetail?: boolean },
) {
  return {
    approved: prequal.decision === "APPROVED",
    // OFAC paths surface as "pending manual review" — buyer never learns the cause.
    pending:
      prequal.decision === "MANUAL_REVIEW" ||
      prequal.decision === "OFAC_ESCALATED" ||
      prequal.decision === "OFAC_REVIEW",
    declined: prequal.decision === "DECLINED",
    tier: prequal.tier,
    // Immutable — no client component may modify or exceed this value.
    maxOtdAmountCents: prequal.maxOtdAmountCents,
    expiresAt: prequal.expiresAt,
    ...(options?.includeDecisionDetail
      ? {
          backEndDtiBps: prequal.backEndDtiBps ?? null,
          benchmarkAprBps: prequal.benchmarkAprBps ?? null,
        }
      : {}),
  };
}

export interface PrequalSubmission {
  // Required (Section 1)
  firstName: string;
  lastName: string;
  dateOfBirth: string; // MM/DD/YYYY
  address: string;
  city: string;
  state: string;
  zip: string;
  fcraConsent: boolean;

  // Optional (Section 2) — AutoLenis-internal only, never sent to MicroBilt.
  employmentStatus?: string;
  employerName?: string;
  monthlyIncomeCents?: number;
  lengthOfEmployment?: string;

  // Optional (Section 2.5) housing + debt — AutoLenis-internal only.
  housingStatus?: string;
  monthlyHousingPaymentCents?: number;
  monthlyOtherDebtCents?: number;

  // Audit
  ipAddress?: string;
  userAgent?: string;
}

interface BuyerForPrequal {
  id: string;
  /** Buyer's stated budget in cents — used as fallback when iPredict returns no amount. */
  maxOtdAmountCents?: number | null;
  user: { email: string };
}

// A soft-pull in-flight marker older than this is treated as abandoned (e.g. a
// crashed pull) and may be re-claimed. Comfortably above the iPredict 10s abort.
const PULL_INFLIGHT_TTL_MS = 30_000;

/**
 * Atomically claim the credit-pull slot for a buyer and capture FCRA consent
 * BEFORE the pull. Returns "claimed" if this caller may pull, or "inflight" if
 * another pull is already running (or was claimed microseconds ago).
 *
 * The @unique buyerId makes the create path a natural mutex: a concurrent
 * create throws a unique violation, which we treat as "inflight". The
 * update path is conditional on the exact updatedAt we read, so exactly one
 * racing updater wins.
 */
async function claimPrequalPull(
  buyerId: string,
  input: PrequalSubmission,
): Promise<"claimed" | "inflight"> {
  const current = await prisma.preQualification.findUnique({ where: { buyerId } });
  const now = Date.now();

  if (!current) {
    // No row yet — create the in-flight PENDING marker. A racing create hits
    // the unique constraint and throws → the loser is "inflight".
    try {
      await prisma.preQualification.create({
        data: {
          buyerId,
          decision: PreQualDecision.PENDING,
          maxOtdAmountCents: 0,
          // Placeholder; overwritten by the real decision. PENDING is never
          // `isPrequalValid`, so a crashed pull leaves a harmless marker.
          expiresAt: new Date(now),
          checkOfacAlert: false,
        },
      });
    } catch {
      return "inflight";
    }
  } else {
    const isFresh =
      current.decision === PreQualDecision.PENDING &&
      now - current.updatedAt.getTime() < PULL_INFLIGHT_TTL_MS;
    if (isFresh) return "inflight";

    // Claim conditionally on the state we read — a racing claimant matches 0.
    const res = await prisma.preQualification.updateMany({
      where: { buyerId, updatedAt: current.updatedAt },
      data: { decision: PreQualDecision.PENDING },
    });
    if (res.count === 0) return "inflight";
  }

  // Consent captured now, before the pull. Required: if this fails, we abort
  // the whole request and never reach the bureau call.
  const claimed = await prisma.preQualification.findUniqueOrThrow({
    where: { buyerId },
    select: { id: true },
  });
  await prisma.prequalConsent.create({
    data: {
      prequalId: claimed.id,
      buyerId,
      consentText: FCRA_CONSENT_TEXT,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
    },
  });
  return "claimed";
}

export async function initiatePrsequal(buyer: BuyerForPrequal, input: PrequalSubmission) {
  if (!input.fcraConsent) throw new Error("FCRA consent required");

  // Reuse only a still-valid APPROVED prequal — never re-pull MicroBilt for an
  // active approval. A DECLINED / PENDING / MANUAL_REVIEW / OFAC record (even
  // before expiresAt) is NOT treated as valid, so the buyer is allowed to
  // re-apply through this code path and we pull a fresh report.
  const existing = await prisma.preQualification.findUnique({
    where: { buyerId: buyer.id },
  });
  if (existing && isPrequalValid(existing)) {
    return { prequal: existing, mocked: false };
  }

  // ── Pre-pull claim (double-pull guard + consent-before-pull) ───────────────
  // A soft credit inquiry costs money and touches the consumer. Two concurrent
  // submissions (two tabs) previously both passed the check above and both
  // pulled. We claim a durable in-flight slot on the @unique buyerId row before
  // pulling: the loser of the race gets `inflight` and returns the current
  // record WITHOUT a second pull. The claim self-heals — a PENDING marker older
  // than the pull TTL (e.g. a crashed pull) is reclaimable. FCRA consent is
  // persisted in this same step, BEFORE the pull, so a pull can never happen
  // without a durable consent record (previously consent was written post-pull).
  const claim = await claimPrequalPull(buyer.id, input);
  if (claim === "inflight") {
    // A pull is already running for this buyer — surface the current state
    // rather than firing a duplicate inquiry.
    const latest = await prisma.preQualification.findUnique({ where: { buyerId: buyer.id } });
    if (!latest) throw new Error("Prequal in flight but no record found");
    return { prequal: latest, mocked: false, inFlight: true };
  }

  const pii: MicroBiltBuyerPII = {
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
  };

  const result = await callIPredict({
    buyer: pii,
    monthlyIncomeCents:  input.monthlyIncomeCents ?? null,
    employmentStatus:    input.employmentStatus ?? null,
    lengthOfEmployment:  input.lengthOfEmployment ?? null,
    statedBudgetCents:   buyer.maxOtdAmountCents ?? null,
    monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
    monthlyOtherDebtCents:      input.monthlyOtherDebtCents ?? null,
  });

  // ── Decision gate pipeline (applied in this exact order) ───────────────────
  // Gate 1: OFAC (hard gate — preserved). Gates 2–4 are iPredict_6.yaml risk
  // signals that route to MANUAL_REVIEW. Gate 5 is the existing income +
  // credit decision already baked into result.decision (preserved unchanged).
  let finalDecision: PreQualDecision = result.decision;

  // Gate 1: OFAC — if ofacFlagged === true, NEVER approve, regardless of code.
  // Internal status OFAC_REVIEW; admin queue item created; buyer sees pending.
  if (result.ofacFlagged === true) {
    finalDecision = PreQualDecision.OFAC_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "OFAC Alert — Manual Review Required",
          body: `Buyer prequalification flagged for OFAC review. Buyer ID: ${buyer.id}. Do NOT auto-approve.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch((err) => logger.error(`[prequal] OFAC alert notification failed for buyer ${buyer.id}:`, err));
  }
  // Gate 2: Deceased indicator → manual review.
  else if (result.deceasedFlag) {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    logger.warn(`[prequal] Deceased indicator for buyer ${buyer.id} — manual review`);
  }
  // Gate 3: MLA covered borrower → manual review (apply MLA disclosures).
  else if (result.mlaCovered === true) {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    await prisma.notification
      .create({
        data: {
          title: "MLA Covered Borrower — Manual Review Required",
          body: `Buyer ${buyer.id} is covered under the Military Lending Act. Apply MLA-compliant disclosures.`,
          type: "SYSTEM_ALERT",
        },
      })
      .catch((err) => logger.error(`[prequal] MLA notification failed for buyer ${buyer.id}:`, err));
  }
  // Gate 4: Fraud warning → manual review.
  else if (result.fraudWarning && result.fraudWarning !== "N" && result.fraudWarning !== "") {
    finalDecision = PreQualDecision.MANUAL_REVIEW;
    logger.warn(`[prequal] Fraud warning ${result.fraudWarning} for buyer ${buyer.id}`);
  }

  // ── maxOtdAmountCents assignment ───────────────────────────────────────────
  // Only set on APPROVED. callIPredict already applies the two-gate minimum
  // (income gate vs credit gate). Field is immutable once written — never allow
  // client to overwrite it.
  const maxOtdAmountCents =
    finalDecision === PreQualDecision.APPROVED ? result.maxOtdAmountCents : 0;

  const tier: PreQualTier | null = result.tier;

  // Persist the decision. Consent was already captured in claimPrequalPull()
  // BEFORE the pull, so the FCRA audit row always exists by the time we get
  // here; this transaction only writes the decision result.
  const prequal = await prisma.$transaction(async (tx) => {
    const upserted = await tx.preQualification.upsert({
      where: { buyerId: buyer.id },
      create: {
        buyerId: buyer.id,
        decision: finalDecision,
        tier,
        maxOtdAmountCents,
        checkOfacAlert: result.ofacFlagged === true,
        expiresAt: result.expiresAt,
        rawResponse: result.rawResponse,
        employmentStatus: input.employmentStatus ?? null,
        employerName: input.employerName ?? null,
        monthlyIncomeCents: input.monthlyIncomeCents ?? null,
        lengthOfEmployment: input.lengthOfEmployment ?? null,
        housingStatus: input.housingStatus ?? null,
        monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
        monthlyOtherDebtCents: input.monthlyOtherDebtCents ?? null,
        frontEndDtiBps: result.frontEndDtiBps ?? null,
        backEndDtiBps: result.backEndDtiBps ?? null,
        benchmarkAprBps: result.benchmarkAprBps ?? null,
        effectiveIncomeCents: result.effectiveIncomeCents ?? null,
        // iPredict_6.yaml spec fields
        creditScore: result.creditScore ?? null,
        idvScore: result.idvScore ?? null,
        mlaCovered: result.mlaCovered ?? false,
        fraudWarning: result.fraudWarning ?? null,
        adverseReasonCodes: result.adverseReasonCodes ?? [],
        deceasedFlag: result.deceasedFlag ?? false,
        bankruptcyFlag: result.bankruptcyFlag ?? false,
      },
      update: {
        decision: finalDecision,
        tier,
        // Re-pulls only ever overwrite the existing maxOtdAmountCents when a
        // new decision arrives; the buyer-facing API never accepts this value.
        maxOtdAmountCents,
        checkOfacAlert: result.ofacFlagged === true,
        expiresAt: result.expiresAt,
        rawResponse: result.rawResponse,
        employmentStatus: input.employmentStatus ?? null,
        employerName: input.employerName ?? null,
        monthlyIncomeCents: input.monthlyIncomeCents ?? null,
        lengthOfEmployment: input.lengthOfEmployment ?? null,
        housingStatus: input.housingStatus ?? null,
        monthlyHousingPaymentCents: input.monthlyHousingPaymentCents ?? null,
        monthlyOtherDebtCents: input.monthlyOtherDebtCents ?? null,
        frontEndDtiBps: result.frontEndDtiBps ?? null,
        backEndDtiBps: result.backEndDtiBps ?? null,
        benchmarkAprBps: result.benchmarkAprBps ?? null,
        effectiveIncomeCents: result.effectiveIncomeCents ?? null,
        // iPredict_6.yaml spec fields
        creditScore: result.creditScore ?? null,
        idvScore: result.idvScore ?? null,
        mlaCovered: result.mlaCovered ?? false,
        fraudWarning: result.fraudWarning ?? null,
        adverseReasonCodes: result.adverseReasonCodes ?? [],
        deceasedFlag: result.deceasedFlag ?? false,
        bankruptcyFlag: result.bankruptcyFlag ?? false,
      },
    });

    return upserted;
  });

  // CRM contact-plane sync (additive, non-blocking) — append AFTER the prequal
  // record is committed so a CRM hiccup can never affect the prequal flow. This
  // is STARTED-ONLY and FCRA-neutral by construction: it forwards ONLY the
  // buyer's existing contact identity (email/phone/name the contact already
  // holds) plus a neutral stage marker. It MUST NEVER carry the iPredict score,
  // the decision/eligibility result, adverse-action content, or any PII beyond
  // the contact identity — hence `data: {}`. Do not add decision/score fields.
  try {
    const crmBuyer = await prisma.buyer.findUnique({
      where: { id: buyer.id },
      include: { user: true },
    });
    const email = crmBuyer?.user.email ?? null;
    if (crmBuyer && email) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      const { ContactService } = await import("@/lib/services/contact.service");
      const { emitDomainEvent } = await import("@/lib/events/emit");
      const supabase = getServiceSupabase();

      const contact = await ContactService.upsertContact(supabase, {
        email,
        phone: crmBuyer.phone ?? null,
        firstName: crmBuyer.firstName ?? undefined,
        lastName: crmBuyer.lastName ?? undefined,
        source: "prequal",
      });
      await ContactService.linkContactIdentity(supabase, contact.id, "buyer", crmBuyer.id);

      await emitDomainEvent("prequal_started", {
        domainEntityId: prequal.id,
        supabase,
        contact: {
          email,
          phone: crmBuyer.phone ?? null,
          firstName: crmBuyer.firstName ?? undefined,
          lastName: crmBuyer.lastName ?? undefined,
          source: "prequal",
        },
        // Intentionally EMPTY — no score, no decision, no FCRA-protected data.
        data: {},
      });
    }
  } catch (err) {
    logger.error("[prequal] CRM prequal_started emit failed:", err);
  }

  // Send congratulations email and log compliance event for APPROVED decisions.
  // Email failure must never block the approval — catch and log only.
  if (finalDecision === PreQualDecision.APPROVED) {
    const decisionDate = new Date();
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      await sendPrequalApprovedEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        maxOtdAmountCents: result.maxOtdAmountCents,
        tier: result.tier,
        decisionDate,
        expiryDate,
      });
    } catch (emailErr) {
      logger.error("[prequal] Failed to send approval email:", emailErr);
    }

    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_APPROVAL_NOTICE_SENT",
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: decisionDate.toISOString(),
            maxOtdAmountCents: result.maxOtdAmountCents,
            tier: result.tier,
            expiresAt: expiryDate.toISOString(),
          },
        },
      });
    } catch (logErr) {
      logger.error("[prequal] Failed to log compliance event:", logErr);
    }
  }

  // FCRA § 615: Send adverse action notice on DECLINED decisions.
  // Required by law whenever a consumer report contributed to the denial.
  // Email failure must never block the response — catch and log only.
  //
  // The compliance event must reflect TRUE send status. A duplicate-suppressed
  // send (sent === false) is logged as ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE
  // so the audit trail is honest. A thrown error logs no "SENT" event.
  if (finalDecision === PreQualDecision.DECLINED) {
    const decisionDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    // Branch on the discriminated `outcome` — `sent === false` alone is
    // ambiguous (DUPLICATE / FAILED / DEV_SKIPPED). Mislabeling a Resend
    // outage as SUPPRESSED_DUPLICATE would leave a false FCRA § 615 audit
    // trail.
    let outcome: "SENT" | "DUPLICATE" | "FAILED" | "DEV_SKIPPED" | "THREW" = "THREW";
    let adverseActionErrorMessage: string | null = null;
    try {
      const result = await sendAdverseActionEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        decisionDate,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
        adverseReasonCodes: prequal.adverseReasonCodes,
      });
      outcome = result.outcome;
    } catch (emailErr) {
      logger.error("[prequal] Failed to send adverse action email:", emailErr);
      adverseActionErrorMessage =
        emailErr instanceof Error ? emailErr.message : String(emailErr);
    }

    try {
      const eventType =
        outcome === "SENT"
          ? "ADVERSE_ACTION_NOTICE_SENT"
          : outcome === "DUPLICATE"
            ? "ADVERSE_ACTION_NOTICE_SUPPRESSED_DUPLICATE"
            : "ADVERSE_ACTION_NOTICE_SEND_FAILED";
      await prisma.complianceEvent.create({
        data: {
          eventType,
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decisionTimestamp: prequal.updatedAt.toISOString(),
            sendOutcome: outcome,
            ...(adverseActionErrorMessage
              ? { errorMessage: adverseActionErrorMessage }
              : {}),
          },
        },
      });
    } catch (logErr) {
      logger.error("[prequal] Failed to log adverse action compliance event:", logErr);
    }
  }

  // OFAC-silent buyer notice + ops alert when the decision needs manual
  // attention (MANUAL_REVIEW / OFAC_REVIEW / OFAC_ESCALATED).
  const needsReview =
    finalDecision === PreQualDecision.MANUAL_REVIEW ||
    finalDecision === PreQualDecision.OFAC_REVIEW ||
    finalDecision === PreQualDecision.OFAC_ESCALATED;

  if (needsReview) {
    try {
      await sendPrequalUnderReviewEmail({
        to: buyer.user.email,
        firstName: input.firstName,
        prequalApplicationId: prequal.id,
        decisionTimestamp: prequal.updatedAt.toISOString(),
      });
    } catch (emailErr) {
      logger.error("[prequal] Failed to send under-review email:", emailErr);
    }
    try {
      await prisma.complianceEvent.create({
        data: {
          eventType: "PREQUAL_UNDER_REVIEW_NOTICE_SENT",
          buyerId: buyer.id,
          prequalApplicationId: prequal.id,
          metadata: {
            sentTo: buyer.user.email,
            sentAt: new Date().toISOString(),
            decision: finalDecision,
          },
        },
      });
    } catch (logErr) {
      logger.error("[prequal] Failed to log under-review compliance event:", logErr);
    }
  }

  // Admin ops alert: needs-review OR upstream provider error. Failure to send
  // must never block the buyer response.
  const isProviderError = isProviderErrorReason(result.reason);
  if (needsReview || isProviderError) {
    try {
      await sendAdminPrequalAlertEmail({
        kind: isProviderError ? "PROVIDER_ERROR" : "REVIEW",
        buyerId: buyer.id,
        buyerEmail: buyer.user.email,
        decision: finalDecision,
        providerReason: result.reason,
        prequalApplicationId: prequal.id,
      });
    } catch (emailErr) {
      logger.error("[prequal] Failed to send admin alert email:", emailErr);
    }
  }

  return { prequal, mocked: result.mocked };
}
