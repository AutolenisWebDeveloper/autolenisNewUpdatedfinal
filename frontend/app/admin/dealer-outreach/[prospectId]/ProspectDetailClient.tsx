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
  email: string | null;
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
  lastOutreach: {
    status: string;
    subject: string | null;
    outreachType: string;
    sentAt: string;
  } | null;
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

const OUTREACH_BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  complained: "bg-red-100 text-red-700",
  replied: "bg-purple-100 text-purple-700",
  failed: "bg-red-100 text-red-700",
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

  // Outreach email state.
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [previewLoaded, setPreviewLoaded] = useState(false);

  async function previewEmail() {
    setBusy("preview");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/dealer-outreach/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerProspectId: prospect.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setEmailSubject(body?.data?.subject ?? "");
      setEmailBody(body?.data?.body ?? "");
      setPreviewLoaded(true);
      setMessage("Preview generated. Edit if needed, then Send.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendEmail(outreachType: "initial" | "followup_1" | "followup_2") {
    if (!prospect.email) {
      setMessage("This dealer has no email on file.");
      return;
    }
    if (
      !window.confirm(
        `Send ${outreachType.replace("_", " ")} outreach email to ${prospect.email}?`,
      )
    ) {
      return;
    }
    setBusy("send");
    setMessage(null);
    try {
      // If the founder edited a generated preview, send those overrides.
      const useOverride = previewLoaded && emailSubject.trim() && emailBody.trim();
      const res = await fetch("/api/admin/dealer-outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerProspectId: prospect.id,
          outreachType,
          ...(useOverride ? { customSubject: emailSubject, customBody: emailBody } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setMessage(`Email sent${body?.data?.resendId ? ` (${body.data.resendId})` : ""}.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }

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

      {/* Outreach email */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Outreach Email</h2>
          {prospect.lastOutreach ? (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                OUTREACH_BADGE[prospect.lastOutreach.status] ?? "bg-slate-100 text-slate-600"
              }`}
            >
              Last: {prospect.lastOutreach.status} · {fmt(prospect.lastOutreach.sentAt)}
            </span>
          ) : (
            <span className="text-xs text-slate-400">No email sent yet</span>
          )}
        </div>

        <div className="text-sm text-slate-600 mb-3">
          To:{" "}
          {prospect.email ? (
            <span className="font-medium text-slate-800">{prospect.email}</span>
          ) : (
            <span className="text-red-600">No email on file — enrich or add one first.</span>
          )}
        </div>

        {previewLoaded && (
          <div className="space-y-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-[#0B5FD1] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Body (edit before sending — signature &amp; CAN-SPAM footer are added automatically)
              </label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={14}
                className="w-full rounded-md border border-slate-300 p-3 text-sm font-mono focus:border-[#0B5FD1] focus:outline-none"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={previewEmail}
            disabled={busy !== null || !prospect.email}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "preview" ? "Generating…" : "Preview Email"}
          </button>
          <button
            onClick={() => sendEmail("initial")}
            disabled={busy !== null || !prospect.email}
            className="rounded-md bg-[#0B5FD1] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Send Email"}
          </button>
          {prospect.lastOutreach && prospect.lastOutreach.status !== "replied" && (
            <button
              onClick={() => sendEmail("followup_1")}
              disabled={busy !== null || !prospect.email}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Send Follow-up
            </button>
          )}
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
