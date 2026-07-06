"use client";

// Opens an uploaded affiliate document via a short-lived signed URL from
// GET /api/affiliate/documents (M-20: documents were listed but not viewable —
// the signed-URL route existed but nothing in the portal used it). The URL is
// fetched on click, never rendered into the page, so nothing long-lived leaks
// into the DOM or history.

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api/client";

interface SignedDocument {
  id: string;
  signedUrl: string | null;
}

export default function DocumentViewButton({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDocument() {
    setLoading(true);
    setError(null);
    try {
      const { documents } = await api.get<{ documents: SignedDocument[] }>("/api/affiliate/documents");
      const url = documents.find((d) => d.id === documentId)?.signedUrl;
      if (!url) {
        setError("Preview unavailable. Try again shortly.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't open the document."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => { void openDocument(); }}
        disabled={loading}
        aria-label="View document"
        data-testid={`view-doc-${documentId}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
        View
      </button>
      {error && <span className="text-[11px] text-red-600 mt-0.5" role="alert">{error}</span>}
    </span>
  );
}
