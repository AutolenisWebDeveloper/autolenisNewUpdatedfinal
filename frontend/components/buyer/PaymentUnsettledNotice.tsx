import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

// The single rendering of "your money moved, our bookkeeping hasn't caught up".
//
// Two different surfaces reach this same fact about the same payment:
//   • /buyer/deposit/success — the buyer just confirmed a card and we verified
//     the PaymentIntent server-side;
//   • /buyer/deposit — the buyer came back later (or the next day) and
//     create-intent refused to mint a second intent, returning CHARGE_UNSETTLED.
//
// They are the same buyer being told the same thing, so they are one component.
// When these were separate blocks the wording drifted, and drift here is not
// cosmetic: the whole point of this state is the sentence "do not pay again",
// and a surface that softens or omits it invites a duplicate charge.
//
// This is presentational only. It decides nothing — `classifyPaymentConfirmation`
// (lib/services/payment/payment-confirmation) is the one rule that decides which
// variant applies, and both callers go through it.

export type PaymentUnsettledVariant = "processing" | "charged";

/** Which payment this is about. Both buyer payments reach this same state for
 *  the same reason (the webhook that would record them has never landed), so
 *  they share the component — only the noun and the consequence differ. */
export type PaymentUnsettledContext = "deposit" | "fee";

interface Props {
  variant: PaymentUnsettledVariant;
  /** Stripe PaymentIntent id, shown so the buyer can quote it to support. */
  paymentIntentId: string | null;
  /** Where "Check again" goes — must carry the payment reference forward. */
  recheckHref: string;
  /** Concierge deposits unlock prepared offers; they never launch an auction. */
  isConcierge?: boolean;
  /** Defaults to the $99 deposit. */
  context?: PaymentUnsettledContext;
  /** Distinguishes the surface in tests. */
  testId: string;
}

export default function PaymentUnsettledNotice({
  variant,
  paymentIntentId,
  recheckHref,
  isConcierge = false,
  context = "deposit",
  testId,
}: Props) {
  const charged = variant === "charged";
  const isFee = context === "fee";

  return (
    <div className="p-6 md:p-8 max-w-xl text-center" data-testid={testId}>
      <div
        className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 ${
          charged
            ? "bg-[#FFFBEB] border border-[#FDE68A]"
            : "bg-al-primary-subtle border border-[#DBEAFE]"
        }`}
      >
        <Clock
          size={40}
          className={charged ? "text-al-warning" : "text-al-primary"}
          aria-hidden="true"
        />
      </div>

      <h1 className="text-2xl font-bold text-[#111827] mb-2">
        {charged
          ? `Payment received — finishing ${isFee ? "up" : "setup"}`
          : "Payment processing…"}
      </h1>

      <p className="text-[#4B5563] text-sm mb-6 leading-relaxed" role="status">
        {charged && isFee ? (
          <>
            Your service fee payment went through. We haven&apos;t finished
            recording it on our side yet.{" "}
            <strong className="text-[#111827]">Do not pay again.</strong> This
            usually resolves on its own within a few minutes.
          </>
        ) : charged ? (
          <>
            Your $99 payment went through. We haven&apos;t finished recording it on
            our side yet, so{" "}
            {isConcierge ? "your offers are not unlocked" : "your auction is not live"}{" "}
            just this moment.{" "}
            <strong className="text-[#111827]">Do not pay again.</strong> This
            usually resolves on its own within a few minutes.
          </>
        ) : (
          <>
            Your bank is still confirming this payment. This usually takes a few
            seconds. Refresh this page in a moment —{" "}
            <strong className="text-[#111827]">you do not need to pay again.</strong>
          </>
        )}
      </p>

      {charged && (
        <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-4 mb-6 text-left text-sm text-[#4B5563]">
          {paymentIntentId && (
            <p className="mb-1">
              Payment reference:{" "}
              <span className="font-mono text-xs text-[#111827]">{paymentIntentId}</span>
            </p>
          )}
          <p>
            If this page still says the same thing in 15 minutes,{" "}
            {paymentIntentId ? "send that reference to" : "contact"}{" "}
            <a href="mailto:support@autolenis.com" className="text-al-primary hover:underline">
              support@autolenis.com
            </a>{" "}
            and we&apos;ll finish it for you.
          </p>
        </div>
      )}

      <Link
        href={recheckHref}
        className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors"
      >
        Check again <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
