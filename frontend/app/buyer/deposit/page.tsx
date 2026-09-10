"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Shield, Sparkles, Loader2, Check } from "lucide-react";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { DEPOSIT_DISCLOSURES, DISCLOSURES_VERSION } from "@/lib/payments/deposit-disclosures";
import type { EligibilityFailureCode } from "@/lib/services/payment/deposit-eligibility";

import PreIntelligencePanel from "@/components/buyer/PreIntelligencePanel";
import PaymentUnsettledNotice from "@/components/buyer/PaymentUnsettledNotice";
import { classifyPaymentConfirmation } from "@/lib/services/payment/payment-confirmation";
import { api } from "@/lib/api/client";

// Inline Stripe checkout — NOT a redirect to Stripe URL
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK && !STRIPE_PK.includes("placeholder")
  ? loadStripe(STRIPE_PK)
  : null;

/** A Stripe client secret is `<paymentIntentId>_secret_<random>`. */
function paymentIntentIdFromClientSecret(clientSecret: string): string | null {
  const id = clientSecret.split("_secret_")[0];
  return id.startsWith("pi_") ? id : null;
}

function DepositForm({
  clientSecret,
  onConfirmed,
}: {
  clientSecret: string;
  onConfirmed: (paymentIntentId: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    // `redirect: "if_required"` means the normal card path does NOT redirect, so
    // the buyer stays here and this promise resolves locally. That resolution
    // says only "Stripe accepted the confirmation" — it is NOT confirmation that
    // the money settled, that our Deposit row flipped to PAID, or that an
    // auction exists. This page previously treated a missing error as proof of
    // all three and rendered "Auction activated! … Dealers are being invited."
    // With zero Stripe webhook events ever recorded in production, that claim
    // was false for every buyer who saw it.
    //
    // Nothing is asserted here. We hand off to /buyer/deposit/success, which
    // re-retrieves the PaymentIntent from Stripe server-side and checks the
    // Deposit row — the only place a claim about this payment can be made.
    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/buyer/deposit/success` },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed");
      setLoading(false);
      return;
    }

    // Prefer the id Stripe just returned; fall back to the one embedded in the
    // client secret so the verifying page always has a reference to check.
    onConfirmed(paymentIntent?.id ?? paymentIntentIdFromClientSecret(clientSecret));
  }

  return (
    <form onSubmit={handleSubmit} data-testid="deposit-payment-form" className="space-y-6">
      <PaymentElement data-testid="stripe-payment-element" />
      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="deposit-error">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={!stripe || loading} data-testid="deposit-submit-btn">
        {loading ? "Confirming payment…" : `Pay $${DEPOSIT_AMOUNT_CENTS / 100} — Activate Auction`}
      </Button>
    </form>
  );
}

/**
 * §5a / PAY-09 — THE CODE → STEP MAP.
 *
 * "Any failure returns the buyer to the exact missing requirement — named, not
 * generic." The server has always sent the code and the named item; this page handled
 * five codes and dropped every other one into "Unable to initialize payment. Please try
 * again." with a Try Again button that reloads and fails identically. A buyer with no
 * ZIP code, an unverified email or an incomplete request met a dead end that told them
 * nothing and offered them nothing — which is the opposite of what §5a asks for, and the
 * §13-D10 buyers land here by construction.
 *
 * TYPED AS A TOTAL RECORD over the union on purpose: adding an eligibility code without
 * giving the buyer somewhere to go now fails the build rather than shipping another dead
 * end.
 */
const ELIGIBILITY_STEP: Record<EligibilityFailureCode | "REQUEST_REQUIRED", { href: string; cta: string }> = {
  ACCOUNT_INACTIVE: { href: "/buyer/dashboard", cta: "Go to your dashboard" },
  EMAIL_UNVERIFIED: { href: "/buyer/profile", cta: "Verify your email" },
  ONBOARDING_REQUIRED: { href: "/buyer/onboarding", cta: "Finish setting up your account" },
  LOCATION_REQUIRED: { href: "/buyer/profile", cta: "Add your location" },
  PREQUAL_REQUIRED: { href: "/buyer/prequal", cta: "Complete prequalification" },
  VEHICLE_CRITERIA_INCOMPLETE: { href: "/buyer/requests", cta: "Complete your request" },
  REQUEST_CONFLICT: { href: "/buyer/requests", cta: "Review your open requests" },
  REQUEST_REQUIRED: { href: "/request-a-car", cta: "Start a vehicle request" },
  // The buyer is already here, and the gate above is what fixes it. There is nowhere
  // else to send them, so the CTA returns them to the disclosures on this page.
  DISCLOSURE_REQUIRED: { href: "/buyer/deposit", cta: "Read the terms again" },
};

/**
 * §5b — the seven things a buyer must be shown before they pay.
 *
 * The WORDS come from `lib/payments/deposit-disclosures.ts` and are never written
 * here. §13-D48 exists because they were written twice before: this page said the $99
 * was "refundable on request" while the confirmation email said it was "credited
 * toward your concierge fee", and both contradicted §23.1. Copy that lives in two
 * files gets corrected in one, so this renders the list and owns none of it.
 *
 * ACCEPTANCE GATES THE PAYMENT INTENT, not the PAYMENT_REQUIRED transition. §5a's
 * seven eligibility conditions decide whether a buyer may reach checkout at all;
 * whether they have READ the disclosures is a different question, answered at the
 * moment money is about to move. That split is why the intent is created on the
 * button below rather than on mount, which is where it used to be created — before
 * the buyer had seen a single one of these.
 *
 * The version travels with the acceptance. `DISCLOSURES_VERSION` is stored on the
 * deposit, and the server refuses an acceptance naming a different one, so when legal
 * returns approved wording (§13-D48) bumping the constant re-asks every buyer instead
 * of treating agreement to these words as agreement to those.
 */
function DisclosureGate({
  accepted,
  pending,
  onAccept,
}: {
  accepted: boolean;
  pending: boolean;
  onAccept: () => void;
}) {
  return (
    <div
      className="bg-white border border-[#E5E7EB] rounded-xl p-5 mb-6"
      data-testid="deposit-disclosures"
    >
      <h2 className="text-sm font-semibold text-[#111827] mb-3">Before you pay, please read this</h2>
      <ul className="space-y-2.5" data-testid="deposit-disclosure-list">
        {DEPOSIT_DISCLOSURES.map((d) => (
          <li key={d.id} className="flex gap-2.5 text-xs text-[#4B5563] leading-relaxed" data-disclosure-id={d.id}>
            <Check size={14} className="text-[#50D14E] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{d.text}</span>
          </li>
        ))}
      </ul>

      {!accepted && (
        <Button
          className="w-full mt-5"
          size="lg"
          onClick={onAccept}
          disabled={pending}
          data-testid="deposit-accept-disclosures-btn"
        >
          {pending ? "One moment…" : "I've read this — continue to payment"}
        </Button>
      )}
      {accepted && (
        <p className="text-xs text-[#1A6B18] mt-4 flex items-center gap-1.5" data-testid="deposit-disclosures-accepted">
          <Check size={12} aria-hidden="true" />
          Recorded with your payment.
        </p>
      )}
    </div>
  );
}

export default function DepositPage() {
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Set when create-intent answers CHARGE_UNSETTLED: this buyer has already been
  // charged (or a charge is in flight) on a deposit our side has not recorded,
  // because the Stripe webhook never landed. Non-null here means no card form
  // may render — see the early return below.
  const [unsettled, setUnsettled] = useState<
    { paymentIntentId: string | null; intentStatus: string | null } | null
  >(null);
  const [plan, setPlan] = useState<"STANDARD" | "PREMIUM">("STANDARD");
  // §5b: the buyer has read the seven disclosures. Nothing is charged, and no
  // PaymentIntent is even created, until this is true.
  const [accepted, setAccepted] = useState(false);
  /** A create-intent call is in flight. Separate from `loading`, which is page setup. */
  const [creating, setCreating] = useState(false);
  /** Our own books say this deposit is PAID. No card form, ever. */
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  /** §5a: where to send the buyer to fix the exact thing that is missing (PAY-09). */
  const [errorStep, setErrorStep] = useState<{ href: string; cta: string } | null>(null);
  // Concierge convergence: when the buyer arrives from a "?offer=<reviewToken>"
  // vehicle-offer review link, this deposit unlocks an admin-curated set of
  // dealer offers (converted to a CLOSED auction on settle) instead of launching
  // a live reverse auction. Read from the URL to avoid a Suspense boundary.
  const [reviewToken, setReviewToken] = useState<string | null>(null);
  const isConcierge = !!reviewToken;

  useEffect(() => {
    const token =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("offer")
        : null;
    setReviewToken(token);

    // Fetch buyer's plan + create payment intent in parallel
    api.get<{ plan?: string }>("/api/buyer/profile")
      .then(data => {
        if (data?.plan === "PREMIUM") setPlan("PREMIUM");
      })
      .catch(() => { /* default to STANDARD */ });

    // PROBE. The same endpoint, called WITHOUT the disclosure version.
    //
    // A call with no version cannot mint: the server checks §5a, moves the request to
    // PAYMENT_REQUIRED, runs the provider-side existing-obligation check, and only
    // then asks whether the disclosures were accepted. So this load answers the one
    // question the page must know before it renders anything — has this buyer already
    // been charged? — and can never create a PaymentIntent while doing it.
    //
    // That question has to be answered on LOAD rather than on accept, because a buyer
    // whose money has already moved must never be shown a card form or a "Total
    // charged today" summary. Minting used to happen here, which is what made the
    // answer available; the probe is what keeps it available now that it does not.
    postCreateIntent(false, token);
  }, []);

  /**
   * Ask the server for a PaymentIntent, or (with `withVersion` false) merely for the
   * buyer's situation.
   *
   * `token` is passed explicitly rather than read from state because the mount probe
   * runs in the same tick as `setReviewToken` and would otherwise see null.
   */
  function postCreateIntent(withVersion: boolean, token: string | null) {
    if (withVersion) setCreating(true);
    setError(null);
    setErrorStep(null);
    fetch("/api/buyer/deposit/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Concierge deposits carry the review token so the server binds this
      // deposit to the offers and stamps the concierge PI metadata.
      body: JSON.stringify({
        ...(token ? { reviewToken: token } : {}),
        ...(withVersion ? { disclosuresVersion: DISCLOSURES_VERSION } : {}),
      }),
    })
      .then(r => r.json())
      .then((d: {
        success: boolean;
        data?: { clientSecret: string };
        error?: {
          code?: string;
          message?: string;
          details?: { paymentIntentId?: string; intentStatus?: string };
        };
      }) => {
        if (d.success && d.data) {
          setClientSecret(d.data.clientSecret);
          setAccepted(true);
        } else if (d.error?.code === "DISCLOSURE_REQUIRED") {
          // On the PROBE this is the expected answer and means "nothing is owed, the
          // buyer just has not accepted yet" — the disclosure gate renders and waits.
          // On the ACCEPT call it means the server's wording moved on since this page
          // loaded (legal-approved copy landing mid-session, §13-D48); reloading
          // fetches the new text, and accepting the old one would record agreement to
          // words that are no longer shown.
          if (withVersion) {
            setError("These terms have just been updated. Please reload the page and read them again before paying.");
          }
        } else if (d.error?.code === "ALREADY_PAID") {
          // Our own books say PAID. Not an error to retry, and never a card form.
          setAlreadyPaid(true);
        } else if (d.error?.code === "CHARGE_UNSETTLED") {
          // The buyer's money already moved — the server refused to mint a
          // second PaymentIntent. Record the facts; the render path below turns
          // them into the same honest state /buyer/deposit/success shows, and
          // never reaches the card form.
          setUnsettled({
            paymentIntentId: d.error.details?.paymentIntentId ?? null,
            intentStatus: d.error.details?.intentStatus ?? null,
          });
        } else if (d.error?.code === "PREQUAL_REQUIRED") {
          setError("You need to complete prequalification before paying the Auction Access Deposit.");
          setTimeout(() => router.push("/buyer/prequal"), 2000);
        } else if (d.error?.code === "REVIEW_FORBIDDEN") {
          setError("These offers were sent to a different account. Please sign in with the email the offers were sent to.");
        } else if (d.error?.code === "REVIEW_EXPIRED" || d.error?.code === "REVIEW_NOT_FOUND") {
          setError("This offer review link is no longer valid. Please contact AutoLenis support.");
        } else if (d.error?.code && d.error.code in ELIGIBILITY_STEP) {
          // §5a: the server named the missing requirement. Say what it is and give the
          // buyer the one control that fixes it.
          const step = ELIGIBILITY_STEP[d.error.code as keyof typeof ELIGIBILITY_STEP];
          setError(d.error.message ?? "Something is missing before you can pay.");
          setErrorStep(step);
        } else {
          setError("Unable to initialize payment. Please try again.");
        }
      })
      .catch(() => setError("Unable to connect to payment service."))
      .finally(() => {
        setCreating(false);
        setLoading(false);
      });
  }

  // Confirmation handed off to the server — show a neutral, truthful
  // interstitial while the verifying page loads. It claims nothing about the
  // payment, the auction, or dealer activity, because nothing is known yet.
  if (confirming) {
    return (
      <div className="p-6 md:p-8 max-w-lg text-center" data-testid="deposit-confirming">
        <div
          className="w-16 h-16 rounded-full bg-al-primary-subtle flex items-center justify-center mx-auto mb-4"
          aria-hidden="true"
        >
          <Loader2 size={28} className="text-al-primary motion-safe:animate-spin" />
        </div>
        <h2 className="text-2xl font-bold text-[#111827] mb-2">Confirming your payment…</h2>
        <p className="text-[#4B5563] text-sm" role="status">
          Hang tight — we&apos;re verifying this with our payment processor. Don&apos;t close this page.
        </p>
      </div>
    );
  }

  // A buyer who has already been charged must never be shown a card form, a
  // "Total charged today $99.00" summary, or a "Pay $99" button — each of those
  // is an invitation to a duplicate charge. Returning before the sales surface
  // is what makes that structural rather than a matter of conditional styling.
  //
  // Which of the two states applies is decided by the same pure rule the
  // verifying page uses, not by a second interpretation of Stripe's statuses
  // written here: `recordedStatus` is null because our side has recorded nothing
  // — that is precisely why the server refused to create another intent.
  // Our own books say PAID. This is not "unsettled" — there is nothing in flight and
  // nothing to re-check at Stripe — so it gets its own, plainer answer rather than
  // being pushed through the unsettled notice, whose copy ("it isn't recorded on our
  // side yet") would be false here.
  if (alreadyPaid) {
    return (
      <div className="p-6 md:p-8 max-w-lg" data-testid="deposit-already-paid-block">
        <h1 className="text-xl font-bold text-[#111827] mb-2">You&apos;ve already paid this.</h1>
        <p className="text-sm text-[#4B5563] mb-5">
          Your ${DEPOSIT_AMOUNT_CENTS / 100} is recorded against your vehicle request. Please do not pay again.
        </p>
        <Button onClick={() => router.push("/buyer/billing")} data-testid="deposit-already-paid-billing-btn">
          View your billing
        </Button>
      </div>
    );
  }

  if (unsettled) {
    const outcome = classifyPaymentConfirmation({
      intentStatus: unsettled.intentStatus,
      recordedStatus: null,
    });
    const recheckHref = unsettled.paymentIntentId
      ? `/buyer/deposit/success?payment_intent=${encodeURIComponent(unsettled.paymentIntentId)}`
      : "/buyer/deposit/success";
    return (
      <PaymentUnsettledNotice
        variant={outcome === "processing" ? "processing" : "charged"}
        paymentIntentId={unsettled.paymentIntentId}
        recheckHref={recheckHref}
        isConcierge={isConcierge}
        testId="deposit-charge-unsettled-block"
      />
    );
  }

  const isPremium = plan === "PREMIUM";

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deposit-page">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#111827]">
          {isConcierge ? "Unlock & Accept Your Offers" : "Activate Your Auction"}
        </h1>
        <p className="text-sm text-[#4B5563] mt-1">
          {isConcierge ? (
            <>
              Pay your <strong>$99 Auction Access Deposit — refundable on request</strong> to unlock the dealer
              offers we prepared for you and choose the one you want.
            </>
          ) : (
            <>
              Pay a <strong>$99 Limited-Time Auction Access Deposit — refund available on request if no valuable offer is received</strong> to launch your private 48-hour reverse auction.
            </>
          )}
        </p>
      </div>

      {/* Plan indicator */}
      <div
        data-testid="deposit-plan-indicator"
        className={`rounded-xl px-4 py-3 mb-5 border flex items-center gap-3 ${
          isPremium
            ? "bg-[#F8F9FB] border-[#DBEAFE]"
            : "bg-white border-[#E5E7EB]"
        }`}
      >
        {isPremium ? (
          <Sparkles size={16} className="text-al-primary shrink-0" />
        ) : (
          <Shield size={16} className="text-[#50D14E] shrink-0" />
        )}
        <div className="text-xs text-[#4B5563] leading-relaxed">
          <p className="font-semibold text-[#111827] mb-0.5">
            You are on the {isPremium ? "Premium" : "Standard"} plan.
          </p>
          <p data-testid="deposit-plan-credit-copy">
            {isPremium
              ? `Your $99 Auction Access Deposit will be credited toward your $${PREMIUM_FEE_CENTS / 100} AutoLenis Service Fee ($${PREMIUM_FEE_REMAINING_CENTS / 100} remaining after this).`
              : "If no valuable offer is received, you can request a refund of your $99 Auction Access Deposit — our team reviews every request."}
          </p>
        </div>
      </div>

      {/* System 3 ENH — Pre-intelligence panel before $99 commitment */}
      <PreIntelligencePanel />

      <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-[#4B5563]">Limited-Time Auction Access Deposit</span>
          <span className="font-semibold text-[#111827]">$99.00</span>
        </div>
        <div className="flex items-center justify-between text-sm border-t border-[#E5E7EB] pt-3">
          <span className="font-semibold text-[#111827]">Total charged today</span>
          <span className="font-bold text-[#111827] text-lg">$99.00</span>
        </div>
        <p className="text-xs text-[#1A6B18] mt-2 flex items-center gap-1">
          <Shield size={12} />
          Refund available on request if no valuable offer is received
        </p>
      </div>

      {!stripePromise ? (
        <div className="text-center py-8" data-testid="stripe-unavailable">
          <p className="text-sm text-red-600 font-medium">
            Payment service temporarily unavailable.
          </p>
          <p className="text-xs text-[#6B7280] mt-1">Please contact support.</p>
        </div>
      ) : (
        <>
          {/* §5b. Rendered BEFORE the card form and before any PaymentIntent exists,
              because a disclosure shown after the money moves is not a disclosure. */}
          <DisclosureGate accepted={accepted} pending={creating} onAccept={() => postCreateIntent(true, reviewToken)} />

          {loading && <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />}
          {error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-600 mb-4" data-testid="deposit-init-error">{error}</p>
              {errorStep ? (
                <Button
                  onClick={() => router.push(errorStep.href)}
                  data-testid="deposit-fix-step-btn"
                >
                  {errorStep.cta}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => window.location.reload()} data-testid="deposit-retry-btn">Try Again</Button>
              )}
            </div>
          )}
          {clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <DepositForm
            clientSecret={clientSecret}
            onConfirmed={(paymentIntentId) => {
              setConfirming(true);
              // The success page is the ONLY surface that may make a claim about
              // this payment: it re-retrieves the PaymentIntent server-side and
              // reads the Deposit row before saying anything.
              router.push(
                paymentIntentId
                  ? `/buyer/deposit/success?payment_intent=${encodeURIComponent(paymentIntentId)}`
                  : "/buyer/deposit/success",
              );
            }}
          />
        </Elements>
          )}
        </>
      )}
    </div>
  );
}
