"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const AGREEMENT_TEXT = `By joining the AutoLenis Dealer Network, you agree to: (1) provide accurate vehicle listings and pricing; (2) respond promptly to buyer inquiries; (3) comply with all applicable state and federal regulations; (4) maintain your dealer license in good standing; (5) abide by AutoLenis marketplace policies. AutoLenis reserves the right to suspend or terminate accounts that violate these terms. Your account data is governed by the AutoLenis Privacy Policy.`;

export default function DealerAgreementPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    if (!agreed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "AGREEMENT", agreedToTerms: true }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Agreement could not be completed. Please try again.");
        return;
      }
      router.push("/dealer/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#0E0620] flex items-center justify-center p-4"
      data-testid="agreement-page"
    >
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">Dealer Agreement</h1>
          <p className="text-purple-300 text-sm mt-1">
            Review and sign the AutoLenis Dealer Network Agreement
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* DocuSign Notice */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-4">
            <p className="text-blue-200 text-sm leading-relaxed">
              <span className="font-semibold">Signing will be facilitated via DocuSign</span> — an
              envelope has been sent to your email. Please check your inbox to complete the signing
              process.
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 text-purple-400 text-xs">
            <div className="flex-1 h-px bg-white/10" />
            <span>— or sign inline —</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Inline Agreement */}
          <div>
            <p className="text-xs font-semibold text-white mb-2">AutoLenis Dealer Network Agreement</p>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 max-h-48 overflow-y-auto text-purple-300 text-xs leading-relaxed">
              {AGREEMENT_TEXT}
            </div>
          </div>

          {/* Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/10 accent-purple-500"
              data-testid="agree-checkbox"
            />
            <span className="text-purple-200 text-sm">
              I have read and agree to the AutoLenis Dealer Network Agreement
            </span>
          </label>

          {/* Accept Button */}
          <button
            onClick={handleAccept}
            disabled={loading || !agreed}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            data-testid="accept-agreement-btn"
          >
            {loading ? "Processing..." : "Accept & Continue"}
          </button>

          <Link
            href="/dealer/onboarding"
            className="block text-center text-sm text-purple-400 hover:text-purple-200 transition-colors"
            data-testid="back-to-onboarding"
          >
            ← Back to Onboarding
          </Link>
        </div>
      </div>
    </div>
  );
}
