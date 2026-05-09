// AdminDealTabs — tabbed interface for deal detail with action panel
// Tabs: Overview | Billing | Insurance | E-Sign | Pickup | Refunds | Notes
// All admin actions POST to API routes which log to AdminAuditLog

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, AlertTriangle, Loader2, StickyNote } from "lucide-react";
import AdminPaymentActionsClient from "@/components/admin/AdminPaymentActionsClient";

const TABS = ["Overview", "Billing", "Insurance", "E-Sign", "Pickup", "Refunds", "Notes"] as const;
type Tab = typeof TABS[number];

interface DealNote { id: string; adminEmail: string; content: string; createdAt: string }

const DEAL_STAGES = [
  "PENDING", "ACTIVE", "FINANCING_PENDING", "FEE_PENDING", "FEE_PAID",
  "INSURANCE_PENDING", "CONTRACT_PENDING", "CONTRACT_REVIEW",
  "CONTRACT_APPROVED", "SIGNING_PENDING", "SIGNED",
  "PICKUP_SCHEDULED", "PICKUP_COMPLETE", "COMPLETED",
];

interface DealRecord { id: string; status: string; buyerId: string; financingPath: string | null; feePaidAt: string | null; feeAmountCents: number | null; feeRefundedAt?: string | null; insuranceStatus: string; contractShieldStatus: string | null; contractShieldScore: number | null; offer: { otdPriceCents: number; vehiclePriceCents: number; taxCents: number; feesCents: number; dealer: { dealershipName: string; city: string | null; state: string | null; tier: string }; auction: { deposit: { id: string; status: string; amountCents: number; stripePaymentIntentId: string | null } | null } | null }; buyer: { firstName: string; lastName: string; plan: string; user: { email: string } }; eSignEnvelope: { status: string; sentAt: string | null; completedAt: string | null; docusignEnvelopeId: string | null } | null; pickup: { status: string; scheduledAt: string | null; location: string | null; qrCodeImage: string | null } | null; contractScans: Array<{ status: string; score: number; fixList: unknown }> }
interface TimelineItem { stage: string; timestamp: string; description: string }
interface AuditLogItem { id: string; action: string; adminEmail: string; reason: string | null; createdAt: string }

interface Props { deal: DealRecord; timeline: TimelineItem[]; auditLogs: AuditLogItem[]; adminId: string; adminEmail: string }

export default function AdminDealTabs({ deal, timeline, auditLogs, adminId, adminEmail }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [actionReason, setActionReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  // Notes state
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/admin/deals/${deal.id}/notes`);
      const data = await res.json() as { success?: boolean; data?: { notes: DealNote[] } };
      if (data.success && data.data?.notes) {
        setNotes([...data.data.notes].reverse()); // show oldest first
      }
    } catch { /* ignore */ }
    finally { setNotesLoading(false); }
  }, [deal.id]);

  useEffect(() => {
    if (activeTab === "Notes") {
      void loadNotes();
    }
  }, [activeTab, loadNotes]);

  async function doAction(action: string, extra: Record<string, unknown> = {}) {
    if (!actionReason.trim() && action !== "VIEW") {
      setFeedback({ message: "Please provide a reason for this action", isError: true });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/deals/${deal.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: actionReason, ...extra }),
      });
      const data = await res.json() as { success?: boolean; error?: { message: string } };
      if (!res.ok) setFeedback({ message: data.error?.message ?? "Action failed", isError: true });
      else { setFeedback({ message: `Action '${action}' completed`, isError: false }); setActionReason(""); }
    } catch { setFeedback({ message: "Request failed", isError: true }); }
    finally { setLoading(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Tabs */}
      <div className="lg:col-span-2">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto" data-testid="deal-tabs">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              data-testid={`deal-tab-${tab.toLowerCase()}`}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === tab ? "border-[#0B5FD1] text-[#0B5FD1]" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "Overview" && (
          <div className="space-y-5" data-testid="tab-overview">
            {/* Deal timeline */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Deal Timeline</h3>
              <div className="space-y-3">
                {timeline.map((item, i) => (
                  <div key={i} data-testid={`timeline-item-${i}`} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 size={12} className="text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{item.stage}</p>
                      <p className="text-xs text-slate-500">{item.description}</p>
                      <p className="text-xs text-slate-400">{new Date(item.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-3 opacity-40">
                  <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Clock size={12} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">Future stages pending</p>
                </div>
              </div>
            </div>

            {/* Payments section */}
            <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="deal-payments-section">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Payments</h3>
              <div className="space-y-4">
                {/* Deposit row */}
                {deal.offer.auction?.deposit ? (
                  <div className="border border-slate-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-800">$99 Auction Access Deposit</span>
                    </div>
                    <AdminPaymentActionsClient
                      type="deposit"
                      depositId={deal.offer.auction.deposit.id}
                      buyerId={deal.buyerId}
                      buyerEmail={deal.buyer.user.email}
                      status={deal.offer.auction.deposit.status}
                    />
                  </div>
                ) : (
                  <div className="border border-slate-100 rounded-lg p-4 text-sm text-slate-400">
                    $99 Auction Access Deposit — no deposit record found.
                  </div>
                )}

                {/* Concierge fee row — Premium buyers only */}
                {deal.buyer.plan === "PREMIUM" && (
                  <div className="border border-slate-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-800">
                        $499 Concierge Fee ($99 deposit credited — $400 due)
                      </span>
                    </div>
                    {deal.feePaidAt && (
                      <p className="text-xs text-slate-500 mb-2">
                        Paid: {new Date(deal.feePaidAt).toLocaleDateString()}
                      </p>
                    )}
                    <AdminPaymentActionsClient
                      type="concierge_fee"
                      dealId={deal.id}
                      buyerId={deal.buyerId}
                      buyerEmail={deal.buyer.user.email}
                      feeStatus={deal.feeRefundedAt ? "REFUNDED" : deal.feePaidAt ? "PAID" : "PENDING"}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Deal + buyer + dealer overview */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Buyer</p>
                <p className="font-semibold text-slate-800">{deal.buyer.firstName} {deal.buyer.lastName}</p>
                <p className="text-xs text-slate-500">{deal.buyer.user.email}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Dealer</p>
                <p className="font-semibold text-slate-800">{deal.offer.dealer.dealershipName}</p>
                <p className="text-xs text-slate-500">{deal.offer.dealer.city}, {deal.offer.dealer.state} · {deal.offer.dealer.tier}</p>
              </div>
            </div>

            {/* Contract Shield Status */}
            {deal.contractShieldStatus && (
              <div className={`rounded-xl p-4 border ${deal.contractShieldStatus === "PASS" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`} data-testid="deal-contract-shield-status">
                <p className="text-sm font-semibold">Contract Shield: {deal.contractShieldStatus} · Score: {deal.contractShieldScore}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "Billing" && (
          <div className="space-y-4" data-testid="tab-billing">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Billing Breakdown</h3>
              {[
                { label: "Vehicle Price", value: `$${(deal.offer.vehiclePriceCents / 100).toLocaleString()}` },
                { label: "Tax", value: `$${(deal.offer.taxCents / 100).toLocaleString()}` },
                { label: "Dealer Fees", value: `$${(deal.offer.feesCents / 100).toLocaleString()}` },
                { label: "OTD Total", value: `$${(deal.offer.otdPriceCents / 100).toLocaleString()}` },
                { label: "Financing Path", value: deal.financingPath ?? "Not selected" },
                { label: "Concierge Fee", value: deal.feePaidAt ? `$${(deal.feeAmountCents ?? 49900) / 100} — paid ${new Date(deal.feePaidAt).toLocaleDateString()}` : "Not yet paid" },
              ].map(f => (
                <div key={f.label} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 text-sm">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="font-semibold text-slate-900">{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "Insurance" && (
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="tab-insurance">
            <h3 className="font-semibold text-slate-800 text-sm mb-4">Insurance</h3>
            <div className="flex items-center gap-2 mb-4">
              <Badge variant={deal.insuranceStatus === "POLICY_BOUND" ? "green" : "amber"}>{deal.insuranceStatus.replace(/_/g, " ")}</Badge>
            </div>
            <p className="text-sm text-slate-500">Insurance status managed through the buyer portal. Admin may flag exceptions via the action panel.</p>
          </div>
        )}

        {activeTab === "E-Sign" && (
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="tab-esign">
            <h3 className="font-semibold text-slate-800 text-sm mb-4">E-Sign Envelope</h3>
            {deal.eSignEnvelope ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge variant={deal.eSignEnvelope.status === "COMPLETED" ? "green" : "amber"}>{deal.eSignEnvelope.status}</Badge></div>
                <div className="flex justify-between"><span className="text-slate-500">DocuSign ID</span><code className="text-xs font-mono text-slate-600">{deal.eSignEnvelope.docusignEnvelopeId ?? "—"}</code></div>
                {deal.eSignEnvelope.sentAt && <div className="flex justify-between"><span className="text-slate-500">Sent</span><span>{new Date(deal.eSignEnvelope.sentAt).toLocaleDateString()}</span></div>}
                {deal.eSignEnvelope.completedAt && <div className="flex justify-between"><span className="text-slate-500">Completed</span><span>{new Date(deal.eSignEnvelope.completedAt).toLocaleDateString()}</span></div>}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No envelope created yet</p>
            )}
          </div>
        )}

        {activeTab === "Pickup" && (
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="tab-pickup">
            <h3 className="font-semibold text-slate-800 text-sm mb-4">Vehicle Pickup</h3>
            {deal.pickup ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge variant={deal.pickup.status === "COMPLETED" ? "green" : "blue"}>{deal.pickup.status.replace(/_/g, " ")}</Badge></div>
                {deal.pickup.scheduledAt && <div className="flex justify-between"><span className="text-slate-500">Scheduled</span><span>{new Date(deal.pickup.scheduledAt).toLocaleDateString()}</span></div>}
                {deal.pickup.location && <div className="flex justify-between"><span className="text-slate-500">Location</span><span>{deal.pickup.location}</span></div>}
                {deal.pickup.qrCodeImage && (
                  <div className="mt-4">
                    <p className="text-xs text-slate-400 mb-2">QR Code</p>
                    <img src={deal.pickup.qrCodeImage} alt="Pickup QR" className="w-32 h-32" />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No pickup scheduled</p>
            )}
          </div>
        )}

        {activeTab === "Refunds" && (
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="tab-refunds">
            <h3 className="font-semibold text-slate-800 text-sm mb-4">Refund History</h3>
            <p className="text-sm text-slate-500">No refunds issued for this deal.</p>
          </div>
        )}

        {activeTab === "Notes" && (
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="tab-notes">
            <h3 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
              <StickyNote size={14} />Internal Notes
            </h3>

            {notesLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 size={14} className="animate-spin" />Loading notes…
              </div>
            ) : notes.length === 0 ? (
              <p className="text-sm text-slate-400 py-2" data-testid="notes-empty">
                No notes yet. Add the first internal note for this deal.
              </p>
            ) : (
              <div className="space-y-3 mb-4" data-testid="notes-list">
                {notes.map(note => (
                  <div key={note.id} data-testid={`note-${note.id}`} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-slate-400">{note.adminEmail}</span>
                      <span className="text-xs text-slate-300">{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {noteFeedback && (
              <div className={`text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 ${noteFeedback.isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                {noteFeedback.isError ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                {noteFeedback.message}
              </div>
            )}

            <div className="border-t border-slate-100 pt-4">
              <label className="text-xs text-slate-500 font-medium mb-1.5 block">Add Internal Note</label>
              <Textarea
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                placeholder="Write an internal note (min 10 characters)…"
                className="text-sm min-h-[80px] mb-2"
                data-testid="note-content-input"
              />
              <Button
                size="sm"
                disabled={noteSubmitting || noteContent.trim().length < 10}
                data-testid="add-note-btn"
                onClick={async () => {
                  const content = noteContent.trim();
                  if (content.length < 10) return;
                  // Optimistic UI
                  const tempNote: DealNote = {
                    id: `temp-${Date.now()}`,
                    adminEmail,
                    content,
                    createdAt: new Date().toISOString(),
                  };
                  setNotes(prev => [...prev, tempNote]);
                  setNoteContent("");
                  setNoteSubmitting(true);
                  setNoteFeedback(null);
                  try {
                    const res = await fetch(`/api/admin/deals/${deal.id}/notes`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content }),
                    });
                    const data = await res.json() as { success?: boolean; data?: { note: DealNote }; error?: { message: string } };
                    if (!res.ok || !data.success) {
                      // Rollback
                      setNotes(prev => prev.filter(n => n.id !== tempNote.id));
                      setNoteContent(content);
                      setNoteFeedback({ message: data.error?.message ?? "Failed to add note", isError: true });
                    } else if (data.data?.note) {
                      // Replace temp note with real note
                      setNotes(prev => prev.map(n => n.id === tempNote.id ? data.data!.note : n));
                      setNoteFeedback({ message: "Note added", isError: false });
                    }
                  } catch {
                    setNotes(prev => prev.filter(n => n.id !== tempNote.id));
                    setNoteContent(content);
                    setNoteFeedback({ message: "Network error — note not saved", isError: true });
                  } finally {
                    setNoteSubmitting(false);
                  }
                }}
              >
                {noteSubmitting ? <><Loader2 size={12} className="animate-spin" />Adding…</> : "Add Note"}
              </Button>
            </div>
          </div>
        )}

        {/* Audit log */}
        {auditLogs.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mt-5" data-testid="deal-audit-log">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">Admin Action Log</h3>
            <div className="space-y-2">
              {auditLogs.map(log => (
                <div key={log.id} data-testid={`audit-${log.id}`} className="flex items-start justify-between text-xs py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-mono font-semibold text-slate-700">{log.action}</span>
                    {log.reason && <span className="text-slate-400 ml-2">— {log.reason}</span>}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-slate-400">{log.adminEmail}</p>
                    <p className="text-slate-300">{new Date(log.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: Admin action panel */}
      <div className="space-y-4" data-testid="admin-action-panel">
        <div className="bg-white border-2 border-[#0B5FD1]/20 rounded-xl p-5 sticky top-6">
          <h3 className="font-semibold text-slate-800 text-sm mb-4">Admin Actions</h3>

          <div className="mb-4">
            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Reason (required for all actions)</label>
            <Textarea
              value={actionReason}
              onChange={e => setActionReason(e.target.value)}
              placeholder="Describe the reason for this action…"
              className="text-sm min-h-[72px]"
              data-testid="action-reason-input"
            />
          </div>

          {feedback && (
            <div className={`text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 ${feedback.isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`} data-testid="action-feedback">
              {feedback.isError ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
              {feedback.message}
            </div>
          )}

          <div className="space-y-2">
            {/* Advance stage */}
            <div>
              <label className="text-xs text-slate-500 font-medium mb-1 block">Advance to stage</label>
              <select className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
                id="next-stage-select" data-testid="advance-stage-select">
                {DEAL_STAGES.filter(s => s !== deal.status).map(s => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
              <Button className="w-full mt-1.5" size="sm" variant="secondary" disabled={loading}
                data-testid="advance-stage-btn"
                onClick={() => {
                  const sel = (document.getElementById("next-stage-select") as HTMLSelectElement)?.value;
                  doAction("DEAL_STAGE_ADVANCED", { newStatus: sel });
                }}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : "Advance Stage"}
              </Button>
            </div>

            {/* Override contract shield */}
            <Button className="w-full" size="sm" variant="secondary" disabled={loading} data-testid="override-shield-btn"
              onClick={() => doAction("CONTRACT_SHIELD_OVERRIDDEN")}>
              Override Contract Shield
            </Button>

            {/* Cancel deal */}
            <Button className="w-full" size="sm" variant="destructive" disabled={loading} data-testid="cancel-deal-btn"
              onClick={() => doAction("DEAL_CANCELLED")}>
              Cancel Deal
            </Button>

            {/* Trigger refund */}
            <Button className="w-full" size="sm" variant="destructive" disabled={loading} data-testid="trigger-refund-btn"
              onClick={() => doAction("REFUND_TRIGGERED")}>
              Trigger Refund
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
