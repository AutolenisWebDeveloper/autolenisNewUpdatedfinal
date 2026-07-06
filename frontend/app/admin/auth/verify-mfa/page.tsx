// Admin MFA verification page
// OTP input cells auto-advance on digit entry AND handle full-code paste
// MFA is REQUIRED — no skip path for any admin role

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

export default function AdminVerifyMfaPage() {
  const router = useRouter();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  // Auto-submit when all 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !useRecovery) handleVerify();
  }, [code]);

  function handleDigitChange(i: number, val: string) {
    if (!/^\d*$/.test(val)) return;

    // Handle paste — distribute across cells
    if (val.length > 1) {
      const pasted = val.replace(/\D/g, "").slice(0, 6).split("");
      const next = [...digits];
      pasted.forEach((d, idx) => { if (next[i + idx] !== undefined) next[i + idx] = d; });
      setDigits(next);
      const focusIdx = Math.min(i + pasted.length, 5);
      inputs.current[focusIdx]?.focus();
      return;
    }

    const next = [...digits];
    next[i] = val;
    setDigits(next);
    if (val && i < 5) inputs.current[i + 1]?.focus(); // Auto-advance
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  async function handleVerify() {
    setError(null);
    setLoading(true);

    const res = await fetch("/api/admin/auth/verify-mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        useRecovery
          ? { code: recoveryCode, isRecoveryCode: true }
          : { code, isRecoveryCode: false }
      ),
    });
    const data = await res.json() as { success?: boolean; error?: string };
    setLoading(false);

    if (res.ok && data.success) {
      router.push("/admin/dashboard");
    } else {
      setError(data.error ?? "Invalid code. Please try again.");
      setDigits(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0A] via-[#111827] to-[#0B3D8A] flex items-center justify-center p-6" data-testid="admin-verify-mfa-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-al-primary flex items-center justify-center mx-auto mb-4 shadow-md shadow-al-primary/25">
            <Shield size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Two-Factor Authentication</h1>
          <p className="text-white/70 text-sm mt-1">
            {useRecovery ? "Enter a recovery code" : "Enter the 6-digit code from your authenticator app"}
          </p>
        </div>

        <div className="bg-white border border-[#EAE0F5] rounded-2xl p-6 shadow-sm">
        {!useRecovery ? (
          <div>
            {/* OTP cells — auto-advance + paste support */}
            <div className="flex gap-2 justify-center mb-6" data-testid="otp-input-cells">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={el => { inputs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={d}
                  onChange={e => handleDigitChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  onPaste={e => {
                    e.preventDefault();
                    handleDigitChange(i, e.clipboardData.getData("text"));
                  }}
                  data-testid={`otp-cell-${i}`}
                  className="w-12 h-14 text-center text-xl font-bold rounded-xl bg-[#F9F5FF] border border-[#EAE0F5] text-[#1A0833] focus:outline-none focus:border-[#643293] focus:bg-white transition-colors"
                />
              ))}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleVerify}
              disabled={code.length !== 6 || loading}
              data-testid="verify-otp-btn"
            >
              {loading ? "Verifying…" : "Verify"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="XXXX-XXXX"
              value={recoveryCode}
              onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
              data-testid="recovery-code-input"
              className="w-full h-12 text-center font-mono rounded-xl bg-[#F9F5FF] border border-[#EAE0F5] text-[#1A0833] focus:outline-none focus:border-[#643293] placeholder:text-[#9A85B8]"
            />
            <Button className="w-full" size="lg"
              onClick={handleVerify} disabled={!recoveryCode || loading} data-testid="verify-recovery-btn">
              {loading ? "Verifying…" : "Use Recovery Code"}
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-4 text-center" data-testid="mfa-error">
            {error}
          </p>
        )}
        </div>

        <button
          onClick={() => { setUseRecovery(!useRecovery); setError(null); }}
          className="block w-full text-center text-xs text-white/60 hover:text-white transition-colors mt-6"
          data-testid="toggle-recovery-mode-btn"
        >
          {useRecovery ? "← Use authenticator app instead" : "Use a recovery code instead"}
        </button>
      </div>
    </div>
  );
}
