"use client";

// Phase 4B-3 — per-row dealer outreach actions: last-send status badge, a
// Preview modal (generated subject + body, optionally edited before sending),
// a Send button, and a Send Followup button once an initial email has gone out.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Eye, Loader2 } from "lucide-react";

interface OutreachActionsProps {
  prospectId: string;
  hasEmail: boolean;
  lastStatus: string | null; // queued | sent | delivered | bounced | complained | replied | failed
}

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  complained: "bg-red-100 text-red-700",
  replied: "bg-purple-100 text-purple-700",
  failed: "bg-amber-100 text-amber-700",
};

export default function OutreachActions({
  prospectId,
  hasEmail,
  lastStatus,
}: OutreachActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");

  const alreadySent =
    lastStatus === "sent" || lastStatus === "delivered" || lastStatus === "replied";

  async function openPreview() {
    setPreviewOpen(true);
    setLoadingPreview(true);
    try {
      const res = await fetch("/api/admin/dealer-outreach/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerProspectId: prospectId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      setSubject(body?.data?.subject ?? "");
      setBodyText(body?.data?.bodyText ?? "");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Preview failed");
      setPreviewOpen(false);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function send(opts: { followup?: boolean; useEdited?: boolean }) {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        dealerProspectId: prospectId,
        outreachType: opts.followup ? "followup_1" : "initial",
      };
      // If sending from the preview modal with edits, pass the custom content.
      if (opts.useEdited && subject.trim() && bodyText.trim()) {
        payload.customSubject = subject.trim();
        payload.customBody = bodyText.trim();
      }
      const res = await fetch("/api/admin/dealer-outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      setPreviewOpen(false);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {lastStatus ? (
        <span
          className={`inline-block w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${
            STATUS_BADGE[lastStatus] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {lastStatus}
        </span>
      ) : (
        <span className="text-[11px] text-slate-400">no outreach</span>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={openPreview}
          disabled={!hasEmail || busy}
          title={hasEmail ? "Preview email" : "No email captured"}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#0B5FD1] disabled:opacity-40"
        >
          <Eye size={12} />
          Preview
        </button>
        {alreadySent ? (
          <button
            onClick={() => send({ followup: true })}
            disabled={!hasEmail || busy}
            title="Send a follow-up email"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#0B5FD1] disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
            Followup
          </button>
        ) : (
          <button
            onClick={() => send({})}
            disabled={!hasEmail || busy}
            title={hasEmail ? "Send outreach email" : "No email captured"}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0B5FD1] hover:underline disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
            Send
          </button>
        )}
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setPreviewOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-bold text-slate-900">
              Preview outreach email
            </h3>
            {loadingPreview ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Generating…
              </div>
            ) : (
              <>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Body (edit before sending if you like)
                </label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={12}
                  className="mb-4 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setPreviewOpen(false)}
                    disabled={busy}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => send({ useEdited: true, followup: alreadySent })}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-md bg-[#0B5FD1] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0a52b5] disabled:opacity-50"
                  >
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    Send Now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
