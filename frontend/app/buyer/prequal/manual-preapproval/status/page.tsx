// /buyer/prequal/manual-preapproval/status
// System 4B — External pre-approval status with 60-second polling
// All status states: PENDING | APPROVED | REJECTED | ADDITIONAL_INFO_REQUIRED
// Full rejection reason display and next-action CTAs per state

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, XCircle, AlertTriangle, RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/client";

type StatusType = "PENDING" | "APPROVED" | "REJECTED" | "ADDITIONAL_INFO_REQUIRED" | "LOADING";

interface PreApprovalStatus {
  status: StatusType;
  lenderName?: string;
  approvedAmount?: number;
  aprRate?: number;
  termMonths?: number;
  expiryDate?: string;
  rejectionReason?: string;
  additionalInfoRequired?: string;
  reviewedAt?: string;
}

// Status configuration per state
const STATUS_CONFIG: Record<string, {
  icon: React.ElementType;
  label: string;
  badgeVariant: "green" | "amber" | "destructive" | "secondary";
  bg: string;
}> = {
  APPROVED:                   { icon: CheckCircle2,  label: "Approved",               badgeVariant: "green",       bg: "bg-green-50 border-green-200" },
  PENDING:                    { icon: Clock,          label: "Under Review",            badgeVariant: "secondary",   bg: "bg-slate-50 border-slate-200" },
  REJECTED:                   { icon: XCircle,        label: "Not Approved",            badgeVariant: "destructive", bg: "bg-red-50 border-red-200" },
  ADDITIONAL_INFO_REQUIRED:   { icon: AlertTriangle,  label: "Additional Info Needed",  badgeVariant: "amber",       bg: "bg-amber-50 border-amber-200" },
};

export default function ManualPreapprovalStatusPage() {
  const [data, setData] = useState<PreApprovalStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (showPolling = false) => {
    if (showPolling) setPolling(true);
    setError(null);
    try {
      const status = await api.get<PreApprovalStatus>("/api/buyer/prequal/external-status");
      setData(status);
      setLastChecked(new Date());
    } catch (err) {
      setError("Unable to load status. Retrying…");
    } finally {
      setPolling(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // 60-second polling while status is PENDING
  useEffect(() => {
    if (!data || data.status !== "PENDING") return;
    const interval = setInterval(() => fetchStatus(), 60_000);
    return () => clearInterval(interval);
  }, [data, fetchStatus]);

  if (!data) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="prequal-status-loading">
        <div className="flex items-center gap-3 text-slate-500">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading application status…</span>
        </div>
      </div>
    );
  }

  const config = STATUS_CONFIG[data.status] ?? STATUS_CONFIG.PENDING;
  const Icon = config.icon;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="manual-preapproval-status-page">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Pre-Approval Status</h1>
      {data.lenderName && (
        <p className="text-sm text-slate-500 mb-6">Submitted to <strong>{data.lenderName}</strong></p>
      )}

      {/* Status card */}
      <div className={`border-2 rounded-2xl p-8 mb-6 ${config.bg}`} data-testid={`status-card-${data.status.toLowerCase()}`}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-white/60 flex items-center justify-center">
            <Icon size={28} className={
              data.status === "APPROVED" ? "text-green-600"
              : data.status === "REJECTED" ? "text-red-600"
              : data.status === "ADDITIONAL_INFO_REQUIRED" ? "text-amber-600"
              : "text-slate-500"
            } />
          </div>
          <div>
            <Badge variant={config.badgeVariant} data-testid="status-badge">{config.label}</Badge>
            {data.reviewedAt && (
              <p className="text-xs text-slate-500 mt-1">
                Reviewed {new Date(data.reviewedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
              </p>
            )}
          </div>
        </div>

        {/* State-specific content */}
        {data.status === "APPROVED" && data.approvedAmount && (
          <div className="mt-2" data-testid="approved-details">
            <p className="text-3xl font-bold text-green-900 mb-1">
              ${data.approvedAmount.toLocaleString()}
            </p>
            <p className="text-sm text-green-700">Approved budget</p>
            <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
              {data.aprRate && (
                <div><p className="text-xs text-slate-500">APR</p><p className="font-semibold">{data.aprRate}%</p></div>
              )}
              {data.termMonths && (
                <div><p className="text-xs text-slate-500">Term</p><p className="font-semibold">{data.termMonths} mo</p></div>
              )}
              {data.expiryDate && (
                <div><p className="text-xs text-slate-500">Valid until</p><p className="font-semibold">{new Date(data.expiryDate).toLocaleDateString()}</p></div>
              )}
            </div>
          </div>
        )}

        {data.status === "PENDING" && (
          <div data-testid="pending-details">
            <p className="text-sm text-slate-600">
              Your application is being reviewed by our team. This typically takes 1–2 business days.
            </p>
            {lastChecked && (
              <p className="text-xs text-slate-400 mt-2">
                Last checked: {lastChecked.toLocaleTimeString()} · Auto-refreshes every 60 seconds
              </p>
            )}
            {polling && (
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-2">
                <RefreshCw size={12} className="animate-spin" />Checking for updates…
              </div>
            )}
          </div>
        )}

        {data.status === "REJECTED" && (
          <div data-testid="rejected-details">
            {data.rejectionReason ? (
              <>
                <p className="text-sm font-semibold text-red-800 mb-1">Reason provided:</p>
                <p className="text-sm text-red-700 bg-white/60 rounded-lg p-3">{data.rejectionReason}</p>
              </>
            ) : (
              <p className="text-sm text-red-700">Your pre-approval was not approved at this time.</p>
            )}
          </div>
        )}

        {data.status === "ADDITIONAL_INFO_REQUIRED" && (
          <div data-testid="additional-info-details">
            {data.additionalInfoRequired ? (
              <>
                <p className="text-sm font-semibold text-amber-800 mb-1">Required:</p>
                <p className="text-sm text-amber-700 bg-white/60 rounded-lg p-3">{data.additionalInfoRequired}</p>
              </>
            ) : (
              <p className="text-sm text-amber-700">Additional information is required to complete your review.</p>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3" data-testid="status-error">
          {error}
        </div>
      )}

      {/* Next-action CTAs — state-specific */}
      <div className="space-y-3" data-testid="next-action-ctas">
        {data.status === "APPROVED" && (
          <>
            <Button className="w-full" size="lg" href="/buyer/search" data-testid="approved-search-cta">
              Browse Vehicles Within My Budget <ArrowRight size={15} />
            </Button>
            <Button variant="secondary" className="w-full" href="/buyer/shortlist" data-testid="approved-shortlist-cta">
              View My Shortlist
            </Button>
          </>
        )}

        {data.status === "PENDING" && (
          <>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fetchStatus(true)}
              disabled={polling}
              data-testid="manual-refresh-btn"
            >
              <RefreshCw size={14} className={polling ? "animate-spin" : ""} />
              {polling ? "Checking…" : "Check Now"}
            </Button>
            <Button variant="ghost" className="w-full" href="/buyer/search" data-testid="pending-browse-cta">
              Browse inventory while you wait
            </Button>
          </>
        )}

        {data.status === "REJECTED" && (
          <>
            <Button className="w-full" href="/buyer/prequal" data-testid="rejected-use-autolenis-cta">
              Try AutoLenis Pre-Qualification Instead <ArrowRight size={15} />
            </Button>
            <Button variant="secondary" className="w-full" href="/buyer/prequal/external" data-testid="rejected-resubmit-cta">
              Submit a Different Pre-Approval
            </Button>
          </>
        )}

        {data.status === "ADDITIONAL_INFO_REQUIRED" && (
          <>
            <Button className="w-full" href="/buyer/prequal/external" data-testid="additional-info-resubmit-cta">
              Resubmit with Required Information <ArrowRight size={15} />
            </Button>
            <Link
              href="/contact"
              className="block text-center text-sm text-al-primary hover:underline"
              data-testid="additional-info-contact-cta"
            >
              Contact support for help
            </Link>
          </>
        )}

        {/* Always show: use AutoLenis prequal as alternative */}
        {data.status !== "APPROVED" && (
          <div className="pt-2 border-t border-slate-100 text-center">
            <Link href="/buyer/prequal" className="text-xs text-slate-400 hover:underline" data-testid="use-autolenis-prequal-link">
              Use AutoLenis soft-pull prequalification instead (no credit score impact)
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
