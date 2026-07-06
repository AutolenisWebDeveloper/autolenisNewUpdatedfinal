"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, CheckCircle, AlertTriangle } from "lucide-react";

function DealerClaimInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<{ dealershipName: string; email: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError("No claim token provided.");
      setLoading(false);
      return;
    }
    fetch(`/api/dealer/claim?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = (await res.json()) as { success?: boolean; data?: typeof account; error?: string };
        if (res.ok && data.data) {
          setAccount(data.data);
        } else {
          setTokenError(data.error ?? "Invalid claim link");
        }
      })
      .catch(() => setTokenError("Failed to validate claim link"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setSubmitError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setSubmitError("Password must be at least 8 characters");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/dealer/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; redirect?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to set password");
      } else {
        setSuccess(true);
        setTimeout(() => router.push(data.redirect ?? "/dealer/onboarding"), 1500);
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
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-al-primary to-[#0B3D8A] flex items-center justify-center">
              <span className="text-white font-black text-sm">AL</span>
            </div>
            <span className="text-[#111827] font-bold text-lg">AutoLenis</span>
          </div>
          <h1 className="text-2xl font-bold text-[#111827]">Claim Your Dealer Account</h1>
          <p className="text-sm text-[#4B5563] mt-1">Set a password to finish activating your account.</p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
          {loading && <p className="text-al-primary text-sm text-center">Validating claim link...</p>}

          {!loading && tokenError && (
            <div data-testid="claim-error" className="text-center">
              <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h2 className="text-[#111827] font-semibold text-lg mb-2">Link Issue</h2>
              <p className="text-red-600 text-sm">{tokenError}</p>
              <p className="text-[#4B5563] text-sm mt-4">Contact your AutoLenis representative for a new claim link.</p>
            </div>
          )}

          {!loading && account && !success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-al-primary-subtle border border-[#BFDBFE] rounded-lg p-4 mb-2">
                <p className="text-[#1D4ED8] text-sm"><strong>Dealership:</strong> {account.dealershipName}</p>
                <p className="text-[#1D4ED8] text-sm mt-1"><strong>Email:</strong> {account.email}</p>
              </div>

              <div>
                <label className="block text-[#374151] text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input data-testid="claim-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-4 py-3 text-[#111827] placeholder-[#9CA3AF] text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20 focus:border-al-primary pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-al-primary transition-colors">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[#374151] text-sm font-medium mb-1">Confirm Password</label>
                <input data-testid="claim-confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required className="w-full bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-4 py-3 text-[#111827] placeholder-[#9CA3AF] text-sm focus:outline-none focus:ring-2 focus:ring-al-primary/20 focus:border-al-primary" />
              </div>

              {submitError && (
                <div data-testid="claim-submit-error" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{submitError}</div>
              )}

              <button data-testid="claim-submit" type="submit" disabled={submitting} className="w-full bg-al-primary hover:bg-al-primary-hover disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm">{submitting ? "Setting Password..." : "Set Password & Continue"}</button>
            </form>
          )}

          {success && (
            <div data-testid="claim-success" className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-[#111827] font-semibold text-xl mb-2">Account Claimed!</h2>
              <p className="text-[#4B5563] text-sm">Redirecting to onboarding...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DealerClaimPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center text-al-primary text-sm">Loading...</div>}>
      <DealerClaimInner />
    </Suspense>
  );
}
