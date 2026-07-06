"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ScrollText, CheckCircle, Loader2 } from "lucide-react";
import {
  CURRENT_DEALER_AGREEMENT_VERSION,
  DEALER_AGREEMENT_TEXT,
} from "@/lib/constants/dealer-agreement";
import { api, apiErrorMessage } from "@/lib/api/client";

export default function DealerAgreementPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || hasScrolled) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
    if (atBottom) setHasScrolled(true);
  }, [hasScrolled]);

  const canSign = agreed && hasScrolled;

  async function handleSign() {
    if (!canSign) return;
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/dealer/agreement/sign", {
        agreedToTerms: true,
        agreementVersion: CURRENT_DEALER_AGREEMENT_VERSION,
        consentedToElectronic: true,
      });
      router.push("/dealer/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "Network error. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const buttonLabel = loading
    ? "Processing..."
    : canSign
      ? "Sign Agreement & Complete Onboarding"
      : hasScrolled
        ? "Check the box above to continue"
        : "Scroll to review the full agreement";

  return (
    <div
      className="min-h-screen bg-[#0E0620] flex items-center justify-center p-4"
      data-testid="agreement-page"
    >
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <ShieldCheck color="#643293" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white">Dealer Network Agreement</h1>
          <p className="text-purple-300 text-sm mt-1">
            Review and sign to complete your onboarding
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 space-y-6">
          {/* A. Error banner */}
          {error && (
            <div
              className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 text-sm"
              data-testid="agreement-error"
            >
              {error}
            </div>
          )}

          {/* B. Electronic consent disclosure */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-5 py-4">
            <p className="text-blue-200 text-sm font-semibold mb-1">
              Electronic Signature Consent
            </p>
            <p className="text-blue-300 text-xs leading-relaxed">
              By signing below, you consent to conduct this transaction
              electronically and to receive this agreement in electronic form.
              You have the right to receive a paper copy — contact
              support@autolenis.com to request one. Your electronic signature is
              legally binding under the U.S. ESIGN Act and UETA.
            </p>
          </div>

          {/* C. Agreement version line */}
          <div className="flex items-center gap-2">
            <ScrollText size={14} className="text-purple-400" />
            <span className="text-purple-400 text-xs">
              AutoLenis Dealer Network Agreement — Version{" "}
              {CURRENT_DEALER_AGREEMENT_VERSION}
            </span>
          </div>

          {/* Scroll status indicator */}
          <div>
            {hasScrolled ? (
              <span className="text-green-400 flex items-center gap-1 text-xs">
                <CheckCircle size={12} /> Agreement reviewed
              </span>
            ) : (
              <span className="text-purple-400 text-xs">
                ↓ Scroll to the bottom to continue
              </span>
            )}
          </div>

          {/* D. Scrollable agreement text */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="agreement-scroll"
            className="bg-white/5 border border-white/10 rounded-lg p-5 h-72 overflow-y-auto text-purple-200 text-xs leading-relaxed whitespace-pre-wrap"
          >
            {DEALER_AGREEMENT_TEXT}
          </div>

          {/* E. Acknowledgment checkbox */}
          <label
            className="flex items-start gap-3 cursor-pointer"
            data-testid="agree-label"
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={!hasScrolled}
              className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/10 accent-purple-500 disabled:opacity-40"
              data-testid="agree-checkbox"
            />
            <span className="text-purple-200 text-sm">
              I have read the AutoLenis Dealer Network Participation Agreement in
              its entirety and agree to be bound by its terms on behalf of my
              dealership.
            </span>
          </label>

          {/* F. Sign button */}
          <button
            onClick={handleSign}
            disabled={loading || !canSign}
            className="w-full bg-[#643293] hover:bg-[#7a40b0] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors text-sm"
            data-testid="sign-agreement-btn"
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {buttonLabel}
              </span>
            ) : buttonLabel}
          </button>

          {/* G. Disclosure footer */}
          <p className="text-center text-xs text-purple-500">
            A signed copy will be emailed to you and stored in your account. Your
            IP address, timestamp, and browser identity are recorded as part of
            this signature event.
          </p>
        </div>
      </div>
    </div>
  );
}
