"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { trackLeadMagnet } from "@/lib/analytics/events";
import { getLeadMagnet, TIMELINE_OPTIONS } from "@/lib/leads/lead-magnets";

interface LeadMagnetFormProps {
  /** Which magnet this form delivers. Defaults to the flagship guide. */
  magnetSlug?: string;
  /**
   * When true, on success navigate to the magnet's access page instead of
   * showing the inline confirmation (used on dedicated landing pages).
   */
  redirectOnSuccess?: boolean;
  className?: string;
}

export default function LeadMagnetForm({
  magnetSlug = "honest-guide",
  redirectOnSuccess = false,
  className = "",
}: LeadMagnetFormProps) {
  const router = useRouter();
  const magnet = getLeadMagnet(magnetSlug);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [timeline, setTimeline] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [accessPath, setAccessPath] = useState(
    `${magnet.accessPath}?m=${magnet.slug}`,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.includes("@") || !timeline) {
      setError("Please add your name, a valid email, and your buying timeline.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads/lead-magnet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          buyerTimeline: timeline,
          magnetSlug: magnet.slug,
          vehicleInterest: vehicle.trim() || undefined,
          smsOptIn,
          sourceUrl:
            typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError("Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      trackLeadMagnet({ magnetName: magnet.slug, buyerTimeline: timeline });
      const path = typeof data.accessPath === "string" ? data.accessPath : accessPath;
      setAccessPath(path);
      if (redirectOnSuccess) {
        router.push(path);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        data-testid="lead-magnet-success"
        className={`rounded-2xl border border-slate-200 bg-white p-6 text-center md:p-8 ${className}`}
      >
        <CheckCircle2 className="mx-auto text-green-600" size={40} />
        <h3 className="mt-3 text-xl font-bold text-slate-900">
          Check your inbox
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          We just emailed <strong>{magnet.title}</strong> to {email}. You can
          also read it right now.
        </p>
        <a
          href={accessPath}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0B5FD1] px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Read the Guide Now
        </a>
      </div>
    );
  }

  return (
    <form
      data-testid="lead-magnet-form"
      onSubmit={handleSubmit}
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8 ${className}`}
    >
      <h3 className="text-xl font-bold text-slate-900">{magnet.ctaLabel}</h3>
      <p className="mt-1 text-sm text-slate-500">
        Free, instant, and written by Markist — AutoLenis&apos; founder.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lm-name">Name *</Label>
          <Input
            id="lm-name"
            className="mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="lm-email">Email *</Label>
          <Input
            id="lm-email"
            type="email"
            className="mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="lm-phone">Phone (optional)</Label>
          <Input
            id="lm-phone"
            type="tel"
            className="mt-1.5"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lm-timeline">When are you buying? *</Label>
          <Select
            id="lm-timeline"
            className="mt-1.5"
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {TIMELINE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="lm-vehicle">Vehicle interest (optional)</Label>
          <Input
            id="lm-vehicle"
            className="mt-1.5"
            placeholder="e.g. Toyota RAV4"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
          />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-600">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0B5FD1] focus:ring-[#0B5FD1]"
          checked={smsOptIn}
          onChange={(e) => setSmsOptIn(e.target.checked)}
        />
        <span>
          Send me car buying tips by text (optional).
          <span className="block text-xs text-slate-400">
            AutoLenis may send helpful tips via SMS. Msg &amp; data rates apply.
            Reply STOP to unsubscribe.
          </span>
        </span>
      </label>

      {error && (
        <p className="mt-3 text-sm font-medium text-red-600">{error}</p>
      )}

      <Button type="submit" disabled={submitting} className="mt-6 w-full">
        {submitting ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Sending…
          </>
        ) : (
          magnet.ctaLabel
        )}
      </Button>

      <p className="mt-3 text-center text-xs text-slate-400">
        No spam. Unsubscribe anytime. We never sell your information.
      </p>
    </form>
  );
}
