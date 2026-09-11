// lib/services/auction/auction-invitation.service.ts
//
// Stage 7 — ONE invitation service for both pools.
//
// §Stage 7: "System launches a 48-hour sealed auction and issues each rooftop a unique,
// expiring, auction-and-rooftop-bound invitation link. Registered and outside dealerships
// receive the same class of secure invitation — registered dealers no longer receive a
// generic dashboard link."
//
// WHAT THIS REPLACES, AND WHY ONE SERVICE RATHER THAN THREE. At HEAD, three code paths
// create `AuctionInvitation` rows and a fourth writes `OutsideAuctionInvite`, and they
// disagree about everything that matters:
//
//   • `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:165` — `createMany` with no
//     cap (`dealerIds` is `.min(1)` with no `.max()`, :45, while `outsideDealers` IS capped
//     at 8, :50), no ranking, no radius check, no score, leaving `invitationScore` and
//     `distanceMiles` null. Its dealer lookup has no `orderBy` (:107-114), so the automatic
//     tie-break followed database order. That is defect 4.
//   • `app/api/admin/auctions/[auctionId]/action/route.ts:121` — a single DEALER_INVITED,
//     whose sibling DEALER_REMOVED hard-deletes the row (:95-97) without decrementing
//     `currentAuctionLoad`, because `releaseAuctionLoad` derives its list from the SURVIVING
//     rows (`dealer-invitation.service.ts:438-457`). The +1 is never returned, and enough
//     leakage silently stops the scored path from inviting anyone at load >= 5.
//   • `lib/services/auction/dealer-invitation.service.ts:360` — the canonical one, with the
//     8-cap, the radius ladder, fail-closed geo and a score sort. Registered dealers only.
//   • `lib/services/auction/outside-invite.service.ts:148` plus a SECOND writer the module's
//     own header denies exists — `app/api/admin/offers/route.ts:206`, which dedups only on
//     (auctionId, email), writes no `rooftopId`, and therefore slips past both the
//     in-service rooftop dedup and the `@@unique([auctionId, rooftopId])` backstop.
//
// Every path here goes through `issueInvitations`. §8.4 stops `outside_auction_invites`
// WRITES and keeps its READS — the two historical rows and the public token route that
// resolves both tables — so no capability is removed: outside dealerships are still invited,
// now as `auction_invitations` rows with `isRegisteredDealer = false`, which is what makes
// defect 6's counting fix possible at all.
//
// THE IDENTITY FIREWALL IS BUILT HERE AND LIFTED IN PHASE 7 (§11.6). Issuing an invitation
// writes a WITHHELD `identity_firewall_entries` row per auction and rooftop (25-10). Nothing
// in this file writes LIFTED, and the payload type in `phase5-email-content.ts` has no field
// that could carry a buyer name, email, phone or street address.

import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { withSavepoint } from "@/lib/prisma-savepoint";
import { issueInvitationToken } from "@/lib/services/dealer-recruitment/invitation-token.service";
import { buildUnsubscribeUrl } from "@/lib/services/dealer-recruitment/unsubscribe-token.service";
import { enqueueTransactional } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_5_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import {
  renderDealerInvitation,
  renderDealerInvitationReminder,
  type DealerInvitationContent,
} from "@/lib/services/comms/phase5-email-content";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { MAX_INVITATION_FIELD } from "@/lib/services/sourcing/rooftop-sourcing.service";

type Db = PrismaClient | Prisma.TransactionClient;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").replace(/\/+$/, "");

/** §Stage 7 "Nonresponders are reminded at 50% and 90% of the window." */
export const REMINDER_FRACTIONS = [0.5, 0.9] as const;

/** The statuses that mean "this invitation is still waiting on the dealership". */
export const OPEN_INVITATION_STATUSES = ["QUEUED", "SENT", "DELIVERED", "OPENED"] as const;

/** The statuses that mean the dealership answered, one way or another. */
export const ANSWERED_INVITATION_STATUSES = ["DECLINED", "RESPONDED", "OFFER_SUBMITTED"] as const;

export interface InvitationTarget {
  rooftopId: string;
  /** Null for an outside rooftop with no registered dealer. */
  dealerId: string | null;
  dealershipName: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  distanceMiles: number | null;
  /** The buyer's candidate ids this rooftop can serve (§33 #29, S7-23). */
  candidateIds: string[];
  invitationScore: number | null;
}

export interface IssueInvitationsResult {
  auctionId: string;
  issued: number;
  skipped: Array<{ rooftopId: string; reason: string }>;
  /** Raw tokens are returned ONLY so the caller can build links; never persisted or logged. */
  invitationIds: string[];
}

/**
 * Issue one invitation per rooftop, capped and deterministically ordered.
 *
 * THE CAP IS APPLIED HERE, NOT AT THE CALLER. Defect 4's shape was a cap that existed on one
 * pool and not the other, in a route. A cap in the service cannot be forgotten by the next
 * caller, and `MAX_INVITATION_FIELD` is imported from the sourcing service rather than
 * restated so §6c's "the best eight" and this cap cannot drift apart.
 *
 * IDEMPOTENT PER (auction, rooftop). Phase 1's partial unique
 * `auction_invitations_auction_rooftop_key` is the backstop and the create-then-catch-P2002
 * below is the intent — see the note at the insert for why it is not an `upsert`. A second
 * call for a rooftop that already holds a live invitation does NOT rotate its token; rotating
 * would invalidate a link a dealership may already be looking at. Rotation is
 * `replaceInvitation`'s job and it is deliberate there.
 */
export async function issueInvitations(
  auctionId: string,
  targets: InvitationTarget[],
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<IssueInvitationsResult> {
  const skipped: Array<{ rooftopId: string; reason: string }> = [];
  const invitationIds: string[] = [];

  const auction = await db.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, endsAt: true, status: true, vehicleRequestId: true },
  });
  if (!auction) throw new Error(`issueInvitations: auction ${auctionId} does not exist`);

  // Already-invited rooftops, so the cap counts the FIELD and not this call's batch. A
  // second invite round after a bounce replacement must not take the field past eight.
  const existing = await db.auctionInvitation.findMany({
    where: { auctionId, status: { notIn: ["REPLACED", "EXPIRED"] } },
    select: { rooftopId: true },
  });
  const alreadyInvited = new Set(existing.map((e) => e.rooftopId).filter(Boolean) as string[]);
  const room = Math.max(0, MAX_INVITATION_FIELD - alreadyInvited.size);

  // Deterministic order before the cap. The caller ranks; this re-sorts on the recorded
  // score and then on rooftop id so the cap cuts the same rooftops every time even if a
  // caller hands them over unsorted.
  const ordered = [...targets]
    .filter((t) => {
      if (alreadyInvited.has(t.rooftopId)) {
        skipped.push({ rooftopId: t.rooftopId, reason: "ALREADY_INVITED" });
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const sa = a.invitationScore ?? 0;
      const sb = b.invitationScore ?? 0;
      if (sb !== sa) return sb - sa;
      const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
      const dbb = b.distanceMiles ?? Number.POSITIVE_INFINITY;
      if (da !== dbb) return da - dbb;
      return a.rooftopId < b.rooftopId ? -1 : a.rooftopId > b.rooftopId ? 1 : 0;
    });

  for (const [i, t] of ordered.entries()) {
    if (i >= room) {
      skipped.push({ rooftopId: t.rooftopId, reason: "FIELD_CAP_REACHED" });
      continue;
    }

    // THE OPT-OUT IS A PRECONDITION, NOT A FOOTER. `buildUnsubscribeUrl` returns null when
    // no signing secret is provisioned, and an invitation with no working opt-out is one we
    // must not send to an address that never opted in. Refusing is the honest failure:
    // §7 readiness then holds the auction and names the blocker, instead of the auction
    // launching on mail a recipient cannot stop.
    const unsubscribeUrl = buildUnsubscribeUrl(t.email);
    if (!unsubscribeUrl) {
      skipped.push({ rooftopId: t.rooftopId, reason: "NO_UNSUBSCRIBE_CHANNEL" });
      continue;
    }

    // ONE TOKEN SCHEME FOR THE WHOLE PLATFORM. `issueInvitationToken` is the existing
    // minter and `hashToken` the existing SHA-256; only the hash is persisted. The EXPIRY
    // is overridden to the auction's own `endsAt` rather than the recruitment TTL, because
    // §Stage 7's token is "auction-and-rooftop-bound" — a link that outlives the auction it
    // belongs to is a link that can be replayed into a closed auction, which is exactly
    // what `OutsideAuctionInvite.expiresAt` was created to prevent.
    const issued = issueInvitationToken(now);
    const expiresAt = auction.endsAt ?? issued.expiresAt;

    try {
      // CREATE-THEN-CATCH-P2002, not `upsert`, and the reason is the schema rather than taste.
      // The dedup constraint is a PARTIAL unique — `auction_invitations_auction_rooftop_key ON
      // (auction_id, rooftop_id) WHERE rooftop_id IS NOT NULL`, Phase 1's
      // `migration.sql:1093` — and Prisma cannot express a `WHERE`-predicated unique, so it is
      // absent from `schema.prisma` and there is no compound `where` key to upsert on.
      // Declaring a PLAIN `@@unique` to get one would change the index Prisma believes in and
      // push `drift-baseline.json` above its pinned 344.
      //
      // So the database is the authority and this is the same idiom `openSourcingCase` uses
      // against the same class of constraint: attempt the insert, and read back the row that
      // won. `withSavepoint` is required because a caller may hand us a TRANSACTION client —
      // launch readiness does — and PostgreSQL aborts the whole transaction on a constraint
      // violation, so the re-read would otherwise throw 25P02 on an aborted transaction.
      let row: { id: string } | null = null;
      try {
        row = await withSavepoint(db, () =>
          db.auctionInvitation.create({
            data: {
              auctionId,
              rooftopId: t.rooftopId,
              dealerId: t.dealerId,
              isRegisteredDealer: t.dealerId !== null,
              dealershipName: t.dealershipName,
              contactName: t.contactName,
              email: t.email,
              phone: t.phone,
              distanceMiles: t.distanceMiles,
              candidateIds: t.candidateIds,
              invitationScore: t.invitationScore,
              tokenHash: issued.tokenHash,
              expiresAt,
              status: "QUEUED",
              queuedAt: now,
            },
            select: { id: true },
          }),
        );
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== "P2002") throw err;
        // Another writer got there first. Take its row and send nothing new: the token it
        // minted is the one in the dealership's inbox, and ours is discarded unused.
        const won = await db.auctionInvitation.findFirst({
          where: { auctionId, rooftopId: t.rooftopId },
          select: { id: true },
        });
        if (!won) throw err; // the unique violation was on something else entirely
        skipped.push({ rooftopId: t.rooftopId, reason: "ALREADY_INVITED_CONCURRENTLY" });
        continue;
      }
      if (!row) {
        skipped.push({ rooftopId: t.rooftopId, reason: "WRITE_FAILED" });
        continue;
      }
      invitationIds.push(row.id);

      // §25.1 / 25-10 — the firewall state, written WITH the invitation. Phase 7 lifts it at
      // reaffirmation; nothing here writes LIFTED.
      await writeWithheldFirewallEntry(auctionId, t.rooftopId, t.dealerId, db, now);

      // The emailed link carries the RAW token. It is never persisted and never logged.
      await enqueueDealerInvitation(
        {
          invitationId: row.id,
          auctionId,
          vehicleRequestId: auction.vehicleRequestId,
          rawToken: issued.rawToken,
          target: t,
          deadline: expiresAt,
          unsubscribeUrl,
        },
        db,
      );
    } catch (err) {
      // One rooftop failing must not abandon the field. The readiness check re-runs and the
      // rooftop is retried, because the upsert is keyed rather than appended.
      logger.warn(`[invitation] could not issue for rooftop ${t.rooftopId} on auction ${auctionId}:`, err);
      skipped.push({ rooftopId: t.rooftopId, reason: "WRITE_FAILED" });
    }
  }

  logger.info(
    `[invitation] auction ${auctionId}: issued ${invitationIds.length}, skipped ${skipped.length} ` +
      `(field was ${alreadyInvited.size}, room ${room})`,
  );
  return { auctionId, issued: invitationIds.length, skipped, invitationIds };
}

/**
 * §25.1 / §10.6 25-10 — one WITHHELD entry per auction and rooftop.
 *
 * Best-effort by design? NO. This one throws. §25.1 is a compliance boundary: the record
 * that buyer identity was withheld from a given dealership for a given auction is what makes
 * the Phase 7 lift auditable, and an invitation sent without it would leave no evidence the
 * firewall ever applied. The caller is inside `issueInvitations`' per-rooftop try/catch, so a
 * failure skips that rooftop rather than the field — which is the correct blast radius.
 */
async function writeWithheldFirewallEntry(
  auctionId: string,
  rooftopId: string,
  dealerId: string | null,
  db: Db,
  now: Date,
): Promise<void> {
  await db.identityFirewallEntry.upsert({
    where: { auctionId_rooftopId: { auctionId, rooftopId } },
    create: {
      id: randomUUID(),
      auctionId,
      rooftopId,
      dealerId,
      // No `flag`: this is firewall STATE, not a circumvention alert. Phase 5's migration is
      // what made `flag` nullable so this row can exist.
      state: "WITHHELD",
      description:
        "Buyer identity withheld from this rooftop for this auction (§25.1). Released only at " +
        "Stage 10 reaffirmation, by Phase 7.",
      createdAt: now,
    },
    update: {},
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// The dispatcher calls — every dealer-facing send, on one rail
// ───────────────────────────────────────────────────────────────────────────────

interface EnqueueInvitationInput {
  invitationId: string;
  auctionId: string;
  vehicleRequestId: string | null;
  rawToken: string;
  target: InvitationTarget;
  deadline: Date;
  unsubscribeUrl: string;
}

/**
 * Build the §Stage 7 payload from the request, and enqueue it.
 *
 * NO BUYER IDENTITY REACHES THIS FUNCTION. The select below asks for the request's criteria
 * and its city/state — "the buyer's general location" §25.1 permits — and nothing else. There
 * is no buyer relation in the query, so there is no buyer name, email, phone or street
 * address available to leak even by mistake.
 */
async function enqueueDealerInvitation(input: EnqueueInvitationInput, db: Db): Promise<void> {
  const content = await buildInvitationContent(input, db);
  if (!content) {
    logger.warn(`[invitation] no content for invitation ${input.invitationId} — not enqueued`);
    return;
  }
  const rendered = renderDealerInvitation(content);
  await enqueueTransactional(
    {
      triggerEvent: "auction.invitation.issued",
      templateKey: PHASE_5_TEMPLATES.DEALER_INVITED,
      channel: "email",
      recipientKind: "dealer",
      recipientId: input.target.dealerId,
      to: input.target.email,
      auctionId: input.auctionId,
      vehicleRequestId: input.vehicleRequestId,
      // THE DEDUP KEY IS THE INVITATION, NOT THE ADDRESS. `sendDealerInvitationEmail` on the
      // legacy rail keyed on the address alone, so the admin resend route rotated the token
      // and then silently returned DUPLICATE — handing a dealership a link that no longer
      // worked. Keyed on the invitation id, a replacement invitation is a different message.
      idempotencyKey: `${PHASE_5_TEMPLATES.DEALER_INVITED}:email:${input.invitationId}`,
      // §Stage 7's recovery window: cancelling every outstanding send for an auction is one
      // key, which is what a cancellation (§24, Phase 10) and a bounce replacement both need.
      cancelKey: `auction-invitation:${input.auctionId}:${input.target.rooftopId}`,
      payload: {
        email: input.target.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        type: "transactional",
        // DEFECT 1. A dealer invitation is solicited B2B outreach, not the recipient's own
        // receipt, so the FULL suppression store applies — including `unsubscribed`, which
        // the hard tier ignores and which AutoLenis' own one-click link writes.
        suppressionTier: "full",
        listUnsubscribeUrl: input.unsubscribeUrl,
        idempotencyKey: `${PHASE_5_TEMPLATES.DEALER_INVITED}:email:${input.invitationId}`,
        // Read by the state recheck at dispatch, so a replaced, declined, expired or
        // suspended invitation is never sent.
        invitationId: input.invitationId,
      },
    },
    db,
  );
}

async function buildInvitationContent(
  input: EnqueueInvitationInput,
  db: Db,
): Promise<DealerInvitationContent | null> {
  if (!input.vehicleRequestId) return null;
  const req = await db.vehicleRequest.findUnique({
    where: { id: input.vehicleRequestId },
    select: {
      // Criteria only, plus the GENERAL location §25.1 permits. No buyer relation.
      makePreference: true,
      modelPreference: true,
      yearMin: true,
      yearMax: true,
      maxMileage: true,
      // §Stage 7's "required-versus-preferred feature distinction" — two separate columns,
      // sent as two separate lists. Collapsing them would lose exactly the distinction the
      // spec names, and a dealership reading one list cannot tell which features it may
      // substitute on.
      requiredFeatures: true,
      preferredFeatures: true,
      city: true,
      state: true,
      zip: true,
      tradeElected: true,
      deliveryPreference: true,
    },
  });
  if (!req) return null;

  const generalLocation =
    [req.city, req.state].filter(Boolean).join(", ") || req.zip || "the local area";

  return {
    dealershipName: input.target.dealershipName,
    contactName: input.target.contactName,
    generalLocation,
    distanceMiles: input.target.distanceMiles,
    criteria: {
      yearMin: req.yearMin,
      yearMax: req.yearMax,
      make: req.makePreference,
      model: req.modelPreference,
      // `vehicle_requests` carries no trim column — the buyer states make/model/year and
      // features, and trim is what the DEALERSHIP proposes. Sent as null rather than
      // invented, so the invitation never implies a trim the buyer did not ask for.
      trim: null,
      requiredFeatures: req.requiredFeatures ?? [],
      preferredFeatures: req.preferredFeatures ?? [],
      maxMileage: req.maxMileage,
    },
    candidateCount: input.target.candidateIds.length,
    tradeIndicated: req.tradeElected === true,
    deliveryPreference: req.deliveryPreference,
    deadline: input.deadline,
    submitUrl: `${APP_URL}/dealer/invitation/${encodeURIComponent(input.rawToken)}`,
    unsubscribeUrl: input.unsubscribeUrl,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// S7-14b — per-invitation tracking across the ten-state enum
// ───────────────────────────────────────────────────────────────────────────────

/**
 * §Stage 7 "Tracked per invitation. Queued, sent, delivered, opened, bounced, declined,
 * responded, offer submitted."
 *
 * MONOTONIC, and that is the whole design. Provider webhooks arrive out of order — Resend can
 * deliver an `email.opened` before its `email.delivered` — and a naive last-write-wins would
 * walk an invitation backwards from OPENED to DELIVERED and make the funnel lie. The rank
 * below is the order of PROGRESS, not the order of arrival: a lower-ranked event stamps its
 * timestamp (the fact happened) but never lowers the status.
 *
 * BOUNCED, DECLINED and REPLACED are terminal-ish and outrank the delivery states, because
 * each is a fact about the invitation rather than about the message.
 */
const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  RESPONDED: 4,
  OFFER_SUBMITTED: 5,
  DECLINED: 6,
  BOUNCED: 7,
  EXPIRED: 8,
  REPLACED: 9,
};

export type InvitationEvent =
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "BOUNCED"
  | "DECLINED"
  | "RESPONDED"
  | "OFFER_SUBMITTED"
  | "EXPIRED";

const EVENT_TIMESTAMP: Record<InvitationEvent, string> = {
  SENT: "sentAt",
  DELIVERED: "deliveredAt",
  OPENED: "openedAt",
  BOUNCED: "bouncedAt",
  DECLINED: "declinedAt",
  RESPONDED: "respondedAt",
  OFFER_SUBMITTED: "offerSubmittedAt",
  EXPIRED: "expiresAt",
};

export interface RecordEventResult {
  ok: boolean;
  /** False when the event was recorded but did not advance the status (out-of-order arrival). */
  statusAdvanced: boolean;
  reason?: string;
}

/**
 * Record one delivery or response event on an invitation.
 *
 * The ONE writer of `auction_invitations.status`. A second writer is how the legacy rails
 * came to disagree about whether a dealer had been reached.
 */
export async function recordInvitationEvent(
  invitationId: string,
  event: InvitationEvent,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<RecordEventResult> {
  const inv = await db.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, status: true, auctionId: true, rooftopId: true, dealershipName: true, email: true },
  });
  if (!inv) return { ok: false, statusAdvanced: false, reason: "INVITATION_NOT_FOUND" };

  const currentRank = STATUS_RANK[inv.status] ?? 0;
  const eventRank = STATUS_RANK[event] ?? 0;
  const advance = eventRank > currentRank;

  const data: Record<string, unknown> = { [EVENT_TIMESTAMP[event]]: now };
  if (advance) data.status = event;

  await db.auctionInvitation.update({ where: { id: invitationId }, data });

  if (!advance) {
    logger.info(
      `[invitation] ${invitationId}: ${event} recorded out of order (status stays ${inv.status})`,
    );
  }
  return { ok: true, statusAdvanced: advance };
}

/**
 * S7-21 / §26 "Invitation bounced → Operations → Replace contact or rooftop inside the
 * window", and S7-15's replacement.
 *
 * TWO EFFECTS, IN THIS ORDER: the exception is raised first, then the outstanding reminders
 * for that rooftop are cancelled. Raising first means a failure to cancel still leaves an
 * Operations task; cancelling first would mean a failure to raise leaves neither.
 */
export async function handleInvitationBounce(
  invitationId: string,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<void> {
  const inv = await db.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true, auctionId: true, rooftopId: true, dealerId: true, dealershipName: true,
      email: true, auction: { select: { endsAt: true, vehicleRequestId: true } },
    },
  });
  if (!inv) return;

  await recordInvitationEvent(invitationId, "BOUNCED", db, now);

  await raiseException(
    {
      code: "INVITATION_BOUNCED",
      auctionId: inv.auctionId,
      vehicleRequestId: inv.auction?.vehicleRequestId ?? null,
      dealerId: inv.dealerId,
      idempotencyKey: `INVITATION_BOUNCED:${invitationId}`,
      detail:
        `${inv.dealershipName ?? "rooftop"} (${inv.email ?? "no address"}), rooftop ` +
        `${inv.rooftopId ?? "unresolved"}` +
        (inv.auction?.endsAt ? `; auction closes ${inv.auction.endsAt.toISOString()}` : ""),
    },
    db,
  );

  // The reminders for a bounced address would bounce too, and each one consumes a delivery
  // attempt and a little sender reputation.
  if (inv.rooftopId) {
    const { cancelByKey } = await import("@/lib/services/comms/transactional-dispatcher.service");
    await cancelByKey(
      `auction-invitation:${inv.auctionId}:${inv.rooftopId}`,
      "invitation bounced",
      db,
    );
  }
}

/**
 * S7-15 — "An undeliverable contact or rooftop is replaced early in the auction window where
 * possible." The old row becomes REPLACED; a new invitation is issued for the replacement.
 *
 * ROTATES THE TOKEN, deliberately, which `issueInvitations` does not. A replacement is a
 * different invitation to a different address, and the old token must stop working — that is
 * the difference between replacing a contact and re-sending to one.
 */
export async function replaceInvitation(
  invitationId: string,
  replacement: InvitationTarget,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<IssueInvitationsResult | null> {
  const old = await db.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, auctionId: true, rooftopId: true, status: true },
  });
  if (!old) return null;

  // Mark REPLACED first. If the new issue fails, the field is short by one and readiness
  // reports it — which is recoverable. The reverse order could leave two live invitations for
  // one rooftop, which the partial unique would refuse anyway, so this order is also the only
  // one that works.
  await db.auctionInvitation.update({
    where: { id: invitationId },
    data: { status: "REPLACED" },
  });

  if (old.rooftopId) {
    const { cancelByKey } = await import("@/lib/services/comms/transactional-dispatcher.service");
    await cancelByKey(
      `auction-invitation:${old.auctionId}:${old.rooftopId}`,
      "invitation replaced",
      db,
    );
  }

  return issueInvitations(old.auctionId, [replacement], db, now);
}

// ───────────────────────────────────────────────────────────────────────────────
// S7-16 / defect 5 — ONE reminder schedule, at 50% and 90% of the window
// ───────────────────────────────────────────────────────────────────────────────

export interface ReminderSweepResult {
  auctionsConsidered: number;
  enqueued50: number;
  enqueued90: number;
  skipped: number;
}

/**
 * The ONE dealer reminder rail. §Stage 7: "Nonresponders are reminded at 50% and 90% of the
 * window."
 *
 * WHAT THIS RETIRES, AND WHY THE CONSOLIDATION IS A BUG FIX RATHER THAN A TIDY-UP. Three
 * rails existed and they actively broke each other:
 *
 *   (a) QStash `/api/jobs/dealer-invited` → `/api/jobs/dealer-bid-reminder` at +24h, then
 *       touch 2 at +42h. Both send SMS to dealerships through `notifyContact`, with none of
 *       the consent checks the shared gate applies — and the rail is already unreachable from
 *       the scheduler (`lifecycle-scheduler.ts:306-307` forces the internal path;
 *       `lifecycle-touch-drain.service.ts:330` makes `dealer_invited` single-touch), so the
 *       comment at `dealer-invitation.service.ts:419` claiming "default QStash" is stale.
 *   (b) Hourly cron `/api/cron/dealer-invitation-reminder`, a 5h–7h-to-deadline window,
 *       email only. It selects `respondedAt` (:48) and never uses it (:93-97 skips only on a
 *       SUBMITTED offer), so declined and bounced dealerships were chased anyway.
 *   (c) `/api/cron/auction-close` every 5 minutes, re-sending to every ACTIVE auction ending
 *       within 2h — with `vehicleMake: ''`, `vehicleModel: ''`, `vehicleYear: 0` (:84-86)
 *       interpolated straight into the subject line.
 *
 *   AND (b) SILENTLY KILLED (c). Both call `sendDealerAuctionReminderEmail`, whose idempotency
 *   key is `dealer-auction-reminder-${auctionId}-${to}` (`resend.service.ts:1671`). (b) fires
 *   first at 6h out and marks the key SENT, so every (c) reminder returns DUPLICATE (:200-202)
 *   and is never delivered. `DUPLICATE` is a resolved value, not a rejection, so the
 *   `.catch(() => {})` at `auction-close/route.ts:90` could not see it. The ≤2h "submit your
 *   offer" notice — the one with the most bid-conversion value — has never been delivered to
 *   any dealership who received the 6h one.
 *
 * FRACTIONS OF THE WINDOW, NOT FIXED OFFSETS. All three rails hard-coded hours, so an auction
 * whose `endsAt` was overridden (the admin route accepts 1–168h) got reminders at the wrong
 * moments or not at all. 50% and 90% of `startedAt → endsAt` are correct at any length.
 *
 * IDEMPOTENT THROUGH THE COLUMNS PHASE 1 PROVISIONED AND NOTHING EVER WROTE.
 * `reminder50SentAt` / `reminder90SentAt` have had zero readers and zero writers repo-wide
 * since the Phase 1 wave created them; this is their writer.
 */
export async function sweepInvitationReminders(
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = { auctionsConsidered: 0, enqueued50: 0, enqueued90: 0, skipped: 0 };

  const auctions = await db.auction.findMany({
    where: { status: "ACTIVE", endsAt: { gt: now }, startedAt: { not: null } },
    select: { id: true, startedAt: true, endsAt: true, vehicleRequestId: true },
  });
  result.auctionsConsidered = auctions.length;

  for (const a of auctions) {
    if (!a.startedAt || !a.endsAt) continue;
    const total = a.endsAt.getTime() - a.startedAt.getTime();
    if (total <= 0) continue;
    const elapsed = (now.getTime() - a.startedAt.getTime()) / total;

    // Only the rooftops that have not answered. §Stage 7 says NONRESPONDERS, and rail (b)'s
    // defect was reading `respondedAt` and then ignoring it.
    const open = await db.auctionInvitation.findMany({
      where: {
        auctionId: a.id,
        status: { in: [...OPEN_INVITATION_STATUSES] },
        declinedAt: null,
        offerSubmittedAt: null,
        respondedAt: null,
        bouncedAt: null,
        tokenHash: { not: null },
        email: { not: null },
      },
      select: {
        id: true, rooftopId: true, dealerId: true, dealershipName: true, contactName: true,
        email: true, phone: true, distanceMiles: true, candidateIds: true,
        reminder50SentAt: true, reminder90SentAt: true, expiresAt: true,
      },
    });

    for (const inv of open) {
      const due: Array<50 | 90> = [];
      if (elapsed >= 0.5 && !inv.reminder50SentAt) due.push(50);
      if (elapsed >= 0.9 && !inv.reminder90SentAt) due.push(90);
      if (due.length === 0) {
        result.skipped += 1;
        continue;
      }
      for (const pct of due) {
        const ok = await enqueueReminder(
          { auctionId: a.id, vehicleRequestId: a.vehicleRequestId, endsAt: a.endsAt, invitation: inv, percentElapsed: pct },
          db,
          now,
        );
        if (!ok) continue;
        await db.auctionInvitation.update({
          where: { id: inv.id },
          data: pct === 50 ? { reminder50SentAt: now } : { reminder90SentAt: now },
        });
        if (pct === 50) result.enqueued50 += 1;
        else result.enqueued90 += 1;
      }
    }
  }

  logger.info(
    `[invitation] reminder sweep: ${result.auctionsConsidered} auction(s), ` +
      `50%=${result.enqueued50} 90%=${result.enqueued90} skipped=${result.skipped}`,
  );
  return result;
}

async function enqueueReminder(
  input: {
    auctionId: string;
    vehicleRequestId: string | null;
    endsAt: Date;
    invitation: {
      id: string; rooftopId: string | null; dealerId: string | null;
      dealershipName: string | null; contactName: string | null; email: string | null;
      phone: string | null; distanceMiles: number | null; candidateIds: string[];
    };
    percentElapsed: 50 | 90;
  },
  db: Db,
  // Kept in the signature for symmetry with every other writer here and so a test can pin a
  // clock; the reminder's own timing comes from the auction's `endsAt`, not from `now`.
  _now: Date,
): Promise<boolean> {
  const inv = input.invitation;
  if (!inv.email) return false;
  const unsubscribeUrl = buildUnsubscribeUrl(inv.email);
  if (!unsubscribeUrl) return false;

  // A REMINDER CANNOT CARRY A LINK IT DOES NOT HAVE. The raw token is not recoverable from
  // the stored hash — that is the point of hashing it — so a reminder links to the
  // token-resolution entry point, which identifies the invitation from the dealer's side. It
  // never re-mints a token, because re-minting would invalidate the link already in their
  // inbox.
  const content = await buildInvitationContent(
    {
      invitationId: inv.id,
      auctionId: input.auctionId,
      vehicleRequestId: input.vehicleRequestId,
      rawToken: "",
      target: {
        rooftopId: inv.rooftopId ?? "",
        dealerId: inv.dealerId,
        dealershipName: inv.dealershipName ?? "your dealership",
        contactName: inv.contactName,
        email: inv.email,
        phone: inv.phone,
        distanceMiles: inv.distanceMiles,
        candidateIds: inv.candidateIds,
        invitationScore: null,
      },
      deadline: input.endsAt,
      unsubscribeUrl,
    },
    db,
  );
  if (!content) return false;

  const key = PHASE_5_TEMPLATES[input.percentElapsed === 50 ? "DEALER_INVITATION_REMINDER_50" : "DEALER_INVITATION_REMINDER_90"];
  const rendered = renderDealerInvitationReminder({
    ...content,
    submitUrl: `${APP_URL}/dealer/invitation/resume/${encodeURIComponent(inv.id)}`,
    percentElapsed: input.percentElapsed,
  });

  await enqueueTransactional(
    {
      triggerEvent: `auction.invitation.reminder.${input.percentElapsed}`,
      templateKey: key,
      channel: "email",
      recipientKind: "dealer",
      recipientId: inv.dealerId,
      to: inv.email,
      auctionId: input.auctionId,
      vehicleRequestId: input.vehicleRequestId,
      // CHANNEL-QUALIFIED AND INVITATION-SCOPED. `comms_outbox.dedup_key` is globally unique
      // and the dispatcher's derived default carries no channel, so a two-channel touch using
      // the default silently loses its second channel and returns `enqueued:false` —
      // indistinguishable from a legitimate duplicate. Every key this service writes is
      // explicit for that reason.
      idempotencyKey: `${key}:email:${inv.id}`,
      cancelKey: `auction-invitation:${input.auctionId}:${inv.rooftopId ?? inv.id}`,
      payload: {
        email: inv.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        type: "transactional",
        suppressionTier: "full",
        listUnsubscribeUrl: unsubscribeUrl,
        idempotencyKey: `${key}:email:${inv.id}`,
        invitationId: inv.id,
      },
    },
    db,
  );
  return true;
}

/**
 * S7-24 — "Dealer can decline an invitation."
 *
 * IDEMPOTENT, and it cancels the reminders. A dealership that declines and then receives two
 * more reminders has been told its answer does not count.
 */
export async function declineInvitation(
  invitationId: string,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<{ ok: boolean; alreadyDeclined: boolean }> {
  const inv = await db.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, auctionId: true, rooftopId: true, declinedAt: true, offerSubmittedAt: true },
  });
  if (!inv) return { ok: false, alreadyDeclined: false };
  if (inv.declinedAt) return { ok: true, alreadyDeclined: true };
  if (inv.offerSubmittedAt) {
    // An offer already stands. Declining after bidding is not a decline — it is a withdrawal,
    // which is Phase 6's (offer lifecycle), not this service's to improvise.
    return { ok: false, alreadyDeclined: false };
  }

  await recordInvitationEvent(invitationId, "DECLINED", db, now);
  const { cancelByKey } = await import("@/lib/services/comms/transactional-dispatcher.service");
  await cancelByKey(
    `auction-invitation:${inv.auctionId}:${inv.rooftopId ?? inv.id}`,
    "dealer declined",
    db,
  );
  return { ok: true, alreadyDeclined: false };
}

/**
 * S7-19 / defect 6 — the invitation count that covers BOTH pools.
 *
 * `deposit-activation.service.ts:133` counts `_count: { invitations: true }` only, and
 * `Auction.outsideInvites` is counted nowhere — not in the `_count` and not in the sweep
 * predicate (:334). An auction contacted only through `OutsideAuctionInvite` therefore reads
 * as zero-invitation and the reconciler closes it at the 120-minute grace, after which every
 * live token is rejected `AUCTION_INACTIVE` (`outside-invite.service.ts:54`).
 *
 * The trigger is ordinary, not hypothetical: `DEALER_REMOVED` hard-deletes invitation rows
 * (`admin/auctions/[auctionId]/action/route.ts:95-97`), so removing the last registered dealer
 * from an auction carrying live outside invites drops the count to zero.
 *
 * EXCLUDES REPLACED AND BOUNCED, per S7-19 — a bounced invitation did not reach anyone, so
 * counting it would tell the buyer a dealership was invited when it was not.
 */
export async function countReachedInvitations(
  auctionId: string,
  db: Db = defaultPrisma,
): Promise<{ total: number; unified: number; legacyOutside: number }> {
  const [unified, legacyOutside] = await Promise.all([
    db.auctionInvitation.count({
      where: { auctionId, status: { notIn: ["REPLACED", "BOUNCED", "EXPIRED"] } },
    }),
    // READS KEPT, WRITES STOPPED (§8.4). The two historical rows still count toward an
    // auction's reach, and an auction created before this phase has only these.
    db.outsideAuctionInvite.count({ where: { auctionId } }),
  ]);
  return { total: unified + legacyOutside, unified, legacyOutside };
}
