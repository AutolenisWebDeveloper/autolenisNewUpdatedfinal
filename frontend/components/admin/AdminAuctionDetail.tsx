// AdminAuctionDetail — full auction management for admin
// Dealer identity visible to admin | Best Price Engine panel | Admin actions

"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle, Loader2, Gavel, Users, Clock, TrendingUp } from "lucide-react";
import { COMMISSION_RATES, PREMIUM_FEE_CENTS } from "@/lib/constants";
import { api, apiErrorMessage } from "@/lib/api/client";

interface Offer { id: string; otdPriceCents: number; vehiclePriceCents: number; taxCents: number; feesCents: number; junkFeesCents: number; includesFinancing: boolean; aprRate: number | null; termMonths: number | null; status: string; version: number; aprFlag: string | null; dealer: { id: string; dealershipName: string; tier: string; city: string | null; state: string | null; user: { email: string } } }
interface Invitation { id: string; dealer: { id: string; dealershipName: string; tier: string }; sentAt: string; respondedAt: string | null }
interface AuditLog { id: string; action: string; adminEmail: string; reason: string | null; createdAt: string }
interface AuctionRecord { id: string; status: string; startedAt: string | null; endsAt: string | null; closedAt: string | null; buyer: { firstName: string; lastName: string; user: { email: string }; preQualification: { maxOtdAmountCents: number; tier: string | null } | null }; deposit: { amountCents: number; stripePaymentIntentId: string | null } | null; offers: Offer[]; invitations: Invitation[] }

interface Props { auction: AuctionRecord; auditLogs: AuditLog[]; adminId: string; adminEmail: string }

function computeBestPrice(offers: Offer[]): { bestCash: Offer | null; bestMonthly: Offer | null; bestOverall: Offer | null } {
  const submitted = offers.filter(o => o.status === "SUBMITTED");
  if (submitted.length === 0) return { bestCash: null, bestMonthly: null, bestOverall: null };

  const sorted = [...submitted].sort((a, b) => a.otdPriceCents - b.otdPriceCents);
  const withFinancing = submitted.filter(o => o.includesFinancing && o.aprRate && o.termMonths);
  const bestMonthly = withFinancing.sort((a, b) => {
    const ma = a.otdPriceCents * (a.aprRate! / 12 / 100) / (1 - Math.pow(1 + a.aprRate! / 12 / 100, -(a.termMonths!)));
    const mb = b.otdPriceCents * (b.aprRate! / 12 / 100) / (1 - Math.pow(1 + b.aprRate! / 12 / 100, -(b.termMonths!)));
    return ma - mb;
  })[0] ?? null;

  return {
    bestCash: sorted[0] ?? null,
    bestMonthly,
    bestOverall: sorted[Math.floor(sorted.length / 2)] ?? sorted[0] ?? null,
  };
}

export default function AdminAuctionDetail({ auction, auditLogs, adminId, adminEmail }: Props) {
  const [reason, setReason] = useState("");
  const [extendHours, setExtendHours] = useState("24");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [remaining, setRemaining] = useState(auction.endsAt ? new Date(auction.endsAt).getTime() - Date.now() : 0);

  useEffect(() => {
    if (!auction.endsAt || auction.status !== "ACTIVE") return;
    const iv = setInterval(() => setRemaining(new Date(auction.endsAt!).getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, [auction.endsAt, auction.status]);

  async function doAction(action: string, extra: Record<string, unknown> = {}) {
    if (!reason.trim()) { setFeedback({ message: "Reason is required", isError: true }); return; }
    setLoading(true); setFeedback(null);
    try {
      await api.post(`/api/admin/auctions/${auction.id}/action`, { action, reason, ...extra });
      setFeedback({ message: `${action} completed`, isError: false }); setReason("");
    } catch (err) {
      setFeedback({ message: apiErrorMessage(err, "Action failed"), isError: true });
    } finally {
      setLoading(false);
    }
  }

  const bestPrice = computeBestPrice(auction.offers);
  const isActive = auction.status === "ACTIVE";
  const h = Math.floor(Math.max(0, remaining) / 3600000);
  const m = Math.floor((Math.max(0, remaining) % 3600000) / 60000);
  const s = Math.floor((Math.max(0, remaining) % 60000) / 1000);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Gavel size={22} className="text-al-primary" />
            <h1 className="text-xl font-bold text-slate-900">Auction #{auction.id.slice(-8)}</h1>
            <Badge variant={isActive ? "green" : "secondary"}>{auction.status}</Badge>
            {isActive && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
          </div>
          <p className="text-sm text-slate-500">Buyer: {auction.buyer.firstName} {auction.buyer.lastName} · {auction.buyer.user.email}</p>
        </div>
        {isActive && remaining > 0 && (
          <div className="text-right" data-testid="auction-countdown">
            <p className="text-2xl font-bold font-mono text-al-primary">
              {h.toString().padStart(2,"0")}:{m.toString().padStart(2,"0")}:{s.toString().padStart(2,"0")}
            </p>
            <p className="text-xs text-slate-400">remaining</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Stats + Invitations + Offers */}
        <div className="lg:col-span-2 space-y-5">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: Users, label: "Invited Dealers", value: auction.invitations.length },
              { icon: TrendingUp, label: "Offers Submitted", value: auction.offers.filter(o => o.status === "SUBMITTED").length },
              { icon: Clock, label: "Responses", value: auction.invitations.filter(i => i.respondedAt).length },
            ].map(s => (
              <div key={s.label} data-testid={`auction-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                <s.icon size={16} className="text-al-primary mx-auto mb-1" />
                <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Buyer budget */}
          {auction.buyer.preQualification && (
            <div className="bg-al-primary/5 border border-al-primary/20 rounded-xl p-4 text-sm" data-testid="buyer-budget-panel">
              <span className="text-slate-600 font-medium">Approved budget (immutable): </span>
              <span className="font-bold text-al-primary">${(auction.buyer.preQualification.maxOtdAmountCents / 100).toLocaleString()}</span>
              <Badge variant="secondary" className="ml-2 text-xs">{auction.buyer.preQualification.tier}</Badge>
            </div>
          )}

          {/* All offers — dealer identity visible to admin */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="auction-offers-table">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">All Offers (dealer identity visible — admin only)</h3>
            </div>
            {auction.offers.length === 0 ? (
              <p className="p-5 text-sm text-slate-400">No offers yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>{["Dealer","OTD","Vehicle","Tax","Fees","APR","Term","Status","APR Flag"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auction.offers.map(offer => (
                    <tr key={offer.id} data-testid={`offer-row-${offer.id}`} className="hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-800">{offer.dealer.dealershipName}</p>
                        <p className="text-slate-400">{offer.dealer.user.email}</p>
                        <Badge variant="secondary" className="text-xs mt-0.5">{offer.dealer.tier}</Badge>
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-900">${(offer.otdPriceCents/100).toLocaleString()}</td>
                      <td className="px-3 py-3">${(offer.vehiclePriceCents/100).toLocaleString()}</td>
                      <td className="px-3 py-3">${(offer.taxCents/100).toLocaleString()}</td>
                      <td className="px-3 py-3">{offer.feesCents > 0 ? <span className="text-red-600">${(offer.feesCents/100).toLocaleString()}</span> : "—"}</td>
                      <td className="px-3 py-3">{offer.aprRate ? `${offer.aprRate}%` : "—"}</td>
                      <td className="px-3 py-3">{offer.termMonths ? `${offer.termMonths}mo` : "—"}</td>
                      <td className="px-3 py-3"><Badge variant={offer.status === "ACCEPTED" ? "green" : "secondary"} className="text-xs">{offer.status}</Badge></td>
                      <td className="px-3 py-3">{offer.aprFlag ? <Badge variant="destructive" className="text-xs">{offer.aprFlag}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Best Price Engine output */}
          {auction.offers.filter(o => o.status === "SUBMITTED").length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="best-price-engine-panel">
              <h3 className="font-semibold text-slate-800 text-sm mb-4">Best Price Engine Output</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Best Cash", offer: bestPrice.bestCash, rank: "BEST_CASH" },
                  { label: "Best Monthly", offer: bestPrice.bestMonthly, rank: "BEST_MONTHLY" },
                  { label: "Best Overall", offer: bestPrice.bestOverall, rank: "BEST_OVERALL" },
                ].map(({ label, offer, rank }) => (
                  <div key={rank} data-testid={`bpe-${rank.toLowerCase()}`} className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">{label}</p>
                    {offer ? (
                      <>
                        <p className="text-lg font-bold text-al-primary">${(offer.otdPriceCents/100).toLocaleString()}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{offer.dealer.dealershipName}</p>
                      </>
                    ) : <p className="text-xs text-slate-400">No eligible offers</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invited dealers */}
          <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="invited-dealers">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">Invited Dealers ({auction.invitations.length})</h3>
            <div className="space-y-2">
              {auction.invitations.map((inv, i) => (
                <div key={inv.id} data-testid={`invitation-${i}`} className="flex items-center justify-between text-sm py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-medium text-slate-800">{inv.dealer.dealershipName}</span>
                    <Badge variant="secondary" className="text-xs ml-2">{inv.dealer.tier}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{new Date(inv.sentAt).toLocaleDateString()}</span>
                    {inv.respondedAt && <Badge variant="green" className="text-xs">Responded</Badge>}
                    <Button size="sm" variant="ghost" className="text-xs text-red-500 h-6"
                      data-testid={`remove-dealer-${inv.dealer.id}`}
                      onClick={() => doAction("DEALER_REMOVED", { dealerId: inv.dealer.id })}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Audit log */}
          {auditLogs.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5" data-testid="auction-audit-log">
              <h3 className="font-semibold text-slate-800 text-sm mb-3">Action Log</h3>
              <div className="space-y-1.5">
                {auditLogs.map(log => (
                  <div key={log.id} className="flex items-start justify-between text-xs border-b border-slate-100 py-2 last:border-0">
                    <span className="font-mono text-slate-700">{log.action} {log.reason && <span className="text-slate-400">— {log.reason}</span>}</span>
                    <span className="text-slate-400 shrink-0 ml-2">{log.adminEmail} · {new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Admin action panel */}
        <div className="sticky top-6" data-testid="auction-action-panel">
          <div className="bg-white border-2 border-al-primary/20 rounded-xl p-5">
            <h3 className="font-semibold text-slate-800 text-sm mb-4">Admin Actions</h3>

            <div className="mb-4">
              <label className="text-xs text-slate-500 font-medium mb-1.5 block">Reason (required)</label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Reason for this action…" className="text-sm min-h-[60px]" data-testid="auction-action-reason" />
            </div>

            {feedback && (
              <div className={`text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 ${feedback.isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                {feedback.isError ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{feedback.message}
              </div>
            )}

            <div className="space-y-2">
              <Button className="w-full" size="sm" variant="secondary" disabled={loading || !isActive}
                data-testid="close-auction-btn" onClick={() => doAction("AUCTION_CLOSED")}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : "Close Auction"}
              </Button>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Label className="text-xs text-slate-500">Extend by (hours)</Label>
                  <Input type="number" value={extendHours} onChange={e => setExtendHours(e.target.value)}
                    className="h-7 text-xs w-20" min="1" max="72" data-testid="extend-hours-input" />
                </div>
                <Button className="w-full" size="sm" variant="secondary" disabled={loading || !isActive}
                  data-testid="extend-auction-btn" onClick={() => doAction("AUCTION_EXTENDED", { hours: parseInt(extendHours) })}>
                  Extend Deadline
                </Button>
              </div>

              <Button className="w-full" size="sm" variant="destructive" disabled={loading}
                data-testid="auction-refund-btn" onClick={() => doAction("AUCTION_REFUND_TRIGGERED")}>
                Trigger Refund (No Offers)
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
