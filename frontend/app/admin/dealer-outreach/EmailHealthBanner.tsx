"use client";

// Phase 4B-2 — Email Health banner. Surfaces, at the top of the dealer outreach
// page, whether the sending domain is configured and ready. Green when all
// required env vars are set; amber (with the missing vars + a Resend link) when
// the founder still needs to finish DNS / env warming setup.
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

interface EmailHealth {
  configured: boolean;
  missingVars: string[];
  fromEmail: string | null;
  replyTo: string | null;
  hasPhysicalAddress: boolean;
  resendDashboardUrl: string;
}

export default function EmailHealthBanner() {
  const [health, setHealth] = useState<EmailHealth | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/dealer-outreach/email-health")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const data = body?.data as EmailHealth | undefined;
        if (data) setHealth(data);
        else setErrored(true);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stay silent until we know the status (and on fetch error — non-blocking).
  if (errored || !health) return null;

  if (health.configured) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="font-medium">Email domain ready</span>
        {health.fromEmail && (
          <span className="text-green-700">· sending from {health.fromEmail}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={16} className="shrink-0" />
        Email domain not configured — outreach sends are blocked
      </div>
      {health.missingVars.length > 0 && (
        <div className="mt-1.5 text-amber-800">
          Set these in Vercel:{" "}
          <span className="font-mono text-xs">{health.missingVars.join(", ")}</span>
        </div>
      )}
      <a
        href={health.resendDashboardUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 font-medium text-amber-900 underline hover:text-amber-700"
      >
        Open Resend dashboard
        <ExternalLink size={13} />
      </a>
    </div>
  );
}
