// lib/services/acquisition/guest-verification.service.ts
//
// §27.1 ROWS 3-4 AND 9-11 — the guest's claim link, and the three reminders that follow it.
//
// ── WHAT WAS THERE BEFORE ───────────────────────────────────────────────────
//
// Nothing. `guest_capture_claim`, `verification_reminder_1h`, `verification_reminder_24h`
// and `verification_reminder_72h` were four registered §27.1 template keys with registered
// state rechecks (`skipIfAlreadyClaimed`, `skipIfVerified`) and NO ENQUEUE SITE — messages
// the register described and the system never sent. A visitor who filled in a public form
// got a saved request, a `buyers` row they could not reach, and silence.
//
// The registered-address sibling DID exist (`REGISTERED_CLAIM_PROMPT`, in
// `unified-buyer-intake.service.ts`), which is what made the gap hard to see: the rarer
// case was handled and the ordinary one was not.
//
// ── THE CREDENTIAL IS SENT ONCE ─────────────────────────────────────────────
//
// The claim token is a live write credential with a days-long life. It goes in the FIRST
// message and in no other: the three reminders are enqueued hours or days ahead of being
// sent, so a copy in each would leave the same credential sitting in four outbox payloads
// at rest to save the reader one click. A reminder says where the link is and points at the
// public site; `skipIfVerified` is what stops it being sent at all once the account is
// claimed.
//
// ── ONE CANCEL HANDLE ───────────────────────────────────────────────────────
//
// The same shape `draft-recovery.service.ts` uses, for the same reason: when the guest
// claims, the whole sequence stops together rather than one row at a time. The rechecks are
// the second guard — a row that escapes the cancel is still re-evaluated at send.
//
// Run: pnpm test:intake

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { enqueueTransactional, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_2_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { renderGuestCaptureClaim, renderVerificationReminder } from "@/lib/services/comms/phase2-email-content";

type Db = typeof prisma | Prisma.TransactionClient;

const HOUR = 3_600_000;

/** §27.1's three reminders, with their delays. Hours are part of the template key. */
export const VERIFICATION_REMINDERS = [
  { template: PHASE_2_TEMPLATES.VERIFICATION_REMINDER_1H, hours: 1 as const, trigger: "verification_reminder_1h" },
  { template: PHASE_2_TEMPLATES.VERIFICATION_REMINDER_24H, hours: 24 as const, trigger: "verification_reminder_24h" },
  { template: PHASE_2_TEMPLATES.VERIFICATION_REMINDER_72H, hours: 72 as const, trigger: "verification_reminder_72h" },
] as const;

/** One handle for the claim message and its three reminders. */
export function guestVerificationCancelKey(buyerId: string): string {
  return `guest_verification:${buyerId}`;
}

export interface GuestVerificationInput {
  buyerId: string;
  /**
   * The address the CALLER supplied. It is checked against the account's own address and is
   * NEVER used for delivery — see the refusal in `enqueueGuestVerification`.
   */
  email: string;
  firstName?: string | null;
  /** Carried onto the rows so an Operations exception can name the request. */
  vehicleRequestId?: string | null;
  /** Overrides "now", for tests. */
  from?: Date;
}

export interface GuestVerificationResult {
  claimSent: boolean;
  remindersEnqueued: number;
  cancelKey: string;
  /** Why nothing was sent, when nothing was. */
  reason: string;
}

/**
 * Enqueue the claim link and the three reminders for a freshly captured GUEST.
 *
 * REFUSES A NON-GUEST, and that refusal is the point rather than a precaution: this is
 * called from a public route where the same address may already belong to a claimed
 * account, and minting a claim credential for one would be an account-takeover primitive
 * handed out by a form. The identity layer already distinguishes the two
 * (`intake-identity.ts`); this re-reads the buyer rather than trusting the caller, because
 * the caller is unauthenticated.
 *
 * Idempotent per buyer: an existing live claim token means the link is already in that
 * inbox, so nothing is re-minted and nothing is re-sent — the same rule
 * `REGISTERED_CLAIM_PROMPT` applies one branch over.
 */
export async function enqueueGuestVerification(
  input: GuestVerificationInput,
  db: Db = prisma,
): Promise<GuestVerificationResult> {
  const cancelKey = guestVerificationCancelKey(input.buyerId);
  const nothing = (reason: string): GuestVerificationResult => ({
    claimSent: false,
    remindersEnqueued: 0,
    cancelKey,
    reason,
  });

  const buyer = await db.buyer.findUnique({
    where: { id: input.buyerId },
    select: {
      id: true,
      isGuest: true,
      firstName: true,
      user: { select: { supabaseId: true, email: true } },
    },
  });
  if (!buyer) return nothing("buyer_not_found");
  // BOTH halves, because they can disagree: `isGuest` is the intake flag and the
  // `guest_` prefix is the identity fact `skipIfVerified` reads. A row where either says
  // "claimed" is not a guest capture.
  const looksGuest = buyer.isGuest && (buyer.user?.supabaseId ?? "").startsWith("guest_");
  if (!looksGuest) return nothing("not_a_guest");

  // ── THE CREDENTIAL IS ADDRESSED FROM THE ACCOUNT, NEVER FROM THE REQUEST ───
  //
  // Found by the SECOND independent review, and the `looksGuest` guard above does not close
  // it — it checks WHOSE account, and the hole was WHERE THE MAIL GOES.
  //
  // The attack, end to end: a caller POSTs to the public route with a live claim token for
  // guest buyer G (forwarded, leaked, or read from a shared inbox) and an `email` of their own
  // choosing. `resolveIdentity` resolves tier CLAIM_TOKEN and `buyerId = G`
  // (`intake-identity.ts:139-150`); the intake CONSUMES that token inside its transaction
  // (`unified-buyer-intake.service.ts:735-737`), which is precisely the "a forwarded link works
  // once" guarantee. G is still `isGuest`, so `looksGuest` passes; the token was just spent, so
  // `findLiveClaimToken` finds none. A FRESH five-day claim credential is then minted for G and
  // mailed to the attacker's address — a single-use leak converted into a renewable one,
  // delivered to a mailbox the guest does not control.
  //
  // Two changes close it, and the second is the one that matters:
  //   1. delivery uses `users.email` — the account's own address, read here — so a credential
  //      for G can only ever reach G;
  //   2. a supplied address that DISAGREES with the account is refused outright rather than
  //      quietly redirected, because on this route the two agreeing is the ordinary case (the
  //      guest row was just created from that same address) and a disagreement means the
  //      caller is acting on an account that is not theirs.
  const accountEmail = (buyer.user?.email ?? "").trim().toLowerCase();
  if (!accountEmail) return nothing("no_account_email");
  if (accountEmail !== input.email.trim().toLowerCase()) {
    logger.warn(
      "[guest-verification] refused: the supplied address does not match the account's own",
      { buyerId: input.buyerId },
    );
    return nothing("address_mismatch");
  }

  const { issueResumeToken, findLiveClaimToken, TOKEN_PURPOSE } = await import(
    "@/lib/services/buyer/request-resume-token.service"
  );
  const live = await findLiveClaimToken(input.buyerId, db);
  if (live) {
    logger.info("[guest-verification] claim link already live — sequence not re-enqueued", {
      buyerId: input.buyerId,
      expiresAt: live.expiresAt.toISOString(),
    });
    return nothing("claim_link_already_live");
  }

  const { rawToken, tokenId } = await issueResumeToken(
    { buyerId: input.buyerId, purpose: TOKEN_PURPOSE.CLAIM },
    db,
  );
  const siteUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const claimUrl = `${siteUrl}/request-vehicle?claim=${encodeURIComponent(rawToken)}`;
  const firstName = input.firstName ?? buyer.firstName ?? null;
  const base = (input.from ?? new Date()).getTime();

  // THE CLAIM LINK. Keyed on the TOKEN, matching `REGISTERED_CLAIM_PROMPT`: one live
  // credential, one message carrying it, and a later legitimate capture months on gets its
  // own token and its own message rather than being suppressed for ever.
  const claimKey = `${PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM}:${input.buyerId}:${tokenId}`;
  const claim = renderGuestCaptureClaim({ firstName, claimUrl });
  await enqueueTransactional(
    {
      triggerEvent: "guest_capture",
      templateKey: PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM,
      channel: "email",
      recipientKind: "buyer",
      recipientId: input.buyerId,
      to: accountEmail,
      vehicleRequestId: input.vehicleRequestId ?? null,
      idempotencyKey: claimKey,
      cancelKey,
      payload: { email: accountEmail, subject: claim.subject, html: claim.html, text: claim.text },
    },
    db,
  );

  // THE REMINDERS. Keyed on the TOKEN as well, so they belong to this credential's life:
  // a second capture after the first token expires gets its own three, which is correct —
  // it is a new attempt by someone who never got in.
  let remindersEnqueued = 0;
  for (const r of VERIFICATION_REMINDERS) {
    const content = renderVerificationReminder(r.hours, { firstName, siteUrl: siteUrl || "https://autolenis.com" });
    try {
      await enqueueTransactional(
        {
          triggerEvent: r.trigger,
          templateKey: r.template,
          channel: "email",
          recipientKind: "buyer",
          recipientId: input.buyerId,
          to: accountEmail,
          vehicleRequestId: input.vehicleRequestId ?? null,
          idempotencyKey: `${r.template}:${input.buyerId}:${tokenId}`,
          cancelKey,
          runAt: new Date(base + r.hours * HOUR),
          payload: { email: accountEmail, subject: content.subject, html: content.html, text: content.text },
        },
        db,
      );
      remindersEnqueued++;
    } catch (err) {
      // One reminder that could not be scheduled must not cost the other two, and none of
      // them may cost the claim link that is already enqueued above.
      logger.error(`[guest-verification] reminder ${r.hours}h not enqueued for ${input.buyerId}:`, err);
    }
  }

  return { claimSent: true, remindersEnqueued, cancelKey, reason: "enqueued" };
}

/**
 * Stop the sequence. Called when the guest claims their account.
 *
 * The rechecks would also stop it at send time; this stops it EARLIER, which matters because
 * a cancelled row is one the drain never claims and one an operator reading the outbox does
 * not have to reason about.
 */
export async function cancelGuestVerification(
  buyerId: string,
  reason: string,
  db: Db = prisma,
): Promise<{ cancelled: number }> {
  return cancelByKey(guestVerificationCancelKey(buyerId), reason, db);
}
