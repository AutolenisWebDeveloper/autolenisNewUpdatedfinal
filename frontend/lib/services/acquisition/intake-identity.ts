// lib/services/acquisition/intake-identity.ts
//
// Rule 16 — identity resolution, in order, enforced in code.
//
//   authenticated buyer id → valid claim token → normalised verified email.
//   Never name, never phone, never fuzzy matching.
//
// WHY THE THIRD TIER IS NOT "the email the caller typed". §7.2 records three live
// violations, and two of them are the same mistake: `/api/public/request-vehicle/complete`
// mutates a Vehicle Request found by "the buyer's most recent request BY EMAIL",
// and public intake attaches a new request to a REGISTERED buyer on an email the
// caller merely asserted. An unauthenticated visitor who types someone else's
// address reaches their account. That is not "resolving identity by verified
// email"; it is trusting an unverified claim.
//
// So the third tier means an email THE SYSTEM has verified, and a public form has
// verified nothing. The resolver therefore refuses to attach an anonymous
// submission to a registered account. Instead it captures the lead and hands back
// `REGISTERED_REQUIRES_CLAIM`, and the surface emails that address a claim link.
// Clicking it is what turns an asserted address into a verified one — tier 2 — and
// only then does anything attach. This is §6.3's guest-capture flow used as the
// verification step it already is, not a new mechanism.
//
// WHAT "VERIFIED" IS, IN THIS SCHEMA. `users` has no email-verification column:
// verification lives in Supabase Auth. The Prisma-visible fact that stands for it
// is the supabaseId prefix — a public capture writes `guest_<uuid>`
// (unified-buyer-intake.service.ts), and a real Supabase identity is only written
// by `ensurePrismaUser` at `/auth/callback`, which is reached by clicking the
// verification link. A non-`guest_` supabaseId therefore IS a verified email. This
// reads the signal the system has rather than inventing a column, and Phase 1's
// wave is the only schema wave (constraint C1).
//
// PHONE IS NORMALISED AND NEVER MATCHED ON. §7.2's remedy is explicit: "a flag,
// never a merge — on any buyer phone write that collides with another buyer's
// normalised phone, raise an Operations exception ('possible duplicate buyer') for
// an audited human merge". `flagPhoneCollision` does exactly that and returns
// nothing the caller can use to merge.
//
// Run: pnpm test:intake

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/utils/phone";
import { raiseException } from "@/lib/services/operations/queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** Which tier of rule 16 resolved the identity. */
export type IdentityTier =
  /** Tier 1 — an authenticated session supplied the buyer id. */
  | "AUTHENTICATED"
  /** Tier 2 — a valid, unconsumed claim token. */
  | "CLAIM_TOKEN"
  /** Tier 3 — an email already verified through Supabase, matched on the normalised form. */
  | "VERIFIED_EMAIL"
  /** Tier 3, guest branch — the same unverified capture as before, reused rather than duplicated. */
  | "GUEST_CAPTURE"
  /** A new guest capture. */
  | "NEW_GUEST"
  /**
   * The address belongs to a REGISTERED account and the caller has not proved they
   * control it. NOTHING is attached; the surface must issue a claim link.
   */
  | "REGISTERED_REQUIRES_CLAIM"
  /** Not enough information to resolve or create anything. */
  | "UNRESOLVED";

export interface IdentityResolution {
  tier: IdentityTier;
  buyerId: string | null;
  /** Set only for CLAIM_TOKEN — the request the token was minted for. */
  vehicleRequestId?: string | null;
  /** True when the surface must email a claim link instead of attaching. */
  requiresClaim: boolean;
  /** Normalised email, when one was supplied. */
  email: string | null;
}

export interface ResolveIdentityInput {
  /** Tier 1. From the session — NEVER from the request body. */
  authenticatedBuyerId?: string | null;
  /** Tier 2. The raw claim token from a link. */
  claimToken?: string | null;
  /** Tier 3. As typed; normalised here. */
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  zip?: string | null;
  /** Create a guest capture when nothing matches. Off for read-only resolution. */
  createIfMissing?: boolean;
}

/** Lowercase and trim. The only normalisation `users.email` (UNIQUE, exact case) needs. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 && t.includes("@") ? t : null;
}

/** A user row created by a public capture rather than by verified registration. */
export function isGuestUser(supabaseId: string | null | undefined): boolean {
  return typeof supabaseId === "string" && supabaseId.startsWith("guest_");
}

/**
 * Resolve a buyer identity in rule-16 order.
 *
 * Never matches on name, never matches on phone, never fuzzy-matches. The negative
 * test in `intake-identity.test.ts` proves it: same phone, same name, a different
 * verified email → two buyers and no merge.
 */
export async function resolveIdentity(input: ResolveIdentityInput, db: Db = prisma): Promise<IdentityResolution> {
  const email = normalizeEmail(input.email);

  // ── Tier 1: an authenticated buyer id. ────────────────────────────────────
  if (input.authenticatedBuyerId) {
    return { tier: "AUTHENTICATED", buyerId: input.authenticatedBuyerId, requiresClaim: false, email };
  }

  // ── Tier 2: a valid claim token. ──────────────────────────────────────────
  if (input.claimToken) {
    const claimed = await resolveClaimToken(input.claimToken, db);
    if (claimed) {
      return {
        tier: "CLAIM_TOKEN",
        buyerId: claimed.buyerId,
        vehicleRequestId: claimed.vehicleRequestId,
        requiresClaim: false,
        email,
      };
    }
    // An invalid or consumed token falls through to tier 3 rather than failing the
    // submission — the visitor still gets their request captured — but it never
    // grants the identity the token would have.
    logger.info("[intake-identity] claim token did not resolve; falling through to email");
  }

  // ── Tier 3: the normalised email. ─────────────────────────────────────────
  if (!email) return { tier: "UNRESOLVED", buyerId: null, requiresClaim: false, email: null };

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, supabaseId: true, buyer: { select: { id: true } } },
  });

  if (user && !isGuestUser(user.supabaseId)) {
    // A VERIFIED address that belongs to a registered account, offered by an
    // UNAUTHENTICATED caller. Rule 16 does not let an assertion stand in for
    // verification, so nothing attaches here. The surface emails a claim link; the
    // click is tier 2.
    return { tier: "REGISTERED_REQUIRES_CLAIM", buyerId: null, requiresClaim: true, email };
  }

  if (user?.buyer) {
    // The same guest capture as before. Reusing it is what stops one person's
    // repeated submissions becoming several buyers.
    return { tier: "GUEST_CAPTURE", buyerId: user.buyer.id, requiresClaim: true, email };
  }

  if (!input.createIfMissing) {
    return { tier: "UNRESOLVED", buyerId: null, requiresClaim: false, email };
  }

  const created = await createGuestCapture({ ...input, email }, db);
  return { tier: created.reusedExistingUser ? "GUEST_CAPTURE" : "NEW_GUEST", buyerId: created.buyerId, requiresClaim: true, email };
}

interface ClaimResolution {
  buyerId: string;
  vehicleRequestId: string | null;
}

/**
 * A claim token resolves to its buyer only while it is live: not expired, not
 * consumed. The token is stored as a hash, so the raw value is hashed here and
 * never compared in plaintext.
 */
async function resolveClaimToken(rawToken: string, db: Db): Promise<ClaimResolution | null> {
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const row = await db.buyerRequestClaimToken.findFirst({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { buyerId: true, vehicleRequestId: true },
  });
  if (!row) return null;
  return { buyerId: row.buyerId, vehicleRequestId: row.vehicleRequestId ?? null };
}

interface GuestCaptureResult {
  buyerId: string;
  reusedExistingUser: boolean;
}

/** Create the guest `users` + `buyers` pair for a first-time public capture. */
async function createGuestCapture(
  input: ResolveIdentityInput & { email: string },
  db: Db
): Promise<GuestCaptureResult> {
  const { randomUUID } = await import("node:crypto");
  const existingUser = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  const userId =
    existingUser?.id ??
    (
      await db.user.create({
        data: { supabaseId: `guest_${randomUUID()}`, email: input.email, role: "BUYER" },
        select: { id: true },
      })
    ).id;

  // `Buyer.userId` is @unique. Two concurrent captures of the same address can
  // both reach here — one creates the user, the other reuses it — and only one may
  // create the buyer. The loser reads the winner's row rather than surfacing a
  // P2002 to a visitor who filled in a form twice. This is §7.2 case (i) at the
  // identity layer; the open-request CAS is the same idea one level up.
  try {
    const buyer = await db.buyer.create({
      data: {
        userId,
        firstName: input.firstName ?? "",
        lastName: input.lastName ?? "",
        phone: normalizePhone(input.phone ?? undefined) || null,
        zip: input.zip ?? null,
        isGuest: true,
      },
      select: { id: true },
    });
    return { buyerId: buyer.id, reusedExistingUser: Boolean(existingUser) };
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    const winner = await db.buyer.findFirst({ where: { userId }, select: { id: true } });
    if (!winner) throw err;
    logger.info("[intake-identity] lost the guest-buyer create race; reusing the concurrent winner", { userId });
    return { buyerId: winner.id, reusedExistingUser: true };
  }
}

/**
 * §7.2 (iv): flag a phone collision, never merge on one.
 *
 * Two buyers with the same normalised phone and different verified emails are TWO
 * identities under rule 16 — the resolver above will not merge them, and neither
 * will this. What it does is tell a human, so an audited merge can happen if one is
 * warranted. It returns nothing a caller could act on automatically, by design.
 */
export async function flagPhoneCollision(buyerId: string, phone: string | null | undefined, db: Db = prisma): Promise<void> {
  const normalized = normalizePhone(phone ?? undefined);
  if (!normalized) return;

  const others = await db.buyer.findMany({
    where: { phone: normalized, id: { not: buyerId } },
    select: { id: true },
    take: 5,
  });
  if (others.length === 0) return;

  try {
    await raiseException(
      {
        // Not a lineage problem and not a payment problem: a duplicate-identity
        // condition a human resolves. §7.2's remedy is a flag for an audited human
        // merge, and no admin merge exists yet — so the exception IS the record.
        code: "LINEAGE_ORPHAN",
        buyerId,
        idempotencyKey: `POSSIBLE_DUPLICATE_BUYER:${normalized}:${[buyerId, ...others.map((o) => o.id)].sort().join("+")}`,
        detail: `possible duplicate buyer — normalised phone ${normalized} is also held by ${others.map((o) => o.id).join(", ")}. Rule 16 forbids merging on a phone; review and merge only through an audited admin action.`,
      },
      db
    );
  } catch (err) {
    // Flagging must never fail a capture. The collision stays in the data and the
    // next write flags it again.
    logger.error("[intake-identity] phone-collision flag failed", {
      buyerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
