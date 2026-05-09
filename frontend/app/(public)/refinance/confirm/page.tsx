"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowLeft, ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import RefinanceComplianceDisclosure from "@/components/public/RefinanceComplianceDisclosure";

type CachedLead = {
  leadId: string;
  qualified: boolean;
  vehicleYear: number;
  loanBalance: string;
  state: string;
};

function RefinanceConfirmInner() {
  const searchParams = useSearchParams();
  const leadIdFromUrl = searchParams.get("leadId") ?? "";
  const [lead, setLead] = useState<CachedLead | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [redirected, setRedirected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = sessionStorage.getItem("refinance-lead");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CachedLead;
        if (parsed.leadId === leadIdFromUrl || !leadIdFromUrl) setLead(parsed);
      } catch {
        setLead(null);
      }
    }
    // If we have a leadId in URL, check its server-side status — if REDIRECTED,
    // show the "already connected" view instead of the form.
    if (leadIdFromUrl) {
      fetch(`/api/public/refinance/redirect?leadId=${encodeURIComponent(leadIdFromUrl)}`)
        .then(r => r.json())
        .then((j: { success?: boolean; data?: { status: string; vehicleYear: number; loanBalance: string; state: string } }) => {
          if (j.success && j.data) {
            if (j.data.status === "REDIRECTED") {
              setRedirected(true);
            } else if (!cached) {
              // Hydrate summary card from server when sessionStorage missing
              setLead({
                leadId: leadIdFromUrl,
                qualified: true,
                vehicleYear: j.data.vehicleYear,
                loanBalance: j.data.loanBalance,
                state: j.data.state,
              });
            }
          }
        })
        .catch(() => { /* non-fatal */ });
    }
  }, [leadIdFromUrl]);

  async function handleContinueToPartner() {
    if (!leadIdFromUrl) {
      setError("Missing lead identifier. Please restart the eligibility screening.");
      return;
    }
    setError(null);
    setRedirecting(true);

    try {
      const res = await fetch("/api/public/refinance/redirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadIdFromUrl }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { leadId: string; status: string; redirectUrl: string };
        error?: { code: string; message: string };
      };

      if (!res.ok || !json.success || !json.data) {
        setError(json.error?.message ?? "Unable to connect you with our partner right now.");
        setRedirecting(false);
        return;
      }

      // Spec: open partner URL in a NEW tab — AutoLenis never frames/embeds.
      if (typeof window !== "undefined") {
        window.open(json.data.redirectUrl, "_blank", "noopener,noreferrer");
      }
      setRedirected(true);
      setRedirecting(false);
      // Clear cached context so refreshing doesn't re-submit.
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("refinance-lead");
      }
    } catch {
      setError("Unable to reach our servers. Please try again.");
      setRedirecting(false);
    }
  }

  if (redirected) {
    return (
      <div className="bg-white min-h-[70vh]" data-testid="refinance-redirected">
        <section className="pt-20 pb-24">
          <div className="mx-auto max-w-2xl px-6 text-center">
            <div className="w-14 h-14 rounded-full bg-[#50D14E]/15 flex items-center justify-center mx-auto mb-5 border border-[#50D14E]/25">
              <ExternalLink size={24} className="text-[#1A6B18]" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] mb-3 tracking-tight" data-testid="refinance-already-connected-heading">
              You have already been connected with OpenRoad Lending
            </h1>
            <p className="text-sm text-[#4B5563] max-w-md mx-auto leading-relaxed mb-8">
              Complete your application on their website. AutoLenis is not involved in their application process, underwriting, or decisions.
            </p>
            <RefinanceComplianceDisclosure className="max-w-lg mx-auto text-left" />
            <div className="mt-8">
              <Link
                href="/"
                className="text-sm font-semibold text-[#0B5FD1] hover:text-[#0A4DB8] transition-colors"
                data-testid="refinance-redirected-home-link"
              >
                ← Back to AutoLenis
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-white" data-testid="refinance-confirm-page">
      <section className="pt-16 py-20 bg-gradient-to-b from-[#F8F9FB] to-white">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#0B5FD1]">
            Before You Continue
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[#111827] mt-4 mb-4">
            You May Be a Fit for Refinancing
          </h1>
          <p className="text-[#4B5563] text-base leading-relaxed">
            Based on the information you provided, you may be eligible to apply through our partner, OpenRoad Lending.
          </p>
        </div>
      </section>

      <section className="py-14">
        <div className="mx-auto max-w-2xl px-6">
          {lead && (
            <div
              data-testid="refinance-confirm-summary"
              className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-6"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3">
                Your Submission
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-[#94A3B8]">Vehicle year</p>
                  <p className="font-semibold text-[#111827]" data-testid="rf-summary-year">{lead.vehicleYear}</p>
                </div>
                <div>
                  <p className="text-xs text-[#94A3B8]">Estimated balance</p>
                  <p className="font-semibold text-[#111827]" data-testid="rf-summary-balance">
                    ${Number(lead.loanBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#94A3B8]">State</p>
                  <p className="font-semibold text-[#111827]" data-testid="rf-summary-state">{lead.state}</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-6 mb-6" data-testid="refinance-next-steps">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="text-[#0B5FD1] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-[#111827] mb-1">What happens next</p>
                <p className="text-xs text-[#4B5563] leading-relaxed">
                  Clicking <strong>Continue</strong> will take you to OpenRoad Lending&rsquo;s secure application. AutoLenis will not be involved in their application process, underwriting, or decisions.
                </p>
              </div>
            </div>
          </div>

          <p
            data-testid="refinance-confirm-final-disclosure"
            className="text-xs text-[#4B5563] leading-relaxed mb-6"
          >
            <strong className="text-[#111827]">AutoLenis does not guarantee approval, rates, or savings.</strong>{" "}
            All lending decisions are made by OpenRoad Lending independently.
          </p>

          <RefinanceComplianceDisclosure className="mb-6" />

          {error && (
            <p
              data-testid="refinance-confirm-error"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              className="w-full sm:flex-1"
              size="lg"
              onClick={handleContinueToPartner}
              disabled={redirecting || !leadIdFromUrl}
              data-testid="refinance-continue-to-partner-btn"
            >
              {redirecting ? "Connecting…" : "Continue to Partner Application"}
              {!redirecting && <ArrowRight size={15} className="ml-1.5" />}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              size="lg"
              asChild
              data-testid="refinance-go-back-btn"
            >
              <Link href="/refinance/eligibility">
                <ArrowLeft size={15} className="mr-1.5" />
                Go Back
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function RefinanceConfirmPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[#4B5563]">Loading…</div>}>
      <RefinanceConfirmInner />
    </Suspense>
  );
}
