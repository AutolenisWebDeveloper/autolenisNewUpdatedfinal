"use client";
import { useState } from "react";
import { PenLine, Loader2 } from "lucide-react";

interface Props {
  dealId: string;
  signingUrl: string | null;
}

export default function ESignLaunchButton({ dealId, signingUrl }: Props) {  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(signingUrl);

  async function handleLaunch() {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/esign/${dealId}`, { method: "POST" });
      const data = await res.json() as {
        success: boolean;
        data?: { signingUrl?: string };
        error?: { message: string };
      };
      if (!data.success) {
        setError(data.error?.message ?? "Failed to create signing session");
        return;
      }
      const newUrl = data.data?.signingUrl;
      if (newUrl && newUrl.startsWith("https://")) {
        setUrl(newUrl);
        window.open(newUrl, "_blank", "noopener,noreferrer");
      } else {
        setError("Signing session unavailable. Please try again or contact support.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleLaunch}
        disabled={loading}
        data-testid="open-docusign-btn"
        className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-al-primary text-white font-semibold rounded-xl hover:bg-al-primary-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {loading ? (
          <><Loader2 size={15} className="animate-spin" /> Preparing session…</>
        ) : (
          <><PenLine size={15} /> Open Signing Session</>
        )}
      </button>
      {error && (
        <p className="text-xs text-red-600 mt-2 text-center">{error}</p>
      )}
      <p className="text-xs text-slate-400 text-center mt-3">
        Powered by DocuSign · Bank-grade security
      </p>
    </div>
  );
}
