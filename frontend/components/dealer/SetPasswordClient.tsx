"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Lock, CheckCircle2 } from "lucide-react";

export default function SetPasswordClient({ email }: { email: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/dealer/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: pw }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(data.error?.message ?? "Could not update password");
      return;
    }
    // Hard reload so the layout-level guard re-evaluates and lets us in.
    window.location.href = "/dealer/dashboard?welcome=1";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-6">
      <div data-testid="dealer-set-password-card" className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full p-8">
        <div className="flex items-center gap-2 mb-2">
          <Lock size={18} className="text-[#0B5FD1]" />
          <h1 className="text-lg font-bold text-slate-900">Set a new password</h1>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          You signed in with a temporary password. For your security, please set a new password before continuing.
        </p>
        <p className="text-xs text-slate-400 mb-5">Account: <span className="font-medium text-slate-700">{email}</span></p>

        {error && (
          <div data-testid="set-password-error" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4" data-testid="dealer-set-password-form">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">New password</label>
            <input
              data-testid="dealer-new-password"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#0B5FD1]"
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">10+ chars, with uppercase, lowercase, and number</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Confirm new password</label>
            <input
              data-testid="dealer-confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#0B5FD1]"
              required
            />
          </div>
          <Button data-testid="dealer-set-password-submit" type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving…" : (<><CheckCircle2 size={15} /> Set password & continue</>)}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => router.push("/dealer/signin")}
          className="block mx-auto mt-4 text-xs text-slate-500 hover:underline"
        >
          Cancel & sign out
        </button>
      </div>
    </div>
  );
}
