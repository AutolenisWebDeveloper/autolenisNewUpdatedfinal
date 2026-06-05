"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ProspectDetail {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  brand: string | null;
  sourceUrl: string | null;
  searchScore: number | null;
  status: string;
  outreachScript: string | null;
  founderNotes: string | null;
  scriptDraftedAt: string | null;
  createdAt: string;
  scriptedAt: string | null;
  contactedAt: string | null;
  repliedAt: string | null;
  onboardedAt: string | null;
  deadAt: string | null;
  deadReason: string | null;
  buyerOpp: {
    id: string;
    firstName: string | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    yearMin: number | null;
    yearMax: number | null;
    bodyStyle: string | null;
    budgetAmount: number | null;
    monthlyPayment: number | null;
    timeline: string | null;
    zip: string | null;
    phone: string | null;
    createdAt: string;
  } | null;
  // Change 1 — web-grounded market context for the linked buyer request.
  marketInsight: MarketInsight | null;
}

export interface MarketInsight {
  regionalPricingInsight: string | null;
  msrpRange: { low: number | null; high: number | null } | null;
  currentIncentives: string | null;
  demandLevel: "high" | "normal" | "low" | null;
  supplyNote: string | null;
  localDealers: Array<{
    name: string;
    city: string | null;
    distanceMiles: number | null;
    hasInventory: boolean | null;
    inventoryNote: string | null;
  }>;
  searchGrounded: boolean;
  dataAsOf: string | null;
  // Legacy fields (present even on pre-Change-1 records).
  typicalMarkup: string | null;
  goodDealTarget: number | null;
  notes: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  DISCOVERED: "bg-slate-100 text-slate-600",
  SCRIPTED: "bg-blue-100 text-blue-700",
  DRAFTED: "bg-indigo-100 text-indigo-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  REPLIED: "bg-purple-100 text-purple-700",
  ONBOARDED: "bg-green-100 text-green-700",
  DEAD: "bg-red-100 text-red-700",
};

function humanizeTimeline(t: string | null): string {
  if (t === "this_week") return "this week";
  if (t === "1_to_3_months") return "1-3 months";
  if (t === "researching") return "researching";
  return t ?? "—";
}

function formatBudget(amount: number | null, monthly: number | null): string {
  if (amount) return `$${amount.toLocaleString()}`;
  if (monthly) return `$${monthly}/mo`;
  return "flexible";
}

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default function ProspectDetailClient({
  prospect,
}: {
  prospect: ProspectDetail;
}) {
  const router = useRouter();
  const opp = prospect.buyerOpp;

  const [script, setScript] = useState(prospect.outreachScript ?? "");
  const [notes, setNotes] = useState(prospect.founderNotes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>, action: string) {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/dealer-outreach/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setBusy("regenerate");
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/dealer-outreach/${prospect.id}/regenerate-script`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      if (body?.data?.script) setScript(body.data.script);
      setMessage("Script regenerated.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setBusy(null);
    }
  }

  function markDead() {
    const reason = window.prompt("Reason this prospect is dead?");
    if (reason === null) return;
    void patch({ status: "DEAD", deadReason: reason }, "dead");
  }

  const vehicle =
    [opp?.make, opp?.model].filter(Boolean).join(" ") || opp?.bodyStyle || "vehicle";
  const yearRange =
    opp?.yearMin && opp?.yearMax
      ? `${opp.yearMin}-${opp.yearMax}`
      : opp?.yearMin
        ? `${opp.yearMin}`
        : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{prospect.name}</h1>
        <span
          className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
            STATUS_BADGE[prospect.status] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {prospect.status}
        </span>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 text-sm">
          {message}
        </div>
      )}

      {/* Two-column dealer / buyer info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dealer info */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">Dealer</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={prospect.name} />
            <Row
              label="Address"
              value={
                prospect.sourceUrl ? (
                  <a
                    href={prospect.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0B5FD1] hover:underline"
                  >
                    {[prospect.address, prospect.city, prospect.state, prospect.zip]
                      .filter(Boolean)
                      .join(", ") || "View on Google Maps"}
                  </a>
                ) : (
                  [prospect.address, prospect.city, prospect.state, prospect.zip]
                    .filter(Boolean)
                    .join(", ") || "—"
                )
              }
            />
            <Row
              label="Phone"
              value={
                prospect.phone ? (
                  <a href={`tel:${prospect.phone}`} className="text-[#0B5FD1] hover:underline">
                    {prospect.phone}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="Website"
              value={
                prospect.website ? (
                  <a
                    href={prospect.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0B5FD1] hover:underline"
                  >
                    {prospect.website}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Brand" value={prospect.brand ?? "—"} />
            <Row
              label="Source"
              value={
                prospect.sourceUrl ? (
                  <a
                    href={prospect.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0B5FD1] hover:underline break-all"
                  >
                    {prospect.sourceUrl}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="Search score"
              value={prospect.searchScore != null ? prospect.searchScore.toFixed(2) : "—"}
            />
          </dl>
        </div>

        {/* Buyer info */}
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">Linked Buyer</h2>
          {opp ? (
            <dl className="space-y-2 text-sm">
              <Row label="First name" value={opp.firstName ?? "—"} />
              <Row
                label="Vehicle"
                value={[yearRange, vehicle, opp.trim].filter(Boolean).join(" ") || "—"}
              />
              <Row label="Budget" value={formatBudget(opp.budgetAmount, opp.monthlyPayment)} />
              <Row label="Timeline" value={humanizeTimeline(opp.timeline)} />
              <Row label="ZIP" value={opp.zip ?? "—"} />
              <Row label="Phone" value={opp.phone ?? "—"} />
              <Row label="Created" value={fmt(opp.createdAt)} />
            </dl>
          ) : (
            <p className="text-sm text-slate-400">No linked buyer opportunity.</p>
          )}
        </div>
      </div>

      {/* Change 1 — Market Insight */}
      <MarketInsightSection insight={prospect.marketInsight} />

      {/* Phone script */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Phone Script</h2>
          <span className="text-xs text-slate-400">
            Drafted at: {fmt(prospect.scriptDraftedAt)}
          </span>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={14}
          className="w-full rounded-md border border-slate-300 p-3 text-sm font-mono focus:border-[#0B5FD1] focus:outline-none"
          placeholder="No script drafted yet. Click Regenerate Script to generate one."
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => patch({ outreachScript: script }, "save-script")}
            disabled={busy !== null}
            className="rounded-md bg-[#0B5FD1] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
          >
            {busy === "save-script" ? "Saving…" : "Save Script Edits"}
          </button>
          <button
            onClick={regenerate}
            disabled={busy !== null}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "regenerate" ? "Regenerating…" : "Regenerate Script"}
          </button>
        </div>
      </div>

      {/* Status actions */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">Status &amp; Actions</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => patch({ status: "CONTACTED" }, "contacted")}
            disabled={busy !== null}
            className="rounded-md bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50"
          >
            📞 Mark as Called
          </button>
          <button
            onClick={() => patch({ status: "REPLIED" }, "replied")}
            disabled={busy !== null}
            className="rounded-md bg-purple-100 px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-200 disabled:opacity-50"
          >
            ↩️ Mark as Replied
          </button>
          <button
            onClick={() => patch({ status: "ONBOARDED" }, "onboarded")}
            disabled={busy !== null}
            className="rounded-md bg-green-100 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-200 disabled:opacity-50"
          >
            🎉 Mark as Onboarded
          </button>
          <button
            onClick={markDead}
            disabled={busy !== null}
            className="rounded-md bg-red-100 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-200 disabled:opacity-50"
          >
            ❌ Mark as Dead
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">Founder Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-[#0B5FD1] focus:outline-none"
          placeholder="Log call outcomes, follow-ups, objections…"
        />
        <button
          onClick={() => patch({ founderNotes: notes }, "save-notes")}
          disabled={busy !== null}
          className="mt-3 rounded-md bg-[#0B5FD1] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
        >
          {busy === "save-notes" ? "Saving…" : "Save Notes"}
        </button>
      </div>

      {/* Timeline */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase text-slate-500 mb-3">Timeline</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          <li>Discovered: {fmt(prospect.createdAt)}</li>
          <li>Scripted: {fmt(prospect.scriptedAt)}</li>
          <li>Contacted: {fmt(prospect.contactedAt)}</li>
          <li>Replied: {fmt(prospect.repliedAt)}</li>
          <li>Onboarded: {fmt(prospect.onboardedAt)}</li>
          <li>
            Dead: {fmt(prospect.deadAt)}
            {prospect.deadReason ? ` — ${prospect.deadReason}` : ""}
          </li>
        </ul>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-slate-400">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

const DEMAND_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  normal: "bg-slate-100 text-slate-600",
  low: "bg-green-100 text-green-700",
};

function formatMsrpRange(
  range: { low: number | null; high: number | null } | null,
): string {
  if (!range) return "—";
  const { low, high } = range;
  if (low != null && high != null)
    return `$${low.toLocaleString()} – $${high.toLocaleString()}`;
  if (low != null) return `from $${low.toLocaleString()}`;
  if (high != null) return `up to $${high.toLocaleString()}`;
  return "—";
}

function MarketInsightSection({ insight }: { insight: MarketInsight | null }) {
  const [open, setOpen] = useState(false);

  const hasAny =
    !!insight &&
    (insight.regionalPricingInsight ||
      insight.msrpRange ||
      insight.currentIncentives ||
      insight.demandLevel ||
      insight.supplyNote ||
      insight.localDealers.length > 0 ||
      insight.notes ||
      insight.typicalMarkup ||
      insight.goodDealTarget != null);

  const dealersWithInventory =
    insight?.localDealers.filter((d) => d.hasInventory === true).length ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-500">
          Market Insight
          {insight?.searchGrounded && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium normal-case text-emerald-700">
              grounded
            </span>
          )}
        </h2>
        <span className="text-xs text-slate-400">{open ? "Hide" : "Show"}</span>
      </button>

      {open &&
        (hasAny && insight ? (
          <div className="mt-4 space-y-3 text-sm">
            <dl className="space-y-2">
              <Row
                label="MSRP range"
                value={formatMsrpRange(insight.msrpRange)}
              />
              <Row
                label="Demand"
                value={
                  insight.demandLevel ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        DEMAND_BADGE[insight.demandLevel] ??
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {insight.demandLevel}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <Row label="Supply" value={insight.supplyNote ?? "—"} />
              <Row
                label="Incentives"
                value={insight.currentIncentives ?? "—"}
              />
              <Row
                label="Typical markup"
                value={insight.typicalMarkup ?? "—"}
              />
              <Row
                label="Good-deal target"
                value={
                  insight.goodDealTarget != null
                    ? `$${insight.goodDealTarget.toLocaleString()}`
                    : "—"
                }
              />
              <Row
                label="Local dealers"
                value={
                  insight.localDealers.length > 0
                    ? `${insight.localDealers.length} found · ${dealersWithInventory} with inventory`
                    : "—"
                }
              />
            </dl>

            {insight.regionalPricingInsight && (
              <p className="rounded-md bg-slate-50 p-3 text-slate-700">
                {insight.regionalPricingInsight}
              </p>
            )}

            {insight.localDealers.length > 0 && (
              <ul className="space-y-1 text-xs text-slate-600">
                {insight.localDealers.map((d, i) => (
                  <li key={`${d.name}-${i}`} className="flex flex-wrap gap-1">
                    <span className="font-medium text-slate-800">{d.name}</span>
                    {d.city && <span>· {d.city}</span>}
                    {d.distanceMiles != null && (
                      <span>· {d.distanceMiles} mi</span>
                    )}
                    {d.hasInventory === true && (
                      <span className="text-emerald-600">· in stock</span>
                    )}
                    {d.inventoryNote && (
                      <span className="text-slate-400">· {d.inventoryNote}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {insight.dataAsOf && (
              <p className="text-[11px] text-slate-400">
                Data as of {new Date(insight.dataAsOf).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            No market enrichment data for this request yet.
          </p>
        ))}
    </div>
  );
}
