"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api/client";

// Opens a private-bucket document via a freshly signed URL. `endpoint` is the
// signed-url route for the document family (platform vs affiliate).
export default function DocumentOpenButton({
  endpoint,
  label = "Open",
}: {
  endpoint: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const d = await api.get<{ signedUrl: string }>(endpoint);
      window.open(d.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not open document"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs font-medium text-al-primary hover:underline disabled:opacity-50"
      data-testid="document-open-btn"
    >
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ExternalLink size={12} aria-hidden />}
      {label}
    </button>
  );
}
