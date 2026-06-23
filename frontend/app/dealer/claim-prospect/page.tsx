"use client";

// F-010 — recruited-prospect one-click claim form.
// Reached from the tokenized link in dealer outreach emails
// (`buildClaimUrl` → /dealer/claim-prospect?token=...). Prefills the
// dealership from the sourced prospect and collects the one field prospects
// never carry — the license number — then converts to a PENDING
// DealerApplication (approval still gates account creation).

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, AlertTriangle } from "lucide-react";

interface Prefill {
  prospectId: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  contactName: string | null;
  contactEmail: string | null;
  alreadyConverted: boolean;
}

export default function DealerClaimProspectPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [licenseNumber, setLicenseNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError("No claim token provided.");
      setLoading(false);
      return;
    }
    fetch(`/api/dealer/prospect-claim?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = (await res.json()) as { success?: boolean; data?: Prefill; error?: string };
        if (res.ok && data.data) {
          setPrefill(data.data);
          setContactName(data.data.contactName ?? "");
          setContactEmail(data.data.contactEmail ?? "");
        } else {
          setLoadError(data.error ?? "Invalid or expired claim link.");
        }
      })
      .catch(() => setLoadError("Failed to validate claim link."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!licenseNumber.trim()) {
      setSubmitError("Dealer license number is required.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/dealer/prospect-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          licenseNumber: licenseNumber.trim(),
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; data?: { message?: string } };
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to submit application.");
      } else {
        setSuccess(data.data?.message ?? "Application received — our team will confirm your dealership shortly.");
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#0B5FD1] to-[#0B3D8A] flex items-center justify-center">
              <span className="text-white font-black text-sm">AL</span>
            </div>
            <span className="text-[#111827] font-bold text-lg">AutoLenis</span>
          </div>
          <h1 className="text-2xl font-bold text-[#111827]">Claim Your Dealership</h1>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
          {loading && <p className="text-[#0B5FD1] text-sm text-center">Validating claim link...</p>}

          {!loading && loadError && (
            <div data-testid="claim-error" className="text-center">
              <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h2 className="text-[#111827] font-semibold text-lg mb-2">Link Issue</h2>
              <p className="text-red-600 text-sm">{loadError}</p>
              <p className="text-[#4B5563] text-sm mt-4">
                You can still apply directly on our{" "}
                <a href="/dealer-application" className="text-[#0B5FD1] font-medium hover:underline">
                  dealer application
                </a>
                .
              </p>
            </div>
          )}

          {!loading && prefill && !success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4 mb-2">
                <p className="text-[#1D4ED8] text-sm">
                  <strong>Dealership:</strong> {prefill.dealershipName}
                </p>
                {(prefill.city || prefill.state) && (
                  <p className="text-[#1D4ED8] text-sm mt-1">
                    <strong>Location:</strong> {[prefill.city, prefill.state, prefill.zip].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>

              {prefill.alreadyConverted && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 text-sm">
                  An application for this dealership is already on file. Submitting again will not create a duplicate.
                </div>
              )}

              <div>
                <label className="block text-[#374151] text-sm font-medium mb-1">Dealer License Number</label>
                <input
                  data-testid="claim-license"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="Your state dealer license #"
                  required
                  className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-4 py-3 text-[#111827] placeholder-[#9CA3AF] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1]"
                />
              </div>

              <div>
                <label className="block text-[#374151] text-sm font-medium mb-1">Contact Name</label>
                <input
                  data-testid="claim-contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-4 py-3 text-[#111827] placeholder-[#9CA3AF] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1]"
                />
              </div>

              <div>
                <label className="block text-[#374151] text-sm font-medium mb-1">Contact Email</label>
                <input
                  data-testid="claim-contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@dealership.com"
                  className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-4 py-3 text-[#111827] placeholder-[#9CA3AF] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/20 focus:border-[#0B5FD1]"
                />
              </div>

              {submitError && (
                <div data-testid="claim-submit-error" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
                  {submitError}
                </div>
              )}

              <button
                data-testid="claim-submit"
                type="submit"
                disabled={submitting}
                className="w-full bg-[#0B5FD1] hover:bg-[#0A4DB8] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {submitting ? "Submitting..." : "Submit Application"}
              </button>
            </form>
          )}

          {success && (
            <div data-testid="claim-success" className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-[#111827] font-semibold text-xl mb-2">Application Received</h2>
              <p className="text-[#4B5563] text-sm">{success}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
