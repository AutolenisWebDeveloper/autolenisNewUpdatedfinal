"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";

const DISCLOSURES = [
  {
    id: "ftc-material",
    title: "FTC Material Connection Disclosure",
    text: "You must disclose your relationship with AutoLenis when promoting the platform. This includes any blogs, social media posts, videos, or other content where you mention or recommend AutoLenis in exchange for compensation.",
    required: true,
  },
  {
    id: "earnings-claims",
    title: "No Guaranteed Earnings Claims",
    text: "You may not make guarantees about earnings potential when promoting the AutoLenis affiliate program. You may share your own results accurately, but must note that results vary.",
    required: true,
  },
  {
    id: "tcpa-compliance",
    title: "TCPA Compliance",
    text: "You may not send unsolicited text messages or use auto-dialers to promote AutoLenis. All communications must comply with the Telephone Consumer Protection Act.",
    required: true,
  },
  {
    id: "spam-prohibition",
    title: "Anti-Spam Policy",
    text: "You may not use spam, deceptive email subject lines, purchased email lists, or any unsolicited bulk messaging to promote your referral link.",
    required: true,
  },
  {
    id: "platform-accuracy",
    title: "Accurate Platform Representation",
    text: "You must accurately represent AutoLenis features and pricing. You may not claim the $99 Auction Access Fee is non-refundable or misrepresent the $499 Premium fee structure. The $99 is refundable if no valuable offer is received, and becomes a deposit credited toward the $499 only if the buyer purchases Premium.",
    required: true,
  },
];

interface Props {
  // ISO string of the last acknowledgment, or null if never acknowledged.
  initialAcknowledgedAt: string | null;
}

export default function ComplianceClient({ initialAcknowledgedAt }: Props) {
  // If there's a prior acknowledgment from the DB, pre-check all boxes and show saved state.
  const allIds = DISCLOSURES.map((d) => d.id);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    initialAcknowledgedAt ? new Set(allIds) : new Set()
  );
  const [saved, setSaved] = useState(initialAcknowledgedAt !== null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(initialAcknowledgedAt);
  const [error, setError] = useState<string | null>(null);

  const allRequired = DISCLOSURES.filter((d) => d.required).every((d) =>
    acknowledged.has(d.id)
  );

  function toggle(id: string) {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/affiliate/compliance/acknowledge", {
        method: "POST",
      });
      const json = await res.json() as { success?: boolean; data?: { acknowledgedAt: string } };
      if (!res.ok || !json.success) {
        setError("Failed to save. Please try again.");
        return;
      }
      setSaved(true);
      setSavedAt(json.data?.acknowledgedAt ?? new Date().toISOString());
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="compliance-page">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Compliance Acknowledgments</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Review and acknowledge each disclosure. Your referral link is accessible only after all
        required items are acknowledged.
      </p>

      {/* Disclosure gate status */}
      {!allRequired ? (
        <div
          className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6"
          data-testid="compliance-gate-warning"
        >
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Referral link locked</p>
            <p className="text-xs text-amber-600">
              Acknowledge all required disclosures to unlock your referral link.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-4 mb-6"
          data-testid="compliance-gate-open"
        >
          <CheckCircle2 size={18} className="text-green-600" />
          <p className="text-sm font-semibold text-green-800">
            All disclosures acknowledged — referral link active
          </p>
        </div>
      )}

      {/* Disclosure items */}
      <div className="space-y-4 mb-6">
        {DISCLOSURES.map((d) => (
          <div
            key={d.id}
            data-testid={`disclosure-${d.id}`}
            className={`border-2 rounded-xl p-5 transition-colors ${
              acknowledged.has(d.id)
                ? "border-[#0B5FD1]/30 bg-[#0B5FD1]/3"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id={d.id}
                checked={acknowledged.has(d.id)}
                onChange={() => toggle(d.id)}
                className="mt-0.5 accent-[#0B5FD1] w-4 h-4 shrink-0"
                data-testid={`disclosure-checkbox-${d.id}`}
              />
              <label htmlFor={d.id} className="cursor-pointer">
                <p className="font-semibold text-slate-900 text-sm mb-1">
                  {d.title}
                  {d.required && (
                    <span className="ml-2 text-xs text-red-500 font-normal">Required</span>
                  )}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">{d.text}</p>
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-3 text-center" data-testid="compliance-error">
          {error}
        </p>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={handleSave}
        disabled={!allRequired || saving || saved}
        data-testid="compliance-save-btn"
      >
        {saving ? "Saving…" : saved ? "Acknowledgments Saved" : "Confirm All Acknowledgments"}
      </Button>

      {savedAt && (
        <p
          className="text-xs text-slate-400 text-center mt-3"
          data-testid="compliance-saved-note"
        >
          Last acknowledged: {new Date(savedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
