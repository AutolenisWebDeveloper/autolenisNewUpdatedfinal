"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Check,
  X,
  Mail,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { parseSource } from "@/lib/admin/buyer-source";

export interface OutreachLogEntry {
  id: string;
  outreachType: string;
  channel: string;
  subject: string | null;
  body: string | null;
  status: string;
  resendId: string | null;
  sentAt: string;
  outreachSequenceStep: number | null;
}

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
  distanceMiles: number | null;
  status: string;
  outreachScript: string | null;
  founderNotes: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  emailSource: string | null;
  emailEnrichedAt: string | null;
  scriptDraftedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scriptedAt: string | null;
  contactedAt: string | null;
  repliedAt: string | null;
  onboardedAt: string | null;
  deadAt: string | null;
  deadReason: string | null;
  replyDetectedAt: string | null;
  outreachLog: OutreachLogEntry[];
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
    source: string | null;
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

const LOG_STATUS_BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  complained: "bg-red-100 text-red-700",
  replied: "bg-purple-100 text-purple-700",
  failed: "bg-amber-100 text-amber-700",
};

const EMAIL_TYPES: { value: string; label: string }[] = [
  { value: "invitation", label: "Invitation" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "missing_info", label: "Request Info" },
  { value: "offer_follow_up", label: "Offer Follow-Up" },
  { value: "re_engagement", label: "Re-Engage" },
  { value: "general", label: "General" },
];

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

function fmtDate(ts: string | null): string {
  return ts ? new Date(ts).toLocaleDateString() : "—";
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// ─── Tags-in-notes encoding ──────────────────────────────────────────────────
// Tags live inline in founderNotes to avoid a schema migration:
//   JSON.stringify({tags:[...]}) + "\n---\n" + <plain notes>
const NOTES_DIVIDER = "\n---\n";

function parseNotes(raw: string | null): { tags: string[]; notes: string } {
  if (!raw) return { tags: [], notes: "" };
  if (raw.startsWith("{")) {
    const idx = raw.indexOf(NOTES_DIVIDER);
    if (idx !== -1) {
      const prefix = raw.slice(0, idx);
      const rest = raw.slice(idx + NOTES_DIVIDER.length);
      try {
        const parsed = JSON.parse(prefix) as { tags?: unknown };
        const tags = Array.isArray(parsed.tags)
          ? parsed.tags.filter((t): t is string => typeof t === "string")
          : [];
        return { tags, notes: rest };
      } catch {
        // Not our structured prefix — treat the whole thing as notes.
      }
    }
  }
  return { tags: [], notes: raw };
}

function serializeNotes(tags: string[], notes: string): string {
  if (tags.length === 0) return notes;
  return JSON.stringify({ tags }) + NOTES_DIVIDER + notes;
}

// ─── Compose pre-fill templates ──────────────────────────────────────────────
function composeTemplates(
  p: ProspectDetail,
): Record<string, { subject: string; body: string; emailType: string }> {
  const dealerName = p.name;
  const invitationName = p.contactName || "Internet Sales Team";
  const teamName = p.contactName || "team";

  return {
    invitation: {
      emailType: "invitation",
      subject: "Dealer Partnership Opportunity — AutoLenis",
      body: `Hi ${invitationName},\n\nI'm reaching out about a partnership opportunity with AutoLenis, a buyer-first automotive concierge platform where qualified buyers submit vehicle requests and local dealers submit competing offers.\n\nWe currently have active buyers in your area looking for vehicles your dealership stocks. There is no upfront cost — we only earn when a deal closes.\n\nWould you be open to a quick call to learn more?\n\nBest,\nMarkist Athelus\nAutoLenis`,
    },
    missing_info: {
      emailType: "missing_info",
      subject: `Quick Question — ${dealerName}`,
      body: `Hi ${teamName},\n\nI wanted to follow up and confirm the best contact for your internet sales or fleet department. We have buyer requests in your area I'd love to send your way.\n\nCould you confirm:\n1. Best email for auction invitations\n2. Best contact name and title\n\nThank you,\nMarkist Athelus\nAutoLenis`,
    },
    offer_follow_up: {
      emailType: "offer_follow_up",
      subject: "Following Up — Buyer Opportunity in Your Market",
      body: `Hi ${teamName},\n\nJust following up on our previous outreach. We still have qualified buyers in your area submitting vehicle requests.\n\nIf the timing wasn't right before, no worries — we would love to include ${dealerName} when the right buyer request comes in for your inventory.\n\nBest,\nMarkist Athelus\nAutoLenis`,
    },
    re_engagement: {
      emailType: "re_engagement",
      subject: "Still Here — Buyer Auctions in Your Market",
      body: `Hi ${teamName},\n\nQuick note — AutoLenis continues to see buyer demand in your market. We have not heard back and wanted to check in one last time.\n\nIf you are not interested, no problem at all. If you are open to it, I would love to send you your first buyer request at no cost.\n\nEither way — thank you for your time.\n\nMarkist Athelus\nAutoLenis`,
    },
  };
}

export default function ProspectDetailClient({
  prospect,
}: {
  prospect: ProspectDetail;
}) {
  const router = useRouter();
  const opp = prospect.buyerOpp;
  const initial = parseNotes(prospect.founderNotes);

  const [script, setScript] = useState(prospect.outreachScript ?? "");
  const [notes, setNotes] = useState(initial.notes);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagDraft, setTagDraft] = useState("");
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
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
      return false;
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

  // Persist tags immediately (alongside the current notes text) so a tag edit
  // doesn't require also clicking Save Notes.
  function persistNotes(nextTags: string[], nextNotes: string) {
    void patch(
      { founderNotes: serializeNotes(nextTags, nextNotes) },
      "save-notes",
    );
  }

  function addTag() {
    const t = tagDraft.trim().toLowerCase();
    if (!t || tags.includes(t)) {
      setTagDraft("");
      return;
    }
    const next = [...tags, t];
    setTags(next);
    setTagDraft("");
    persistNotes(next, notes);
  }

  function removeTag(t: string) {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    persistNotes(next, notes);
  }

  const sentCount = prospect.outreachLog.length;
  const lastLog = prospect.outreachLog[0] ?? null;
  const currentStep = (() => {
    const steps = prospect.outreachLog
      .map((l) => l.outreachSequenceStep)
      .filter((s): s is number => typeof s === "number");
    if (steps.length === 0) return "—";
    const max = Math.max(...steps);
    return max >= 3 ? "Complete" : String(max);
  })();

  const vehicle =
    [opp?.make, opp?.model].filter(Boolean).join(" ") || opp?.bodyStyle || "vehicle";
  const yearRange =
    opp?.yearMin && opp?.yearMax
      ? `${opp.yearMin}-${opp.yearMax}`
      : opp?.yearMin
        ? `${opp.yearMin}`
        : "";

  const fullAddress =
    [prospect.address, prospect.city, prospect.state, prospect.zip]
      .filter(Boolean)
      .join(", ") || "—";

  return (
    <div className="space-y-6">
      {/* ── Profile header ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#0F172A]">{prospect.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              {prospect.brand && (
                <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {prospect.brand}
                </span>
              )}
              <span className="text-sm text-[#64748B]">
                {[prospect.city, prospect.state].filter(Boolean).join(", ")}
              </span>
            </div>
          </div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
              STATUS_BADGE[prospect.status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {prospect.status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <QuickStat label="Total Emails Sent" value={String(sentCount)} />
          <QuickStat
            label="Last Contact"
            value={fmtDate(prospect.contactedAt)}
          />
          <QuickStat
            label="Reply Status"
            value={prospect.replyDetectedAt || prospect.repliedAt ? "Replied" : "No reply"}
          />
          <QuickStat
            label="Days Since Added"
            value={String(daysSince(prospect.createdAt))}
          />
        </div>
      </div>

      {message && (
        <div className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 text-sm">
          {message}
        </div>
      )}

      {/* ── Dealer information (2-column) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: dealer */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
            Dealer Information
          </h2>
          <dl className="space-y-2 text-sm">
            <Row
              label="Name"
              value={
                <EditableField
                  value={prospect.name}
                  field="name"
                  onSave={(v) => patch({ name: v }, "edit-name")}
                />
              }
            />
            <Row label="Brand" value={prospect.brand ?? "—"} />
            <Row label="Address" value={fullAddress} />
            <Row
              label="City"
              value={
                <EditableField
                  value={prospect.city}
                  field="city"
                  onSave={(v) => patch({ city: v }, "edit-city")}
                />
              }
            />
            <Row
              label="State"
              value={
                <EditableField
                  value={prospect.state}
                  field="state"
                  onSave={(v) => patch({ state: v }, "edit-state")}
                />
              }
            />
            <Row
              label="ZIP"
              value={
                <EditableField
                  value={prospect.zip}
                  field="zip"
                  onSave={(v) => patch({ zip: v }, "edit-zip")}
                />
              }
            />
            <Row
              label="Phone"
              value={
                <EditableField
                  value={prospect.phone}
                  field="phone"
                  onSave={(v) => patch({ phone: v }, "edit-phone")}
                  display={
                    prospect.phone ? (
                      <a
                        href={`tel:${prospect.phone}`}
                        className="text-al-primary hover:underline"
                      >
                        {prospect.phone}
                      </a>
                    ) : undefined
                  }
                />
              }
            />
            <Row
              label="Website"
              value={
                <EditableField
                  value={prospect.website}
                  field="website"
                  placeholder="https://dealer.com"
                  onSave={(v) => patch({ website: v }, "edit-website")}
                  display={
                    prospect.website ? (
                      <a
                        href={prospect.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-al-primary hover:underline break-all"
                      >
                        {prospect.website}
                      </a>
                    ) : undefined
                  }
                  addLabel="Add website"
                />
              }
            />
            <Row
              label="Source"
              value={
                prospect.sourceUrl ? (
                  <a
                    href={prospect.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-al-primary hover:underline break-all"
                  >
                    Google Maps
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row
              label="Search score"
              value={
                prospect.searchScore != null ? prospect.searchScore.toFixed(2) : "—"
              }
            />
            <Row
              label="Distance"
              value={
                prospect.distanceMiles != null
                  ? `${prospect.distanceMiles} mi`
                  : "—"
              }
            />
            <Row label="Created" value={fmt(prospect.createdAt)} />
            <Row label="Updated" value={fmt(prospect.updatedAt)} />
          </dl>
        </div>

        {/* Right: contact */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
            Contact Information
          </h2>
          <dl className="space-y-2 text-sm">
            <Row
              label="Contact name"
              value={
                <EditableField
                  value={prospect.contactName}
                  field="contactName"
                  onSave={(v) => patch({ contactName: v }, "edit-contactName")}
                  addLabel="Add contact"
                />
              }
            />
            <Row
              label="Contact title"
              value={
                <EditableField
                  value={prospect.contactTitle}
                  field="contactTitle"
                  onSave={(v) => patch({ contactTitle: v }, "edit-contactTitle")}
                  addLabel="Add title"
                />
              }
            />
            <Row
              label="Email"
              value={
                <EmailEdit
                  prospectId={prospect.id}
                  email={prospect.email}
                  onRefresh={() => router.refresh()}
                />
              }
            />
            <Row label="Email source" value={prospect.emailSource ?? "—"} />
            <Row label="Email enriched" value={fmt(prospect.emailEnrichedAt)} />
          </dl>
          <button
            onClick={() => reEnrich(prospect.id, () => router.refresh())}
            className="mt-3 rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-[#F8FAFC]"
          >
            Re-Enrich Email
          </button>
        </div>
      </div>

      {/* ── Performance metrics ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Emails Sent" value={String(sentCount)} />
        <MetricCard label="Last Sent" value={fmtDate(lastLog?.sentAt ?? null)} />
        <MetricCard
          label="Last Status"
          value={
            lastLog ? (
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  LOG_STATUS_BADGE[lastLog.status] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {lastLog.status}
              </span>
            ) : (
              "—"
            )
          }
        />
        <MetricCard label="Sequence Step" value={currentStep} />
      </div>

      {/* ── Compose email ── */}
      <ComposeSection prospect={prospect} onSent={() => router.refresh()} />

      {/* ── Communication history ── */}
      <CommunicationHistory log={prospect.outreachLog} />

      {/* ── Linked buyer ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
          Linked Buyer
        </h2>
        {opp ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="First name" value={opp.firstName ?? "—"} />
            <Row
              label="Vehicle"
              value={[yearRange, vehicle, opp.trim].filter(Boolean).join(" ") || "—"}
            />
            <Row
              label="Budget"
              value={formatBudget(opp.budgetAmount, opp.monthlyPayment)}
            />
            <Row label="Timeline" value={humanizeTimeline(opp.timeline)} />
            <Row label="ZIP" value={opp.zip ?? "—"} />
            <Row label="Phone" value={opp.phone ?? "—"} />
            <Row label="Source" value={parseSource(opp.source).label} />
            <Row label="Created" value={fmt(opp.createdAt)} />
          </dl>
        ) : (
          <p className="text-sm text-[#94A3B8]">No linked buyer opportunity.</p>
        )}
      </div>

      {/* Change 1 — Market Insight */}
      <MarketInsightSection insight={prospect.marketInsight} />

      {/* ── Phone script ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase text-[#64748B]">
            Phone Script
          </h2>
          <span className="text-xs text-[#94A3B8]">
            Drafted at: {fmt(prospect.scriptDraftedAt)}
          </span>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={14}
          className="w-full rounded-md border border-slate-300 p-3 text-sm font-mono focus:border-al-primary focus:outline-none"
          placeholder="No script drafted yet. Click Regenerate Script to generate one."
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => patch({ outreachScript: script }, "save-script")}
            disabled={busy !== null}
            className="rounded-xl bg-al-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
          >
            {busy === "save-script" ? "Saving…" : "Save Script Edits"}
          </button>
          <button
            onClick={regenerate}
            disabled={busy !== null}
            className="rounded-xl border border-[#E2E8F0] px-4 py-2 text-sm font-medium text-slate-700 hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            {busy === "regenerate" ? "Regenerating…" : "Regenerate Script"}
          </button>
        </div>
      </div>

      {/* ── Pipeline status ── */}
      <PipelineStatus prospect={prospect} patch={patch} busy={busy} />

      {/* ── Notes & tags ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
          Notes &amp; Tags
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
            >
              {t}
              <button
                onClick={() => removeTag(t)}
                className="text-blue-400 hover:text-blue-700"
                aria-label={`Remove tag ${t}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add tag…"
            className="w-28 rounded-full border border-[#E2E8F0] px-3 py-0.5 text-xs focus:border-al-primary focus:outline-none"
            data-testid="tag-input"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-al-primary focus:outline-none"
          placeholder="Log call outcomes, follow-ups, objections…"
        />
        <button
          onClick={() => persistNotes(tags, notes)}
          disabled={busy !== null}
          className="mt-3 rounded-xl bg-al-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
        >
          {busy === "save-notes" ? "Saving…" : "Save Notes"}
        </button>
      </div>
    </div>
  );
}

// ─── Re-enrich + email helpers ───────────────────────────────────────────────
async function reEnrich(prospectId: string, onDone: () => void) {
  try {
    const res = await fetch(
      `/api/admin/dealer-outreach/${prospectId}/reenrich-email`,
      { method: "POST" },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
    }
    if (!body?.data?.email) window.alert("No email found for this dealer.");
    onDone();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Re-enrich failed");
  }
}

function EmailEdit({
  prospectId,
  email,
  onRefresh,
}: {
  prospectId: string;
  email: string | null;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/dealer-outreach/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: draft.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      setEditing(false);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="name@dealer.com"
          className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
          autoFocus
        />
        <button
          onClick={save}
          disabled={busy}
          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
        >
          <Check size={14} />
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(email ?? "");
          }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
        >
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <span className="group inline-flex items-center gap-2">
      {email ? (
        <a href={`mailto:${email}`} className="text-al-primary hover:underline break-all">
          {email}
        </a>
      ) : (
        <span className="text-[#94A3B8]">—</span>
      )}
      <button
        onClick={() => setEditing(true)}
        className="text-slate-300 hover:text-al-primary group-hover:text-slate-500"
        aria-label="Edit email"
      >
        <Pencil size={12} />
      </button>
    </span>
  );
}

// ─── Inline editable text field ──────────────────────────────────────────────
function EditableField({
  value,
  field,
  onSave,
  display,
  placeholder,
  addLabel = "Add",
}: {
  value: string | null;
  field: string;
  onSave: (v: string) => Promise<boolean>;
  display?: React.ReactNode;
  placeholder?: string;
  addLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const ok = await onSave(draft.trim());
    setBusy(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
          autoFocus
          data-testid={`edit-${field}-input`}
        />
        <button
          onClick={save}
          disabled={busy}
          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
          aria-label="Save"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setDraft(value ?? "");
          }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </span>
    );
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-xs text-al-primary hover:underline"
        data-testid={`edit-${field}-add`}
      >
        <Pencil size={11} /> {addLabel}
      </button>
    );
  }

  return (
    <span className="group inline-flex items-center gap-2">
      {display ?? <span className="text-[#0F172A]">{value}</span>}
      <button
        onClick={() => setEditing(true)}
        className="text-slate-300 hover:text-al-primary group-hover:text-slate-500"
        aria-label={`Edit ${field}`}
        data-testid={`edit-${field}`}
      >
        <Pencil size={12} />
      </button>
    </span>
  );
}

// ─── Compose section ─────────────────────────────────────────────────────────
function ComposeSection({
  prospect,
  onSent,
}: {
  prospect: ProspectDetail;
  onSent: () => void;
}) {
  const templates = composeTemplates(prospect);
  const [emailType, setEmailType] = useState("general");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const noEmail = !prospect.email;

  function applyTemplate(key: string) {
    const t = templates[key];
    if (!t) return;
    setEmailType(t.emailType);
    setSubject(t.subject);
    setBody(t.body);
    setResult(null);
  }

  async function send() {
    if (!subject.trim() || !body.trim()) {
      setResult({ ok: false, msg: "Subject and body are required." });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerProspectId: prospect.id,
          subject: subject.trim(),
          body: body.trim(),
          emailType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Failed (${res.status})`);
      }
      setResult({ ok: true, msg: "Email sent — logged to communication history" });
      setSubject("");
      setBody("");
      onSent();
    } catch (err) {
      setResult({
        ok: false,
        msg: err instanceof Error ? err.message : "Send failed",
      });
    } finally {
      setSending(false);
    }
  }

  const QUICK: { key: string; label: string }[] = [
    { key: "invitation", label: "Send Invitation" },
    { key: "missing_info", label: "Request Info" },
    { key: "offer_follow_up", label: "Offer Follow-Up" },
    { key: "re_engagement", label: "Re-Engage" },
  ];

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
        Compose Email
      </h2>

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q.key}
            onClick={() => applyTemplate(q.key)}
            className="rounded-xl border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-[#F8FAFC]"
            data-testid={`compose-quick-${q.key}`}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-[#64748B]">
            <span className="mb-1 block font-medium">Email Type</span>
            <select
              value={emailType}
              onChange={(e) => setEmailType(e.target.value)}
              className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] focus:border-al-primary focus:outline-none"
              data-testid="compose-email-type"
            >
              {EMAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs text-[#64748B]">
            <span className="mb-1 block font-medium">To</span>
            <input
              value={prospect.email ?? "No email on file"}
              disabled
              className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#64748B]"
            />
          </label>
        </div>

        <label className="text-xs text-[#64748B]">
          <span className="mb-1 block font-medium">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="Subject line"
            className="w-full rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-al-primary focus:outline-none"
            data-testid="compose-subject"
          />
        </label>

        <label className="text-xs text-[#64748B]">
          <span className="mb-1 block font-medium">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={5000}
            placeholder="Write your message… (signature and CAN-SPAM footer are added automatically)"
            className="w-full rounded-md border border-slate-300 p-3 text-sm focus:border-al-primary focus:outline-none"
            data-testid="compose-body"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={sending || noEmail}
            title={noEmail ? "No email on file" : "Send email"}
            className="inline-flex items-center gap-2 rounded-xl bg-al-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
            data-testid="compose-send"
          >
            {sending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Mail size={14} />
            )}
            Send Email
          </button>
          {result && (
            <span
              className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}
            >
              {result.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Communication history ───────────────────────────────────────────────────
function CommunicationHistory({ log }: { log: OutreachLogEntry[] }) {
  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
        Communication History
      </h2>
      {log.length === 0 ? (
        <p className="text-sm text-[#94A3B8]">No emails sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-[#94A3B8]">
              <tr>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Subject</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Resend ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {log.map((l) => (
                <LogRow key={l.id} entry={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: OutreachLogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="hover:bg-[#F8FAFC]">
        <td className="py-2 pr-3 whitespace-nowrap text-[#64748B]">
          {fmtDate(entry.sentAt)}
        </td>
        <td className="py-2 pr-3 whitespace-nowrap text-[#0F172A]">
          {entry.outreachType}
        </td>
        <td className="py-2 pr-3 max-w-[260px] truncate text-[#0F172A]">
          {entry.subject ?? "—"}
        </td>
        <td className="py-2 pr-3">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              LOG_STATUS_BADGE[entry.status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {entry.status}
          </span>
        </td>
        <td className="py-2 pr-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-al-primary"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {entry.resendId ? entry.resendId.slice(0, 10) + "…" : "Show body"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-[#F8FAFC] px-3 py-3">
            <pre className="whitespace-pre-wrap break-words text-xs text-[#475569]">
              {entry.body ?? "(no body recorded)"}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Pipeline status ─────────────────────────────────────────────────────────
function PipelineStatus({
  prospect,
  patch,
  busy,
}: {
  prospect: ProspectDetail;
  patch: (payload: Record<string, unknown>, action: string) => Promise<boolean>;
  busy: string | null;
}) {
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadReason, setDeadReason] = useState("");

  function mark(status: string) {
    void patch({ status }, `status-${status}`);
  }

  function confirmDead() {
    void patch({ status: "DEAD", deadReason }, "status-DEAD");
    setDeadOpen(false);
    setDeadReason("");
  }

  const actions: { label: string; status: string; cls: string }[] = (() => {
    switch (prospect.status) {
      case "DISCOVERED":
        return [
          { label: "Mark Scripted", status: "SCRIPTED", cls: "bg-blue-100 text-blue-800 hover:bg-blue-200" },
          { label: "Mark Contacted", status: "CONTACTED", cls: "bg-amber-100 text-amber-800 hover:bg-amber-200" },
        ];
      case "SCRIPTED":
        return [
          { label: "Mark Contacted", status: "CONTACTED", cls: "bg-amber-100 text-amber-800 hover:bg-amber-200" },
        ];
      case "CONTACTED":
        return [
          { label: "Mark Replied", status: "REPLIED", cls: "bg-purple-100 text-purple-800 hover:bg-purple-200" },
        ];
      case "REPLIED":
        return [
          { label: "Mark Onboarded", status: "ONBOARDED", cls: "bg-green-100 text-green-800 hover:bg-green-200" },
        ];
      case "DEAD":
        return [
          { label: "Reopen", status: "DISCOVERED", cls: "bg-slate-100 text-slate-700 hover:bg-slate-200" },
        ];
      default:
        return [];
    }
  })();

  const canDie = prospect.status !== "ONBOARDED" && prospect.status !== "DEAD";

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase text-[#64748B] mb-3">
        Pipeline Status
      </h2>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
            STATUS_BADGE[prospect.status] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {prospect.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.status}
            onClick={() => mark(a.status)}
            disabled={busy !== null}
            className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 ${a.cls}`}
            data-testid={`status-${a.status}`}
          >
            {a.label}
          </button>
        ))}
        {canDie && (
          <button
            onClick={() => setDeadOpen((v) => !v)}
            disabled={busy !== null}
            className="rounded-xl bg-red-100 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-200 disabled:opacity-50"
            data-testid="status-DEAD-open"
          >
            Mark Dead
          </button>
        )}
      </div>

      {deadOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={deadReason}
            onChange={(e) => setDeadReason(e.target.value)}
            placeholder="Reason this prospect is dead…"
            className="flex-1 min-w-[200px] rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm focus:border-al-primary focus:outline-none"
            data-testid="dead-reason-input"
          />
          <button
            onClick={confirmDead}
            disabled={busy !== null}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirm Dead
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-5 border-t border-[#F1F5F9] pt-4">
        <h3 className="text-xs font-semibold uppercase text-[#94A3B8] mb-2">
          Timeline
        </h3>
        <ul className="space-y-1 text-sm text-[#64748B]">
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

// ─── Small presentational helpers ────────────────────────────────────────────
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-[#94A3B8]">{label}</dt>
      <dd className="text-[#0F172A]">{value}</dd>
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#F8FAFC] p-3">
      <div className="text-lg font-bold text-[#0F172A]">{value}</div>
      <div className="text-xs text-[#64748B]">{label}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="text-xs text-[#64748B]">{label}</div>
      <div className="mt-1 text-lg font-bold text-[#0F172A]">{value}</div>
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
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-[#64748B]">
          Market Insight
          {insight?.searchGrounded && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium normal-case text-emerald-700">
              grounded
            </span>
          )}
        </h2>
        <span className="text-xs text-[#94A3B8]">{open ? "Hide" : "Show"}</span>
      </button>

      {open &&
        (hasAny && insight ? (
          <div className="mt-4 space-y-3 text-sm">
            <dl className="space-y-2">
              <Row label="MSRP range" value={formatMsrpRange(insight.msrpRange)} />
              <Row
                label="Demand"
                value={
                  insight.demandLevel ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        DEMAND_BADGE[insight.demandLevel] ?? "bg-slate-100 text-slate-600"
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
              <Row label="Incentives" value={insight.currentIncentives ?? "—"} />
              <Row label="Typical markup" value={insight.typicalMarkup ?? "—"} />
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
              <p className="rounded-md bg-[#F8FAFC] p-3 text-[#475569]">
                {insight.regionalPricingInsight}
              </p>
            )}

            {insight.localDealers.length > 0 && (
              <ul className="space-y-1 text-xs text-[#64748B]">
                {insight.localDealers.map((d, i) => (
                  <li key={`${d.name}-${i}`} className="flex flex-wrap gap-1">
                    <span className="font-medium text-[#0F172A]">{d.name}</span>
                    {d.city && <span>· {d.city}</span>}
                    {d.distanceMiles != null && <span>· {d.distanceMiles} mi</span>}
                    {d.hasInventory === true && (
                      <span className="text-emerald-600">· in stock</span>
                    )}
                    {d.inventoryNote && (
                      <span className="text-[#94A3B8]">· {d.inventoryNote}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {insight.dataAsOf && (
              <p className="text-[11px] text-[#94A3B8]">
                Data as of {new Date(insight.dataAsOf).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#94A3B8]">
            No market enrichment data for this request yet.
          </p>
        ))}
    </div>
  );
}
