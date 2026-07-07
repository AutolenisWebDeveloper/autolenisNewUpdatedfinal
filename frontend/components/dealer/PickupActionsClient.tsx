"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  dealId: string;
}

export default function PickupActionsClient({ dealId }: Props) {
  const router = useRouter();
  const [qrToken, setQrToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!qrToken.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/pickup/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrToken: qrToken.trim() }),
      });

      if (res.status === 409) {
        setError("This QR code has already been scanned.");
        return;
      }
      if (res.status === 422) {
        setError("Invalid or expired QR code.");
        return;
      }
      if (!res.ok) {
        setError("Scan failed. Please try again.");
        return;
      }

      setSuccess(true);
      setQrToken("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  if (success) {
    return (
      <div
        className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700"
        data-testid={`scan-success-${dealId}`}
      >
        ✓ Pickup confirmed — deal marked complete
      </div>
    );
  }

  return (
    <form onSubmit={handleScan} className="space-y-3" data-testid={`pickup-form-${dealId}`}>
      {error && (
        <p className="text-sm text-red-600" data-testid={`scan-error-${dealId}`}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="Paste QR token..."
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-al-primary/30"
          data-testid={`qr-token-input-${dealId}`}
        />
        <button
          type="submit"
          disabled={scanning || !qrToken.trim()}
          className="px-4 py-2 bg-al-primary hover:bg-[#1A6FE0] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm"
          data-testid={`scan-qr-${dealId}`}
        >
          {scanning ? "..." : "Scan QR"}
        </button>
      </div>
    </form>
  );
}
