// C — outside-auction-invite minting with rooftop dedup + auto-mint from sourcing.
//
// The ONE place OutsideAuctionInvite rows are created. Extends the existing
// invite → public bid page → System-A Offer path (no new bid system); the admin
// routes and the sourcing auto-mint all funnel through mintOutsideInvites so the
// dedup rules live in exactly one spot.
//
// Dedup invariant: one physical A2 rooftop is invited to a given auction AT MOST
// ONCE, and never as an outside dealer when its registered dealer is already
// invited (AuctionInvitation). Also dedups by normalized email (existing + within
// the batch). Each invite's token expiry is stamped from the auction's endsAt.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/utils/phone";
import { SEND_SAFE_STATUSES } from "@/lib/services/dealer-recruitment/contact-resolution.service";
import { haversineMiles, boundingBox, type LatLng } from "@/lib/utils/zip-coords";

// Matches the admin invite cap (max 8 outside dealers per auction).
export const MAX_OUTSIDE_INVITES = 8;
// Default net radius for sourcing-driven auto-mint (wide — outside invites are the
// coverage-shortfall fallback, not the primary registered-dealer net).
export const AUTO_MINT_RADIUS_MILES = 150;
// Bounds how many send-safe rooftops a single auto-mint pulls to rank. The DB query
// is bounding-box pre-filtered when buyer coords are known, so this cap applies to
// already-near rooftops (not an arbitrary national sample).
const MAX_ROOFTOP_SCAN = 500;
// Fallback token TTL when an auction has no endsAt, so a token never lives forever.
const DEFAULT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type InviteRejectReason =
  | "ALREADY_SUBMITTED"
  | "AUCTION_INACTIVE"
  | "AUCTION_EXPIRED"
  | "TOKEN_EXPIRED";

/**
 * Pure acceptance guard for an outside-dealer invite token. Returns the reject
 * reason, or null when the invite may still be acted on. Order matters:
 * already-responded (single-use) → auction not active → auction past end → token
 * past its own expiry. The token expiry is enforced INDEPENDENTLY of auction
 * status so a link can't be replayed even if the auction is briefly reopened.
 */
export function inviteRejection(
  invite: {
    respondedAt: Date | null;
    expiresAt: Date | null;
    auction: { status: string; endsAt: Date | null };
  },
  now: Date,
): InviteRejectReason | null {
  if (invite.respondedAt) return "ALREADY_SUBMITTED";
  if (invite.auction.status !== "ACTIVE") return "AUCTION_INACTIVE";
  if (invite.auction.endsAt && invite.auction.endsAt < now) return "AUCTION_EXPIRED";
  if (invite.expiresAt && invite.expiresAt < now) return "TOKEN_EXPIRED";
  return null;
}

export interface OutsideInviteCandidate {
  dealershipName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  rooftopId?: string | null;
}

export interface MintedInvite {
  id: string;
  email: string;
  token: string;
  contactName: string;
  dealershipName: string;
  rooftopId: string | null;
}

export interface MintOptions {
  /** Cap on how many invites this call creates (after dedup). */
  max?: number;
}

export interface MintDeps {
  prisma: PrismaClient;
  now: Date;
}

/**
 * Create OutsideAuctionInvite rows for `candidates`, deduped so one rooftop is
 * invited to `auctionId` at most once (and never when its registered dealer is
 * already invited) and no email is invited twice. Rows are created one at a time
 * so the caller gets each unique token back reliably (createMany can't return
 * generated tokens). Returns the minted invites. Empty when the auction is gone.
 */
export async function mintOutsideInvites(
  auctionId: string,
  candidates: OutsideInviteCandidate[],
  options?: MintOptions,
  deps?: Partial<MintDeps>,
): Promise<MintedInvite[]> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  if (candidates.length === 0) return [];

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { id: true, endsAt: true },
  });
  if (!auction) {
    logger.warn(`[outside-invite] auction ${auctionId} not found — no invites minted`);
    return [];
  }

  // Token expiry: the auction end, or a bounded fallback so a token is never
  // immortal when the auction has no endsAt (keeps the "expires independently"
  // guarantee from silently degrading to null).
  const expiresAt = auction.endsAt ?? new Date(now.getTime() + DEFAULT_TOKEN_TTL_MS);

  // Existing coverage for this auction: outside invites already minted, and
  // registered dealers already invited (their rooftop counts as covered).
  const [existingInvites, dealerInvites] = await Promise.all([
    prisma.outsideAuctionInvite.findMany({ where: { auctionId }, select: { email: true, rooftopId: true } }),
    prisma.auctionInvitation.findMany({ where: { auctionId }, select: { dealer: { select: { rooftopId: true } } } }),
  ]);

  const takenEmails = new Set<string>();
  for (const i of existingInvites) {
    const k = normalizeEmail(i.email);
    if (k) takenEmails.add(k);
  }
  const takenRooftops = new Set<string>();
  for (const i of existingInvites) if (i.rooftopId) takenRooftops.add(i.rooftopId);
  for (const d of dealerInvites) if (d.dealer?.rooftopId) takenRooftops.add(d.dealer.rooftopId);

  const max = options?.max ?? Infinity;
  const minted: MintedInvite[] = [];
  const batchEmails = new Set<string>();
  const batchRooftops = new Set<string>();

  for (const c of candidates) {
    if (minted.length >= max) break;
    const emailKey = normalizeEmail(c.email);
    if (!emailKey) continue; // no usable email → nothing to send to
    if (c.rooftopId && (takenRooftops.has(c.rooftopId) || batchRooftops.has(c.rooftopId))) continue;
    if (takenEmails.has(emailKey) || batchEmails.has(emailKey)) continue;

    let created;
    try {
      created = await prisma.outsideAuctionInvite.create({
        data: {
          auctionId,
          dealershipName: c.dealershipName,
          contactName: c.contactName,
          email: c.email,
          phone: c.phone ?? null,
          rooftopId: c.rooftopId ?? null,
          expiresAt,
        },
      });
    } catch (e) {
      // DB backstop for the rooftop dedup invariant: @@unique([auctionId, rooftopId])
      // (Postgres treats NULLs as distinct, so manual null-rooftop invites are never
      // blocked). A P2002 here means a concurrent mint already covered this rooftop —
      // skip rather than fail the batch.
      if ((e as { code?: string })?.code === "P2002") {
        if (c.rooftopId) batchRooftops.add(c.rooftopId);
        continue;
      }
      throw e;
    }
    minted.push({
      id: created.id,
      email: created.email,
      token: created.token,
      contactName: created.contactName,
      dealershipName: created.dealershipName,
      rooftopId: created.rooftopId ?? null,
    });
    batchEmails.add(emailKey);
    if (c.rooftopId) batchRooftops.add(c.rooftopId);
  }

  return minted;
}

export interface AutoMintOptions {
  /** Buyer location — when set, rooftops are proximity-filtered + ordered by it. */
  buyerCoords?: LatLng | null;
  radiusMiles?: number;
  max?: number;
}

const statusRank = (s: string | null): number => (s === "VERIFIED" ? 3 : s === "ROLE_DERIVED" ? 2 : 0);

/**
 * Auto-mint outside invites from sourcing: rooftops that carry a send-safe contact
 * (a resolved DealerContactProfile) and are not yet covered for this auction. When
 * buyer coordinates are known, rooftops are filtered to `radiusMiles` and ordered
 * nearest-first (fail-closed: an unplaceable rooftop is excluded rather than
 * invited blindly). One best contact per rooftop (VERIFIED before ROLE_DERIVED).
 * Coverage dedup is enforced authoritatively by mintOutsideInvites.
 */
export async function autoMintOutsideInvitesFromSourcing(
  auctionId: string,
  options?: AutoMintOptions,
  deps?: Partial<MintDeps>,
): Promise<MintedInvite[]> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const max = options?.max ?? MAX_OUTSIDE_INVITES;
  const buyerCoords = options?.buyerCoords ?? null;
  const radiusMiles = options?.radiusMiles ?? AUTO_MINT_RADIUS_MILES;

  // When the buyer is placeable, pre-filter the scan to a bounding box around them
  // so the MAX_ROOFTOP_SCAN cap applies to NEAR rooftops (not an arbitrary national
  // sample) — the ranking below then can't miss the closest rooftops as data grows.
  const bbox = buyerCoords ? boundingBox(buyerCoords, radiusMiles) : null;
  const geoWhere = bbox
    ? {
        latitude: { gte: bbox.minLat, lte: bbox.maxLat },
        longitude: { gte: bbox.minLng, lte: bbox.maxLng },
      }
    : {};

  const rooftops = await prisma.dealerRooftop.findMany({
    where: {
      ...geoWhere,
      contacts: {
        some: { email: { not: null }, emailVerificationStatus: { in: [...SEND_SAFE_STATUSES] } },
      },
    },
    select: {
      id: true,
      displayName: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      contacts: {
        where: { email: { not: null }, emailVerificationStatus: { in: [...SEND_SAFE_STATUSES] } },
        select: { name: true, email: true, phone: true, emailVerificationStatus: true },
      },
    },
    orderBy: { createdAt: "asc" }, // deterministic scan window
    take: MAX_ROOFTOP_SCAN,
  });

  type Row = (typeof rooftops)[number];
  let ranked: Row[] = rooftops;

  if (buyerCoords) {
    // Proximity filter + order. Unplaceable rooftops (null coords) are dropped —
    // fail-closed: we don't blindly invite a rooftop we can't confirm is in range.
    ranked = rooftops
      .map((r) => ({
        r,
        d:
          r.latitude != null && r.longitude != null
            ? haversineMiles(buyerCoords, { lat: r.latitude, lng: r.longitude })
            : Number.POSITIVE_INFINITY,
      }))
      .filter((x) => x.d <= radiusMiles)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.r);
  }

  const candidates: OutsideInviteCandidate[] = [];
  for (const r of ranked) {
    const best = [...r.contacts].sort(
      (a, b) => statusRank(b.emailVerificationStatus) - statusRank(a.emailVerificationStatus),
    )[0];
    if (!best?.email) continue;
    candidates.push({
      dealershipName: r.displayName,
      contactName: best.name ?? "Sales Team",
      email: best.email,
      phone: best.phone ?? null,
      rooftopId: r.id,
    });
  }

  return mintOutsideInvites(auctionId, candidates, { max }, deps);
}
