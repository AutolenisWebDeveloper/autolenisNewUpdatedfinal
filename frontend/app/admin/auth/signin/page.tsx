// Admin sign-in page — uses admin-auth.ts ONLY, never Supabase buyer/dealer auth

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";

export default function AdminSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      let data: { redirect?: string; error?: string };
      try {
        data = await res.json() as { redirect?: string; error?: string };
      } catch {
        setError("Unexpected server response. Please try again.");
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Incorrect email or password");
        return;
      }

      if (data.redirect) {
        router.push(data.redirect);
      } else {
        setError("Unexpected server response. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0A] via-[#111827] to-[#0B3D8A] flex items-center justify-center p-6" data-testid="admin-signin-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#0B5FD1] flex items-center justify-center mx-auto mb-4 shadow-md shadow-[#0B5FD1]/25">
            <Shield size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Console</h1>
          <p className="text-white/70 text-sm mt-1">AutoLenis operations access</p>
        </div>

        <div className="bg-white border border-[#EAE0F5] rounded-2xl p-7 shadow-sm">
          <form onSubmit={handleSubmit} data-testid="admin-signin-form" className="space-y-4">
            <div>
              <Label htmlFor="admin-email" className="text-[#5C4580]">Email</Label>
              <Input id="admin-email" type="email" data-testid="admin-email-input"
                className="mt-1.5"
                value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="admin-password" className="text-[#5C4580]">Password</Label>
              <Input id="admin-password" type="password" data-testid="admin-password-input"
                className="mt-1.5"
                value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="admin-signin-error">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg"
              disabled={loading} data-testid="admin-signin-submit-btn">
              {loading ? "Signing in…" : "Continue to MFA"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-white/60 mt-6">
          MFA is required for all admin accounts &bull; Session lasts 24h
        </p>

        <div className="text-center mt-3">
          <Link href="/" className="text-xs text-white/60 hover:text-white transition-colors" data-testid="back-to-site-link">
            ← Back to AutoLenis
          </Link>
        </div>
      </div>
    </div>
  );
}
