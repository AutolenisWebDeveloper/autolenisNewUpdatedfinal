"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "@/lib/auth/actions";
import { CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await forgotPasswordAction(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center" data-testid="forgot-password-success">
        <div className="w-14 h-14 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={28} className="text-[#1A6B18]" />
        </div>
        <h2 className="text-xl font-bold text-[#111827] mb-2">Check your email</h2>
        {/* Identical message whether email exists or not — prevents enumeration */}
        <p className="text-sm text-[#4B5563] mb-6">Check your email for password reset instructions.</p>
        <Link href="/auth/signin" className="text-sm text-[#0B5FD1] font-semibold hover:underline" data-testid="back-to-signin-link">← Back to sign in</Link>
      </div>
    );
  }

  return (
    <div data-testid="forgot-password-page">
      <h1 className="text-2xl font-bold text-[#111827] mb-1 tracking-tight">Reset your password</h1>
      <p className="text-sm text-[#4B5563] mb-8">Enter your email and we&apos;ll send you a reset link.</p>

      <form onSubmit={handleSubmit} data-testid="forgot-password-form" className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" data-testid="forgot-email-input" required className="mt-1.5" autoComplete="email" />
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="forgot-error">{error}</p>}
        <Button type="submit" className="w-full" size="lg" data-testid="forgot-submit-btn" disabled={loading}>
          {loading ? "Sending…" : "Send Reset Link"}
        </Button>
      </form>
      <div className="text-center mt-6">
        <Link href="/auth/signin" className="text-sm text-[#0B5FD1] font-semibold hover:underline" data-testid="back-to-signin-link">← Back to sign in</Link>
      </div>
    </div>
  );
}
