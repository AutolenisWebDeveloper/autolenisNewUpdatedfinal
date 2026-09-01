"use client";
import { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, ArrowRight } from "lucide-react";
import { ApiError, api, apiErrorMessage } from "@/lib/api/client";
import PaymentUnsettledNotice from "@/components/buyer/PaymentUnsettledNotice";
import { classifyPaymentConfirmation } from "@/lib/services/payment/payment-confirmation";

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK && !STRIPE_PK.includes("placeholder")
  ? loadStripe(STRIPE_PK)
  : null;

interface Props {
  dealId: string;
  netFeeCents: number;
}

function CheckoutForm({ netFeeCents }: { netFeeCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    // return_url must land on a page that VERIFIES the payment server-side.
    // It used to point at /buyer/deal, which ignores Stripe's redirect params
    // entirely and renders from the DB state the (never-delivered) webhook would
    // have written — so after a real $400 charge the buyer saw the fee still
    // unpaid and this Pay button offered again, inviting a second charge.
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/buyer/deal/payment/success`,
      },
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} data-testid="fee-payment-form">
      <PaymentElement className="mb-6" />
      {error && <p role="alert" className="text-xs text-red-600 mb-4">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || loading}
        data-testid="submit-fee-payment-btn"
        className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-al-primary text-white font-semibold rounded-xl hover:bg-al-primary-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <><Loader2 size={15} className="animate-spin" /> Processing…</>
        ) : (
          <>Pay ${(netFeeCents / 100).toFixed(0)} &amp; Continue <ArrowRight size={15} /></>
        )}
      </button>
    </form>
  );
}

export default function FeePaymentForm({ dealId, netFeeCents }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Set when create-intent answers CHARGE_UNSETTLED: Stripe says this deal's fee
  // has already been charged (or is in flight) while our side has recorded
  // nothing, because the webhook never landed. Non-null here means no card form
  // may render — the early return below is what makes that structural.
  const [unsettled, setUnsettled] = useState<
    { paymentIntentId: string | null; intentStatus: string | null } | null
  >(null);

  useEffect(() => {
    api.post<{ clientSecret: string }>(`/api/buyer/deals/${dealId}/fee/create-intent`)
      .then(data => {
        if (data?.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setFetchError("Could not initialize payment.");
        }
      })
      .catch(err => {
        if (err instanceof ApiError && err.code === "CHARGE_UNSETTLED") {
          const d = err.details ?? {};
          setUnsettled({
            paymentIntentId: typeof d.paymentIntentId === "string" ? d.paymentIntentId : null,
            intentStatus: typeof d.intentStatus === "string" ? d.intentStatus : null,
          });
          return;
        }
        setFetchError(apiErrorMessage(err, "Network error. Please refresh and try again."));
      });
  }, [dealId]);

  // A buyer whose fee already went through must never be offered the card form
  // again. Which of the two honest states applies is decided by the same pure
  // rule the verifying pages use, not by a second reading of Stripe's statuses;
  // an absent status falls to "charged", because when we do not know, telling
  // someone not to pay again is the safe error.
  if (unsettled) {
    const outcome = classifyPaymentConfirmation({
      intentStatus: unsettled.intentStatus,
      recordedStatus: null,
    });
    const recheckHref = unsettled.paymentIntentId
      ? `/buyer/deal/payment/success?payment_intent=${encodeURIComponent(unsettled.paymentIntentId)}`
      : "/buyer/deal/payment/success";
    return (
      <PaymentUnsettledNotice
        variant={outcome === "processing" ? "processing" : "charged"}
        context="fee"
        paymentIntentId={unsettled.paymentIntentId}
        recheckHref={recheckHref}
        testId="fee-charge-unsettled-block"
      />
    );
  }

  if (fetchError) {
    return <p className="text-sm text-red-600 text-center py-4">{fetchError}</p>;
  }
  if (!clientSecret) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Preparing payment…
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="text-center py-8" data-testid="stripe-unavailable">
        <p className="text-sm text-red-600 font-medium">
          Payment service temporarily unavailable.
        </p>
        <p className="text-xs text-[#6B7280] mt-1">Please contact support.</p>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm netFeeCents={netFeeCents} />
    </Elements>
  );
}
