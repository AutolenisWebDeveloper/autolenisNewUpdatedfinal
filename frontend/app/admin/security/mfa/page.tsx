"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Copy, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

interface MfaStatus {
  totpEnabled: boolean;
  codesRemaining: number;
  lastRecoveryCodeUsedAt: string | null;
}

type Step = "status" | "scan" | "codes" | "done" | "regen-codes" | "regen-done";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

const pageShell = "min-h-screen bg-gradient-to-br from-[#F8F9FB] via-white to-[#EDF6FD] p-6 md:p-8";
const card = "w-full max-w-lg bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm mx-auto";

export default function AdminMfaSecurityPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("status");
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset flow state
  const [resetData, setResetData] = useState<{ secret: string; qrCode: string; recoveryCodes: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [codesSaved, setCodesSaved] = useState(false);

  // Regen flow state
  const [regenCodes, setRegenCodes] = useState<string[]>([]);
  const [regenSaved, setRegenSaved] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/security/mfa");
      if (res.status === 401) { router.push("/admin/auth/signin"); return; }
      if (!res.ok) { setLoadError("Failed to load MFA status. Please refresh."); return; }
      const d = await res.json() as { data?: MfaStatus };
      if (d.data) setStatus(d.data);
    } catch {
      setLoadError("Network error. Please refresh.");
    }
  }, [router]);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  async function startReset() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-reset" }),
      });
      const d = await res.json() as { data?: { secret: string; qrCode: string; recoveryCodes: string[] }; error?: { message: string } };
      if (!res.ok) { setError(d.error?.message ?? "Failed to start reset."); setLoading(false); return; }
      if (d.data) { setResetData(d.data); setTotpCode(""); setCodesSaved(false); setStep("scan"); }
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  async function proceedToSaveCodes() {
    if (!resetData || totpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    // TOTP is verified server-side when the reset is completed.
    // Nothing to hash client-side — just advance to the save-codes step.
    setStep("codes");
    setLoading(false);
  }

  async function completeReset() {
    if (!resetData || !codesSaved) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete-reset", secret: resetData.secret, code: totpCode }),
      });
      const d = await res.json() as { error?: { message: string } };
      if (!res.ok) { setError(d.error?.message ?? "Reset failed. Please try again."); setLoading(false); return; }
      await fetchStatus();
      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  async function startRegenCodes() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-codes" }),
      });
      const d = await res.json() as { data?: { recoveryCodes: string[] }; error?: { message: string } };
      if (!res.ok || !d.data) { setError(d.error?.message ?? "Failed to generate codes."); setLoading(false); return; }
      setRegenCodes(d.data.recoveryCodes);
      setRegenSaved(false);
      setStep("regen-codes");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  async function saveRegenCodes() {
    if (!regenSaved) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regen-codes" }),
      });
      const d = await res.json() as { error?: { message: string } };
      if (!res.ok) { setError(d.error?.message ?? "Failed to save codes."); setLoading(false); return; }
      await fetchStatus();
      setStep("regen-done");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  // ─── Loading / error ───────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className={pageShell}>
        <div className={card}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-[#111827]">Error</p>
              <p className="text-sm text-[#4B5563] mt-1">{loadError}</p>
            </div>
          </div>
          <Button className="mt-4 w-full" onClick={() => { setLoadError(null); void fetchStatus(); }}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className={pageShell}>
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="w-8 h-8 border-2 border-[#0B5FD1] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[#94A3B8]">Loading MFA status…</p>
        </div>
      </div>
    );
  }

  // ─── Status view ──────────────────────────────────────────────────────────

  if (step === "status") {
    const crit = status.codesRemaining === 0 && status.lastRecoveryCodeUsedAt != null;
    const low = status.codesRemaining > 0 && status.codesRemaining <= 2;

    return (
      <div className={pageShell} data-testid="admin-mfa-status-page">
        <div className={card}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#F3EAFF] flex items-center justify-center shrink-0">
              <Shield size={18} className="text-[#0B5FD1]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#111827]">MFA Security</h1>
              <p className="text-sm text-[#94A3B8]">Manage your authenticator and recovery codes</p>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between py-3 border-b border-[#E5E7EB]">
              <span className="text-sm text-[#4B5563]">Authenticator App</span>
              <Badge variant={status.totpEnabled ? "default" : "secondary"}>
                {status.totpEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-3 border-b border-[#E5E7EB]">
              <span className="text-sm text-[#4B5563]">Recovery Codes Remaining</span>
              <span className={`text-sm font-bold ${crit ? "text-red-700" : low ? "text-amber-700" : "text-[#111827]"}`}>
                {status.codesRemaining}
              </span>
            </div>
            {status.lastRecoveryCodeUsedAt && (
              <div className="flex items-center justify-between py-3 border-b border-[#E5E7EB]">
                <span className="text-sm text-[#4B5563]">Last Recovery Code Used</span>
                <span className="text-sm text-[#111827]">
                  {new Date(status.lastRecoveryCodeUsedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {crit && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
              <AlertTriangle size={16} className="text-red-700 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">You have no recovery codes left. Reset your MFA immediately to generate new codes.</p>
            </div>
          )}
          {!crit && low && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
              <AlertTriangle size={16} className="text-amber-900 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900">Only {status.codesRemaining} recovery code(s) remaining. Regenerate soon.</p>
            </div>
          )}

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <div className="flex flex-col gap-3">
            <Button className="w-full" onClick={startReset} disabled={loading} data-testid="start-reset-btn">
              <RefreshCw size={14} />
              {loading ? "Starting…" : "Reset Authenticator App"}
            </Button>
            <Button variant="outline" className="w-full" onClick={startRegenCodes} data-testid="regen-codes-btn">
              Regenerate Recovery Codes Only
            </Button>
          </div>

          <div className="mt-6 text-center">
            <Link href="/admin/dashboard" className="text-xs text-[#94A3B8] hover:text-[#0B5FD1] transition-colors">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Reset: scan step ─────────────────────────────────────────────────────

  if (step === "scan" && resetData) {
    return (
      <div className={pageShell} data-testid="admin-mfa-reset-scan-step">
        <div className={card}>
          <div className="flex items-center gap-3 mb-6">
            <Shield size={20} className="text-[#0B5FD1]" />
            <h2 className="text-xl font-bold text-[#111827]">Scan New QR Code</h2>
          </div>
          <p className="text-sm text-[#4B5563] mb-5">
            Open your authenticator app and scan the QR code below to add the new account.
          </p>

          <div className="bg-[#F8F9FB] border border-[#E5E7EB] p-4 rounded-xl mb-4 text-center" data-testid="totp-qr-code">
            <img src={resetData.qrCode} alt="TOTP QR Code" className="w-40 h-40 mx-auto" />
          </div>

          <div className="mb-5">
            <p className="text-xs text-[#94A3B8] mb-1">Or enter manually:</p>
            <div className="flex items-center gap-2 bg-[#F8F9FB] border border-[#E5E7EB] rounded-lg px-3 py-2">
              <code className="text-xs font-mono text-[#4B5563] flex-1 break-all" data-testid="totp-secret">
                {resetData.secret}
              </code>
              <button
                onClick={() => copyText(resetData.secret)}
                className="text-[#94A3B8] hover:text-[#0B5FD1] transition-colors"
                data-testid="copy-secret-btn"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div className="mb-5">
            <p className="text-sm text-[#4B5563] mb-2">Enter the 6-digit code to confirm:</p>
            <Input
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              inputMode="numeric"
              placeholder="000000"
              data-testid="reset-totp-code-input"
              className="text-center font-mono text-lg"
            />
          </div>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("status")} className="flex-1">Cancel</Button>
            <Button
              className="flex-1"
              onClick={proceedToSaveCodes}
              disabled={totpCode.length !== 6 || loading}
              data-testid="next-save-codes-btn"
            >
              {loading ? "…" : "Next: Save Recovery Codes"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Reset: codes step ────────────────────────────────────────────────────

  if (step === "codes" && resetData) {
    return (
      <div className={pageShell} data-testid="admin-mfa-reset-codes-step">
        <div className={card}>
          <h2 className="text-xl font-bold text-[#111827] mb-2">Save Your New Recovery Codes</h2>
          <p className="text-sm text-[#4B5563] mb-5">
            Store these in a secure location. Each code can only be used once.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-4" data-testid="recovery-codes-grid">
            {resetData.recoveryCodes.map((c, i) => (
              <code
                key={i}
                className="text-xs font-mono bg-[#F8F9FB] border border-[#E5E7EB] text-[#1A6B18] rounded-lg px-3 py-2 text-center"
                data-testid={`recovery-code-${i}`}
              >
                {c}
              </code>
            ))}
          </div>

          <button
            onClick={() => copyText(resetData.recoveryCodes.join("\n"))}
            className="flex items-center gap-1.5 text-xs text-[#0B5FD1] hover:underline mb-5"
            data-testid="copy-all-codes-btn"
          >
            <Copy size={12} /> Copy all codes
          </button>

          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
            <input
              type="checkbox"
              id="codes-saved"
              checked={codesSaved}
              onChange={e => setCodesSaved(e.target.checked)}
              className="mt-0.5 accent-[#0B5FD1]"
              data-testid="codes-saved-checkbox"
            />
            <label htmlFor="codes-saved" className="text-sm text-amber-900">
              I have saved my recovery codes in a secure location. I understand they cannot be recovered if lost.
            </label>
          </div>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={completeReset}
            disabled={!codesSaved || loading}
            data-testid="complete-reset-btn"
          >
            {loading ? "Completing reset…" : "Complete Reset"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Reset: done ──────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <div className={pageShell} data-testid="admin-mfa-reset-done-step">
        <div className={card}>
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-green-700" />
            </div>
            <h2 className="text-xl font-bold text-[#111827]">Authenticator reset successfully.</h2>
            <p className="text-sm text-[#4B5563]">Your account is fully secured.</p>
            {status && (
              <p className="text-sm text-[#94A3B8]">{status.codesRemaining} recovery codes active.</p>
            )}
          </div>
          <div className="flex flex-col gap-3 mt-4">
            <Button className="w-full" href="/admin/dashboard" data-testid="return-dashboard-btn">
              Return to Dashboard
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setStep("status")}>
              Back to MFA Settings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Regen codes flow ─────────────────────────────────────────────────────

  if (step === "regen-codes") {
    return (
      <div className={pageShell} data-testid="admin-mfa-regen-codes-step">
        <div className={card}>
          <h2 className="text-xl font-bold text-[#111827] mb-2">New Recovery Codes</h2>
          <p className="text-sm text-[#4B5563] mb-5">
            Your previous codes will be replaced. Store these in a secure location.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-4" data-testid="regen-codes-grid">
            {regenCodes.map((c, i) => (
              <code
                key={i}
                className="text-xs font-mono bg-[#F8F9FB] border border-[#E5E7EB] text-[#1A6B18] rounded-lg px-3 py-2 text-center"
                data-testid={`regen-code-${i}`}
              >
                {c}
              </code>
            ))}
          </div>

          <button
            onClick={() => copyText(regenCodes.join("\n"))}
            className="flex items-center gap-1.5 text-xs text-[#0B5FD1] hover:underline mb-5"
            data-testid="copy-all-regen-codes-btn"
          >
            <Copy size={12} /> Copy all codes
          </button>

          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
            <input
              type="checkbox"
              id="regen-saved"
              checked={regenSaved}
              onChange={e => setRegenSaved(e.target.checked)}
              className="mt-0.5 accent-[#0B5FD1]"
              data-testid="regen-saved-checkbox"
            />
            <label htmlFor="regen-saved" className="text-sm text-amber-900">
              I have saved my recovery codes in a secure location.
            </label>
          </div>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("status")} className="flex-1">Cancel</Button>
            <Button
              className="flex-1"
              onClick={saveRegenCodes}
              disabled={!regenSaved || loading}
              data-testid="save-regen-codes-btn"
            >
              {loading ? "Saving…" : "Save New Recovery Codes"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Regen done ───────────────────────────────────────────────────────────

  if (step === "regen-done") {
    return (
      <div className={pageShell}>
        <div className={card}>
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-green-700" />
            </div>
            <h2 className="text-xl font-bold text-[#111827]">Recovery codes updated.</h2>
            <p className="text-sm text-[#4B5563]">Your new codes are now active.</p>
            {status && (
              <p className="text-sm text-[#94A3B8]">{status.codesRemaining} codes active.</p>
            )}
          </div>
          <Button className="w-full mt-4" href="/admin/dashboard">Return to Dashboard</Button>
        </div>
      </div>
    );
  }

  return null;
}
