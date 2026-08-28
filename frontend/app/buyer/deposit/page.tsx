"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Shield, Sparkles, Loader2 } from "lucide-react";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

import PreIntelligencePanel from "@/components/buyer/PreIntelligencePanel";
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

export default function DepositPage() {
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [plan, setPlan] = useState<"STANDARD" | "PREMIUM">("STANDARD");
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

    fetch("/api/buyer/deposit/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Concierge deposits carry the review token so the server binds this
      // deposit to the offers and stamps the concierge PI metadata.
      body: JSON.stringify(token ? { reviewToken: token } : {}),
    })
      .then(r => r.json())
      .then((d: { success: boolean; data?: { clientSecret: string }; error?: { code?: string; message?: string } }) => {
        if (d.success && d.data) {
          setClientSecret(d.data.clientSecret);
        } else if (d.error?.code === "PREQUAL_REQUIRED") {
          setError("You need to complete prequalification before paying the Auction Access Deposit.");
          setTimeout(() => router.push("/buyer/prequal"), 2000);
        } else if (d.error?.code === "REVIEW_FORBIDDEN") {
          setError("These offers were sent to a different account. Please sign in with the email the offers were sent to.");
        } else if (d.error?.code === "REVIEW_EXPIRED" || d.error?.code === "REVIEW_NOT_FOUND") {
          setError("This offer review link is no longer valid. Please contact AutoLenis support.");
        } else {
          setError("Unable to initialize payment. Please try again.");
        }
      })
      .catch(() => setError("Unable to connect to payment service."))
      .finally(() => setLoading(false));
  }, []);

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

      {loading && <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />}
      {error && (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-4" data-testid="deposit-init-error">{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()} data-testid="deposit-retry-btn">Try Again</Button>
        </div>
      )}
      {!stripePromise ? (
        <div className="text-center py-8" data-testid="stripe-unavailable">
          <p className="text-sm text-red-600 font-medium">
            Payment service temporarily unavailable.
          </p>
          <p className="text-xs text-[#6B7280] mt-1">Please contact support.</p>
        </div>
      ) : (clientSecret && (
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
      ))}
    </div>
  );
}
