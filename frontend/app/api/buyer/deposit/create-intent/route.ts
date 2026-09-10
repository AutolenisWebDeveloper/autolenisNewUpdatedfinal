import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { enrollDepositReminders } from "@/lib/services/payment/deposit-reminder.service";
import { limitPaymentIntent, limitGeneral, clientIpKey } from "@/lib/security/rate-limit";
import { cancelPreCheckoutTouches } from "@/lib/services/crm/lifecycle-touch-drain.service";
import { logger } from "@/lib/logger";
import {
  findExistingDepositObligation,
  retireDeadDeposits,
} from "@/lib/services/payment/deposit-obligation";
import { DEAD_INTENT_FROM } from "@/lib/payments/deposit-state";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";
import { enterPaymentRequired } from "@/lib/services/vehicle-request/vehicle-request.service";
import { gatherAndCheckEligibility, type EligibilityResult } from "@/lib/services/payment/deposit-eligibility";
import { getRequestUser } from "@/lib/auth/api";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Concierge convergence path: when a reviewToken is supplied, this deposit
  // unlocks an admin-curated set of dealer offers (System B) rather than
  // launching a live reverse auction. The concierge buyer has a VehicleOffer,
  // not a prequal + shortlist — so those gates are replaced by a strict
  // buyer↔offer binding (the authenticated buyer's email must match the review
  // the admin sent). A settled concierge deposit is converted to a CLOSED
  // auction with canonical Offers by the Stripe webhook.
  let conciergeVehicleOfferId: string | null = null;
  let conciergeReviewToken: string | null = null;
  let acceptedDisclosuresVersion: string | null = null;
  {
    let body: { reviewToken?: unknown; disclosuresVersion?: unknown } = {};
    try {
      body = (await request.json()) as { reviewToken?: unknown; disclosuresVersion?: unknown };
    } catch { /* no body — standard path */ }
    acceptedDisclosuresVersion =
      typeof body?.disclosuresVersion === "string" ? body.disclosuresVersion.trim() : null;
    const reviewToken = typeof body?.reviewToken === "string" ? body.reviewToken.trim() : "";
    if (reviewToken) {
      const review = await prisma.buyerOfferReview.findUnique({
        where: { reviewToken },
        select: { buyerEmail: true, expiresAt: true, vehicleOfferId: true },
      });
      if (!review) return errorResponse("REVIEW_NOT_FOUND", "Offer review link not found", 404);
      if (review.expiresAt && review.expiresAt < new Date()) {
        return errorResponse("REVIEW_EXPIRED", "This offer review link has expired", 410);
      }
      const buyerRow = await prisma.buyer.findUnique({
        where: { id: buyer.id },
        select: { user: { select: { email: true } } },
      });
      const buyerEmail = buyerRow?.user?.email?.trim().toLowerCase() ?? "";
      if (!buyerEmail || buyerEmail !== review.buyerEmail.trim().toLowerCase()) {
        // The signed-in account must be the buyer the offers were sent to.
        return errorResponse("REVIEW_FORBIDDEN", "This offer was sent to a different account. Sign in with the email the offers were sent to.", 403);
      }
      conciergeVehicleOfferId = review.vehicleOfferId;
      conciergeReviewToken = reviewToken;
    }
  }

  // IS THIS A PROBE?
  //
  // A call carrying no disclosure version cannot mint — the §5b gate below sits
  // immediately before the mint and refuses it — so the checkout uses exactly that call
  // to ask what the buyer's situation is on load. Naming the shape here is what lets the
  // two costs a MINT carries be skipped for a READ:
  //
  //   1. THE PAYMENT-INTENT LIMITER. `limitPaymentIntent` is a card-testing guard at
  //      10/hour per buyer AND per source IP. Charging a page LOAD against it meant five
  //      reload-and-accept cycles locked a buyer out of their own checkout, and a shared
  //      office IP tripped sooner. A probe is rate-limited as the read it is.
  //   2. THE PAYMENT_REQUIRED TRANSITION. Moving a DRAFT request to PAYMENT_REQUIRED on
  //      a page view is a state change nobody asked for, and it silently suppresses the
  //      §6.4 draft-recovery series (whose recheck stops the moment a request leaves
  //      DRAFT) for a buyer who looked at checkout once and never paid.
  //
  // The concierge path is NOT a probe: it has no §5a recheck and no disclosure gate, so
  // a call with a reviewToken mints whether or not a version is present.
  const isProbe = acceptedDisclosuresVersion === null && conciergeReviewToken === null;

  // Card-testing guard: throttle intent creation per buyer and per source IP.
  // Fails CLOSED on limiter-store outage (see lib/security/rate-limit.ts).
  for (const key of [`deposit:buyer:${buyer.id}`, `deposit:ip:${clientIpKey(request.headers)}`]) {
    const rl = isProbe
      ? await limitGeneral(`deposit-probe:${key}`, { tokens: 60, window: "10 m" })
      : await limitPaymentIntent(key);
    if (!rl.ok) return errorResponse("RATE_LIMITED", rl.message, rl.status);
  }

  // §5a ELIGIBILITY RECHECK, and the PAYMENT_REQUIRED transition it gates.
  //
  // Standard path only. A concierge deposit has no Vehicle Request until the webhook's
  // conversion creates one at settlement, so there is nothing here to recheck against
  // or to transition; its gate is the strict buyer↔offer binding above, which is a
  // different and stricter thing than §5a.
  //
  // This replaces two ad-hoc checks. The prequal one is folded in unchanged (PAY-04).
  // The shortlist one is NOT folded in and is deliberately dropped: §5a's eight
  // conditions do not include it, Phase 3 removes the auction-at-settlement behaviour
  // it was defending ("paying the deposit launches the auction" stops being true), and
  // shortlist candidates are Phase 4's subject. Recorded rather than silently removed.
  let openRequest: { id: string } | null = null;
  // The SECOND gate, held until the mint. See the note at the check site below and
  // the one on `gatherAndCheckEligibility`. Null on the concierge path, which has no
  // §5a recheck at all.
  let intentGate: EligibilityResult | null = null;
  if (!conciergeReviewToken) {
    openRequest = await findOpenRequest(buyer.id);
    if (!openRequest) {
      return errorResponse(
        "REQUEST_REQUIRED",
        "Start a vehicle request before paying — the $99 activates sourcing for a specific request.",
        400,
      );
    }

    // `email_confirmed_at` lives on the Supabase user, not on our User row, so PAY-01's
    // "read email_confirmed_at on the API path" means asking the session for it.
    const sessionUser = await getRequestUser(request);
    const gate = await gatherAndCheckEligibility({
      buyerId: buyer.id,
      requestId: openRequest.id,
      acceptedDisclosuresVersion,
      emailConfirmedAt: sessionUser?.email_confirmed_at
        ? new Date(sessionUser.email_confirmed_at)
        : null,
    });
    if (!gate.transition.eligible) {
      // §5a: "Any failure returns the buyer to the exact missing requirement — named,
      // not generic." The code and the named item both travel, so the checkout client
      // can route the buyer to the step that fixes it (PAY-09) rather than showing a
      // dead end.
      return errorResponse(gate.transition.code, gate.transition.message, 400, {
        missing: gate.transition.missing,
      });
    }
    intentGate = gate.intent;

    // PAY-10b: eligibility passing is what moves the request into PAYMENT_REQUIRED.
    // Guarded by the source status set so a request that has moved on — settled,
    // cancelled, already sourcing — is not dragged backwards by a stale checkout tab.
    //
    // NOT on a probe. The transition belongs to a buyer ACTING, not to a page rendering
    // — see the note on `isProbe` above for what a page-view transition did to the
    // draft-recovery series.
    if (!isProbe) await enterPaymentRequired(openRequest.id);
  }

  // MONEY-PATH DEFECT 4. This used to be a point lookup on the single newest
  // PENDING-or-PAID row, and three classes of real obligation escaped it: a settled
  // older row hiding behind a fresher PENDING one; a row the pre-Phase-3 behaviour
  // parked at FAILED on a card decline while its intent stayed live at Stripe
  // (defect 1); and a send-link row carrying no PaymentIntent at all. Each of those
  // fell through to `paymentIntents.create`.
  //
  // The shared check is the same one the two admin routes now call, so the three
  // paths cannot drift apart again, and it asks Stripe about every candidate rather
  // than believing our own status column — which §5d requires by name.
  // Request-scoped (PAY-11b). Plan is elected per Vehicle Request — §23.1's "a new
  // request means a new $99" — so a deposit attached to a DIFFERENT request must not
  // block this one, and one attached to THIS request must.
  const obligation = await findExistingDepositObligation({
    buyerId: buyer.id,
    vehicleRequestId: openRequest?.id ?? null,
  });

  if (obligation.kind === "PROVIDER_UNREACHABLE") {
    logger.error(
      `[deposit/create-intent] failing closed for buyer ${buyer.id}: Stripe unreachable while ` +
        `checking intent ${obligation.paymentIntentId}`,
    );
    return errorResponse(
      "PROVIDER_UNREACHABLE",
      "We couldn't reach our payment provider to check your payment status. Please try again in a moment — " +
        "we won't create a second charge while we're unsure.",
      503,
    );
  }

  if (obligation.kind === "SETTLED" || obligation.kind === "SETTLING" || obligation.kind === "CONTRADICTION") {
    logger.warn(
      `[deposit/create-intent] blocked duplicate intent for buyer ${buyer.id}: PI ` +
        `${obligation.paymentIntentId ?? "none"} is ${obligation.intentStatus ?? "unverifiable"} ` +
        `while deposit ${obligation.deposit.id} is ${obligation.deposit.status} (${obligation.kind})`,
    );

    // WHICH MESSAGE. Both codes block the mint, so neither risks a double charge; the
    // only question is which sentence is true.
    //
    // Our own books saying PAID is what decides it. CHARGE_UNSETTLED's copy — "we've
    // received your payment, it isn't recorded on our side yet" — is FALSE for a row
    // that is recorded on our side; that is the state an admin override produces
    // (PAID with no PaymentIntent), and it usually means a real payment made off
    // Stripe. Telling that buyer their payment is unrecorded invites a support ticket
    // at best and a second payment attempt at worst.
    //
    // So a PAID row gets ALREADY_PAID even when the provider disagrees, and the
    // disagreement travels as `needsReview` for Finance rather than as confusing copy
    // for the buyer. CHARGE_UNSETTLED is kept for what it was written for: Stripe says
    // the money arrived and OUR row has not caught up.
    const ourBooksSayPaid = obligation.deposit.status === "PAID";

    return errorResponse(
      ourBooksSayPaid ? "ALREADY_PAID" : "CHARGE_UNSETTLED",
      ourBooksSayPaid
        ? "Your deposit is already paid."
        : "We've received your payment. It isn't recorded on our side yet — please do not pay again.",
      ourBooksSayPaid ? 400 : 409,
      {
        paymentIntentId: obligation.paymentIntentId,
        intentStatus: obligation.intentStatus,
        ...(obligation.kind === "CONTRADICTION" ? { needsReview: true } : {}),
      },
    );
  }

  // Nothing is owed, but some of the buyer's rows point at intents Stripe has
  // cancelled. Retire them here — this is the only moment we know, and leaving them
  // PENDING costs a Stripe round-trip on every future call and keeps the six-touch
  // series chasing money that can no longer be paid. Best-effort by design: it is
  // bookkeeping, and it must never stop a buyer paying.
  if (obligation.kind === "NONE" && obligation.deadDepositIds.length > 0) {
    await retireDeadDeposits(obligation.deadDepositIds);
  }

  // §5b — DISCLOSURE ACCEPTANCE, checked HERE and not with §5a, because the two
  // questions are asked at different moments (PAY-08).
  //
  // §5a decides whether the buyer may REACH checkout, and passing it is what moved
  // the request to PAYMENT_REQUIRED above. Whether they have READ the seven
  // disclosures decides whether a PaymentIntent may exist, and that is now.
  //
  // THE ORDER IS LOAD-BEARING, not a tidy-up. A buyer who has ALREADY been charged
  // opens the checkout with nothing accepted. When this check sat with §5a, that
  // buyer was answered "accept the disclosures first" and the existing-obligation
  // check above was never reached — so the page could not learn they had already
  // paid, and would have rendered a card form and a "Total charged today" summary to
  // someone whose money had already moved. That is the exact failure
  // `deposit-charge-unsettled-block` exists to prevent, and an E2E test pins it.
  //
  // It also gives the checkout a probe it can trust: a call with NO version can never
  // mint, so the page asks this endpoint what the buyer's situation is on load, and
  // asks again with the version once they accept.
  //
  // The concierge path has no §5a recheck and therefore no `intentGate`. Deliberate:
  // three of the seven disclosures are about how far we widen the dealer search, and
  // a concierge buyer is paying for offers that are already curated. Showing them
  // those three would be telling them something untrue about their own purchase.
  if (intentGate && !intentGate.eligible) {
    return errorResponse(intentGate.code, intentGate.message, 400, { missing: intentGate.missing });
  }

  // The row this request should attach to, if any. IN_FLIGHT carries a live intent to
  // reuse; UNVERIFIABLE is a row with no usable provider reference (a send-link row, or
  // a sandbox mock) that must be attached to rather than duplicated.
  const existingDeposit =
    obligation.kind === "IN_FLIGHT" || obligation.kind === "UNVERIFIABLE" ? obligation.deposit : null;

  // Sandbox short-circuit: if a live Stripe key is configured outside production,
  // return a mock client secret so the UI can proceed without exposing real Stripe.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const isLiveKey = stripeKey.startsWith("sk_live_");
  const isSandboxRuntime = process.env.NODE_ENV !== "production";
  if (isLiveKey && isSandboxRuntime) {
    logger.warn("WARNING: Using live Stripe key in sandbox mode — returning mock intent.");
    // Reuse an existing mock so the buyer doesn't accumulate orphan PENDING rows.
    if (existingDeposit?.stripePaymentIntentId?.startsWith("pi_sandbox_mock_")) {
      return successResponse({ clientSecret: "pi_sandbox_mock_secret", mock: true });
    }
    const mockIntentId = `pi_sandbox_mock_${Date.now()}`;
    await prisma.deposit.create({
      data: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: mockIntentId,
      },
    });
    return successResponse({
      clientSecret: "pi_sandbox_mock_secret",
      mock: true,
    });
  }

  try {
    // If a PENDING deposit row already has a live Stripe PI attached, reuse
    // that intent rather than creating a parallel one. Stripe idempotency
    // keys live for 24h, so on a same-day retry create() would return the
    // same PI anyway — but the original `client_secret` is not echoed back
    // by Stripe on a key hit, so we have to retrieve it explicitly here to
    // avoid the unique-index P2002 on Deposit.stripePaymentIntentId.
    if (existingDeposit?.stripePaymentIntentId) {
      const existingPi = await getStripe().paymentIntents.retrieve(
        existingDeposit.stripePaymentIntentId,
      );

      // The duplicate-charge guard that used to live here has MOVED UP, into
      // `findExistingDepositObligation`, and is no longer repeated in this block.
      // That is the point of extracting it: the guard used to sit downstream of a
      // point lookup that could not see the rows it most needed to catch, so it was
      // a correct rule applied to an incomplete candidate set. It now runs over
      // every obligation-bearing row for the buyer, before this block is reached, and
      // a SETTLED result has already returned 409/400 above.
      //
      // Re-testing it here would be a second copy of the decision — exactly what the
      // original comment argued against — and a second copy that would now disagree
      // with the first, because this one keys on a single row.

      const isReusable =
        existingPi.status === "requires_payment_method" ||
        existingPi.status === "requires_confirmation" ||
        existingPi.status === "requires_action";
      // Only reuse a PENDING intent whose type matches the path being requested —
      // a lingering standard-deposit PI must not be served to a concierge request
      // (its webhook branch, metadata, and downstream auction differ), and vice
      // versa. For the concierge path we additionally require the PI to be bound
      // to the SAME review: the buyer↔offer binding is strict, and reusing a PI
      // stamped with a different reviewToken would make the webhook convert the
      // wrong review on payment. A mismatched PI falls through to a fresh create
      // below (whose idempotency key is scoped by reviewToken).
      const pathType = conciergeReviewToken ? "concierge_deposit" : "deposit";
      const typeMatches = (existingPi.metadata?.type ?? "deposit") === pathType;
      const reviewMatches =
        !conciergeReviewToken || existingPi.metadata?.reviewToken === conciergeReviewToken;
      if (isReusable && existingPi.client_secret && typeMatches && reviewMatches) {
        // RECORD THE ACCEPTANCE BEFORE RETURNING.
        //
        // Found by the independent review: this branch returned the client secret and
        // never wrote the version, while the upsert below — the only writer — is
        // downstream of it. So when legal returns approved wording and
        // `DISCLOSURES_VERSION` bumps, a buyer with a live intent who reads the NEW text
        // and accepts it gets the existing secret and a deposit row still stamped with
        // the OLD version. The stored record of what they agreed to would be the wrong
        // wording, which is the one thing the version mechanism exists to prevent.
        if (acceptedDisclosuresVersion) {
          await prisma.deposit.updateMany({
            where: { id: existingDeposit.id },
            // ONLY the acceptance. Stamping `vehicleRequestId` onto an existing row here
            // would be the re-parent §3 forbids and the build-failing ratchet holds at
            // zero; the link is written in the upsert's `create` block, where giving a
            // NEW row its parent is what §3 requires.
            data: {
              disclosuresAcceptedAt: new Date(),
              disclosuresVersion: acceptedDisclosuresVersion,
            },
          });
        }
        return successResponse({ clientSecret: existingPi.client_secret });
      }
      // MONEY-PATH DEFECT 1, the second half. This condition used to be
      // `canceled || existingDeposit.status !== "PENDING"`, so it wrote FAILED for a
      // row that was merely not PENDING — including a row already FAILED, and a row
      // whose intent was perfectly alive but whose type did not match the path
      // (concierge vs standard), which falls through here on purpose. Under the
      // Phase 3 semantics FAILED means THE INTENT IS DEAD, so only `canceled` may
      // write it, and the write is scoped by the matrix so it cannot downgrade a PAID
      // or REFUNDED row that a concurrent webhook has just settled.
      if (existingPi.status === "canceled") {
        await prisma.deposit.updateMany({
          where: { id: existingDeposit.id, status: { in: [...DEAD_INTENT_FROM] } },
          data: { status: "FAILED" },
        });
      }
    }

    // Amount is hardcoded server-side — NEVER accept from frontend (price manipulation prevention).
    // Idempotency key is bucketed by UTC day so that two near-simultaneous clicks
    // share a PI, but a buyer returning the next day gets a fresh intent (the
    // previous day's PI may already be canceled by Stripe's automatic timeout).
    const dayKey = new Date().toISOString().slice(0, 10);
    // Concierge deposits carry type "concierge_deposit" + the source vehicleOfferId
    // so the webhook converts them to a CLOSED auction with canonical offers,
    // rather than launching a live reverse auction. Distinct idempotency bucket so
    // a concierge intent never collides with a standard one for the same buyer.
    const metadata: Record<string, string> = conciergeReviewToken
      ? {
          buyerId: buyer.id,
          type: "concierge_deposit",
          reviewToken: conciergeReviewToken,
          ...(conciergeVehicleOfferId ? { vehicleOfferId: conciergeVehicleOfferId } : {}),
        }
      : {
          buyerId: buyer.id,
          type: "deposit",
          // PAY-11b: stamp the Vehicle Request on the intent. The webhook can then
          // attach the settlement to the right request without inferring it, and an
          // operator looking at a charge in the Stripe dashboard can see what it bought.
          ...(openRequest ? { vehicleRequestId: openRequest.id } : {}),
        };

    // PAY-11b — ONE PaymentIntent per VEHICLE REQUEST, not per buyer per day.
    //
    // The old key was `deposit-buyer-${id}-${dayKey}`, bucketed by UTC day. That had two
    // faults and they pulled in opposite directions. WITHIN a day it collapsed two
    // different requests onto one intent, because the buyer was the only thing in the
    // key. ACROSS days it minted a fresh intent for the SAME unpaid request, which is
    // how the duplicate-charge path opened: the guard that would have caught it sat
    // behind a point lookup, and the day bucket hid the collision until the next day.
    //
    // Keying on the request fixes both, and matches what §5b actually asks for: "Create
    // or reuse ONE Stripe PaymentIntent tied to THAT Vehicle Request — not merely to
    // the buyer." A returning buyer gets the same intent; a new request gets a new one,
    // which is §23.1's "a new request means a new $99".
    //
    // The concierge bucket keeps its own shape: it has no Vehicle Request until the
    // webhook's conversion creates one, and its review token is what a concierge intent
    // is genuinely "per".
    const idempotencyKey = conciergeReviewToken
      ? `concierge-deposit-buyer-${buyer.id}-${conciergeReviewToken}-${dayKey}`
      : `deposit-vr-${openRequest!.id}`;
    const paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: DEPOSIT_AMOUNT_CENTS, // $99 hardcoded
        currency: "usd",
        metadata,
      },
      { idempotencyKey },
    );

    // upsert protects against the race where a concurrent retry already
    // wrote a Deposit row for this PI (unique on stripePaymentIntentId).
    await prisma.deposit.upsert({
      where: { stripePaymentIntentId: paymentIntent.id },
      create: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
        // PAY-11a/11b: the deposit is attached to the request at CREATION, not at
        // settlement. Attaching later would leave a window in which a paid deposit
        // belonged to no request, which is the shape of the eight unattached rows
        // R1b's owner-gated backfill exists to clean up.
        ...(openRequest ? { vehicleRequestId: openRequest.id } : {}),
        // PAY-D / PAY-08: the acceptance is recorded WITH the version accepted. A
        // later wording change bumps the version and invalidates it, so a buyer is
        // never treated as having agreed to words they did not see (§13-D48).
        ...(acceptedDisclosuresVersion
          ? { disclosuresAcceptedAt: new Date(), disclosuresVersion: acceptedDisclosuresVersion }
          : {}),
      },
      // An existing row is BROUGHT UP TO DATE rather than left alone. The reuse path
      // returns before reaching here, so arriving with a row that already carries this
      // intent means a concurrent retry wrote it — and that row may predate the request
      // link or the acceptance. `update: {}` would have silently kept the older, emptier
      // version of both.
      update: {
        ...(openRequest ? { vehicleRequestId: openRequest.id } : {}),
        ...(acceptedDisclosuresVersion
          ? { disclosuresAcceptedAt: new Date(), disclosuresVersion: acceptedDisclosuresVersion }
          : {}),
      },
    });

    // CONCIERGE EXCLUSION (Section 2): concierge deposits (reviewToken present)
    // have their own review-link CTA and must NEVER also receive the generic
    // "$99 deposit" reminder sequence or the abandoned-deposit nurture. Only the
    // normal competitive path enrolls — everything below is gated on !concierge.
    if (!conciergeReviewToken) {
      // Start the $99 deposit-conversion reminder. STILL the single enrollment owner
      // for the chain — onboarding/complete used to enroll too and claimed the touch-1
      // row before any deposit existed — but the RAIL has changed.
      //
      // It now writes six touches to `comms_outbox`, keyed to this Vehicle Request and
      // drained every minute, instead of one `lifecycle_touch_schedule` row chained
      // through a fifteen-minute drain and keyed to the buyer. §8.2 Phase 3: "the
      // series runs on the every-minute outbox drain rather than the 15-minute touch
      // drain". The words and the six offsets are the same ones; see
      // `deposit-reminder.service.ts` for what changed and why.
      //
      // Any lifecycle rows still in flight for this buyer are cancelled first. Both
      // rails enrolling would mean the buyer received every touch twice, and a buyer
      // who was enrolled before this shipped and then returns to checkout is exactly
      // the case that would produce it.
      const buyerContact = await prisma.buyer.findUnique({
        where: { id: buyer.id },
        select: { firstName: true, lastName: true, phone: true, user: { select: { email: true } } },
      });
      if (buyerContact?.user?.email && openRequest) {
        const email = buyerContact.user.email;
        // Best-effort tail — never affects the payment response.
        void (async () => {
          try {
            const { cancelDepositReminderTouches } = await import(
              "@/lib/services/crm/lifecycle-touch-drain.service"
            );
            await cancelDepositReminderTouches(buyer.id, { reason: "migrated_to_comms_outbox" });
          } catch (err) {
            logger.error("[deposit/create-intent] legacy reminder cancellation failed:", err);
          }
          try {
            const res = await enrollDepositReminders({
              buyerId: buyer.id,
              vehicleRequestId: openRequest.id,
              firstName: buyerContact.firstName,
              email,
              phone: buyerContact.phone,
            });
            if (res.smsSkippedReason) {
              // Returned rather than swallowed: an SMS series that quietly became an
              // email-only series is a capability that disappeared without saying so.
              logger.warn(
                `[deposit/create-intent] $99 series enrolled email-only for request ` +
                  `${openRequest.id}: ${res.smsSkippedReason}`,
              );
            }
          } catch (err) {
            logger.error("[deposit/create-intent] reminder enrollment failed:", err);
          }
        })();
      }

      // HANDOFF: a competitive PENDING deposit now exists → the pre-checkout stage
      // hands off to deposit_reminder. Cancel any remaining pre-checkout touches so
      // the two stages never run against the same buyer at once (the send-time
      // preCheckoutResolved guard is the authoritative backstop). Best-effort.
      cancelPreCheckoutTouches(buyer.id).catch((err) =>
        logger.error("[deposit/create-intent] pre-checkout cancel failed:", err),
      );

      // F-037 — emit the deposit_pending domain event. It was defined in the
      // WorkflowTriggerType union but never fired, so the prebuilt 1h→24h→72h
      // abandoned-deposit nurture (workflow.prebuilt.ts) was dead. Emitting it
      // here (deposit intent created, not yet paid) revives that recovery
      // sequence. Tail call: never throws, never affects the payment response.
      if (buyerContact) {
        try {
          const { emitDomainEvent } = await import("@/lib/events/emit");
          await emitDomainEvent("deposit_pending", {
            domainEntityId: buyer.id,
            contact: {
              email: buyerContact.user?.email ?? null,
              phone: buyerContact.phone,
              firstName: buyerContact.firstName,
              lastName: buyerContact.lastName,
              source: "buyer_signup",
            },
            data: {
              buyer_id: buyer.id,
              amount_cents: DEPOSIT_AMOUNT_CENTS,
              deposit_url: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/deposit`,
            },
          });
        } catch (err) {
          logger.error("[deposit/create-intent] deposit_pending emit failed:", err);
        }
      }
    }

    return successResponse({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    logger.error("[deposit/create-intent] Stripe error:", err);
    return errorResponse("STRIPE_ERROR", "Payment service unavailable. Please try again.", 503);
  }
}
