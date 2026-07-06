// Admin MFA setup — first-time TOTP configuration
// Step 1: Send email confirmation → Step 2: Confirm email → Step 3: QR + code → Step 4: Recovery codes
// Recovery codes page CANNOT be dismissed without checking "I have saved my codes"

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, Copy, AlertCircle, Mail, Download } from "lucide-react";

type Step = "email-pending" | "setup" | "codes";

export default function AdminSetupMfaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailToken = searchParams.get("emailToken");

  const [step, setStep] = useState<Step>(emailToken ? "setup" : "email-pending");
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string; recoveryCodes: string[] } | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [codeSaved, setCodeSaved] = useState(false);
  const [hashedCodes, setHashedCodes] = useState<string[]>([]);
  const [emailSent, setEmailSent] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // When we have an emailToken in the URL, verify it and fetch QR data
  const loadSetupData = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/auth/setup-mfa?emailToken=${encodeURIComponent(token)}`);
      if (res.status === 401 || res.status === 403) {
        setLoadError("Your admin session has expired. Please sign in again to continue.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setLoadError(d.error ?? "We couldn't verify your email confirmation. The link may have expired.");
        setLoading(false);
        return;
      }
      const d = await res.json() as { data?: { secret: string; qrCode: string; recoveryCodes: string[]; email?: string } };
      if (d.data) {
        setSetupData(d.data);
        if (d.data.email) setAdminEmail(d.data.email);
        setStep("setup");
      } else {
        setLoadError("MFA setup data unavailable. Please try again.");
      }
    } catch {
      setLoadError("Network error. Check your connection and retry.");
    }
    setLoading(false);
  }, []);

  // Load session email for the email-pending step
  const loadEmailInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auth/setup-mfa");
      if (res.status === 401 || res.status === 403) {
        setLoadError("Your admin session has expired. Please sign in again to continue.");
        return;
      }
      if (!res.ok) return;
      const d = await res.json() as { requiresEmailConfirmation?: boolean; emailSentTo?: string };
      if (d.emailSentTo) setAdminEmail(d.emailSentTo);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (emailToken) {
      void loadSetupData(emailToken);
    } else {
      void loadEmailInfo();
    }
  }, [emailToken, loadSetupData, loadEmailInfo]);

  async function sendConfirmationEmail() {
    setSendingEmail(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/setup-mfa/send-email", { method: "POST" });
      const d = await res.json() as { sent?: boolean; emailSentTo?: string; error?: string };
      if (!res.ok) {
        setError(d.error ?? "Failed to send confirmation email. Please try again.");
      } else {
        setEmailSent(true);
        if (d.emailSentTo) setAdminEmail(d.emailSentTo);
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSendingEmail(false);
  }

  async function handleConfirm() {
    if (!setupData || code.length !== 6) return;
    setError(null);
    setLoading(true);
    // TOTP is verified server-side at POST time.
    // Nothing to hash client-side — just advance to the save-codes step.
    setStep("codes");
    setLoading(false);
  }

  async function handleSaveAndContinue() {
    if (!codeSaved || !setupData) return;
    setLoading(true);

    const res = await fetch("/api/admin/auth/setup-mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: setupData.secret, code }),
    });
    const data = await res.json() as { success?: boolean; error?: string };
    setLoading(false);

    if (res.ok) router.push("/admin/dashboard");
    else setError(data.error ?? "Setup failed. Please try again.");
  }

  function handleCopyAll() {
    if (!setupData) return;
    void navigator.clipboard.writeText(setupData.recoveryCodes.join("\n"));
  }

  function handleDownload() {
    if (!setupData) return;
    const text = [
      "AutoLenis Admin — Recovery Codes",
      "Generated: " + new Date().toISOString(),
      "Each code can be used only once.",
      "",
      ...setupData.recoveryCodes,
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "autolenis-admin-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const pageShell = "min-h-screen bg-gradient-to-br from-[#0A0A0A] via-[#111827] to-[#0B3D8A] flex items-center justify-center p-6";
  const card = "w-full max-w-md bg-white border border-[#EAE0F5] rounded-2xl p-8 shadow-sm";

  if (loadError) {
    return (
      <div className={pageShell} data-testid="setup-mfa-load-error">
        <div className={card}>
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
              <AlertCircle size={18} className="text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1A0833]">MFA setup unavailable</h2>
              <p className="text-sm text-[#5C4580] mt-1 leading-relaxed" data-testid="setup-mfa-error-message">{loadError}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button href="/admin/auth/signin" className="flex-1" data-testid="setup-mfa-back-to-signin">
              Back to sign in
            </Button>
            <Button
              variant="outline"
              onClick={() => { setLoadError(null); location.reload(); }}
              data-testid="setup-mfa-retry-btn"
            >
              Retry
            </Button>
          </div>
          <div className="text-center mt-6">
            <Link href="/" className="text-xs text-[#9A85B8] hover:text-[#643293] transition-colors">
              ← Back to AutoLenis
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Email confirmation gate
  if (step === "email-pending") {
    return (
      <div className={pageShell} data-testid="setup-mfa-email-gate">
        <div className={card}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#F3EBFF] flex items-center justify-center shrink-0">
              <Mail size={20} className="text-[#643293]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1A0833]">Confirm your email to continue</h1>
              <p className="text-sm text-[#9A85B8] mt-0.5">Extra verification before showing your QR code</p>
            </div>
          </div>

          <div className="bg-[#F9F5FF] border border-[#EAE0F5] rounded-xl p-4 mb-6 space-y-2 text-sm text-[#5C4580]">
            <p>Your email and password are <strong>unchanged</strong>.</p>
            <p>You need to reconnect Google Authenticator. For security, we'll send a one-time link to your admin email first.</p>
            {adminEmail && <p>Email: <strong>{adminEmail}</strong></p>}
          </div>

          {emailSent ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6" data-testid="email-sent-notice">
              <p className="text-sm font-semibold text-emerald-800 mb-1">Email sent!</p>
              <p className="text-sm text-emerald-700">
                Check your inbox{adminEmail ? ` (${adminEmail})` : ""} and click the confirmation link.
                The link expires in 10 minutes.
              </p>
            </div>
          ) : null}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4" data-testid="email-send-error">
              {error}
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={sendConfirmationEmail}
            disabled={sendingEmail || emailSent}
            data-testid="send-email-confirmation-btn"
          >
            {sendingEmail ? "Sending…" : emailSent ? "Email sent — check your inbox" : "Send confirmation email"}
          </Button>

          {emailSent && (
            <button
              onClick={sendConfirmationEmail}
              disabled={sendingEmail}
              className="block w-full text-center text-xs text-[#9A85B8] hover:text-[#643293] transition-colors mt-4"
              data-testid="resend-email-btn"
            >
              Didn't receive it? Resend after 60 seconds
            </button>
          )}

          <div className="text-center mt-6">
            <Link href="/admin/auth/signin" className="text-xs text-[#9A85B8] hover:text-[#643293] transition-colors">
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Loading QR data after email confirmation
  if (step === "setup" && !setupData) {
    return (
      <div className={pageShell} data-testid="setup-mfa-loading">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-al-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-white/70">Verifying confirmation…</p>
        </div>
      </div>
    );
  }

  // Step 3: Recovery codes
  if (step === "codes") {
    return (
      <div className={pageShell} data-testid="setup-mfa-codes-page">
        <div className={card}>
          <h2 className="text-xl font-bold text-[#1A0833] mb-2">Save your recovery codes</h2>
          <p className="text-[#5C4580] text-sm mb-5">Store these in a safe place. Each code can be used once if you lose access to your authenticator.</p>

          <div className="grid grid-cols-2 gap-2 mb-4" data-testid="recovery-codes-grid">
            {setupData!.recoveryCodes.map((c, i) => (
              <code key={i} className="text-xs font-mono bg-[#F9F5FF] border border-[#EAE0F5] text-[#1A6B18] rounded-lg px-3 py-2 text-center" data-testid={`recovery-code-${i}`}>{c}</code>
            ))}
          </div>

          <div className="flex gap-2 mb-6">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleCopyAll} data-testid="copy-all-codes-btn">
              <Copy size={13} /> Copy all
            </Button>
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleDownload} data-testid="download-codes-btn">
              <Download size={13} /> Download .txt
            </Button>
          </div>

          <div className="flex items-start gap-3 mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4" data-testid="codes-saved-gate">
            <input type="checkbox" id="saved-check" checked={codeSaved} onChange={e => setCodeSaved(e.target.checked)}
              className="mt-0.5 accent-[#643293]" data-testid="codes-saved-checkbox" />
            <label htmlFor="saved-check" className="text-sm text-amber-900">
              I have saved my recovery codes in a secure location. I understand each code can only be used once and they cannot be recovered if lost.
            </label>
          </div>

          {error && <p className="text-red-600 text-sm mb-4" data-testid="setup-error">{error}</p>}

          <Button className="w-full" size="lg" onClick={handleSaveAndContinue}
            disabled={!codeSaved || loading} data-testid="complete-setup-btn">
            {loading ? "Completing setup…" : "Complete Setup & Enter Console"}
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: QR code + TOTP verification
  return (
    <div className={pageShell} data-testid="setup-mfa-page">
      <div className={card}>
        <div className="flex items-center gap-3 mb-6">
          <Shield size={22} className="text-[#643293]" />
          <h1 className="text-xl font-bold text-[#1A0833]">Set Up Google Authenticator</h1>
        </div>

        <div className="bg-[#F9F5FF] border border-[#EAE0F5] rounded-xl p-4 mb-5 space-y-1.5 text-sm text-[#5C4580]">
          <p className="font-medium text-[#1A0833]">Your email and password are unchanged.</p>
          <p>You only need to reconnect Google Authenticator. Scan the QR code below with the app.</p>
        </div>

        {setupData!.qrCode && (
          <div className="bg-[#F9F5FF] border border-[#EAE0F5] p-4 rounded-xl mb-4 text-center" data-testid="totp-qr-code">
            <img src={setupData!.qrCode} alt="TOTP QR Code" className="w-40 h-40 mx-auto" />
          </div>
        )}

        <div className="mb-6">
          <p className="text-xs text-[#9A85B8] mb-1">Or enter the key manually in Google Authenticator:</p>
          <div className="flex items-center gap-2 bg-[#F9F5FF] border border-[#EAE0F5] rounded-lg px-3 py-2">
            <code className="text-xs font-mono text-[#5C4580] flex-1 break-all" data-testid="totp-secret">{setupData!.secret}</code>
            <button onClick={() => void navigator.clipboard.writeText(setupData!.secret)}
              className="text-[#9A85B8] hover:text-[#643293] transition-colors" data-testid="copy-secret-btn">
              <Copy size={13} />
            </button>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-sm text-[#5C4580] mb-2">Enter the 6-digit code from Google Authenticator to confirm setup:</p>
          <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6} inputMode="numeric" placeholder="000000" data-testid="setup-code-input"
            className="text-center font-mono text-lg" />
        </div>

        {error && <p className="text-red-600 text-sm mb-4" data-testid="setup-confirm-error">{error}</p>}

        <Button className="w-full" size="lg" onClick={handleConfirm}
          disabled={code.length !== 6 || loading} data-testid="confirm-totp-btn">
          {loading ? "Confirming…" : "Confirm & View Recovery Codes"}
        </Button>
      </div>
    </div>
  );
}
