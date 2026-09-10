"use client";

// Stage 4 elections — the surface behind ELECTIONS_REQUIRED (§4c, §5a, §6.2; Phase 4).
//
// WHY IT LIVES ON THE REQUEST DETAIL PAGE. `deposit-eligibility.ts` refuses a deposit until
// both elections are recorded, and `ELIGIBILITY_STEP` sends that buyer to `/buyer/requests`.
// A refusal that names a destination with no control on it is a dead end — the exact failure
// the eligibility map's own header warns about. This is that control.
//
// THREE THINGS THE UI HAS TO GET RIGHT, because the data model is three-state:
//
//   1. "Not answered yet" is visually distinct from "No". They are different states in the
//      database and only one of them blocks checkout, so a card that rendered them the same
//      would leave a buyer unable to see why they are stuck.
//   2. Consent is a deliberate act, not a pre-ticked box. The co-buyer is a third party who
//      has not agreed to anything, and the trade packet goes to competing dealers.
//   3. The appraisal disclaimer is on the surface that COLLECTS the figures, not only the one
//      that displays them back. A buyer typing a payoff is already forming an expectation.
//
// Editing is the same control as creating: a trade packet is entered before the buyer has
// looked up their payoff or found the second key, and a capture-once form publishes figures
// to dealers that are wrong by the time they are read.

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Check, Loader2, Pencil, UserPlus, Car } from "lucide-react";

type Tri = boolean | null;

interface CoBuyer {
  legalFirstName: string | null;
  legalLastName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isRequiredSigner: boolean;
}

interface TradePacket {
  year: number; make: string; model: string; trim: string | null;
  mileage: number | null; condition: string;
  loanStatus: string | null; loanBalanceCents: number | null;
  hasSecondKey: boolean | null; titleInHand: boolean | null;
  disclaimer: string;
}

interface Props {
  requestId: string;
  /** Current elections from the server. `null` means the question has not been answered. */
  coBuyerElected: Tri;
  tradeElected: Tri;
  /** False once the request closes — the elections are then history, not choices. */
  editable: boolean;
}

const ROLES = ["SPOUSE", "PARTNER", "PARENT", "CHILD", "RELATIVE", "FRIEND", "CO_SIGNER", "OTHER"] as const;
const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const LOAN_STATUSES = [
  { value: "OWNED_OUTRIGHT", label: "Owned outright" },
  { value: "FINANCED", label: "Still financing it" },
  { value: "LEASED", label: "Leased" },
] as const;

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** One row of shared chrome so the two cards cannot drift apart. */
function ElectionCard({
  icon, title, question, answered, answer, children, testId,
}: {
  icon: React.ReactNode; title: string; question: string;
  answered: boolean; answer: Tri; children: React.ReactNode; testId: string;
}) {
  return (
    <section
      className="bg-white border border-slate-200 rounded-xl p-5 mb-4"
      data-testid={testId}
      aria-labelledby={`${testId}-heading`}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-al-primary" aria-hidden="true">{icon}</span>
          <h2 id={`${testId}-heading`} className="font-semibold text-slate-900 text-sm">{title}</h2>
        </div>
        {/* Status is never colour alone: each badge carries its own word. */}
        {answered ? (
          <Badge variant={answer ? "blue" : "gray"} data-testid={`${testId}-status`}>
            {answer ? "Yes" : "No"}
          </Badge>
        ) : (
          <Badge variant="amber" data-testid={`${testId}-status`}>Not answered</Badge>
        )}
      </div>
      <p className="text-sm text-slate-600 mb-4">{question}</p>
      {children}
    </section>
  );
}

function YesNo({
  value, disabled, onPick, testId,
}: { value: Tri; disabled: boolean; onPick: (v: boolean) => void; testId: string }) {
  return (
    <div className="flex gap-2 mb-3" role="group" aria-label="Yes or no">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          disabled={disabled}
          onClick={() => onPick(v)}
          aria-pressed={value === v}
          data-testid={`${testId}-${v ? "yes" : "no"}`}
          className={[
            "h-9 px-4 rounded-lg text-sm font-medium border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            value === v
              ? "border-al-primary bg-al-primary-subtle text-al-primary"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

function Text({
  id, label: lbl, value, onChange, type = "text", required, placeholder, disabled,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string; disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs text-slate-500 mb-1">
        {lbl}{required && <span className="text-al-danger" aria-hidden="true"> *</span>}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2
                   disabled:bg-slate-50"
      />
    </label>
  );
}

export default function RequestElectionsClient(props: Props) {
  const { requestId, editable } = props;

  const [coElected, setCoElected] = useState<Tri>(props.coBuyerElected);
  const [trElected, setTrElected] = useState<Tri>(props.tradeElected);
  const [coBuyer, setCoBuyer] = useState<CoBuyer | null>(null);
  const [packet, setPacket] = useState<TradePacket | null>(null);
  const [disclaimer, setDisclaimer] = useState<string>("");
  const [consentText, setConsentText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [coForm, setCoForm] = useState(false);
  const [trForm, setTrForm] = useState(false);
  const [busy, setBusy] = useState<"co" | "trade" | null>(null);
  const [error, setError] = useState<{ where: "co" | "trade"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cb, tr] = await Promise.all([
        fetch(`/api/buyer/requests/${requestId}/co-buyer`).then((r) => r.json()),
        fetch(`/api/buyer/requests/${requestId}/trade`).then((r) => r.json()),
      ]);
      setCoBuyer(cb?.data?.coBuyer ?? null);
      setConsentText(cb?.data?.consent?.text ?? "");
      setPacket(tr?.data?.packet ?? null);
      setDisclaimer(tr?.data?.disclaimer?.text ?? "");
    } catch {
      // A failed read is reported as a failure, never as "you have not answered" — that would
      // tell a buyer who HAS answered to answer again.
      setLoadError("We could not load your answers just now. Refresh and they will reappear.");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  async function put(where: "co" | "trade", body: Record<string, unknown>) {
    setBusy(where);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/requests/${requestId}/${where === "co" ? "co-buyer" : "trade"}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError({ where, message: json?.message ?? json?.error?.message ?? "That did not save." });
        return false;
      }
      if (where === "co") { setCoElected(json.data.elected); setCoBuyer(json.data.coBuyer); setCoForm(false); }
      else { setTrElected(json.data.elected); setPacket(json.data.packet); setTrForm(false); }
      return true;
    } catch {
      setError({ where, message: "We could not reach the server. Try again." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4" data-testid="elections-loading">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Loading your answers…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-white border border-al-danger/30 rounded-xl p-5 mb-4" role="alert" data-testid="elections-load-error">
        <p className="text-sm text-slate-800 font-medium mb-2">{loadError}</p>
        <Button size="sm" variant="secondary" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }

  const pending = coElected === null || trElected === null;

  return (
    <div data-testid="stage4-elections">
      {pending && (
        <div
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-800 flex gap-2"
          role="status"
          data-testid="elections-pending-banner"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Two quick questions before you can pay your deposit. Both change who signs and what
            your deal is worth — and <strong>&ldquo;no&rdquo; is a perfectly good answer.</strong>
          </p>
        </div>
      )}

      {/* ── Co-buyer ─────────────────────────────────────────────────────── */}
      <ElectionCard
        icon={<UserPlus size={16} />}
        title="Co-buyer"
        question="Will anyone else be on the loan or the title with you?"
        answered={coElected !== null}
        answer={coElected}
        testId="co-buyer-card"
      >
        {editable && <YesNo value={coElected} disabled={busy !== null} testId="co-buyer" onPick={(v) => {
          if (!v) { void put("co", { elected: false }); return; }
          setCoElected(true); setCoForm(true);
        }} />}

        {coElected === true && coBuyer && !coForm && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm" data-testid="co-buyer-summary">
            <p className="font-medium text-slate-900">
              {coBuyer.legalFirstName} {coBuyer.legalLastName}
              {coBuyer.role && <span className="text-slate-500 font-normal"> · {label(coBuyer.role)}</span>}
            </p>
            <p className="text-slate-600 text-xs mt-0.5">{coBuyer.email ?? coBuyer.phone}</p>
            {coBuyer.isRequiredSigner && (
              <p className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                <Check size={12} className="text-al-success" aria-hidden="true" /> Will need to sign the contract
              </p>
            )}
            {editable && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setCoForm(true)} data-testid="co-buyer-edit">
                <Pencil size={12} /> Edit
              </Button>
            )}
          </div>
        )}

        {coElected === true && coForm && editable && (
          <CoBuyerForm
            busy={busy === "co"}
            consentText={consentText}
            initial={coBuyer}
            onCancel={() => { setCoForm(false); if (!coBuyer) setCoElected(props.coBuyerElected); }}
            onSubmit={(v) => put("co", { elected: true, ...v })}
          />
        )}

        {error?.where === "co" && (
          <p className="text-sm text-al-danger mt-2" role="alert" data-testid="co-buyer-error">{error.message}</p>
        )}
      </ElectionCard>

      {/* ── Trade-in ─────────────────────────────────────────────────────── */}
      <ElectionCard
        icon={<Car size={16} />}
        title="Trade-in"
        question="Do you have a vehicle you want to trade in?"
        answered={trElected !== null}
        answer={trElected}
        testId="trade-card"
      >
        {editable && <YesNo value={trElected} disabled={busy !== null} testId="trade" onPick={(v) => {
          if (!v) { void put("trade", { elected: false }); return; }
          setTrElected(true); setTrForm(true);
        }} />}

        {trElected === true && packet && !trForm && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm" data-testid="trade-summary">
            <p className="font-medium text-slate-900">
              {packet.year} {packet.make} {packet.model}{packet.trim ? ` ${packet.trim}` : ""}
            </p>
            <p className="text-slate-600 text-xs mt-0.5">
              {[
                packet.mileage != null ? `${packet.mileage.toLocaleString()} mi` : null,
                label(packet.condition),
                packet.loanStatus ? LOAN_STATUSES.find((l) => l.value === packet.loanStatus)?.label : null,
                packet.loanBalanceCents != null ? `$${(packet.loanBalanceCents / 100).toLocaleString()} owed` : null,
              ].filter(Boolean).join(" · ")}
            </p>
            {editable && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTrForm(true)} data-testid="trade-edit">
                <Pencil size={12} /> Update these details
              </Button>
            )}
          </div>
        )}

        {trElected === true && trForm && editable && (
          <TradeForm
            busy={busy === "trade"}
            initial={packet}
            onCancel={() => { setTrForm(false); if (!packet) setTrElected(props.tradeElected); }}
            onSubmit={(v) => put("trade", { elected: true, ...v })}
          />
        )}

        {/* On the surface that COLLECTS the figures, not only the one that shows them back. */}
        {trElected === true && disclaimer && (
          <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-3" data-testid="trade-disclaimer">
            {disclaimer}
          </p>
        )}

        {error?.where === "trade" && (
          <p className="text-sm text-al-danger mt-2" role="alert" data-testid="trade-error">{error.message}</p>
        )}
      </ElectionCard>
    </div>
  );
}

function CoBuyerForm({
  busy, consentText, initial, onCancel, onSubmit,
}: {
  busy: boolean; consentText: string; initial: CoBuyer | null;
  onCancel: () => void; onSubmit: (v: Record<string, unknown>) => Promise<boolean>;
}) {
  const [first, setFirst] = useState(initial?.legalFirstName ?? "");
  const [last, setLast] = useState(initial?.legalLastName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [signer, setSigner] = useState(initial?.isRequiredSigner ?? true);
  const [consent, setConsent] = useState(false);

  return (
    <form
      className="rounded-lg border border-slate-200 p-3 space-y-3"
      data-testid="co-buyer-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          legalFirstName: first, legalLastName: last,
          email: email || null, phone: phone || null,
          role: role || null, isRequiredSigner: signer, shareConsent: consent,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Text id="cb-first" label="Legal first name" value={first} onChange={setFirst} required disabled={busy} />
        <Text id="cb-last" label="Legal last name" value={last} onChange={setLast} required disabled={busy} />
      </div>
      <p className="text-xs text-slate-500 -mt-1">As it appears on their ID — it is the name on the contract.</p>
      <div className="grid grid-cols-2 gap-3">
        <Text id="cb-email" label="Email" type="email" value={email} onChange={setEmail} disabled={busy} placeholder="so they can sign" />
        <Text id="cb-phone" label="Phone" type="tel" value={phone} onChange={setPhone} disabled={busy} placeholder="or a number" />
      </div>
      <label htmlFor="cb-role" className="block">
        <span className="block text-xs text-slate-500 mb-1">Relationship</span>
        <select
          id="cb-role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}
          className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
        >
          <option value="">Prefer not to say</option>
          {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={signer} disabled={busy} onChange={(e) => setSigner(e.target.checked)}
          className="mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
          data-testid="co-buyer-signer" />
        <span>They will need to sign the contract</span>
      </label>

      {/* Deliberate act, never pre-ticked: this person has not agreed to anything. */}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
          data-testid="co-buyer-consent" required />
        <span>{consentText || "I have this person's permission to share their details."}</span>
      </label>

      {/* THE PHRASE IS DELIBERATELY NOT RENDERED, and this is not squeamishness.
          `lib/security/__tests__/no-ssn-intake.test.ts` is a §0 build-failing control that fails
          on a rendered "Social Security" string anywhere a buyer or dealer can reach, because a
          rendered label is how one gets collected. It cannot tell a promise from a prompt, and
          it should not have to: the safer reading of an ambiguous string on a form is the strict
          one. The guard is correct and is left exactly as strict as it was; the copy carries the
          same reassurance in words that are not a field label. The full statement — we never ask
          for a co-buyer's Social Security number, and they provide it to the lender directly at
          financing — lives here, in the comment channel that guard's own header reserves for it. */}
      <p className="text-xs text-slate-500">
        We never ask for a co-buyer&rsquo;s identity numbers. Anything the lender needs, they
        collect from your co-buyer directly.
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy} data-testid="co-buyer-save">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function TradeForm({
  busy, initial, onCancel, onSubmit,
}: {
  busy: boolean; initial: TradePacket | null;
  onCancel: () => void; onSubmit: (v: Record<string, unknown>) => Promise<boolean>;
}) {
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [make, setMake] = useState(initial?.make ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [trim, setTrim] = useState(initial?.trim ?? "");
  const [mileage, setMileage] = useState(initial?.mileage != null ? String(initial.mileage) : "");
  const [condition, setCondition] = useState(initial?.condition ?? "GOOD");
  const [loanStatus, setLoanStatus] = useState(initial?.loanStatus ?? "OWNED_OUTRIGHT");
  const [payoff, setPayoff] = useState(initial?.loanBalanceCents != null ? String(initial.loanBalanceCents / 100) : "");
  const [secondKey, setSecondKey] = useState(initial?.hasSecondKey ?? false);
  const [titleInHand, setTitleInHand] = useState(initial?.titleInHand ?? false);
  const [consent, setConsent] = useState(false);

  const financed = loanStatus === "FINANCED" || loanStatus === "LEASED";

  return (
    <form
      className="rounded-lg border border-slate-200 p-3 space-y-3"
      data-testid="trade-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          year: Number(year), make, model, trim: trim || null,
          mileage: mileage ? Number(mileage) : null,
          condition, loanStatus,
          loanBalanceCents: payoff ? Math.round(Number(payoff) * 100) : null,
          hasSecondKey: secondKey, titleInHand,
          shareConsent: consent,
        });
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <Text id="tr-year" label="Year" type="number" value={year} onChange={setYear} required disabled={busy} />
        <Text id="tr-make" label="Make" value={make} onChange={setMake} required disabled={busy} />
        <Text id="tr-model" label="Model" value={model} onChange={setModel} required disabled={busy} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Text id="tr-trim" label="Trim" value={trim} onChange={setTrim} disabled={busy} />
        <Text id="tr-mileage" label="Mileage" type="number" value={mileage} onChange={setMileage} disabled={busy} />
        <label htmlFor="tr-condition" className="block">
          <span className="block text-xs text-slate-500 mb-1">Condition</span>
          <select id="tr-condition" value={condition} disabled={busy} onChange={(e) => setCondition(e.target.value)}
            className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2">
            {CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label htmlFor="tr-loan" className="block">
          <span className="block text-xs text-slate-500 mb-1">Do you still owe on it?</span>
          <select id="tr-loan" value={loanStatus} disabled={busy} onChange={(e) => setLoanStatus(e.target.value)}
            data-testid="trade-loan-status"
            className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2">
            {LOAN_STATUSES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        {financed && (
          <Text id="tr-payoff" label="Approximate payoff ($)" type="number" value={payoff} onChange={setPayoff}
            required disabled={busy} placeholder="what's still owed" />
        )}
      </div>
      {financed && (
        <p className="text-xs text-slate-500 -mt-1">
          Dealers price a financed trade against the payoff. A missing figure gets guessed at —
          usually not in your favour.
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={secondKey} disabled={busy} onChange={(e) => setSecondKey(e.target.checked)}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2" />
          <span>I have both keys</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={titleInHand} disabled={busy} onChange={(e) => setTitleInHand(e.target.checked)}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2" />
          <span>I have the title</span>
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
          data-testid="trade-consent" required />
        <span>These details can be shown to the dealerships competing for my business.</span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy} data-testid="trade-save">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
