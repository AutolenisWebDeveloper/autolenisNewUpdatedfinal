"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700"
        data-testid={`scan-success-${dealId}`}
      >
        <CheckCircle2 size={15} className="shrink-0" /> Pickup confirmed — deal marked complete
      </div>
    );
  }

  return (
    <form onSubmit={handleScan} className="space-y-3" data-testid={`pickup-form-${dealId}`}>
      {error && (
        <p className="text-sm text-al-danger" role="alert" data-testid={`scan-error-${dealId}`}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          type="text"
          value={qrToken}
          onChange={(e) => setQrToken(e.target.value)}
          placeholder="Paste QR token..."
          className="flex-1"
          data-testid={`qr-token-input-${dealId}`}
        />
        <Button
          type="submit"
          disabled={scanning || !qrToken.trim()}
          data-testid={`scan-qr-${dealId}`}
        >
          {scanning ? "..." : "Scan QR"}
        </Button>
      </div>
    </form>
  );
}
