"use client";

import { useState, useEffect } from "react";
import {
  CreditCard, Link2, RotateCcw, CheckCircle2,
  DollarSign, Users, AlertCircle, Search, X, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Elements, PaymentElement, useStripe, useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type {
  DepositRow, ConciergeFeeRow,
} from "@/lib/services/admin/admin-payments.service";

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = STRIPE_PK && !STRIPE_PK.includes("placeholder")
  ? loadStripe(STRIPE_PK) : null;

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "deposits" | "fees" | "affiliates" | "refunds";

interface CommissionRow {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  amountCents: number;
  level: number;
  status: string;
  dealId: string;
  paidAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  createdAt: string;
}

interface BuyerResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  activeDealId: string | null;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    PAID:     "bg-green-100 text-green-700 border-green-200",
    PENDING:  "bg-amber-100 text-amber-700 border-amber-200",
    REFUNDED: "bg-red-100 text-red-700 border-red-200",
    FAILED:   "bg-red-100 text-red-700 border-red-200",
    APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
    REVERSED: "bg-slate-100 text-slate-600 border-slate-200",
    REJECTED: "bg-red-100 text-red-700 border-red-200",
    WAIVED:   "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide ${s[status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {status}
    </span>
  );
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function StatsRow({ stats }: { stats: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {stats.map(s => (
        <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-400 mb-1">{s.label}</p>
          <p className={`text-lg font-bold ${s.color ?? "text-slate-800"}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Search + Filter Bar ──────────────────────────────────────────────────────

function SearchBar({
  value, onChange, placeholder, filterValue, filterOptions, onFilterChange,
}: {
  value: string; onChange: (v: string) => void; placeholder: string;
  filterValue: string; filterOptions: string[]; onFilterChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2 mb-4">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-al-primary/20" />
      </div>
      <select value={filterValue} onChange={e => onFilterChange(e.target.value)}
        className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-al-primary/20">
        {filterOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── Action Button ────────────────────────────────────────────────────────────

function ActionBtn({
  icon: Icon, label, onClick, variant = "default", disabled,
}: {
  icon: React.ElementType; label: string; onClick: () => void;
  variant?: "default" | "danger" | "success" | "outline"; disabled?: boolean;
}) {
  const styles = {
    default: "bg-al-primary text-white hover:bg-[#0944a8]",
    danger:  "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
    success: "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100",
    outline: "border border-slate-200 text-slate-700 hover:bg-slate-50",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${styles[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}>
      <Icon size={12} />{label}
    </button>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function Modal({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-lg text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-4">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Shared UI Atoms ──────────────────────────────────────────────────────────

function SuccessState({ message }: { message: string }) {
  return (
    <div className="text-center py-4">
      <div className="w-14 h-14 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto mb-3">
        <CheckCircle2 size={24} className="text-[#059669]" />
      </div>
      <p className="text-sm text-slate-700">{message}</p>
    </div>
  );
}

function ErrorMsg({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
      <AlertCircle size={12} />{text}
    </div>
  );
}

function InfoBox({ text }: { text: string }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
      {text}
    </div>
  );
}

// ─── Buyer Search Input ───────────────────────────────────────────────────────

function BuyerSearchInput({
  search, onSearchChange, results, selected, onSelect, onClear, loading,
}: {
  search: string; onSearchChange: (v: string) => void;
  results: BuyerResult[]; selected: BuyerResult | null;
  onSelect: (b: BuyerResult) => void; onClear: () => void;
  loading: boolean;
}) {
  return (
    <div>
      <Label>Search Buyer *</Label>
      {selected ? (
        <div className="mt-1.5 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          <span className="text-sm text-green-800 font-medium flex-1">
            {[selected.firstName, selected.lastName].filter(Boolean).join(" ") || selected.email} · {selected.email}
          </span>
          <button onClick={onClear} className="text-green-600 hover:text-green-800"><X size={14} /></button>
        </div>
      ) : (
        <div className="relative mt-1.5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search buyer by name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-al-primary/20"
          />
          {loading && (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
          )}
          {results.length > 0 && (
            <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {results.map(b => (
                <button key={b.id} onClick={() => onSelect(b)}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <p className="text-sm font-medium text-slate-800">
                    {[b.firstName, b.lastName].filter(Boolean).join(" ") || "(no name)"}
                  </p>
                  <p className="text-xs text-slate-500">{b.email}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stripe Card Form ─────────────────────────────────────────────────────────

function CardForm({ onSuccess, onError, submitLabel }: {
  onSuccess: () => void; onError: (m: string) => void; submitLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);
    const { error: stripeErr } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/admin/payments` },
      redirect: "if_required",
    });
    if (stripeErr) {
      const msg = stripeErr.message ?? "Payment failed";
      setError(msg);
      onError(msg);
    } else {
      onSuccess();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <ErrorMsg text={error} />}
      <Button type="submit" disabled={!stripe || loading} className="w-full">
        {loading ? <><Loader2 size={14} className="animate-spin mr-1" /> Processing…</> : submitLabel}
      </Button>
    </form>
  );
}

function StripeCardEntry({ clientSecret, onSuccess, onError, submitLabel }: {
  clientSecret: string; onSuccess: () => void;
  onError: (m: string) => void; submitLabel: string;
}) {
  if (!stripePromise) return <ErrorMsg text="Stripe is not configured." />;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardForm onSuccess={onSuccess} onError={onError} submitLabel={submitLabel} />
    </Elements>
  );
}

// ─── Deposits Tab ─────────────────────────────────────────────────────────────

type DepositModal =
  | { type: "charge"; depositId: string; buyerId: string; buyerName: string }
  | { type: "link"; depositId: string; buyerId: string; buyerName: string; buyerEmail: string }
  | { type: "refund"; depositId: string; buyerName: string; amountCents: number }
  | { type: "new_charge_deposit" }
  | { type: "new_link_deposit" };

function DepositsTab({ deposits }: { deposits: DepositRow[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [modal, setModal] = useState<DepositModal | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerResults, setBuyerResults] = useState<BuyerResult[]>([]);
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerResult | null>(null);
  const [buyerSearchLoading, setBuyerSearchLoading] = useState(false);

  const filtered = deposits.filter(d =>
    (filter === "ALL" || d.status === filter) &&
    (!search || d.buyerName.toLowerCase().includes(search.toLowerCase()) ||
     d.buyerEmail.toLowerCase().includes(search.toLowerCase()))
  );

  const paidTotal = deposits.filter(d => d.status === "PAID").reduce((s, d) => s + d.amountCents, 0);

  useEffect(() => {
    if (buyerSearch.trim().length < 2) { setBuyerResults([]); return; }
    setBuyerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/buyers?q=${encodeURIComponent(buyerSearch)}&perPage=5`);
        const data = await res.json() as { data?: { buyers?: BuyerResult[] } };
        setBuyerResults(data.data?.buyers ?? []);
      } catch { /* ignore */ }
      finally { setBuyerSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [buyerSearch]);

  function resetModal() {
    setModal(null); setLoading(false); setSuccess(false);
    setError(null); setReason(""); setClientSecret(null);
    setBuyerSearch(""); setBuyerResults([]); setSelectedBuyer(null);
  }

  async function handleAction(url: string, body: object) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { success: boolean; data?: { clientSecret?: string }; error?: { message: string } };
      if (!data.success) { setError(data.error?.message ?? "Action failed"); return null; }
      return data;
    } catch { setError("Network error"); return null; }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setModal({ type: "new_charge_deposit" })}
          className="inline-flex items-center gap-2 bg-al-primary text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#0944a8] transition-colors"
          data-testid="deposit-charge-card-btn">
          <CreditCard size={15} /> Charge Card — $99 Deposit
        </button>
        <button
          onClick={() => setModal({ type: "new_link_deposit" })}
          className="inline-flex items-center gap-2 border border-al-primary text-al-primary text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-al-primary/5 transition-colors"
          data-testid="deposit-send-link-btn">
          <Link2 size={15} /> Send Payment Link
        </button>
      </div>

      <StatsRow stats={[
        { label: "Total Collected", value: `$${paidTotal / 100}`, color: "text-green-700" },
        { label: "Paid",    value: String(deposits.filter(d => d.status === "PAID").length),    color: "text-green-700" },
        { label: "Pending", value: String(deposits.filter(d => d.status === "PENDING").length), color: "text-amber-700" },
        { label: "Refunded",value: String(deposits.filter(d => d.status === "REFUNDED").length),color: "text-red-700" },
      ]} />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name or email…"
        filterValue={filter} onFilterChange={setFilter}
        filterOptions={["ALL","PENDING","PAID","REFUNDED","FAILED"]} />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_2fr_80px_100px_1fr_auto] gap-4 px-5 py-3 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>Buyer</span><span>Email</span><span>Amount</span><span>Status</span><span>Date</span><span>Actions</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No deposits match this filter.</div>
        ) : filtered.map((d, i) => (
          <div key={d.depositId}
            className={`grid md:grid-cols-[2fr_2fr_80px_100px_1fr_auto] gap-4 px-5 py-4 items-center ${i < filtered.length - 1 ? "border-b border-slate-50" : ""} hover:bg-slate-50/40`}>
            <span className="text-sm font-semibold text-slate-800">{d.buyerName}</span>
            <span className="text-xs text-slate-500 truncate">{d.buyerEmail}</span>
            <span className="text-sm font-bold">${d.amountCents / 100}</span>
            <StatusBadge status={d.status} />
            <span className="text-xs text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</span>
            <div className="flex gap-1.5 flex-wrap">
              {(d.status === "PENDING" || d.status === "FAILED") && (
                <>
                  <ActionBtn icon={CreditCard} label="Charge Card"
                    onClick={() => setModal({ type: "charge", depositId: d.depositId, buyerId: d.buyerId, buyerName: d.buyerName })} />
                  <ActionBtn icon={Link2} label="Send Link" variant="outline"
                    onClick={() => setModal({ type: "link", depositId: d.depositId, buyerId: d.buyerId, buyerName: d.buyerName, buyerEmail: d.buyerEmail })} />
                </>
              )}
              {d.status === "PAID" && (
                <ActionBtn icon={RotateCcw} label="Refund" variant="danger"
                  onClick={() => setModal({ type: "refund", depositId: d.depositId, buyerName: d.buyerName, amountCents: d.amountCents })} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charge Card Modal */}
      {modal?.type === "charge" && (
        <Modal title="Charge Card — $99 Auction Access Deposit" subtitle={`Buyer: ${modal.buyerName}`} onClose={resetModal}>
          {success ? <SuccessState message="Payment processed successfully." /> :
           clientSecret ? (
            <StripeCardEntry clientSecret={clientSecret}
              onSuccess={() => setSuccess(true)} onError={setError}
              submitLabel="Charge $99 Auction Access Deposit" />
           ) : (
            <div className="space-y-4">
              <InfoBox text="Creates a Stripe payment intent for $99. You will enter the buyer's card details on the next screen." />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer called in, requested phone payment…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/deposit/create-intent",
                    { buyerId: modal.buyerId, reason });
                  if (data?.data?.clientSecret) setClientSecret(data.data.clientSecret);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Creating…</> : "Continue to Card Entry →"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Send Link Modal */}
      {modal?.type === "link" && (
        <Modal title="Send Payment Link — $99 Deposit" subtitle={`To: ${modal.buyerEmail}`} onClose={resetModal}>
          {success ? <SuccessState message={`Payment link sent to ${modal.buyerEmail}.`} /> : (
            <div className="space-y-4">
              <InfoBox text={`A secure Stripe checkout link will be emailed to ${modal.buyerEmail}. Amount is fixed at $99.`} />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer requested payment link via email…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/deposit/send-link",
                    { buyerId: modal.buyerId, reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Sending…</> : `Send Link to ${modal.buyerEmail}`}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Refund Modal */}
      {modal?.type === "refund" && (
        <Modal title="Refund Deposit" subtitle={`${modal.buyerName} · $${modal.amountCents / 100}`} onClose={resetModal}>
          {success ? <SuccessState message="Refund processed. Buyer will receive confirmation email. Allow 5–10 business days." /> : (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                ⚠️ This issues a full $99 refund through Stripe. This action is logged and cannot be undone.
              </div>
              <div><Label>Refund Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer no longer proceeding…" rows={3} className="mt-1.5" />
              </div>
              <Button variant="outline" disabled={loading || reason.trim().length < 10}
                className="w-full border-red-200 text-red-700 hover:bg-red-50"
                onClick={async () => {
                  const data = await handleAction(
                    `/api/admin/payments/deposit/${modal.depositId}/refund`, { reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Processing…</> : "Confirm Refund — $99"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* New Charge Deposit Modal */}
      {modal?.type === "new_charge_deposit" && (
        <Modal title="Charge Card — $99 Auction Access Deposit" onClose={resetModal}>
          {success ? <SuccessState message="Payment processed successfully." /> :
           clientSecret ? (
            <StripeCardEntry clientSecret={clientSecret}
              onSuccess={() => setSuccess(true)} onError={setError}
              submitLabel="Charge $99 Auction Access Deposit" />
           ) : (
            <div className="space-y-4">
              <BuyerSearchInput
                search={buyerSearch} onSearchChange={setBuyerSearch}
                results={buyerResults} selected={selectedBuyer}
                onSelect={b => { setSelectedBuyer(b); setBuyerResults([]); setBuyerSearch(""); }}
                onClear={() => setSelectedBuyer(null)} loading={buyerSearchLoading} />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer called in, ready to proceed" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim() || !selectedBuyer} className="w-full"
                onClick={async () => {
                  if (!selectedBuyer) return;
                  const data = await handleAction("/api/admin/payments/deposit/create-intent",
                    { buyerId: selectedBuyer.id, reason });
                  if (data?.data?.clientSecret) setClientSecret(data.data.clientSecret);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Creating…</> : "Create Payment Intent →"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* New Send Link Deposit Modal */}
      {modal?.type === "new_link_deposit" && (
        <Modal title="Send $99 Deposit Payment Link" onClose={resetModal}>
          {success ? (
            <SuccessState message={`Link sent to ${selectedBuyer?.email ?? "buyer"}. Buyer can pay at their convenience.`} />
          ) : (
            <div className="space-y-4">
              <BuyerSearchInput
                search={buyerSearch} onSearchChange={setBuyerSearch}
                results={buyerResults} selected={selectedBuyer}
                onSelect={b => { setSelectedBuyer(b); setBuyerResults([]); setBuyerSearch(""); }}
                onClear={() => setSelectedBuyer(null)} loading={buyerSearchLoading} />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer requested payment link via email" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim() || !selectedBuyer} className="w-full"
                onClick={async () => {
                  if (!selectedBuyer) return;
                  const data = await handleAction("/api/admin/payments/deposit/send-link",
                    { buyerId: selectedBuyer.id, reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Sending…</> : "Send Payment Link"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Service Fees Tab ─────────────────────────────────────────────────────────

type FeeModal =
  | { type: "charge"; dealId: string; buyerId: string; buyerName: string }
  | { type: "link"; dealId: string; buyerName: string; buyerEmail: string }
  | { type: "refund"; dealId: string; buyerName: string }
  | { type: "new_charge_fee" }
  | { type: "new_link_fee" };

function ServiceFeesTab({ conciergeFees }: { conciergeFees: ConciergeFeeRow[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [modal, setModal] = useState<FeeModal | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerResults, setBuyerResults] = useState<BuyerResult[]>([]);
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerResult | null>(null);
  const [buyerSearchLoading, setBuyerSearchLoading] = useState(false);
  const [dealIdInput, setDealIdInput] = useState("");

  const filtered = conciergeFees.filter(f =>
    (filter === "ALL" || f.feeStatus === filter) &&
    (!search || f.buyerName.toLowerCase().includes(search.toLowerCase()) ||
     f.buyerEmail.toLowerCase().includes(search.toLowerCase()))
  );

  const paidTotal = conciergeFees.filter(f => f.feeStatus === "PAID")
    .reduce((s, f) => s + f.amountCents, 0);

  useEffect(() => {
    if (buyerSearch.trim().length < 2) { setBuyerResults([]); return; }
    setBuyerSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/buyers?q=${encodeURIComponent(buyerSearch)}&perPage=5`);
        const data = await res.json() as { data?: { buyers?: BuyerResult[] } };
        setBuyerResults(data.data?.buyers ?? []);
      } catch { /* ignore */ }
      finally { setBuyerSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [buyerSearch]);

  function resetModal() {
    setModal(null); setLoading(false); setSuccess(false);
    setError(null); setReason(""); setClientSecret(null);
    setBuyerSearch(""); setBuyerResults([]); setSelectedBuyer(null); setDealIdInput("");
  }

  async function handleAction(url: string, body: object) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { success: boolean; data?: { clientSecret?: string }; error?: { message: string } };
      if (!data.success) { setError(data.error?.message ?? "Failed"); return null; }
      return data;
    } catch { setError("Network error"); return null; }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setModal({ type: "new_charge_fee" })}
          className="inline-flex items-center gap-2 bg-al-primary text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#0944a8] transition-colors"
          data-testid="fee-charge-card-btn">
          <CreditCard size={15} /> Charge Card — $400 Service Fee
        </button>
        <button
          onClick={() => setModal({ type: "new_link_fee" })}
          className="inline-flex items-center gap-2 border border-al-primary text-al-primary text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-al-primary/5 transition-colors"
          data-testid="fee-send-link-btn">
          <Link2 size={15} /> Send Payment Link
        </button>
      </div>

      <StatsRow stats={[
        { label: "Total Collected", value: `$${paidTotal / 100}`, color: "text-green-700" },
        { label: "Paid",    value: String(conciergeFees.filter(f => f.feeStatus === "PAID").length),    color: "text-green-700" },
        { label: "Pending", value: String(conciergeFees.filter(f => f.feeStatus === "PENDING").length), color: "text-amber-700" },
        { label: "Refunded",value: String(conciergeFees.filter(f => f.feeStatus === "REFUNDED").length),color: "text-red-700" },
      ]} />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by name or email…"
        filterValue={filter} onFilterChange={setFilter}
        filterOptions={["ALL","PENDING","PAID","REFUNDED"]} />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_2fr_80px_100px_1fr_auto] gap-4 px-5 py-3 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>Buyer</span><span>Email</span><span>Amount</span><span>Status</span><span>Date</span><span>Actions</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No service fees match this filter.</div>
        ) : filtered.map((f, i) => (
          <div key={f.dealId}
            className={`grid md:grid-cols-[2fr_2fr_80px_100px_1fr_auto] gap-4 px-5 py-4 items-center ${i < filtered.length - 1 ? "border-b border-slate-50" : ""} hover:bg-slate-50/40`}>
            <span className="text-sm font-semibold text-slate-800">{f.buyerName}</span>
            <span className="text-xs text-slate-500 truncate">{f.buyerEmail}</span>
            <span className="text-sm font-bold">${f.amountCents / 100}</span>
            <StatusBadge status={f.feeStatus} />
            <span className="text-xs text-slate-400">{new Date(f.createdAt).toLocaleDateString()}</span>
            <div className="flex gap-1.5 flex-wrap">
              {f.feeStatus === "PENDING" && (
                <>
                  <ActionBtn icon={CreditCard} label="Charge Card"
                    onClick={() => setModal({ type: "charge", dealId: f.dealId, buyerId: f.buyerId, buyerName: f.buyerName })} />
                  <ActionBtn icon={Link2} label="Send Link" variant="outline"
                    onClick={() => setModal({ type: "link", dealId: f.dealId, buyerName: f.buyerName, buyerEmail: f.buyerEmail })} />
                </>
              )}
              {f.feeStatus === "PAID" && (
                <ActionBtn icon={RotateCcw} label="Refund" variant="danger"
                  onClick={() => setModal({ type: "refund", dealId: f.dealId, buyerName: f.buyerName })} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charge Card Modal */}
      {modal?.type === "charge" && (
        <Modal title="Charge Card — $400 Service Fee" subtitle={`Buyer: ${modal.buyerName}`} onClose={resetModal}>
          {success ? <SuccessState message="Service fee payment processed successfully." /> :
           clientSecret ? (
            <StripeCardEntry clientSecret={clientSecret}
              onSuccess={() => setSuccess(true)} onError={setError}
              submitLabel="Charge $400 AutoLenis Service Fee" />
           ) : (
            <div className="space-y-4">
              <InfoBox text="Creates a Stripe payment intent for the $400 AutoLenis Service Fee ($499 total minus $99 deposit credit)." />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer called in, ready to proceed…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/concierge-fee/create-intent",
                    { dealId: modal.dealId, reason });
                  if (data?.data?.clientSecret) setClientSecret(data.data.clientSecret);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Creating…</> : "Continue to Card Entry →"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Send Link Modal */}
      {modal?.type === "link" && (
        <Modal title="Send Service Fee Payment Link" subtitle={`To: ${modal.buyerEmail}`} onClose={resetModal}>
          {success ? <SuccessState message={`Payment link sent to ${modal.buyerEmail}.`} /> : (
            <div className="space-y-4">
              <InfoBox text="Sends a secure Stripe checkout link for the $400 AutoLenis Service Fee." />
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer ready to proceed, requested payment link…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/concierge-fee/send-link",
                    { dealId: modal.dealId, reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Sending…</> : `Send Link to ${modal.buyerEmail}`}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Refund Modal */}
      {modal?.type === "refund" && (
        <Modal title="Refund Service Fee" subtitle={`${modal.buyerName}`} onClose={resetModal}>
          {success ? <SuccessState message="Refund processed. Buyer will receive a confirmation email." /> : (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                ⚠️ This issues a full $400 refund through Stripe. This is logged and cannot be undone.
              </div>
              <div><Label>Refund Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Deal fell through, buyer withdrew…" rows={3} className="mt-1.5" />
              </div>
              <Button variant="outline" disabled={loading || reason.trim().length < 10}
                className="w-full border-red-200 text-red-700 hover:bg-red-50"
                onClick={async () => {
                  const data = await handleAction(
                    `/api/admin/payments/concierge-fee/${modal.dealId}/refund`, { reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Processing…</> : "Confirm Refund — $400"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* New Charge Fee Modal */}
      {modal?.type === "new_charge_fee" && (
        <Modal title="Charge Card — $400 AutoLenis Service Fee" onClose={resetModal}>
          {success ? <SuccessState message="Service fee payment processed successfully." /> :
           clientSecret ? (
            <StripeCardEntry clientSecret={clientSecret}
              onSuccess={() => setSuccess(true)} onError={setError}
              submitLabel="Charge $400 AutoLenis Service Fee" />
           ) : (
            <div className="space-y-4">
              <BuyerSearchInput
                search={buyerSearch} onSearchChange={setBuyerSearch}
                results={buyerResults} selected={selectedBuyer}
                onSelect={b => { setSelectedBuyer(b); setBuyerResults([]); setBuyerSearch(""); setDealIdInput(b.activeDealId ?? ""); }}
                onClear={() => { setSelectedBuyer(null); setDealIdInput(""); }} loading={buyerSearchLoading} />
              <div>
                <Label>Deal ID {selectedBuyer?.activeDealId ? "(pre-filled from active deal)" : "(optional)"}</Label>
                <input value={dealIdInput} onChange={e => setDealIdInput(e.target.value)}
                  placeholder="Paste deal ID or leave blank"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-al-primary/20" />
                {selectedBuyer && !selectedBuyer.activeDealId && (
                  <p className="text-xs text-slate-400 mt-1">No active deal found — enter manually if known.</p>
                )}
              </div>
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer called in, ready to proceed" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim() || !dealIdInput.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/concierge-fee/create-intent",
                    { dealId: dealIdInput.trim(), reason });
                  if (data?.data?.clientSecret) setClientSecret(data.data.clientSecret);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Creating…</> : "Create Payment Intent →"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* New Send Fee Link Modal */}
      {modal?.type === "new_link_fee" && (
        <Modal title="Send $400 Service Fee Payment Link" onClose={resetModal}>
          {success ? (
            <SuccessState message={`Link sent to ${selectedBuyer?.email ?? "buyer"}. Buyer can pay at their convenience.`} />
          ) : (
            <div className="space-y-4">
              <BuyerSearchInput
                search={buyerSearch} onSearchChange={setBuyerSearch}
                results={buyerResults} selected={selectedBuyer}
                onSelect={b => { setSelectedBuyer(b); setBuyerResults([]); setBuyerSearch(""); setDealIdInput(b.activeDealId ?? ""); }}
                onClear={() => { setSelectedBuyer(null); setDealIdInput(""); }} loading={buyerSearchLoading} />
              <div>
                <Label>Deal ID {selectedBuyer?.activeDealId ? "(pre-filled from active deal)" : "(optional)"}</Label>
                <input value={dealIdInput} onChange={e => setDealIdInput(e.target.value)}
                  placeholder="Paste deal ID or leave blank"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-al-primary/20" />
                {selectedBuyer && !selectedBuyer.activeDealId && (
                  <p className="text-xs text-slate-400 mt-1">No active deal found — enter manually if known.</p>
                )}
              </div>
              <div><Label>Reason *</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Buyer ready to proceed, requested payment link" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !reason.trim() || !dealIdInput.trim()} className="w-full"
                onClick={async () => {
                  const data = await handleAction("/api/admin/payments/concierge-fee/send-link",
                    { dealId: dealIdInput.trim(), reason });
                  if (data) setSuccess(true);
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Sending…</> : "Send Payment Link"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Affiliate Payouts Tab ────────────────────────────────────────────────────

type CommissionModal =
  | { type: "approve"; commissionId: string; affiliateName: string; amountCents: number }
  | { type: "reject";  commissionId: string; affiliateName: string; amountCents: number }
  | { type: "paid";    commissionId: string; affiliateName: string; amountCents: number };

function AffiliatePayoutsTab() {
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [modal, setModal] = useState<CommissionModal | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");

  useEffect(() => {
    fetch("/api/admin/payments/commissions")
      .then(r => r.json())
      .then((d: { data?: { commissions?: CommissionRow[] } }) => {
        setCommissions(d.data?.commissions ?? []);
        setLoadingData(false);
      })
      .catch(() => setLoadingData(false));
  }, []);

  const filtered = commissions.filter(c =>
    (filter === "ALL" || c.status === filter) &&
    (!search || c.affiliateName.toLowerCase().includes(search.toLowerCase()) ||
     c.affiliateEmail.toLowerCase().includes(search.toLowerCase()))
  );

  function resetModal() {
    setModal(null); setLoading(false); setSuccess(false);
    setError(null); setReason(""); setPayMethod(""); setPayRef(""); setPayNote("");
  }

  function refreshRow(id: string, updates: Partial<CommissionRow>) {
    setCommissions(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }

  async function handleAction(url: string, body: object) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { success: boolean; error?: { message: string } };
      if (!data.success) { setError(data.error?.message ?? "Action failed"); return false; }
      return true;
    } catch { setError("Network error"); return false; }
    finally { setLoading(false); }
  }

  const pendingCents = commissions.filter(c => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);
  const approvedCents = commissions.filter(c => c.status === "APPROVED").reduce((s, c) => s + c.amountCents, 0);
  const paidCents = commissions.filter(c => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0);

  return (
    <div>
      <StatsRow stats={[
        { label: "Pending Review",    value: `$${pendingCents / 100}`,  color: "text-amber-700" },
        { label: "Approved / Ready",  value: `$${approvedCents / 100}`, color: "text-blue-700" },
        { label: "Total Paid Out",    value: `$${paidCents / 100}`,     color: "text-green-700" },
        { label: "Total Commissions", value: String(commissions.length) },
      ]} />

      <SearchBar value={search} onChange={setSearch} placeholder="Search by affiliate name or email…"
        filterValue={filter} onFilterChange={setFilter}
        filterOptions={["ALL","PENDING","APPROVED","PAID","REVERSED","REJECTED"]} />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_2fr_80px_60px_100px_1fr_auto] gap-3 px-5 py-3 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>Affiliate</span><span>Email</span><span>Amount</span><span>Level</span>
          <span>Status</span><span>Date</span><span>Actions</span>
        </div>

        {loadingData ? (
          <div className="py-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading commissions…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No commissions match this filter.</div>
        ) : filtered.map((c, i) => (
          <div key={c.id}
            className={`grid md:grid-cols-[2fr_2fr_80px_60px_100px_1fr_auto] gap-3 px-5 py-4 items-center ${i < filtered.length - 1 ? "border-b border-slate-50" : ""} hover:bg-slate-50/40`}>
            <span className="text-sm font-semibold text-slate-800">{c.affiliateName}</span>
            <span className="text-xs text-slate-500 truncate">{c.affiliateEmail}</span>
            <span className="text-sm font-bold">${c.amountCents / 100}</span>
            <span className="text-xs text-slate-500">L{c.level}</span>
            <StatusBadge status={c.status} />
            <div>
              <p className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</p>
              {c.status === "PAID" && c.paymentMethod && (
                <p className="text-[10px] text-slate-400 mt-0.5">{c.paymentMethod} · {c.paymentReference}</p>
              )}
              {c.status === "REJECTED" && c.rejectedReason && (
                <p className="text-[10px] text-red-400 mt-0.5">{c.rejectedReason}</p>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {c.status === "PENDING" && (
                <>
                  <ActionBtn icon={CheckCircle2} label="Approve" variant="success"
                    onClick={() => setModal({ type: "approve", commissionId: c.id, affiliateName: c.affiliateName, amountCents: c.amountCents })} />
                  <ActionBtn icon={X} label="Reject" variant="danger"
                    onClick={() => setModal({ type: "reject", commissionId: c.id, affiliateName: c.affiliateName, amountCents: c.amountCents })} />
                </>
              )}
              {c.status === "APPROVED" && (
                <ActionBtn icon={DollarSign} label="Mark as Paid"
                  onClick={() => setModal({ type: "paid", commissionId: c.id, affiliateName: c.affiliateName, amountCents: c.amountCents })} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Approve Modal */}
      {modal?.type === "approve" && (
        <Modal title="Approve Commission" subtitle={`${modal.affiliateName} · $${modal.amountCents / 100}`} onClose={resetModal}>
          {success ? <SuccessState message="Commission approved. Affiliate has been notified." /> : (
            <div className="space-y-4">
              <InfoBox text="Approving marks this commission as ready to pay. The affiliate will be notified." />
              <div><Label>Internal Note (optional)</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Optional note for audit trail…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading} className="w-full"
                onClick={async () => {
                  const ok = await handleAction(
                    `/api/admin/affiliates/commissions/${modal.commissionId}/approve`,
                    { note: reason || undefined });
                  if (ok) {
                    setSuccess(true);
                    refreshRow(modal.commissionId, { status: "APPROVED", approvedAt: new Date().toISOString() });
                  }
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Approving…</> : "✓ Approve Commission"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Reject Modal */}
      {modal?.type === "reject" && (
        <Modal title="Reject Commission" subtitle={`${modal.affiliateName} · $${modal.amountCents / 100}`} onClose={resetModal}>
          {success ? <SuccessState message="Commission rejected. Affiliate has been notified." /> : (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                ⚠️ This rejects the commission. The affiliate will be notified with your reason.
              </div>
              <div><Label>Rejection Reason * (min 10 characters)</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Explain why this commission is being rejected…" rows={3} className="mt-1.5" />
              </div>
              <Button variant="outline" disabled={loading || reason.trim().length < 10}
                className="w-full border-red-200 text-red-700 hover:bg-red-50"
                onClick={async () => {
                  const ok = await handleAction(
                    `/api/admin/affiliates/commissions/${modal.commissionId}/reject`,
                    { reason });
                  if (ok) {
                    setSuccess(true);
                    refreshRow(modal.commissionId, { status: "REJECTED", rejectedReason: reason });
                  }
                }}>
                {loading ? <><Loader2 size={14} className="animate-spin mr-1" />Rejecting…</> : "✗ Reject Commission"}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}

      {/* Mark as Paid Modal */}
      {modal?.type === "paid" && (
        <Modal title="Mark Commission as Paid" subtitle={`${modal.affiliateName} · $${modal.amountCents / 100}`} onClose={resetModal}>
          {success ? <SuccessState message="Commission marked as paid. Affiliate has been notified." /> : (
            <div className="space-y-4">
              <div>
                <Label>Payment Method *</Label>
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-al-primary/20">
                  <option value="">Select method</option>
                  {["ACH Transfer","Zelle","PayPal","Check","Venmo","Other"].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Reference / Transaction ID *</Label>
                <input value={payRef} onChange={e => setPayRef(e.target.value)}
                  placeholder="ACH trace #, check number, or transaction ID"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-al-primary/20" />
                <p className="text-xs text-slate-400 mt-1">Saved for audit trail — required.</p>
              </div>
              <div>
                <Label>Internal Note (optional)</Label>
                <Textarea value={payNote} onChange={e => setPayNote(e.target.value)}
                  placeholder="Any additional notes…" rows={2} className="mt-1.5" />
              </div>
              <Button disabled={loading || !payMethod || !payRef.trim()} className="w-full"
                onClick={async () => {
                  const ok = await handleAction(
                    `/api/admin/affiliates/commissions/${modal.commissionId}/mark-paid`,
                    { paymentMethod: payMethod, paymentReference: payRef, note: payNote || undefined });
                  if (ok) {
                    setSuccess(true);
                    refreshRow(modal.commissionId, {
                      status: "PAID", paidAt: new Date().toISOString(),
                      paymentMethod: payMethod, paymentReference: payRef,
                    });
                  }
                }}>
                {loading
                  ? <><Loader2 size={14} className="animate-spin mr-1" />Processing…</>
                  : `Confirm — $${modal.amountCents / 100} Paid via ${payMethod || "…"}`}
              </Button>
              {error && <ErrorMsg text={error} />}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Refunds Tab ──────────────────────────────────────────────────────────────

function RefundsTab({ deposits, conciergeFees }: {
  deposits: DepositRow[]; conciergeFees: ConciergeFeeRow[];
}) {
  const refundedDeposits = deposits.filter(d => d.status === "REFUNDED").map(d => ({
    id: d.depositId, type: "Deposit" as const, buyerName: d.buyerName,
    buyerEmail: d.buyerEmail, amountCents: d.amountCents,
    refundedAt: d.refundedAt ?? null,
    reason: null as string | null,
    stripeId: null as string | null,
  }));

  const refundedFees = conciergeFees.filter(f => f.feeStatus === "REFUNDED").map(f => ({
    id: f.dealId, type: "Service Fee" as const, buyerName: f.buyerName,
    buyerEmail: f.buyerEmail, amountCents: f.amountCents,
    refundedAt: null as string | null,
    reason: null as string | null,
    stripeId: null as string | null,
  }));

  const all = [...refundedDeposits, ...refundedFees]
    .sort((a, b) => new Date(b.refundedAt ?? 0).getTime() - new Date(a.refundedAt ?? 0).getTime());

  const totalCents = all.reduce((s, r) => s + r.amountCents, 0);

  return (
    <div>
      <StatsRow stats={[
        { label: "Total Refunds", value: String(all.length) },
        { label: "Total Refunded", value: `$${totalCents / 100}`, color: "text-red-700" },
        { label: "Deposit Refunds", value: String(refundedDeposits.length) },
        { label: "Fee Refunds", value: String(refundedFees.length) },
      ]} />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_100px_100px_1fr_2fr_1.5fr] gap-4 px-5 py-3 bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>Buyer</span><span>Type</span><span>Amount</span>
          <span>Date</span><span>Reason</span><span>Stripe Refund ID</span>
        </div>
        {all.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No refunds processed yet.</div>
        ) : all.map((r, i) => (
          <div key={r.id}
            className={`grid md:grid-cols-[2fr_100px_100px_1fr_2fr_1.5fr] gap-4 px-5 py-4 items-start text-sm ${i < all.length - 1 ? "border-b border-slate-50" : ""}`}>
            <div>
              <p className="font-semibold text-slate-800">{r.buyerName}</p>
              <p className="text-xs text-slate-400">{r.buyerEmail}</p>
            </div>
            <span className={`text-xs font-semibold ${r.type === "Deposit" ? "text-blue-600" : "text-purple-600"}`}>
              {r.type}
            </span>
            <span className="font-bold text-red-600">-${r.amountCents / 100}</span>
            <span className="text-xs text-slate-400">
              {r.refundedAt ? new Date(r.refundedAt).toLocaleDateString() : "—"}
            </span>
            <span className="text-xs text-slate-600">{r.reason ?? "—"}</span>
            <span className="text-[10px] font-mono text-slate-400 truncate">{r.stripeId ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function AdminPaymentsClient({
  deposits, conciergeFees,
}: { deposits: DepositRow[]; conciergeFees: ConciergeFeeRow[] }) {
  const [tab, setTab] = useState<Tab>("deposits");

  const TABS = [
    { id: "deposits"   as Tab, label: `Deposits (${deposits.length})`,        icon: DollarSign },
    { id: "fees"       as Tab, label: `Service Fees (${conciergeFees.length})`,icon: CreditCard },
    { id: "affiliates" as Tab, label: "Affiliate Payouts",                     icon: Users },
    { id: "refunds"    as Tab, label: "Refunds",                               icon: RotateCcw },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-al-primary text-al-primary"
                : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {tab === "deposits"   && <DepositsTab deposits={deposits} />}
      {tab === "fees"       && <ServiceFeesTab conciergeFees={conciergeFees} />}
      {tab === "affiliates" && <AffiliatePayoutsTab />}
      {tab === "refunds"    && <RefundsTab deposits={deposits} conciergeFees={conciergeFees} />}
    </div>
  );
}
