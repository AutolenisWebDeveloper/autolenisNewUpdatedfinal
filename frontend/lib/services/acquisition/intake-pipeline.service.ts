// lib/services/acquisition/intake-pipeline.service.ts
//
// The durable intake background pipeline.
//
// This is the sequence that used to run in two racing `after()` blocks (one in
// unified-buyer-intake, one in the API routes). It is driven off
// `buyerOpportunityId` ALONE and is Inngest-free: the authoritative executor is
// the intake-reconcile cron via `processBuyerOpportunityIntake`
// (intake-processor.service.ts), which owns the claim + completion marker. Every
// stage reconstructs what it needs from the persisted BuyerOpportunity row and is
// idempotent/resumable, so a re-drive (or a run resumed after a mid-flight kill)
// never re-enriches, re-scores, re-alerts, or double-contacts a dealer.

import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enrichMarketData, discoverDealers } from "./compound-search.service";
import { scoreLeadFromConversation } from "./scoring.service";
import { draftAndSaveScript } from "../dealer-recruitment/phone-script-drafter.service";
import {
  notifyFounderHotLead,
  sendHotLeadBuyerSms,
  type HotLeadData,
} from "./twilio.service";
import {
  sendBuyerOpportunityConfirmationEmail,
  sendFounderHotLeadAlertEmail,
} from "@/lib/services/email/resend.service";
import { sendDealersContactedEmail } from "@/lib/services/email/buyer-notifications.service";
import { runPostIntakeOutreach } from "./post-intake-outreach.service";
import { enrichProspectEmailsForOpportunity } from "../dealer-recruitment/prospect-email-enrichment.service";
import { applyRequestCoverageGate } from "./request-coverage-gate.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

// ── Structured per-stage outcomes (Batch 2 — trustworthy completion) ──────────
//
// Every stage reports one of:
//   SUCCESS      — ran, did its work.
//   ZERO_RESULTS — ran fine, nothing to act on (a VALID business result).
//   SKIPPED      — preconditions absent / already done on a prior idempotent pass.
//   DEFERRED     — a TRANSIENT throttle (channel rate limit) blocked the work; NOT
//                  a failure — retry later WITHOUT counting toward the terminal cap.
//   FAILED       — threw / timed out / DB error (an EXECUTION failure).
// The completion policy (in intake-processor) stamps intake_processed_at only when
// no REQUIRED stage FAILED and none is DEFERRED; ZERO_RESULTS and SKIPPED are valid
// terminal states.
export type StageStatus = "SUCCESS" | "ZERO_RESULTS" | "SKIPPED" | "DEFERRED" | "FAILED";

export type IntakeStageName =
  | "market_enrichment"
  | "dealer_discovery"
  | "phone_script_drafting"
  | "lead_scoring_alerts"
  | "prospect_email_enrichment"
  | "dealer_outreach"
  | "dealers_contacted_email"
  | "coverage_gate";

export interface StageOutcome {
  stage: IntakeStageName;
  status: StageStatus;
  /** Sanitized reason — set only on FAILED. */
  reason?: string;
}

// The dealer-sourcing spine. An EXECUTION failure of either of these must block
// intake completion (bounded retry). Everything else is best-effort: its failure
// is recorded but never blocks completion or stalls the intake.
export const REQUIRED_STAGES: ReadonlySet<IntakeStageName> = new Set<IntakeStageName>([
  "dealer_discovery",
  "dealer_outreach",
]);

export interface IntakePipelineResult {
  dealersContacted: number;
  stages: StageOutcome[];
  /** True iff any REQUIRED stage FAILED — the completion decision hinges on this. */
  requiredFailed: boolean;
  /**
   * True iff a REQUIRED stage was DEFERRED (transient throttle) and none FAILED.
   * The intake must NOT complete (nobody was contacted) but must NOT count toward
   * the terminal cap either — it retries when the throttle clears.
   */
  deferred: boolean;
  /** True iff dealer discovery ran fine and found zero dealers (valid completion). */
  zeroSupply: boolean;
}

// Bounded, single-line, PII-redacted stage-failure reason. Shared with the
// processor (imported there) so there is one sanitizer. Opportunity ids are cuids
// (not PII); downstream SDK errors could embed an email/phone, so redact both.
export function sanitizeIntakeMessage(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted-phone]")
    // Coarse buyer location can leak if a discovery/geocode SDK error echoes the
    // query ZIP (e.g. "no results for 90210"). Redact standalone 5-digit (ZIP or
    // ZIP+4) tokens — also neutralizes budget-shaped 5-digit amounts. Over-
    // redaction of an internal-only diagnostic is acceptable; a PII leak is not.
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "[redacted-zip]")
    .trim()
    .slice(0, 300);
}

function reasonOf(err: unknown): string {
  return sanitizeIntakeMessage(err instanceof Error ? err.message : String(err));
}

// The subset of intake facts the pipeline consumes, reconstructed from a
// persisted BuyerOpportunity. Budget is normalized back to CENTS (the row
// stores dollars) so the downstream scoring/notification math is unchanged.
interface IntakeFields {
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  yearMin: number | null;
  yearMax: number | null;
  budgetAmount: number | null; // cents
  monthlyPayment: number | null; // cents
  hasTradeIn: boolean | null;
  timeline: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  email: string | null;
}

type OpportunityRow = {
  id: string;
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  yearMin: number | null;
  yearMax: number | null;
  budgetAmount: number | null; // dollars, per legacy convention
  monthlyPayment: number | null; // cents
  hasTradeIn: boolean | null;
  timeline: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  email: string | null;
  marketEnrichedAt: Date | null;
  leadTemperature: string | null;
};

function buildIntakeFields(opp: OpportunityRow): IntakeFields {
  return {
    vehicleType: opp.vehicleType,
    make: opp.make,
    model: opp.model,
    trim: opp.trim,
    yearMin: opp.yearMin,
    yearMax: opp.yearMax,
    // Row stores dollars; the pipeline contract is cents.
    budgetAmount: opp.budgetAmount != null ? opp.budgetAmount * 100 : null,
    monthlyPayment: opp.monthlyPayment,
    hasTradeIn: opp.hasTradeIn,
    timeline: opp.timeline,
    zip: opp.zip,
    phone: opp.phone,
    firstName: opp.firstName,
    email: opp.email,
  };
}

function coerceTimeline(
  timeline: string | null,
): "this_week" | "1_to_3_months" | "researching" | null {
  if (!timeline) return null;
  const t = timeline.toLowerCase();
  if (t === "this_week" || t === "1_to_3_months" || t === "researching") return t;
  if (t.includes("asap") || t.includes("week")) return "this_week";
  if (t.includes("30") || t.includes("60") || t.includes("month")) return "1_to_3_months";
  if (t.includes("research") || t.includes("just")) return "researching";
  return null;
}

function coerceVehicleType(vehicleType: string | null): "new" | "used" | "open" | null {
  if (!vehicleType) return null;
  const v = vehicleType.toLowerCase();
  if (v === "new") return "new";
  if (v === "used") return "used";
  if (v === "open" || v === "either") return "open";
  return null;
}

/**
 * Score the lead and, when hot, fire the four notification channels. Moved here
 * from unified-buyer-intake with its behavior preserved; the caller guards it so
 * a re-drive of an already-scored opportunity never re-notifies.
 *
 * OPTIONAL stage: returns FAILED on an execution error (recorded but non-blocking).
 * Individual notification-channel failures are recorded on the row flags (via
 * allSettled) and do NOT make the stage FAILED — only a scoring/DB throw does.
 */
async function scoreAndAlert(
  opportunityId: string,
  fields: IntakeFields,
): Promise<{ status: StageStatus; reason?: string }> {
  try {
    const extractedData = {
      vehicleType: coerceVehicleType(fields.vehicleType),
      make: fields.make,
      model: fields.model,
      budgetTotal: fields.budgetAmount != null ? Math.round(fields.budgetAmount / 100) : null,
      monthlyPayment: fields.monthlyPayment != null ? Math.round(fields.monthlyPayment / 100) : null,
      tradeIn: fields.hasTradeIn,
      timeline: coerceTimeline(fields.timeline),
      zip: fields.zip,
      phone: fields.phone,
    };

    const scoreResult = await scoreLeadFromConversation(extractedData);

    await prisma.buyerOpportunity.update({
      where: { id: opportunityId },
      data: {
        leadScore: scoreResult.score,
        leadTemperature: scoreResult.temperature,
        scoringReason: scoreResult.reasoning,
      },
    });

    await prisma.leadScore.create({
      data: {
        sessionId: opportunityId,
        score: scoreResult.score,
        temperature: scoreResult.temperature,
        signals: scoreResult.signals as unknown as Prisma.JsonObject,
        reasoning: scoreResult.reasoning,
      },
    });

    if (scoreResult.temperature === "hot" && fields.phone) {
      const vehicle = [fields.make, fields.model].filter(Boolean).join(" ") || "vehicle";
      const budgetDisplay = fields.budgetAmount != null
        ? `$${Math.round(fields.budgetAmount / 100).toLocaleString()}`
        : fields.monthlyPayment != null
          ? `$${Math.round(fields.monthlyPayment / 100).toLocaleString()}/mo`
          : "not specified";

      const lead: HotLeadData = {
        firstName: fields.firstName ?? undefined,
        vehicle,
        budget: budgetDisplay,
        timeline: fields.timeline ?? "unknown",
        zip: fields.zip ?? "unknown",
        score: scoreResult.score,
        sessionId: opportunityId,
        phone: fields.phone,
      };

      const founderEmail = process.env.FOUNDER_EMAIL;
      const email = fields.email ?? null;

      const results = await Promise.allSettled([
        notifyFounderHotLead(lead),
        sendHotLeadBuyerSms(lead),
        email
          ? sendBuyerOpportunityConfirmationEmail({
              to: email,
              firstName: fields.firstName ?? "there",
              vehicle,
              budget: budgetDisplay,
              timeline: fields.timeline ?? "unknown",
              zip: fields.zip ?? "unknown",
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no email" }),
        founderEmail
          ? sendFounderHotLeadAlertEmail({
              to: founderEmail,
              firstName: fields.firstName ?? "Anonymous",
              email: email ?? "no email captured",
              phone: fields.phone,
              vehicle,
              budget: budgetDisplay,
              timeline: fields.timeline ?? "unknown",
              zip: fields.zip ?? "unknown",
              score: scoreResult.score,
              scoringReason: scoreResult.reasoning,
              sessionId: opportunityId,
            })
          : Promise.resolve({ sent: false, skipped: "no founder email" }),
      ]);

      const [founderSms, buyerSms, buyerEmail, founderEmailRes] = results;
      await prisma.buyerOpportunity.update({
        where: { id: opportunityId },
        data: {
          founderNotified: founderSms.status === "fulfilled",
          buyerSmsSent: buyerSms.status === "fulfilled",
          buyerEmailSent: buyerEmail.status === "fulfilled",
          founderEmailSent: founderEmailRes.status === "fulfilled",
        },
      });
    }
    return { status: "SUCCESS" };
  } catch (err) {
    logger.error("[intake-pipeline] scoreAndAlert error:", err);
    return { status: "FAILED", reason: reasonOf(err) };
  }
}

/**
 * Run the full intake background pipeline for one BuyerOpportunity. Idempotent:
 * safe to re-run (the S2 reconciler relies on this). Throws only when the
 * opportunity is missing, so the worker retries/dead-letters.
 */
export async function runIntakePipeline(buyerOpportunityId: string): Promise<IntakePipelineResult> {
  const opp = (await prisma.buyerOpportunity.findUnique({
    where: { id: buyerOpportunityId },
    select: {
      id: true, vehicleType: true, make: true, model: true, trim: true,
      yearMin: true, yearMax: true, budgetAmount: true, monthlyPayment: true,
      hasTradeIn: true, timeline: true, zip: true, phone: true,
      firstName: true, email: true, marketEnrichedAt: true, leadTemperature: true,
    },
  })) as OpportunityRow | null;

  if (!opp) throw new Error(`BuyerOpportunity ${buyerOpportunityId} not found`);
  const fields = buildIntakeFields(opp);
  const stages: StageOutcome[] = [];

  // Stage 3b — market enrichment (OPTIONAL) + dealer discovery (REQUIRED) run
  // concurrently. Each task catches its own errors and RESOLVES to a StageOutcome
  // (never rejects), so failures are recorded, not swallowed.
  const enrichmentTask = async (): Promise<StageOutcome> => {
    if (opp.marketEnrichedAt) return { stage: "market_enrichment", status: "SKIPPED" };
    if (!fields.make || !fields.model || !fields.zip)
      return { stage: "market_enrichment", status: "SKIPPED" };
    try {
      const enrichment = await enrichMarketData({
        vehicleType: fields.vehicleType,
        make: fields.make,
        model: fields.model,
        trim: fields.trim,
        yearMin: fields.yearMin,
        yearMax: fields.yearMax,
        zip: fields.zip,
      });
      if (!enrichment) return { stage: "market_enrichment", status: "ZERO_RESULTS" };
      await prisma.buyerOpportunity.update({
        where: { id: buyerOpportunityId },
        data: {
          marketMsrpEstimate: enrichment.msrpEstimate,
          marketAvgPaidPrice: enrichment.avgPaidPrice,
          marketTypicalMarkup: enrichment.typicalMarkup,
          marketGoodDealTarget: enrichment.goodDealTarget,
          marketNotes: enrichment.notes,
          marketEnrichedAt: new Date(),
        },
      });
      return { stage: "market_enrichment", status: "SUCCESS" };
    } catch (err) {
      logger.error("[intake-pipeline] market enrichment failed:", err);
      return { stage: "market_enrichment", status: "FAILED", reason: reasonOf(err) };
    }
  };

  const dealerTask = async (): Promise<StageOutcome[]> => {
    if (!fields.make || !fields.zip)
      return [
        { stage: "dealer_discovery", status: "SKIPPED" },
        { stage: "phone_script_drafting", status: "SKIPPED" },
      ];
    // Idempotent re-drive guard: DealerProspect has no unique constraint on the
    // intake identity, so createMany({ skipDuplicates }) would NOT dedupe — a
    // re-run would insert a second full set of prospects and the outreach stage
    // would re-email the same dealers. Skip discovery once prospects exist.
    // (A prior pass already discovered them → discovery SUCCESS for this run.)
    let existingProspects: number;
    try {
      existingProspects = await prisma.dealerProspect.count({
        where: { buyerOppId: buyerOpportunityId },
      });
    } catch (err) {
      logger.error("[intake-pipeline] dealer prospect count failed:", err);
      return [
        { stage: "dealer_discovery", status: "FAILED", reason: reasonOf(err) },
        { stage: "phone_script_drafting", status: "SKIPPED" },
      ];
    }
    if (existingProspects > 0) {
      return [
        { stage: "dealer_discovery", status: "SUCCESS" },
        ...(await draftPendingScripts(buyerOpportunityId)),
      ];
    }
    let dealers: Awaited<ReturnType<typeof discoverDealers>>;
    try {
      dealers = await discoverDealers({ make: fields.make, zip: fields.zip, radiusMiles: 25 });
    } catch (err) {
      logger.error("[intake-pipeline] dealer discovery failed:", err);
      return [
        { stage: "dealer_discovery", status: "FAILED", reason: reasonOf(err) },
        { stage: "phone_script_drafting", status: "SKIPPED" },
      ];
    }
    // Ran fine, found nothing — a VALID zero-supply result (not a failure).
    if (dealers.length === 0)
      return [
        { stage: "dealer_discovery", status: "ZERO_RESULTS" },
        { stage: "phone_script_drafting", status: "SKIPPED" },
      ];
    try {
      await prisma.dealerProspect.createMany({
        data: dealers.map((d) => ({
          buyerOppId: buyerOpportunityId,
          name: d.name, address: d.address, city: d.city, state: d.state, zip: d.zip,
          phone: d.phone, email: d.email, website: d.website, brand: d.brand,
          sourceUrl: d.sourceUrl, searchScore: d.searchScore, status: "DISCOVERED",
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      // Persisting discovered prospects is part of the sourcing spine — a DB
      // failure here means outreach has nothing to work with → REQUIRED FAILED.
      logger.error("[intake-pipeline] dealer prospect persist failed:", err);
      return [
        { stage: "dealer_discovery", status: "FAILED", reason: reasonOf(err) },
        { stage: "phone_script_drafting", status: "SKIPPED" },
      ];
    }
    return [
      { stage: "dealer_discovery", status: "SUCCESS" },
      ...(await draftPendingScripts(buyerOpportunityId)),
    ];
  };

  const [enrichmentOutcome, dealerOutcomes] = await Promise.all([
    enrichmentTask(),
    dealerTask(),
  ]);
  stages.push(enrichmentOutcome, ...dealerOutcomes);

  // Stage 4 — lead scoring + hot-lead alerts (OPTIONAL). Guarded so a re-drive of
  // an already-scored opportunity never re-scores or re-notifies.
  if (!fields.phone) {
    stages.push({ stage: "lead_scoring_alerts", status: "SKIPPED" });
  } else if (opp.leadTemperature) {
    stages.push({ stage: "lead_scoring_alerts", status: "SKIPPED" });
  } else {
    const r = await scoreAndAlert(buyerOpportunityId, fields);
    stages.push({ stage: "lead_scoring_alerts", status: r.status, reason: r.reason });
  }

  // Stage 4.5 — enrich discovered prospects with a VERIFIED business email so the
  // outreach stage (email:{not:null}) can actually reach them. OPTIONAL; a failure
  // is recorded but never blocks completion.
  try {
    await enrichProspectEmailsForOpportunity(buyerOpportunityId);
    stages.push({ stage: "prospect_email_enrichment", status: "SUCCESS" });
  } catch (err) {
    logger.error("[intake-pipeline] prospect email enrichment failed:", err);
    stages.push({ stage: "prospect_email_enrichment", status: "FAILED", reason: reasonOf(err) });
  }

  // Stage 5 — dealer outreach (REQUIRED; self-idempotent: skips prospects already
  // contacted). Its status distinguishes ZERO_RESULTS (nothing to contact) from
  // FAILED (infra error, or eligible prospects existed but every send failed).
  const outreach = await runPostIntakeOutreach(buyerOpportunityId);
  const dealersContacted = outreach.dealersContacted;
  stages.push({ stage: "dealer_outreach", status: outreach.status, reason: outreach.reason });

  // Buyer "dealers contacted" confirmation email (OPTIONAL).
  if (dealersContacted > 0 && fields.email) {
    try {
      await sendDealersContactedEmail({
        buyerEmail: fields.email,
        buyerFirstName: fields.firstName ?? "there",
        vehicleMake: fields.make ?? fields.vehicleType ?? "",
        vehicleModel: fields.model ?? "",
        dealerCount: dealersContacted,
        depositUrl: `${APP_URL}/buyer/deposit`,
      });
      stages.push({ stage: "dealers_contacted_email", status: "SUCCESS" });
    } catch (err) {
      logger.error("[intake-pipeline] dealers-contacted email failed:", err);
      stages.push({ stage: "dealers_contacted_email", status: "FAILED", reason: reasonOf(err) });
    }
  } else {
    stages.push({ stage: "dealers_contacted_email", status: "SKIPPED" });
  }

  // Stage 6 (Y2) — request-time coverage gate (OPTIONAL). Record-only
  // (recruitOnThin:false): enrichment already ran unconditionally this pass, so
  // the gate must not fire a redundant second pass. Never blocks completion.
  try {
    const linkedRequest = await prisma.vehicleRequest.findFirst({
      where: { buyerOpportunityId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (linkedRequest) {
      await applyRequestCoverageGate(linkedRequest.id, { recruitOnThin: false });
      stages.push({ stage: "coverage_gate", status: "SUCCESS" });
    } else {
      stages.push({ stage: "coverage_gate", status: "SKIPPED" });
    }
  } catch (err) {
    logger.error("[intake-pipeline] coverage gate failed:", err);
    stages.push({ stage: "coverage_gate", status: "FAILED", reason: reasonOf(err) });
  }

  const requiredFailed = stages.some(
    (s) => REQUIRED_STAGES.has(s.stage) && s.status === "FAILED",
  );
  const deferred =
    !requiredFailed &&
    stages.some((s) => REQUIRED_STAGES.has(s.stage) && s.status === "DEFERRED");
  const zeroSupply =
    stages.find((s) => s.stage === "dealer_discovery")?.status === "ZERO_RESULTS";

  return { dealersContacted, stages, requiredFailed, deferred, zeroSupply };
}

// Phone-script drafting for prospects without one (OPTIONAL, idempotent via
// scriptDraftedAt). Per-item failures are best-effort; the stage is FAILED only
// when every attempted draft threw. Never throws.
async function draftPendingScripts(buyerOpportunityId: string): Promise<StageOutcome[]> {
  let pending: Array<{ id: string }>;
  try {
    pending = await prisma.dealerProspect.findMany({
      where: { buyerOppId: buyerOpportunityId, status: "DISCOVERED", scriptDraftedAt: null },
      select: { id: true },
    });
  } catch (err) {
    logger.error("[intake-pipeline] pending-scripts query failed:", err);
    return [{ stage: "phone_script_drafting", status: "FAILED", reason: reasonOf(err) }];
  }
  if (pending.length === 0) return [{ stage: "phone_script_drafting", status: "SKIPPED" }];
  let drafted = 0;
  let threw = 0;
  let lastReason: string | undefined;
  for (const p of pending) {
    try {
      await draftAndSaveScript(p.id);
      drafted += 1;
      await new Promise((resolve) => setTimeout(resolve, 12000));
    } catch (err) {
      threw += 1;
      lastReason = reasonOf(err);
      logger.error(`[intake-pipeline] script drafting threw for ${p.id}:`, err);
    }
  }
  if (drafted === 0 && threw > 0)
    return [{ stage: "phone_script_drafting", status: "FAILED", reason: lastReason }];
  return [{ stage: "phone_script_drafting", status: "SUCCESS" }];
}
