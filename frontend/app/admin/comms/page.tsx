"use client";

import { useState } from "react";
import { Send, Bell } from "lucide-react";

type Tab = "email" | "notification";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-[#0B5FD1] text-white"
          : "text-[#1E40AF] hover:bg-[#F0F9FF] hover:text-[#0B5FD1]"
      }`}
    >
      {children}
    </button>
  );
}

function Alert({ type, message }: { type: "success" | "error"; message: string }) {
  const colors = type === "success"
    ? "bg-green-50 border-green-200 text-green-800"
    : "bg-red-50 border-red-200 text-red-800";
  return (
    <div className={`border rounded-lg p-3 text-sm ${colors}`}>{message}</div>
  );
}

export default function AdminCommsPage() {
  const [tab, setTab] = useState<Tab>("email");

  // Email form state
  const [emailRecipientType, setEmailRecipientType] = useState<"BUYER" | "DEALER" | "AFFILIATE">("BUYER");
  const [emailRecipientId, setEmailRecipientId] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReason, setEmailReason] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailResult, setEmailResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Notification form state
  const [notifRecipientType, setNotifRecipientType] = useState<"BUYER" | "DEALER" | "AFFILIATE" | "ALL_BUYERS" | "ALL_ACTIVE_DEALERS">("BUYER");
  const [notifRecipientId, setNotifRecipientId] = useState("");
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifActionUrl, setNotifActionUrl] = useState("");
  const [notifReason, setNotifReason] = useState("");
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifResult, setNotifResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const isBulkNotif = notifRecipientType === "ALL_BUYERS" || notifRecipientType === "ALL_ACTIVE_DEALERS";

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailLoading(true);
    setEmailResult(null);
    try {
      const res = await fetch("/api/admin/comms/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientType: emailRecipientType,
          recipientId: emailRecipientId,
          subject: emailSubject,
          body: emailBody,
          reason: emailReason,
        }),
      });
      const data = await res.json() as { success?: boolean; data?: { recipientEmail?: string }; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setEmailResult({ type: "error", message: data.error?.message ?? "Failed to send email" });
      } else {
        setEmailResult({ type: "success", message: `Email sent to ${data.data?.recipientEmail ?? "recipient"}` });
        setEmailRecipientId(""); setEmailSubject(""); setEmailBody(""); setEmailReason("");
      }
    } catch {
      setEmailResult({ type: "error", message: "Network error — please try again" });
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleSendNotification(e: React.FormEvent) {
    e.preventDefault();
    setNotifLoading(true);
    setNotifResult(null);
    try {
      const res = await fetch("/api/admin/comms/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientType: notifRecipientType,
          ...(isBulkNotif ? {} : { recipientId: notifRecipientId }),
          title: notifTitle,
          body: notifBody,
          actionUrl: notifActionUrl || undefined,
          reason: notifReason,
        }),
      });
      const data = await res.json() as { success?: boolean; data?: { sent?: number }; error?: { message?: string } };
      if (!res.ok || !data.success) {
        setNotifResult({ type: "error", message: data.error?.message ?? "Failed to send notification" });
      } else {
        const count = data.data?.sent ?? 0;
        setNotifResult({ type: "success", message: `${count} notification${count === 1 ? "" : "s"} sent` });
        setNotifRecipientId(""); setNotifTitle(""); setNotifBody(""); setNotifActionUrl(""); setNotifReason("");
      }
    } catch {
      setNotifResult({ type: "error", message: "Network error — please try again" });
    } finally {
      setNotifLoading(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-comms-page">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Communications</h1>
      <p className="text-slate-500 text-sm mb-6">Send emails or in-app notifications to users.</p>

      <div className="flex gap-2 mb-6">
        <TabButton active={tab === "email"} onClick={() => setTab("email")}>
          <span className="flex items-center gap-1.5"><Send size={13} />Send Email</span>
        </TabButton>
        <TabButton active={tab === "notification"} onClick={() => setTab("notification")}>
          <span className="flex items-center gap-1.5"><Bell size={13} />Send Notification</span>
        </TabButton>
      </div>

      {tab === "email" && (
        <form onSubmit={handleSendEmail} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4" data-testid="admin-comms-email-form">
          <h2 className="font-semibold text-slate-800 text-sm">Send Email</h2>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Recipient Type</label>
            <div className="flex gap-4">
              {(["BUYER", "DEALER", "AFFILIATE"] as const).map(type => (
                <label key={type} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                  <input type="radio" name="emailRecipientType" value={type}
                    checked={emailRecipientType === type}
                    onChange={() => setEmailRecipientType(type)}
                    className="text-[#0B5FD1]" />
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Recipient ID</label>
            <input type="text" value={emailRecipientId} onChange={e => setEmailRecipientId(e.target.value)}
              placeholder={`${emailRecipientType.toLowerCase()} ID`}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
              required />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Subject</label>
            <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
              placeholder="Email subject line"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
              required />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Body</label>
            <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)}
              placeholder="Email body (min 20 characters)"
              rows={5} minLength={20}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 resize-none"
              required />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Reason <span className="text-slate-400">(admin audit log)</span></label>
            <textarea value={emailReason} onChange={e => setEmailReason(e.target.value)}
              placeholder="Why are you sending this email? (min 10 chars)"
              rows={2} minLength={10}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 resize-none"
              required />
          </div>

          {emailResult && <Alert type={emailResult.type} message={emailResult.message} />}

          <button type="submit" disabled={emailLoading || emailReason.length < 10}
            className="w-full bg-[#0B5FD1] text-white font-semibold text-sm py-2.5 rounded-lg hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {emailLoading ? <><span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />Sending...</> : <><Send size={14} />Send Email</>}
          </button>
        </form>
      )}

      {tab === "notification" && (
        <form onSubmit={handleSendNotification} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4" data-testid="admin-comms-notif-form">
          <h2 className="font-semibold text-slate-800 text-sm">Send In-App Notification</h2>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Recipient Type</label>
            <select value={notifRecipientType} onChange={e => setNotifRecipientType(e.target.value as typeof notifRecipientType)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30">
              <option value="BUYER">Buyer</option>
              <option value="DEALER">Dealer</option>
              <option value="AFFILIATE">Affiliate</option>
              <option value="ALL_BUYERS">All Buyers</option>
              <option value="ALL_ACTIVE_DEALERS">All Active Dealers</option>
            </select>
          </div>

          {!isBulkNotif && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Recipient ID</label>
              <input type="text" value={notifRecipientId} onChange={e => setNotifRecipientId(e.target.value)}
                placeholder="recipient ID"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
                required />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Title <span className="text-slate-400">(max 80)</span></label>
            <input type="text" value={notifTitle} onChange={e => setNotifTitle(e.target.value)}
              placeholder="Notification title"
              maxLength={80}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30"
              required />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Message <span className="text-slate-400">(max 200)</span></label>
            <textarea value={notifBody} onChange={e => setNotifBody(e.target.value)}
              placeholder="Notification body"
              rows={3} maxLength={200}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 resize-none"
              required />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Action URL <span className="text-slate-400">(optional)</span></label>
            <input type="url" value={notifActionUrl} onChange={e => setNotifActionUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30" />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Reason <span className="text-slate-400">(admin audit log)</span></label>
            <textarea value={notifReason} onChange={e => setNotifReason(e.target.value)}
              placeholder="Why are you sending this notification? (min 10 chars)"
              rows={2} minLength={10}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B5FD1]/30 resize-none"
              required />
          </div>

          {notifResult && <Alert type={notifResult.type} message={notifResult.message} />}

          <button type="submit" disabled={notifLoading || notifReason.length < 10}
            className="w-full bg-[#0B5FD1] text-white font-semibold text-sm py-2.5 rounded-lg hover:bg-[#0A4DB8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {notifLoading ? <><span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />Sending...</> : <><Bell size={14} />Send Notification</>}
          </button>
        </form>
      )}
    </div>
  );
}
