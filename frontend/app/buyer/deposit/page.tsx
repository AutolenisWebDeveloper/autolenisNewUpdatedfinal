"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Shield, ArrowRight, Sparkles } from "lucide-react";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

import PreIntelligencePanel from "@/components/buyer/PreIntelligencePanel";

// Inline Stripe checkout — NOT a redirect to Stripe URL
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK && !STRIPE_PK.includes("placeholder")
  ? loadStripe(STRIPE_PK)
  : null;

function DepositForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/buyer/deposit/success` },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed");
      setLoading(false);
    } else {
      onSuccess();
    }
  }

  return (
    <form onSubmit={handleSubmit} data-testid="deposit-payment-form" className="space-y-6">
      <PaymentElement data-testid="stripe-payment-element" />
      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="deposit-error">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={!stripe || loading} data-testid="deposit-submit-btn">
        {loading ? "Processing…" : `Pay $${DEPOSIT_AMOUNT_CENTS / 100} — Activate Auction`}
      </Button>
    </form>
  );
}

export default function DepositPage() {
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [plan, setPlan] = useState<"STANDARD" | "PREMIUM">("STANDARD");

  useEffect(() => {
    // Fetch buyer's plan + create payment intent in parallel
    fetch("/api/buyer/profile")
      .then(r => r.json())
      .then((d: { success: boolean; data?: { plan?: string } }) => {
        if (d.success && d.data?.plan === "PREMIUM") setPlan("PREMIUM");
      })
      .catch(() => { /* default to STANDARD */ });

    fetch("/api/buyer/deposit/create-intent", { method: "POST" })
      .then(r => r.json())
      .then((d: { success: boolean; data?: { clientSecret: string }; error?: { code?: string } }) => {
        if (d.success && d.data) {
          setClientSecret(d.data.clientSecret);
        } else if (d.error?.code === "PREQUAL_REQUIRED") {
          setError("You need to complete prequalification before paying the deposit.");
          setTimeout(() => router.push("/buyer/prequal"), 2000);
        } else {
          setError("Unable to initialize payment. Please try again.");
        }
      })
      .catch(() => setError("Unable to connect to payment service."))
      .finally(() => setLoading(false));
  }, []);

  if (success) {
    return (
      <div className="p-6 md:p-8 max-w-lg text-center" data-testid="deposit-success">
        <div className="w-16 h-16 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-4">
          <Shield size={28} className="text-[#1A6B18]" />
        </div>
        <h2 className="text-2xl font-bold text-[#111827] mb-2">Auction activated!</h2>
        <p className="text-[#4B5563] text-sm mb-6">Your private 48-hour auction is now live. Dealers are being invited.</p>
        <Button href="/buyer/auctions" data-testid="goto-auction-btn">View My Auction <ArrowRight size={15} /></Button>
      </div>
    );
  }

  const isPremium = plan === "PREMIUM";

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deposit-page">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#111827]">Activate Your Auction</h1>
        <p className="text-sm text-[#4B5563] mt-1">
          Pay a <strong>$99 refundable Auction Access Deposit</strong> to launch your private 48-hour reverse auction.
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
          <Sparkles size={16} className="text-[#0B5FD1] shrink-0" />
        ) : (
          <Shield size={16} className="text-[#50D14E] shrink-0" />
        )}
        <div className="text-xs text-[#4B5563] leading-relaxed">
          <p className="font-semibold text-[#111827] mb-0.5">
            You are on the {isPremium ? "Premium" : "Standard"} plan.
          </p>
          <p data-testid="deposit-plan-credit-copy">
            {isPremium
              ? `Your $99 deposit will be credited toward your $${PREMIUM_FEE_CENTS / 100} Premium concierge fee ($${PREMIUM_FEE_REMAINING_CENTS / 100} remaining after this).`
              : "Your $99 deposit will be credited toward your vehicle purchase at closing."}
          </p>
        </div>
      </div>

      {/* System 3 ENH — Pre-intelligence panel before $99 commitment */}
      <PreIntelligencePanel />

      <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="text-[#4B5563]">Auction Access Deposit</span>
          <span className="font-semibold text-[#111827]">$99.00</span>
        </div>
        <div className="flex items-center justify-between text-sm border-t border-[#E5E7EB] pt-3">
          <span className="font-semibold text-[#111827]">Total charged today</span>
          <span className="font-bold text-[#111827] text-lg">$99.00</span>
        </div>
        <p className="text-xs text-[#1A6B18] mt-2 flex items-center gap-1">
          <Shield size={12} />
          100% refundable if no deal is selected
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
          <DepositForm onSuccess={() => setSuccess(true)} />
        </Elements>
      ))}
    </div>
  );
}
