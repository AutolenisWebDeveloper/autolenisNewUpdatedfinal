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
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { withSavepoint } from "@/lib/prisma-savepoint";

/** Prisma client or an interactive-transaction handle. */
type Db = typeof prisma | Prisma.TransactionClient;

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
  /**
   * Overrides the persisted `source` string verbatim. Only for callers migrating
   * onto this handler that have an existing stored convention other code reads.
   */
  sourceLabel?: string;

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
  /**
   * §5a's co-buyer election. The public wizard has always ASKED this ("Will anyone else be on
   * the loan?") and the answer went only to BuyerOpportunity — so `co_buyer_elected`, the
   * column the deposit gate reads, stayed NULL for every buyer who had already answered.
   * Undefined means the form did not ask; false is a recorded "no".
   */
  coBuyer?: boolean;
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
}

export interface UnifiedIntakeResult {
  buyerOpportunityId: string;
  vehicleRequestId: string | null;
  /** Which tier of rule 16 resolved the identity, so a surface can react. */
  identityTier: IdentityResolution["tier"];
  /**
   * True when the address belongs to a registered account the caller has not
   * proved they control. NOTHING was attached; the surface must email a claim
   * link rather than showing the request.
   */
  requiresClaim: boolean;
  /**
   * True only once the claim email is actually on the outbox. `requiresClaim`
   * says a link is REQUIRED; this says one was SENT, and they come apart: a
   * registered user with no buyer row has nothing to mint a token against, and
   * the enqueue itself can fail. The surface used to say "we sent a link to that
   * email address" in both cases, which for the first was simply untrue.
   */
  claimLinkSent: boolean;
  /** CREATED, ATTACHED, or ATTACHED_AFTER_RACE — null when no request was written. */
  attachOutcome: "CREATED" | "ATTACHED" | "ATTACHED_AFTER_RACE" | null;
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

  // §5a Stage 4 elections (Phase 4). Three-state on purpose: `undefined` means this entry
  // point did not ask, and NULL in the column is what `ELECTIONS_REQUIRED` fires on.
  coBuyer?: boolean;
  hasTradeIn?: boolean;

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

export async function intakeBuyerRequest(
  input: UnifiedIntakeInput,
): Promise<UnifiedIntakeResult> {
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
        claimLinkSent: false,
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
    claimLinkSent: result.claimLinkSent,
    attachOutcome: result.attachOutcome,
  };
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
  /** See UnifiedIntakeResult.claimLinkSent — reported, never inferred. */
  claimLinkSent: boolean;
  attachOutcome: "CREATED" | "ATTACHED" | "ATTACHED_AFTER_RACE" | null;
}

/**
 * A capture that produced no VehicleRequest is WORK, not a footnote.
 *
 * Until now it produced an admin `Notification` titled "Vehicle Request: <name>"
 * — a row that four admin surfaces treat as a request, pointing at a request
 * that does not exist. §26 already has the right instrument: BUYER_UNVERIFIED,
 * owned by SYSTEM, with a 14-day clock and a return point. The row carries the
 * buyer id when one is known and always the opportunity id, so a human can get
 * from the queue to the actual record.
 *
 * Deliberately carries no email, name or phone: the queue item is an operational
 * record, and §13-D47 is what happens when contact detail is copied into one.
 *
 * Best-effort at THIS call site: the queue must never fail a visitor's capture.
 * `raiseException` throws by design and does not swallow on the caller's behalf,
 * so the wrapping is here, where the trade-off is known.
 */
async function reportHeldCapture(
  tx: Db,
  args: { opportunityId: string; buyerId: string | null; reason: string },
): Promise<void> {
  try {
    await raiseException(
      {
        code: "BUYER_UNVERIFIED",
        buyerId: args.buyerId,
        // The opportunity is the only durable handle on a capture with no request,
        // and it is what makes the row findable. Once-ever per capture.
        idempotencyKey: `BUYER_UNVERIFIED:opportunity:${args.opportunityId}`,
        detail: `${args.reason} Lead: buyer_opportunities.id=${args.opportunityId}. Resolved when the buyer verifies the address (a claim link may be reissued at any time) or Operations attaches the capture by hand.`,
      },
      tx,
    );
  } catch (err) {
    logger.error("[unified-intake] held-capture exception could not be raised", {
      opportunityId: args.opportunityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    return { vehicleRequestId: existing.id, identityTier: "AUTHENTICATED", requiresClaim: false, claimLinkSent: false, attachOutcome: null };
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
    let claimLinkSent = false;
    // A live token found here means the link is already in that inbox; returning
    // out of the savepoint below would skip the held-capture report, so the
    // decision is carried out rather than returned from inside it.
    let alreadyLive = false;
    if (identity.claimTargetBuyerId && identity.email) {
      const claimTargetBuyerId = identity.claimTargetBuyerId;
      try {
        // SAVEPOINTED. Everything in this block runs inside the caller's
        // transaction, and in Postgres ONE failed statement aborts the whole
        // transaction — a later `COMMIT` silently becomes a `ROLLBACK` while
        // Prisma's `$transaction` still resolves (lib/prisma-savepoint.ts). So a
        // `catch` here is not enough on its own: without the savepoint, swallowing
        // an error from the mint or the enqueue would discard the visitor's
        // capture AND the held-capture exception meant to report it, and the route
        // would answer as though both had been written. The savepoint is what
        // makes "the capture still stands" true rather than merely intended.
        await withSavepoint(tx, async () => {
          const { issueResumeToken, findLiveClaimToken, TOKEN_PURPOSE } = await import(
            "@/lib/services/buyer/request-resume-token.service"
          );

          // ONE LIVE CREDENTIAL PER TARGET BUYER.
          //
          // The key used to be the opportunity id, and the opportunity is a fresh row
          // on every submission — so it deduplicated nothing. Neither public route is
          // rate limited, so N posts at any registered address produced N emails and N
          // live 5-day write credentials in that person's inbox.
          //
          // Keying on the buyer ALONE would be the other error: the prompt is a
          // once-ever key, so a legitimate submission months later, long after the
          // first token expired, would be silently suppressed for good. The live token
          // is the state that actually matters, so it is what the key names — and when
          // one already exists we send nothing and still report the link as sent,
          // because it truthfully is in that inbox.
          const live = await findLiveClaimToken(claimTargetBuyerId, tx);
          if (live) {
            logger.info("[unified-intake] claim link already live for this address — not reissued", {
              opportunityId,
              expiresAt: live.expiresAt.toISOString(),
        });
          alreadyLive = true;
          return;
        }

        const { rawToken, tokenId } = await issueResumeToken(
          { buyerId: claimTargetBuyerId, purpose: TOKEN_PURPOSE.CLAIM },
          tx,
        );
        const { renderRegisteredClaimPrompt } = await import("@/lib/services/comms/phase2-email-content");
        const claimUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/request-vehicle?claim=${encodeURIComponent(rawToken)}`;
        const idempotencyKey = `registered_claim_prompt:${claimTargetBuyerId}:${tokenId}`;
        await enqueueTransactional(
          {
            triggerEvent: "registered_address_offered_anonymously",
            templateKey: PHASE_2_TEMPLATES.REGISTERED_CLAIM_PROMPT,
            channel: "email",
            recipientKind: "buyer",
            recipientId: claimTargetBuyerId,
            to: identity.email,
            idempotencyKey,
            payload: {
              email: identity.email,
              type: "transactional",
              idempotencyKey,
              ...renderRegisteredClaimPrompt({ firstName: input.firstName ?? null, claimUrl }),
            },
          },
          tx,
        );
        claimLinkSent = true;
        });
      } catch (err) {
        // The capture still stands — the savepoint above is what makes that true —
        // but the visitor must NOT be told a link is on its way. `claimLinkSent`
        // stays false, the surface says something true instead, and the held-capture
        // report below puts a human on it.
        logger.error("[unified-intake] claim link could not be enqueued", {
          opportunityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // A registered USER with no buyer row: there is nothing to mint a token
      // against, so no link can exist. This branch used to fall straight through to
      // a response that said one had been sent — silently, with nothing logged.
      logger.warn("[unified-intake] registered address has no buyer row — no claim link can be issued", {
        opportunityId,
        hasEmail: Boolean(identity.email),
      });
    }

    if (alreadyLive) claimLinkSent = true;

    if (!claimLinkSent) {
      await reportHeldCapture(tx, {
        opportunityId,
        buyerId: identity.claimTargetBuyerId ?? null,
        reason:
          "A registered address was submitted anonymously and NO claim link could be issued, so the visitor was told only that we would follow up. Nothing was attached to the account.",
      });
    }

    return { vehicleRequestId: null, identityTier: identity.tier, requiresClaim: true, claimLinkSent, attachOutcome: null };
  }

  if (!identity.buyerId) {
    logger.info("[unified-intake] no buyer resolved — lead captured without a request", { opportunityId });
    await reportHeldCapture(tx, {
      opportunityId,
      buyerId: null,
      reason:
        "A capture carried too little information to identify a buyer, so no vehicle request was created and no claim link could be sent.",
    });
    return { vehicleRequestId: null, identityTier: identity.tier, requiresClaim: false, claimLinkSent: false, attachOutcome: null };
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
    // §5a Stage 4 elections, carried from the form that already asks them. `undefined` is
    // preserved deliberately: a form that did not ask must leave the column NULL, because
    // `ELECTIONS_REQUIRED` distinguishes "not asked" from "said no".
    coBuyerElected: input.coBuyer,
    tradeElected: input.hasTradeIn,
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

  // SINGLE USE, on the path that used it.
  //
  // /complete consumes the token it presents, and the resume route consumes the
  // one it presents — but the intake write path, the one the emailed link
  // actually points at (`/request-vehicle?claim=…`), never did. A forwarded link
  // therefore stayed a write credential against someone else's account for the
  // full 5-day TTL, and every submission through it authorised another write.
  //
  // Consumed AFTER the write it authorised and inside the same transaction, so
  // the two cannot come apart in either direction: a failed write rolls the
  // consumption back with it (a genuine buyer whose submission failed still has a
  // working link), and a failed consumption rolls the write back with it (a link
  // that could not be spent never authorises a lasting change).
  //
  // A `false` return means the row was already consumed — two uses of a single-use
  // credential raced, and this one lost. It is NOT failed: the token binds both
  // callers to the SAME buyer, §5 rule 5 gives that buyer one open request, so the
  // second write updates the first one rather than crossing any boundary. Failing
  // it would discard a real capture (§5 rule 6) to no security benefit. Logged
  // because a race on a single-use credential is worth being able to see.
  if (identity.tier === "CLAIM_TOKEN" && identity.claimTokenId) {
    const { consumeResumeToken } = await import("@/lib/services/buyer/request-resume-token.service");
    const spent = await consumeResumeToken(identity.claimTokenId, tx);
    if (!spent) {
      logger.warn("[unified-intake] claim token was already consumed when this write finished", {
        opportunityId,
        buyerId,
      });
    }
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
    // A request exists, so there is nothing to claim by email. `requiresClaim` is
    // still true for a guest capture here — which is exactly why no surface may
    // read it as "nothing was attached".
    claimLinkSent: false,
    attachOutcome: attached.outcome,
  };
}

// NOTE: lead scoring + hot-lead alerts (scoreAndAlert) and the market-enrichment
// / dealer-discovery / outreach sequence live in intake-pipeline.service.ts and
// are executed by the intake-reconcile cron via processBuyerOpportunityIntake
// (Inngest-free). This service now only creates the records; the persisted
// BuyerOpportunity (intakeProcessedAt IS NULL) is what the cron picks up.
