// lib/services/acquisition/unified-buyer-intake.service.ts
//
// Group 5 — Unified buyer intake.
//
// Every buyer entry point (Zura widget, request-vehicle wizard, buyer
// dashboard, LP campaign forms, phone intake, voice dispatch) should funnel
// structured submissions through this single service so each one produces:
//   1. A BuyerOpportunity  (the AI-enrichment record)
//   2. A VehicleRequest    (the canonical buyer record, when a buyer can be
//                           resolved) linked back via buyerOpportunityId
// and then fires the Group 3 + 4A pipeline (market enrichment, dealer
// discovery, phone-script drafting, lead scoring, hot-lead notifications) in
// the background — mirroring the proven /api/concierge after() flow.
//
<<<<<<< HEAD
// PHASE 2 — THIS IS NOW THE ONE LANE 1 INTAKE HANDLER (§5 rule 1: "All Lane 1
// forms post to a single intake handler. No page implements its own capture
// logic."). What it gained:
//
//   • RULE 16 IDENTITY (`intake-identity.ts`). An unauthenticated caller can no
//     longer attach to a registered buyer by typing their email — §7.2's live
//     violation. The resolver returns REGISTERED_REQUIRES_CLAIM and the surface
//     emails a claim link instead; clicking it is the verification.
//   • ONE OPEN REQUEST (`open-request.service.ts`). A second submission attaches
//     to the buyer's open request and merges into it, under the Phase 1 partial
//     unique index, with the create race handled as a compare-and-swap rather
//     than a raw 23505.
//   • ATTRIBUTION (`intake-attribution.ts`). `acquisition_channel` is derived
//     server-side and is never null; every other column is a real value or NULL;
//     `ip_address` is server-captured or NULL with `ip_unavailable_reason` — never
//     a sentinel string in an address column.
//   • CONSENT, versioned and hashed, per surface (§5 rule 4, §13-D46).
//   • ZIP WRITE-THROUGH to the lead AND the request AND the buyer (§5 rule 3 — the
//     rule whose absence produced §7.1, an auction that received zero invitations
//     because the buyer had no location).
//   • DRAFT persistence (§5 rule 6) and the §6.4 four-touch recovery, enqueued
//     through the §27 dispatcher.
//   • ONE TRANSACTION. The service used to make up to nine independent Prisma
//     calls, so "opportunity created, request failed" was a reachable state that
//     was logged and forgotten. The lead and the request are now written together
//     or not at all.

import { logger } from "@/lib/logger";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_2_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import type { Prisma, VehicleRequestEntryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeAttribution,
  type RawAttribution,
  type IpUnavailableReason,
} from "./intake-attribution";
import { resolveIdentity, flagPhoneCollision, type IdentityResolution } from "./intake-identity";
import { attachOrCreateOpenRequest, type MergeableRequestData } from "@/lib/services/vehicle-request/open-request.service";
import { consentColumns, type ConsentCapture } from "./intake-consent";

/** Prisma client or an interactive-transaction handle. */
type Db = typeof prisma | Prisma.TransactionClient;
=======
// Phase 5.1 builds this service only. Wiring the entry points to it happens in
// phases 5.2-5.4, so nothing here is invoked by existing routes yet.

import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/utils/phone";
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

export type IntakeSource =
  | "zura_widget"
  | "request_vehicle_wizard"
  | "buyer_dashboard"
  | "lp_campaign"
  | "phone_intake"
  | "voice_dispatch";

export interface UnifiedIntakeInput {
  source: IntakeSource;
  campaign?: string; // For lp_campaign, the campaign name
<<<<<<< HEAD
  /**
   * Overrides the persisted `source` string verbatim. Only for callers migrating
   * onto this handler that have an existing stored convention other code reads.
   */
  sourceLabel?: string;
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

  // Buyer identification
  buyerId?: string; // If already resolved (dashboard flow)
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;

  // Vehicle interest
  make?: string;
  model?: string;
  vehicleType?: string;
  yearMin?: number;
  yearMax?: number;
  trim?: string;

  // Financial
  budgetAmount?: number; // in cents
  monthlyPayment?: number; // in cents

  // Timeline + location
  timeline?: string;
  zip?: string;

  // Trade-in
  hasTradeIn?: boolean;
  tradeInDetails?: Record<string, unknown>;

  // Financing
  financingNeeded?: boolean;

  // Existing VehicleRequest fields (for direct mapping)
  notes?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  sourceUrl?: string | null;
  // Organic SEO attribution. `landingSource` is the semantic FormSource
  // ("seo_city_frisco", "seo_texas_hub", …) used to segment paid vs organic
  // conversions; `referrer` is document.referrer captured at form mount.
  landingSource?: string | null;
  referrer?: string | null;
<<<<<<< HEAD

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  /** Tier 1 of rule 16. From the SESSION — never from a request body. */
  authenticatedBuyerId?: string | null;
  /** Tier 2 of rule 16. The raw claim token from a resume link. */
  claimToken?: string | null;
  utmContent?: string | null;
  /** Validated against `affiliates` by the caller, or null. */
  affiliateId?: string | null;
  /** SERVER-CAPTURED only (`captureClientIp`). Never a client-supplied value. */
  ipAddress?: string | null;
  ipUnavailableReason?: IpUnavailableReason | null;
  /** What the visitor affirmatively ticked, and on which surface. */
  consent?: ConsentCapture | null;
  /** §6.1's entry type: a specific listing, or an open specification. */
  entryType?: VehicleRequestEntryType | null;
  /** Location, written through to the lead, the request AND the buyer (§5 rule 3). */
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /**
   * A partial capture persists as DRAFT and enters §6.4's recovery sequence; a
   * complete one is SUBMITTED. §5 rule 6: "Incomplete is a draft, never a dead end."
   */
  draft?: boolean;
  /** The host of this deployment, so a self-referral is not counted as an acquisition. */
  appHost?: string | null;
  /**
   * Capture the LEAD only — no Vehicle Request.
   *
   * The four side captures (lead magnet, fee calculator, LP step 1, exit intent)
   * collect an email and nothing a request could be sourced from. `intake/R1`
   * proposes turning them into DRAFT Vehicle Requests and marks that an OWNER
   * DECISION (map Q1), so this phase does not make it: they are repointed at this
   * one handler — gaining attribution, consent and the identity rules they had
   * none of — while producing exactly what they produce today. Flipping the
   * decision later is removing this flag at four call sites.
   */
  leadOnly?: boolean;
  /** Pre-computed lead temperature, for the surfaces that segment before capture. */
  leadTemperature?: string | null;
  /** Human-readable reason for that temperature. */
  scoringReason?: string | null;
  /** Override the synthesized session id, where a surface already minted one. */
  sessionId?: string | null;
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}

export interface UnifiedIntakeResult {
  buyerOpportunityId: string;
  vehicleRequestId: string | null;
<<<<<<< HEAD
  /** Which tier of rule 16 resolved the identity, so a surface can react. */
  identityTier: IdentityResolution["tier"];
  /**
   * True when the address belongs to a registered account the caller has not
   * proved they control. NOTHING was attached; the surface must email a claim
   * link rather than showing the request.
   */
  requiresClaim: boolean;
  /** CREATED, ATTACHED, or ATTACHED_AFTER_RACE — null when no request was written. */
  attachOutcome: "CREATED" | "ATTACHED" | "ATTACHED_AFTER_RACE" | null;
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}

// The fields promoteOpportunity needs to resolve a buyer and map a
// VehicleRequest. A subset of UnifiedIntakeInput (so intakeBuyerRequest can pass
// its input verbatim), and the shape the Zura chat builds from a BuyerOpportunity
// — with budgetAmount already in CENTS (the chat converts its stored dollars up
// at the call site so the money boundary is explicit and integer-only).
export interface PromoteOpportunityInput {
  buyerId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  zip?: string;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  budgetAmount?: number; // in cents
  notes?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  sourceUrl?: string | null;
  landingSource?: string | null;
  referrer?: string | null;
<<<<<<< HEAD

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  authenticatedBuyerId?: string | null;
  claimToken?: string | null;
  utmContent?: string | null;
  affiliateId?: string | null;
  ipAddress?: string | null;
  ipUnavailableReason?: IpUnavailableReason | null;
  consent?: ConsentCapture | null;
  entryType?: VehicleRequestEntryType | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  draft?: boolean;
  appHost?: string | null;
}

/**
 * Resolve a buyer identity in rule-16 order, delegating to `intake-identity.ts`.
 *
 * This replaces the previous three-case email lookup, which was §7.2's live
 * violation: "Case 1: Registered buyer — link directly" attached an anonymous
 * public submission to a registered account on nothing but the email the caller
 * typed. It no longer does — see `intake-identity.ts` for why an asserted address
 * is not a verified one, and what happens instead.
 */
async function resolveIdentityForIntake(
  input: PromoteOpportunityInput,
  db: Db,
): Promise<IdentityResolution> {
  // `buyerId` on the input is the DASHBOARD path: the caller already resolved the
  // buyer from an authenticated session. It is tier 1 either way, and naming it
  // `authenticatedBuyerId` at the boundary makes the provenance explicit for new
  // callers without breaking the existing ones.
  const authenticatedBuyerId = input.authenticatedBuyerId ?? input.buyerId ?? null;
  return resolveIdentity(
    {
      authenticatedBuyerId,
      claimToken: input.claimToken ?? null,
      email: input.email ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      zip: input.zip ?? null,
      createIfMissing: true,
    },
    db,
  );
}

// REMOVED IN PHASE 2: the P2022 "column does not exist" fallback.
//
// `promoteOpportunity` used to catch P2022 on the VehicleRequest create and retry
// WITHOUT `landingSource` and `referrer`, so a lead was never lost when the
// add_landing_source_referrer migration was unapplied. It also silently discarded
// two attribution fields when it fired, which §5 rule 2 requires to be written.
//
// It is dead either way now. Phase 1's wave declares 264 columns production does
// not have until `migrate deploy` runs (§8.1a.2), so an unmigrated database
// 42703s on almost every read long before this create is reached — a fallback for
// two columns cannot rescue that, and the merge gate is what does. Removing it
// means an unmigrated environment fails loudly instead of quietly writing
// attribution-less rows.
=======
}

/**
 * Resolve a buyerId from the supplied input. Returns an already-resolved
 * buyerId verbatim, otherwise finds-or-creates a User + Buyer from the email
 * — the same three-case logic used by /api/public/request-vehicle.
 * Returns null when there is not enough information to resolve a buyer.
 */
async function resolveBuyerId(
  input: PromoteOpportunityInput,
): Promise<string | null> {
  if (input.buyerId) return input.buyerId;

  // Need at least an email + a first name to stand up a guest buyer.
  if (!input.email || !input.firstName) return null;

  const email = input.email.toLowerCase();
  const firstName = input.firstName;
  const lastName = input.lastName ?? "";

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { buyer: { select: { id: true, zip: true } } },
    });

    if (existingUser?.buyer) {
      // Case 1: Registered buyer — link directly. Backfill Buyer.zip from this
      // submission when it is missing, so geolocation-dependent request
      // progression + coverage can run (the public form always carries a ZIP).
      // Never overwrite an existing ZIP.
      if (!existingUser.buyer.zip && input.zip) {
        await prisma.buyer
          .update({ where: { id: existingUser.buyer.id }, data: { zip: input.zip } })
          .catch((err) => logger.error("[unified-intake] buyer zip backfill failed:", err));
      }
      return existingUser.buyer.id;
    }

    if (existingUser && !existingUser.buyer) {
      // Case 2: User exists but no buyer profile — create it.
      const newBuyer = await prisma.buyer.create({
        data: {
          userId: existingUser.id,
          firstName,
          lastName,
          phone: normalizePhone(input.phone) || null,
          zip: input.zip ?? null,
        },
      });
      return newBuyer.id;
    }

    // Case 3: No user at all — create guest User + Buyer.
    // User.supabaseId is NOT NULL — use a placeholder replaced at signup.
    const guestUser = await prisma.user.create({
      data: {
        supabaseId: `guest_${crypto.randomUUID()}`,
        email,
        role: "BUYER",
      },
    });
    const guestBuyer = await prisma.buyer.create({
      data: {
        userId: guestUser.id,
        firstName,
        lastName,
        phone: normalizePhone(input.phone) || null,
        zip: input.zip ?? null,
        isGuest: true,
      },
    });
    return guestBuyer.id;
  } catch (err) {
    logger.error("[unified-intake] buyer find/create failed:", err);
    return null;
  }
}

// Prisma raises P2022 ("column does not exist") when code references a column
// the database has not migrated yet. The add_landing_source_referrer migration
// may be unapplied in some environments, so we detect this case to retry the
// VehicleRequest create without the new columns rather than lose the lead.
function isMissingColumnError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2022"
  );
}
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

export async function intakeBuyerRequest(
  input: UnifiedIntakeInput,
): Promise<UnifiedIntakeResult> {
<<<<<<< HEAD
  const attribution = normalizeAttribution(input as RawAttribution, input.appHost ?? null);
  const consent = consentColumns(input.consent);
  // `sourceLabel` wins when a caller has an EXISTING persisted convention to keep.
  // The lead-magnet capture is the case: its rows have always read
  // `lead_magnet:<slug>` and its nurture cron filters on exactly that prefix and
  // parses the slug out of segment 1. Composing `lp_campaign:lead_magnet:<slug>`
  // here would have matched nothing and resolved the wrong magnet — a silent
  // regression in a sequence nobody would notice had stopped.
  const source = input.sourceLabel ?? input.source + (input.campaign ? `:${input.campaign}` : "");

  // ONE TRANSACTION. This service used to make up to nine independent Prisma calls,
  // so "the BuyerOpportunity was created and the VehicleRequest failed" was a
  // reachable state that was caught, logged, and returned as a success with a null
  // request id. §5 rule 6 says an incomplete capture is a DRAFT, never a dead end —
  // a half-written lead is a dead end. The lead and the request are now written
  // together or not at all.
  const result = await prisma.$transaction(async (tx) => {
    // 1. The lead. Keyed on a synthesized sessionId — structured submissions have
    //    no chat session.
    const opportunity = await tx.buyerOpportunity.create({
      data: {
        sessionId: input.sessionId ?? crypto.randomUUID(),
        source,
        leadTemperature: input.leadTemperature ?? null,
        scoringReason: input.scoringReason ?? null,
        buyerId: input.authenticatedBuyerId ?? input.buyerId ?? null,
        phone: input.phone ?? null,
        firstName: input.firstName ?? null,
        email: input.email ?? null,
        vehicleType: input.vehicleType ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        yearMin: input.yearMin ?? null,
        yearMax: input.yearMax ?? null,
        trim: input.trim ?? null,
        // BuyerOpportunity.budgetAmount stored as dollars (legacy concierge
        // convention); VehicleRequest stores cents. Input contract = cents.
        budgetAmount: input.budgetAmount != null ? Math.round(input.budgetAmount / 100) : null,
        monthlyPayment: input.monthlyPayment ?? null,
        timeline: input.timeline ?? null,
        zip: input.zip ?? null,
        hasTradeIn: input.hasTradeIn ?? null,
        tradeInDetails: (input.tradeInDetails ?? undefined) as Prisma.InputJsonValue | undefined,
        financingNeeded: input.financingNeeded ?? null,
        completed: !input.draft,
        messages: [],
        // §5 rule 2 — attribution on the LEAD as well as the request. Until now
        // the lead carried only a free-text `source` string, so a lead that never
        // promoted to a request carried no attribution at all.
        acquisitionChannel: attribution.acquisitionChannel,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
        utmContent: attribution.utmContent,
        sourceUrl: attribution.sourceUrl,
        referrer: attribution.referrer,
        affiliateId: attribution.affiliateId,
        ipAddress: attribution.ipAddress,
        ipUnavailableReason: attribution.ipUnavailableReason,
        consentVersion: consent.consentVersion,
        consentTextHash: consent.consentTextHash,
        consentSurface: consent.consentSurface,
        consentIp: consent.consentIp,
        consentIpUnavailableReason: consent.consentIpUnavailableReason,
        consentSms: consent.consentSms,
        consentAt: consent.consentAt,
      },
    });

    // 2. The identity, then the request — unless this is a lead-only capture.
    if (input.leadOnly) {
      return {
        opportunityId: opportunity.id,
        vehicleRequestId: null,
        identityTier: "UNRESOLVED" as const,
        requiresClaim: false,
        attachOutcome: null,
      };
    }
    const promoted = await promoteOpportunityInTx(tx, opportunity.id, input, attribution, consent);
    return { opportunityId: opportunity.id, ...promoted };
  });

  logger.info("[unified-intake] captured", {
    opportunityId: result.opportunityId,
    source,
    identityTier: result.identityTier,
    attachOutcome: result.attachOutcome,
    channel: attribution.acquisitionChannel,
  });

  return {
    buyerOpportunityId: result.opportunityId,
    vehicleRequestId: result.vehicleRequestId,
    identityTier: result.identityTier,
    requiresClaim: result.requiresClaim,
    attachOutcome: result.attachOutcome,
  };
=======
  // 1. Each BuyerOpportunity is keyed on a unique sessionId. Structured
  //    submissions have no chat session, so synthesize one.
  const sessionId = crypto.randomUUID();
  const source =
    input.source + (input.campaign ? `:${input.campaign}` : "");

  // 2. Create the BuyerOpportunity FIRST — it is the AI-enrichment anchor and
  //    the pipeline writes back to it. completed:true because this is a
  //    structured one-shot submission, not an in-progress conversation.
  const opportunity = await prisma.buyerOpportunity.create({
    data: {
      sessionId,
      source,
      buyerId: input.buyerId ?? null,
      phone: input.phone ?? null,
      firstName: input.firstName ?? null,
      email: input.email ?? null,
      vehicleType: input.vehicleType ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      yearMin: input.yearMin ?? null,
      yearMax: input.yearMax ?? null,
      trim: input.trim ?? null,
      // BuyerOpportunity.budgetAmount stored as dollars
      // (legacy concierge convention); VehicleRequest stores
      // cents. Input contract = cents, convert here.
      budgetAmount: input.budgetAmount != null
        ? Math.round(input.budgetAmount / 100)
        : null,
      monthlyPayment: input.monthlyPayment ?? null,
      timeline: input.timeline ?? null,
      zip: input.zip ?? null,
      hasTradeIn: input.hasTradeIn ?? null,
      tradeInDetails: (input.tradeInDetails ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      financingNeeded: input.financingNeeded ?? null,
      completed: true,
      messages: [],
    },
  });
  const opportunityId = opportunity.id;
  logger.info("[unified-intake] BuyerOpportunity created", {
    opportunityId,
    source,
  });

  // 3. Resolve the buyer, create the linked VehicleRequest, and enqueue the
  //    durable pipeline — the one promotion path, shared with the Zura chat.
  const { vehicleRequestId } = await promoteOpportunity(opportunityId, input);

  return { buyerOpportunityId: opportunityId, vehicleRequestId };
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}

/**
 * Promote an existing BuyerOpportunity into a sourceable VehicleRequest (when a
 * buyer can be resolved).
 *
 * Extracted from intakeBuyerRequest so the Zura concierge chat can reuse it
 * against its OWN live BuyerOpportunity (no duplicate opportunity). Idempotent:
 * a second call for an opportunity that already has a linked VehicleRequest
 * creates no duplicate. This does NOT trigger intake orchestration — the heavy
 * background sequence (market enrichment, dealer discovery, phone-script drafting,
 * lead scoring/alerts, dealer outreach) is run by the intake-reconcile cron via
 * `processBuyerOpportunityIntake`, keyed on buyerOpportunityId, which is the single
 * owner of that work (and runs even when no buyer resolves, so lead
 * enrichment/scoring still happens).
 *
 * `input.budgetAmount` is CENTS (callers convert at their boundary).
 */
export async function promoteOpportunity(
  opportunityId: string,
  input: PromoteOpportunityInput,
): Promise<{ vehicleRequestId: string | null }> {
<<<<<<< HEAD
  const attribution = normalizeAttribution(input as RawAttribution, input.appHost ?? null);
  const consent = consentColumns(input.consent);
  const result = await prisma.$transaction((tx) =>
    promoteOpportunityInTx(tx, opportunityId, input, attribution, consent),
  );
  return { vehicleRequestId: result.vehicleRequestId };
}

interface PromoteResult {
  vehicleRequestId: string | null;
  identityTier: IdentityResolution["tier"];
  requiresClaim: boolean;
  attachOutcome: "CREATED" | "ATTACHED" | "ATTACHED_AFTER_RACE" | null;
}

/**
 * The promotion itself, inside a caller-supplied transaction.
 *
 * Idempotent per opportunity: a second call for an opportunity that already has a
 * linked VehicleRequest creates nothing.
 */
async function promoteOpportunityInTx(
  tx: Db,
  opportunityId: string,
  input: PromoteOpportunityInput,
  attribution: ReturnType<typeof normalizeAttribution>,
  consent: ReturnType<typeof consentColumns>,
): Promise<PromoteResult> {
  const existing = await tx.vehicleRequest.findFirst({
    where: { buyerOpportunityId: opportunityId },
    select: { id: true },
  });
  if (existing) {
    logger.info("[unified-intake] opportunity already promoted — reusing VehicleRequest", {
      opportunityId,
      vehicleRequestId: existing.id,
    });
    return { vehicleRequestId: existing.id, identityTier: "AUTHENTICATED", requiresClaim: false, attachOutcome: null };
  }

  const identity = await resolveIdentityForIntake(input, tx);

  if (identity.requiresClaim && identity.buyerId === null) {
    // REGISTERED_REQUIRES_CLAIM. The address belongs to a registered account and
    // the caller has not proved they control it, so NOTHING is written under that
    // account — not a request, not a buyer, not a field. The lead persists with
    // everything the visitor typed, and the surface emails a claim link; clicking
    // it resolves as tier 2 and this same code path attaches then.
    logger.info("[unified-intake] registered address offered anonymously — capture held for claim", {
      opportunityId,
    });

    // SEND THE LINK THE SURFACE SAYS IT SENT. Every email on this route is gated
    // on a vehicleRequestId, and this branch deliberately produces none — so the
    // response told the visitor "we sent a link to that email address" and nothing
    // was ever sent. The token is minted in THIS transaction: the message and the
    // held capture commit together or neither does.
    if (identity.claimTargetBuyerId && identity.email) {
      try {
        const { issueResumeToken } = await import("@/lib/services/buyer/request-resume-token.service");
        const { rawToken } = await issueResumeToken({ buyerId: identity.claimTargetBuyerId }, tx);
        const { renderRegisteredClaimPrompt } = await import("@/lib/services/comms/phase2-email-content");
        const claimUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/request-vehicle?claim=${encodeURIComponent(rawToken)}`;
        await enqueueTransactional(
          {
            triggerEvent: "registered_address_offered_anonymously",
            templateKey: PHASE_2_TEMPLATES.REGISTERED_CLAIM_PROMPT,
            channel: "email",
            recipientKind: "buyer",
            recipientId: identity.claimTargetBuyerId,
            to: identity.email,
            // One live prompt per opportunity: a visitor who submits twice gets one
            // link, and a link that has been used is consumed by the route.
            idempotencyKey: `registered_claim_prompt:${opportunityId}`,
            payload: {
              email: identity.email,
              type: "transactional",
              idempotencyKey: `registered_claim_prompt:${opportunityId}`,
              ...renderRegisteredClaimPrompt({ firstName: input.firstName ?? null, claimUrl }),
            },
          },
          tx,
        );
      } catch (err) {
        // The capture still stands, and the visitor was told to check their email.
        // This is loud rather than silent precisely because it is the half that
        // makes that statement true.
        logger.error("[unified-intake] claim link could not be enqueued", {
          opportunityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { vehicleRequestId: null, identityTier: identity.tier, requiresClaim: true, attachOutcome: null };
  }

  if (!identity.buyerId) {
    logger.info("[unified-intake] no buyer resolved — lead captured without a request", { opportunityId });
    return { vehicleRequestId: null, identityTier: identity.tier, requiresClaim: false, attachOutcome: null };
  }

  const buyerId = identity.buyerId;

  // §5 rule 3 — ZIP write-through. The rule whose absence produced §7.1: the lead
  // carried zip 75035 and the buyer row carried NULL, so the invitation matcher
  // could not place the buyer and the auction received zero invitations. Location
  // reaches the buyer, the lead AND the request, and an existing value is never
  // overwritten by a later, thinner submission.
  if (input.zip || input.city || input.state) {
    const buyer = await tx.buyer.findUnique({
      where: { id: buyerId },
      select: { zip: true, city: true, state: true },
    });
    const patch: Record<string, unknown> = {};
    if (!buyer?.zip && input.zip) patch.zip = input.zip;
    if (!buyer?.city && input.city) patch.city = input.city;
    if (!buyer?.state && input.state) patch.state = input.state;
    if (Object.keys(patch).length > 0) {
      await tx.buyer.update({ where: { id: buyerId }, data: patch });
    }
  }

  const data: MergeableRequestData = {
    buyerOpportunityId: opportunityId,
    makePreference: input.make ?? null,
    modelPreference: input.model ?? null,
    yearMin: input.yearMin ?? null,
    yearMax: input.yearMax ?? null,
    maxBudgetCents: input.budgetAmount ?? null,
    statedBudgetCents: input.budgetAmount ?? null,
    notes: input.notes ?? null,
    zip: input.zip ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    entryType: input.entryType ?? null,
    acquisitionChannel: attribution.acquisitionChannel,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    sourceUrl: attribution.sourceUrl,
    referrer: attribution.referrer,
    landingSource: attribution.landingSource,
    affiliateId: attribution.affiliateId,
    ipAddress: attribution.ipAddress,
    ipUnavailableReason: attribution.ipUnavailableReason,
    consentVersion: consent.consentVersion,
    consentTextHash: consent.consentTextHash,
    consentSurface: consent.consentSurface,
    consentIp: consent.consentIp,
    consentIpUnavailableReason: consent.consentIpUnavailableReason,
  };

  // §5 rule 5 — one open request per buyer, under the Phase 1 partial unique index,
  // with the create race handled as a compare-and-swap.
  const attached = await attachOrCreateOpenRequest(
    { buyerId, createStatus: input.draft ? "DRAFT" : "SUBMITTED", data },
    tx,
  );

  // §6.4's second half. A draft that has just been completed must stop being
  // chased: `cancelDraftRecovery` cancels all four touches at once through their
  // shared cancel key, inside THIS transaction, so the promotion and the
  // cancellation commit together. The send-time recheck would also refuse to
  // send, but it would leave four claimable rows behind and the outbox would go
  // on reporting work that must never happen.
  if (attached.promotedFromDraft) {
    const { cancelDraftRecovery } = await import("@/lib/services/acquisition/draft-recovery.service");
    await cancelDraftRecovery(attached.vehicleRequest.id, "draft completed by a full submission", tx);
  }

  // Keep the two records consistent when the caller supplied no buyer id.
  if (!input.buyerId && !input.authenticatedBuyerId) {
    await tx.buyerOpportunity.update({ where: { id: opportunityId }, data: { buyerId } });
  }

  // §7.2 (iv) — flag, never merge. Two buyers sharing a normalised phone with
  // different verified emails are TWO identities under rule 16; this tells a human
  // so an audited merge can happen if one is warranted, and returns nothing a
  // caller could act on automatically. Non-blocking: a capture is never failed by
  // the flag.
  if (input.phone) {
    await flagPhoneCollision(buyerId, input.phone, tx);
  }

  logger.info("[unified-intake] request " + attached.outcome, {
    opportunityId,
    vehicleRequestId: attached.vehicleRequest.id,
    updatedFields: attached.updatedFields,
    promotedFromDraft: attached.promotedFromDraft,
  });

  return {
    vehicleRequestId: attached.vehicleRequest.id,
    identityTier: identity.tier,
    requiresClaim: identity.requiresClaim,
    attachOutcome: attached.outcome,
  };
=======
  // Idempotency: exactly one request-signal VehicleRequest per opportunity.
  const existing = await prisma.vehicleRequest.findFirst({
    where: { buyerOpportunityId: opportunityId },
    select: { id: true },
  });
  let vehicleRequestId: string | null = existing?.id ?? null;

  if (!vehicleRequestId) {
    const buyerId = await resolveBuyerId(input);
    if (buyerId) {
      try {
        const baseData = {
          buyerId,
          status: "SUBMITTED" as const,
          makePreference: input.make ?? null,
          modelPreference: input.model ?? null,
          yearMin: input.yearMin ?? null,
          yearMax: input.yearMax ?? null,
          maxBudgetCents: input.budgetAmount ?? null,
          notes: input.notes ?? null,
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          sourceUrl: input.sourceUrl ?? null,
          buyerOpportunityId: opportunityId,
        };

        // landingSource/referrer require the add_landing_source_referrer
        // migration. Until it is applied, the create throws P2022; we retry
        // WITHOUT those columns so a lead is never lost.
        try {
          const vr = await prisma.vehicleRequest.create({
            data: {
              ...baseData,
              landingSource: input.landingSource ?? null,
              referrer: input.referrer ?? null,
            },
          });
          vehicleRequestId = vr.id;
        } catch (err) {
          if (isMissingColumnError(err)) {
            logger.warn(
              "[unified-intake] landingSource/referrer migration pending — retrying without",
            );
            const vr = await prisma.vehicleRequest.create({ data: baseData });
            vehicleRequestId = vr.id;
          } else {
            throw err;
          }
        }

        // Backfill the opportunity's buyerId so the two records stay consistent
        // (the input may not have supplied one).
        if (!input.buyerId) {
          await prisma.buyerOpportunity.update({
            where: { id: opportunityId },
            data: { buyerId },
          });
        }

        logger.info("[unified-intake] VehicleRequest created + linked", {
          opportunityId,
          vehicleRequestId,
        });
      } catch (err) {
        logger.error("[unified-intake] VehicleRequest create failed:", err);
      }
    } else {
      logger.info("[unified-intake] No buyer resolved — skipping VehicleRequest", {
        opportunityId,
      });
    }
  } else {
    logger.info("[unified-intake] opportunity already promoted — reusing VehicleRequest", {
      opportunityId,
      vehicleRequestId,
    });
  }

  // Intake orchestration is NOT triggered here. The creation path only persists
  // the BuyerOpportunity (and, when a buyer resolves, the linked VehicleRequest);
  // `intakeProcessedAt IS NULL` on the persisted row makes it eligible. The single
  // authoritative executor — the intake-reconcile cron
  // (processEligibleBuyerIntakes) — picks it up and runs the durable, idempotent
  // pipeline. This keeps the buyer-facing request fast and bounded (the pipeline
  // performs slow, rate-limited work) and removes Inngest from the intake path.
  return { vehicleRequestId };
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}

// NOTE: lead scoring + hot-lead alerts (scoreAndAlert) and the market-enrichment
// / dealer-discovery / outreach sequence live in intake-pipeline.service.ts and
// are executed by the intake-reconcile cron via processBuyerOpportunityIntake
// (Inngest-free). This service now only creates the records; the persisted
// BuyerOpportunity (intakeProcessedAt IS NULL) is what the cron picks up.
