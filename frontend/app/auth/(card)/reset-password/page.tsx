"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/lib/auth/actions";
import { CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";

// Strength indicator: 0 = none, 1 = weak, 2 = fair, 3 = strong. Gate ≥ 2.
function scorePassword(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return 1;
  if (score <= 2) return 1;
  if (score === 3) return 2;
  return 3;
}
const STRENGTH_LABELS = ["", "Weak", "Fair", "Strong"] as const;
const STRENGTH_COLORS = ["", "#E63946", "#E0A100", "#1A6B18"] as const;

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [success, setSuccess] = useState(false);

  const strength = scorePassword(password);
  const passwordsMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;
  const meetsStrength = strength >= 2;

  useEffect(() => {
    if (!tokenHash) setExpired(true);
  }, [tokenHash]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!meetsStrength) {
      setError("Please choose a stronger password (at least 8 characters with mixed case or a number).");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.set("tokenHash", tokenHash);
    const result = await resetPasswordAction(formData);
    setLoading(false);
    if (result?.error) {
      // Detect expired/invalid-link signal so the user can re-request a reset.
      if (/expired|invalid|link/i.test(result.error)) {
        setExpired(true);
      } else {
        setError(result.error);
      }
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <div className="text-center" data-testid="reset-password-success">
        <div className="w-14 h-14 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-[#1A6B18]" />
        </div>
        <h2 className="text-xl font-bold text-[#111827] mb-2">Password updated</h2>
        <p className="text-sm text-[#4B5563] mb-6">Your password has been changed successfully.</p>
        <Button href="/auth/signin" data-testid="goto-signin-btn">Sign In</Button>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="text-center" data-testid="reset-password-expired">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} className="text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-[#111827] mb-2">Reset link expired</h2>
        <p className="text-sm text-[#4B5563] mb-6 leading-relaxed">
          This password reset link has expired or is no longer valid. Request a new one and we&apos;ll email you a fresh link.
        </p>
        <Button href="/auth/forgot-password" data-testid="reset-request-new-btn">
          Request a new link
        </Button>
        <p className="text-xs text-[#94A3B8] mt-6">
          Remembered your password?{" "}
          <Link href="/auth/signin" className="text-[#0B5FD1] hover:underline font-semibold">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div data-testid="reset-password-page">
      <h1 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Set new password</h1>
      <p className="text-sm text-[#4B5563] mb-8">Choose a strong password for your account.</p>

      <form onSubmit={handleSubmit} data-testid="reset-password-form" className="space-y-4">
        <div>
          <input type="hidden" name="tokenHash" value={tokenHash} />
          <Label htmlFor="password">New password</Label>
          <div className="relative mt-1.5">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              data-testid="reset-password-input"
              required
              minLength={8}
              className="pr-11"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              data-testid="reset-password-toggle"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0B5FD1]"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {/* Strength indicator (weak / fair / strong) */}
          {password.length > 0 && (
            <div className="mt-2" data-testid="reset-password-strength">
              <div className="flex gap-1">
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{ background: strength >= step ? STRENGTH_COLORS[strength] : "#E5E7EB" }}
                  />
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: STRENGTH_COLORS[strength] || "#94A3B8" }}>
                {STRENGTH_LABELS[strength]}
              </p>
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            data-testid="reset-confirm-input"
            required
            className="mt-1.5"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {showMismatch && (
            <p className="text-[11px] text-red-600 mt-1.5" data-testid="reset-mismatch-hint">
              Passwords do not match.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="reset-error">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          size="lg"
          data-testid="reset-submit-btn"
          disabled={loading || !meetsStrength || !passwordsMatch}
        >
          {loading ? "Updating…" : "Update Password"}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-[#4B5563]">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
