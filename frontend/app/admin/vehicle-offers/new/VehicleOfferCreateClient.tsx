"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  ArrowLeft,
  Car,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";

const BUDGET_OPTIONS = [
  "Under $15,000",
  "$15,000–$25,000",
  "$25,000–$35,000",
  "$35,000–$50,000",
  "$50,000–$75,000",
  "$75,000+",
];

const CONDITION_OPTIONS = ["New", "Used", "Certified Pre-Owned"] as const;
const NEW_OR_USED = ["New", "Used", "Either"] as const;
const FINANCING = ["Yes", "No", "Not Sure"] as const;
const YEAR_OPTIONS = Array.from({ length: 2026 - 2010 + 1 }, (_, i) => 2010 + i);

const todayISO = () => new Date().toISOString().slice(0, 10);

// NHTSA returns makes/models in upper-case ("TOYOTA"); present them cleanly.
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

type DecodeStatus = "idle" | "decoding" | "done" | "error";

export default function VehicleOfferCreateClient() {
  const searchParams = useSearchParams();
  const fromRequest = searchParams?.get("fromRequest") ?? null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  // Vehicle details
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [condition, setCondition] = useState<string>("Used");
  const [mileage, setMileage] = useState("");
  const [vin, setVin] = useState("");
  const [color, setColor] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [vehicleReferenceUrl, setVehicleReferenceUrl] = useState("");

  // VIN auto-decode state
  const [decodeStatus, setDecodeStatus] = useState<DecodeStatus>("idle");
  const [decodeMsg, setDecodeMsg] = useState<string | null>(null);
  const lastDecodedVin = useRef<string>("");

  // Buyer context
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerBudget, setBuyerBudget] = useState("");
  const [buyerZip, setBuyerZip] = useState("");
  const [buyerNewOrUsed, setBuyerNewOrUsed] = useState<string>("Either");
  const [buyerFinancing, setBuyerFinancing] = useState<string>("Not Sure");
  const [adminNotes, setAdminNotes] = useState("");

  // Offer settings
  const [expiresAt, setExpiresAt] = useState("");
  const [referenceId, setReferenceId] = useState(fromRequest ?? "");

  const canSubmit =
    !loading &&
    Number(year) >= 2010 && Number(year) <= 2026 &&
    make.trim() && model.trim() &&
    condition && buyerBudget &&
    /^\d{5}$/.test(buyerZip) &&
    buyerNewOrUsed && buyerFinancing;

  const decodeVin = useCallback(async (raw: string) => {
    const v = raw.trim().toUpperCase();
    if (v.length !== 17 || !/^[A-HJ-NPR-Z0-9]+$/.test(v)) {
      setDecodeStatus("error");
      setDecodeMsg("Enter a valid 17-character VIN to auto-fill.");
      return;
    }
    if (v === lastDecodedVin.current && decodeStatus === "done") return;
    setDecodeStatus("decoding");
    setDecodeMsg("Decoding VIN…");
    try {
      const res = await fetch(`/api/admin/vehicle-offers/vin-decode?vin=${encodeURIComponent(v)}`);
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { decoded: { year?: string | null; make?: string | null; model?: string | null; trim?: string | null } };
        error?: { message?: string };
      };
      if (!res.ok || !data.success || !data.data) {
        setDecodeStatus("error");
        setDecodeMsg(data.error?.message ?? "Could not decode VIN — enter details manually.");
        return;
      }
      const { decoded } = data.data;
      if (decoded.year) setYear(String(decoded.year));
      if (decoded.make) setMake(titleCase(decoded.make));
      if (decoded.model) setModel(titleCase(decoded.model));
      if (decoded.trim) setTrim(titleCase(decoded.trim));
      lastDecodedVin.current = v;
      setDecodeStatus("done");
      setDecodeMsg(
        `Auto-filled: ${[decoded.year, titleCase(decoded.make ?? ""), titleCase(decoded.model ?? "")].filter(Boolean).join(" ")}`.trim()
      );
    } catch {
      setDecodeStatus("error");
      setDecodeMsg("Network error — enter details manually.");
    }
  }, [decodeStatus]);

  // Automatically decode once a complete VIN is present (debounced), so the
  // admin never has to hand-key year/make/model when a VIN is available.
  useEffect(() => {
    const v = vin.trim().toUpperCase();
    if (v.length !== 17) {
      if (decodeStatus !== "idle" && v.length === 0) {
        setDecodeStatus("idle");
        setDecodeMsg(null);
      }
      return;
    }
    if (v === lastDecodedVin.current) return;
    const t = setTimeout(() => { void decodeVin(v); }, 500);
    return () => clearTimeout(t);
  }, [vin, decodeVin, decodeStatus]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/vehicle-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleYear: Number(year),
          vehicleMake: make.trim(),
          vehicleModel: model.trim(),
          vehicleTrim: trim.trim() || undefined,
          vehicleMileage: mileage ? Number(mileage) : undefined,
          vehicleVin: vin.trim() || undefined,
          vehicleColor: color.trim() || undefined,
          vehicleCondition: condition,
          askingPriceCents: askingPrice ? Math.round(Number(askingPrice) * 100) : undefined,
          vehicleReferenceUrl: vehicleReferenceUrl.trim() || undefined,
          buyerName: buyerName.trim() || undefined,
          buyerEmail: buyerEmail.trim() || undefined,
          buyerBudget,
          buyerZip,
          buyerNewOrUsed,
          buyerFinancing,
          adminNotes: adminNotes.trim() || undefined,
          expiresAt: expiresAt || undefined,
          referenceId: referenceId.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { id: string; url: string; expiresAt: string | null };
        error?: { message?: string };
      };
      if (res.ok && data.success && data.data) {
        setResult(data.data);
      } else {
        setError(data.error?.message ?? "Unable to create offer link.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!result) return;
    void navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setCopied(false);
    setMake(""); setModel(""); setTrim(""); setMileage("");
    setVin(""); setColor(""); setAskingPrice(""); setVehicleReferenceUrl("");
    setBuyerName(""); setBuyerEmail(""); setBuyerBudget("");
    setBuyerZip(""); setAdminNotes("");
    setExpiresAt(""); setReferenceId("");
    setDecodeStatus("idle"); setDecodeMsg(null);
    lastDecodedVin.current = "";
  }

  // ----- Success state -------------------------------------------------------
  if (result) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-3xl px-6 py-10 md:py-16">
          <div
            className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(11,95,209,0.35)]"
            data-testid="offer-link-result"
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-[#0B5FD1] via-[#2E8BFF] to-[#0B5FD1]" />
            <div className="p-8 md:p-10 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ECFDF5] ring-8 ring-[#ECFDF5]/40">
                <CheckCircle2 size={30} className="text-[#059669]" />
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-slate-900">Offer link is live</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Share this secure link with any dealer. Multiple dealers can submit competing
                offers on the same link — every submission is captured automatically.
              </p>

              <div className="mt-7 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <Lock size={15} className="shrink-0 text-slate-400" />
                <code
                  className="flex-1 truncate text-left font-mono text-sm text-[#0B5FD1]"
                  data-testid="offer-link-url"
                >
                  {result.url}
                </code>
                <button
                  onClick={handleCopy}
                  data-testid="copy-offer-link"
                  className="shrink-0 rounded-lg bg-[#0B5FD1] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0944a8]"
                >
                  {copied ? "Copied!" : "Copy link"}
                </button>
              </div>

              {result.expiresAt && (
                <p className="mt-3 text-xs text-slate-400">
                  Expires {new Date(result.expiresAt).toLocaleDateString()}
                </p>
              )}

              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-offer-link"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <ExternalLink size={14} /> Open link
                </a>
                <a
                  href={`/admin/vehicle-offers/${result.id}`}
                  data-testid="view-submissions-link"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0B5FD1] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0944a8]"
                >
                  View submissions →
                </a>
                <button
                  onClick={handleReset}
                  data-testid="create-another-btn"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <RotateCcw size={14} /> Create another
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----- Live vehicle summary ------------------------------------------------
  const summaryParts = [year, make.trim(), model.trim(), trim.trim()].filter(Boolean);
  const vehicleSummary = summaryParts.length > 1 ? summaryParts.join(" ") : "New offer link";

  // ----- Form ----------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white" data-testid="vehicle-offer-create-page">
      <div className="mx-auto max-w-3xl px-6 py-8 md:py-10">
        {/* Breadcrumb */}
        <Link
          href="/admin/vehicle-offers"
          className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-[#0B5FD1]"
        >
          <ArrowLeft size={13} /> Dealer Offer Links
        </Link>

        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0B5FD1] to-[#2E8BFF] shadow-lg shadow-[#0B5FD1]/25">
            <Car size={22} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Dealer Offer Link</h1>
            <p className="mt-1 text-sm text-slate-500">
              Drop in a VIN to auto-fill the vehicle, add buyer context, then generate a secure
              link dealers use to submit competing offers.
            </p>
          </div>
        </div>

        {/* Trust strip */}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><Wand2 size={13} className="text-[#0B5FD1]" /> VIN auto-decode</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-[#059669]" /> Encrypted &amp; audit-logged</span>
          <span className="inline-flex items-center gap-1.5"><Sparkles size={13} className="text-[#0B5FD1]" /> Competing dealer offers</span>
        </div>

        {fromRequest && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700" data-testid="from-request-banner">
            <ClipboardList size={14} />
            Pre-filled from buyer request. Review vehicle details below, then generate the link.
          </div>
        )}

        <form onSubmit={handleSubmit} data-testid="vehicle-offer-form" className="space-y-5">
          {/* Section 1 — Vehicle */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SectionHeader step={1} icon={<Car size={15} />} title="Vehicle Details" subtitle="Paste a VIN to auto-fill, or enter manually." />
            <div className="p-6 pt-2">
              {/* VIN auto-decode */}
              <div className="mb-5 rounded-xl border border-[#0B5FD1]/20 bg-[#0B5FD1]/[0.03] p-4">
                <Label htmlFor="vo-vin" className="flex items-center gap-1.5 text-sm font-semibold text-[#0B5FD1]">
                  <Wand2 size={14} /> Auto-fill from VIN
                </Label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="vo-vin"
                    data-testid="vo-vin"
                    maxLength={17}
                    placeholder="17-character VIN"
                    className="font-mono uppercase tracking-wide"
                    value={vin}
                    onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17))}
                  />
                  <button
                    type="button"
                    onClick={() => void decodeVin(vin)}
                    disabled={decodeStatus === "decoding" || vin.length !== 17}
                    data-testid="vo-vin-decode-btn"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#0B5FD1] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0944a8] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {decodeStatus === "decoding" ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {decodeStatus === "decoding" ? "Decoding…" : "Auto-fill"}
                  </button>
                </div>
                {decodeMsg && (
                  <p
                    data-testid="vo-vin-decode-msg"
                    className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${decodeStatus === "error" ? "text-red-600" : decodeStatus === "done" ? "text-[#059669]" : "text-slate-500"}`}
                  >
                    {decodeStatus === "done" && <CheckCircle2 size={13} />}
                    {decodeStatus === "error" && <AlertCircle size={13} />}
                    {decodeMsg}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Year" required htmlFor="vo-year">
                  <Select id="vo-year" data-testid="vo-year" value={year} onChange={(e) => setYear(e.target.value)} required>
                    {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </Select>
                </Field>
                <Field label="Make" required htmlFor="vo-make">
                  <Input id="vo-make" data-testid="vo-make" value={make} onChange={(e) => setMake(e.target.value)} required />
                </Field>
                <Field label="Model" required htmlFor="vo-model">
                  <Input id="vo-model" data-testid="vo-model" value={model} onChange={(e) => setModel(e.target.value)} required />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Trim" htmlFor="vo-trim" hint="Optional">
                  <Input id="vo-trim" data-testid="vo-trim" value={trim} onChange={(e) => setTrim(e.target.value)} />
                </Field>
                <Field label="Condition" required htmlFor="vo-condition">
                  <Select id="vo-condition" data-testid="vo-condition" value={condition} onChange={(e) => setCondition(e.target.value)} required>
                    {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mileage" htmlFor="vo-mileage" hint="Optional">
                  <Input id="vo-mileage" type="number" min={0} data-testid="vo-mileage" placeholder="e.g. 42,000" value={mileage} onChange={(e) => setMileage(e.target.value)} />
                </Field>
                <Field label="Color" htmlFor="vo-color" hint="Optional">
                  <Input id="vo-color" data-testid="vo-color" value={color} onChange={(e) => setColor(e.target.value)} />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Market / Asking Price" htmlFor="vo-asking" hint="Context for dealers on expected range.">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <Input id="vo-asking" type="number" min={0} data-testid="vo-asking" className="pl-7" placeholder="0" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} />
                  </div>
                </Field>
                <Field label="Vehicle Listing URL" htmlFor="vo-ref-url" hint="Dealers see this so they know exactly which vehicle the buyer means.">
                  <Input id="vo-ref-url" type="url" data-testid="vo-ref-url" placeholder="https://" value={vehicleReferenceUrl} onChange={(e) => setVehicleReferenceUrl(e.target.value)} />
                </Field>
              </div>
            </div>
          </section>

          {/* Section 2 — Buyer */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SectionHeader step={2} icon={<UserRound size={15} />} title="Buyer Context" subtitle="Helps dealers tailor their best offer." />
            <div className="p-6 pt-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Buyer Name" htmlFor="vo-buyer-name" hint="Needed later to send the review to the buyer.">
                  <Input id="vo-buyer-name" data-testid="vo-buyer-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                </Field>
                <Field label="Buyer Email" htmlFor="vo-buyer-email" hint="Needed later to send the review to the buyer.">
                  <Input id="vo-buyer-email" type="email" data-testid="vo-buyer-email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Budget Range" required htmlFor="vo-budget">
                  <Select id="vo-budget" data-testid="vo-budget" value={buyerBudget} onChange={(e) => setBuyerBudget(e.target.value)} required>
                    <option value="">Select budget</option>
                    {BUDGET_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </Select>
                </Field>
                <Field label="Buyer ZIP" required htmlFor="vo-buyer-zip">
                  <Input id="vo-buyer-zip" data-testid="vo-buyer-zip" inputMode="numeric" placeholder="5-digit ZIP" value={buyerZip} onChange={(e) => setBuyerZip(e.target.value.replace(/\D/g, "").slice(0, 5))} required />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="New or Used Preference" required htmlFor="vo-buyer-condition">
                  <Select id="vo-buyer-condition" data-testid="vo-buyer-condition" value={buyerNewOrUsed} onChange={(e) => setBuyerNewOrUsed(e.target.value)} required>
                    {NEW_OR_USED.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Financing Needed" required htmlFor="vo-buyer-financing">
                  <Select id="vo-buyer-financing" data-testid="vo-buyer-financing" value={buyerFinancing} onChange={(e) => setBuyerFinancing(e.target.value)} required>
                    {FINANCING.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Notes for Dealer" htmlFor="vo-admin-notes" hint="Shown to dealers on the offer page.">
                  <Textarea id="vo-admin-notes" data-testid="vo-admin-notes" className="min-h-[100px]" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
                </Field>
              </div>
            </div>
          </section>

          {/* Section 3 — Offer settings */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SectionHeader step={3} icon={<ShieldCheck size={15} />} title="Offer Settings" subtitle="Optional controls for tracking and expiry." />
            <div className="p-6 pt-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Expiration Date" htmlFor="vo-expires" hint="Leave blank for no expiration.">
                  <Input id="vo-expires" type="date" min={todayISO()} data-testid="vo-expires" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </Field>
                <Field label="Internal Reference ID" htmlFor="vo-ref-id" hint="Your own tracking code. Not shown to dealers.">
                  <Input id="vo-ref-id" data-testid="vo-ref-id" placeholder="REQ-001" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
                </Field>
              </div>
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3" data-testid="vehicle-offer-error">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Sticky action bar */}
          <div className="sticky bottom-4 z-10 mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.25)] backdrop-blur sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Generating link for</p>
              <p className="truncate text-sm font-semibold text-slate-900">{vehicleSummary}</p>
            </div>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={!canSubmit} data-testid="vehicle-offer-submit">
              {loading ? <><Loader2 size={16} className="animate-spin" />Creating link…</> : <>Generate Offer Link</>}
            </Button>
          </div>

          <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-xs text-slate-400">
            <Lock size={12} /> Links are tokenized and every action is recorded in the admin audit log.
          </p>
        </form>
      </div>
    </div>
  );
}

// --- Local presentational helpers -------------------------------------------

function SectionHeader({ step, icon, title, subtitle }: { step: number; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 p-6">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B5FD1]/10 text-[#0B5FD1]">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className="text-[11px] font-semibold text-slate-300">{String(step).padStart(2, "0")}</span>
          {title}
        </h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, required, hint, children }: { label: string; htmlFor: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-[#0B5FD1]">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
