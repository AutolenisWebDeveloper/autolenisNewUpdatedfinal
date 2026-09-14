"use client";

// §Stage 10 — the winning dealership's confirmation form.
//
// EVERY FIELD §Stage 10 NAMES, AND NOTHING ELSE. The list is the document's, in the document's
// order, because a form that asks for less than the stage requires produces a confirmation that
// does not confirm — and one that asks for more turns a 24-hour deadline into a chore.
//
// THE FIGURES ARE PRE-FILLED FROM THE ACCEPTED OFFER, which is the point: confirming means saying
// "still true", and a blank form makes a dealership retype numbers it already gave. A changed
// field is then a deliberate change, which is exactly what §10a's comparison is built on. The
// fields the dealership is most likely to change — VIN, odometer, out-the-door — are first.
//
// THE FORM DOES NOT DECIDE WHETHER A CHANGE IS MATERIAL. It submits what the dealership entered
// and the server compares it against the offer (`material-change.ts`). A client that decided would
// be a second copy of §10a's seven rules, and the copy that a dealership's browser runs is the one
// nobody reviews.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock } from "lucide-react";

export interface LineItem {
  label: string;
  amountCents: number | null;
}

interface Accepted {
  otdPriceCents: number;
  vin: string | null;
  odometer: number | null;
  aprRate: number | null;
  termMonths: number | null;
  deliveryTerms: string | null;
  // §Stage 10 asks the dealership to confirm the LINE ITEMS, not only the total, and this form
  // submitted three hard-coded empty arrays. The recap is built from what lands here: an empty
  // add-on list meant `optionalProducts` was empty, so §11a's "separately named, separately
  // priced, separately accepted or declined" never happened and a dealer product could first
  // appear in the contract — the one thing §11a forbids.
  feeItems: LineItem[];
  addOnItems: LineItem[];
  incentiveItems: LineItem[];
}

export function ReaffirmationForm({
  dealId,
  accepted,
  dueAt,
}: {
  dealId: string;
  accepted: Accepted;
  dueAt: string | null;
}) {
  const router = useRouter();
  const [vin, setVin] = useState(accepted.vin ?? "");
  const [odometer, setOdometer] = useState(accepted.odometer != null ? String(accepted.odometer) : "");
  const [otd, setOtd] = useState((accepted.otdPriceCents / 100).toFixed(0));
  const [holdUntil, setHoldUntil] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState(accepted.deliveryTerms ?? "");
  const [outOfState, setOutOfState] = useState("");
  const [available, setAvailable] = useState(true);
  const [canProceed, setCanProceed] = useState(true);
  const [tradeAck, setTradeAck] = useState(false);
  const [docUrls, setDocUrls] = useState("");
  const [feeItems, setFeeItems] = useState<LineItem[]>(accepted.feeItems);
  const [addOnItems, setAddOnItems] = useState<LineItem[]>(accepted.addOnItems);
  const [incentiveItems, setIncentiveItems] = useState<LineItem[]>(accepted.incentiveItems);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      const res = await fetch(`/api/dealer/deals/${dealId}/reaffirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vehicleAvailable: available,
          confirmedVin: vin.trim(),
          confirmedOdometer: Number(odometer),
          confirmedOtdCents: Math.round(Number(otd) * 100),
          confirmedFeeItems: cleaned(feeItems),
          confirmedIncentiveItems: cleaned(incentiveItems),
          confirmedAddOnItems: cleaned(addOnItems),
          confirmedDeliveryTerms: deliveryTerms.trim() || null,
          outOfStateHandling: outOfState.trim() || null,
          canProceed,
          tradeSubjectToAppraisalAck: tradeAck,
          holdUntil: new Date(holdUntil).toISOString(),
          disclosureArtifactUrls: docUrls
            .split(/\s+/)
            .map((u) => u.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? "We could not record your confirmation.");
      // §10a REFUSAL is not an error — it is an answer, and it tells the dealership what to do.
      if (body?.data?.status === "REFUSED") {
        setRefusal(body.data.reason);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not record your confirmation.");
      setBusy(false);
    }
  }

  const ready =
    vin.trim().length >= 11 && odometer !== "" && otd !== "" && holdUntil !== "" && tradeAck;

  return (
    <section
      aria-labelledby="reaffirm-heading"
      className="rounded-al-lg border-2 border-al-primary/30 bg-al-surface"
      data-testid="dealer-reaffirmation-form"
    >
      <header className="border-b border-al-border bg-al-primary-subtle px-5 py-4">
        <h2 id="reaffirm-heading" className="text-[18px] font-semibold text-al-text">
          Confirm this deal
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-al-text-muted">
          The buyer has accepted your offer. Confirm the details below and set a hold — their
          contact information and the trade packet are released to you the moment you do.
        </p>
        {dueAt && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-al-warning-fg">
            <CalendarClock size={14} aria-hidden="true" />
            Due by {new Date(dueAt).toUTCString()}
          </p>
        )}
      </header>

      <div className="space-y-4 px-5 py-5">
        <Field label="VIN" id="reaffirm-vin" hint="As it appears on the vehicle.">
          <input
            id="reaffirm-vin"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            className={inputClass}
            data-testid="reaffirm-vin"
          />
        </Field>

        <Field label="Current mileage" id="reaffirm-odometer" hint="Today's odometer reading.">
          <input
            id="reaffirm-odometer"
            type="number"
            inputMode="numeric"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            className={inputClass}
            data-testid="reaffirm-odometer"
          />
        </Field>

        <Field
          label="Out-the-door amount ($)"
          id="reaffirm-otd"
          hint="Everything the buyer pays. Lower than the accepted offer applies automatically in their favour; above their approved amount cannot be accepted at all."
        >
          <input
            id="reaffirm-otd"
            type="number"
            inputMode="decimal"
            value={otd}
            onChange={(e) => setOtd(e.target.value)}
            className={inputClass}
            data-testid="reaffirm-otd"
          />
        </Field>

        <Field
          label="Hold this vehicle until"
          id="reaffirm-hold"
          hint="We ask you to extend or release if the contract has not been requested by then."
        >
          <input
            id="reaffirm-hold"
            type="datetime-local"
            value={holdUntil}
            onChange={(e) => setHoldUntil(e.target.value)}
            className={inputClass}
            data-testid="reaffirm-hold-until"
          />
        </Field>

        <Field label="Pickup or delivery terms" id="reaffirm-delivery" hint="Optional.">
          <input
            id="reaffirm-delivery"
            value={deliveryTerms}
            onChange={(e) => setDeliveryTerms(e.target.value)}
            className={inputClass}
            data-testid="reaffirm-delivery"
          />
        </Field>

        <Field
          label="Out-of-state registration handling"
          id="reaffirm-oos"
          hint="How you will handle registration for this buyer. Optional."
        >
          <input
            id="reaffirm-oos"
            value={outOfState}
            onChange={(e) => setOutOfState(e.target.value)}
            className={inputClass}
            data-testid="reaffirm-oos"
          />
        </Field>

        <LineItems
          title="Fees"
          testId="reaffirm-fees"
          hint="Everything in the out-the-door total besides the vehicle, tax, documentation, title and registration. Edit an amount and the total above has to move with it."
          items={feeItems}
          onChange={setFeeItems}
        />

        <LineItems
          title="Optional products"
          testId="reaffirm-addons"
          hint="Warranty, service contract, GAP, protection packages. The buyer accepts or declines each one by name before anything is signed, so each needs its own line."
          items={addOnItems}
          onChange={setAddOnItems}
        />

        <LineItems
          title="Discounts and incentives"
          testId="reaffirm-incentives"
          hint="Anything that reduces what the buyer pays."
          items={incentiveItems}
          onChange={setIncentiveItems}
        />

        <Field
          label="Condition report, history report and photographs"
          id="reaffirm-docs"
          hint="Paste one URL per line."
        >
          <textarea
            id="reaffirm-docs"
            value={docUrls}
            onChange={(e) => setDocUrls(e.target.value)}
            rows={3}
            className={inputClass}
            data-testid="reaffirm-docs"
          />
        </Field>

        <div className="space-y-2 border-t border-al-border pt-4">
          <Check id="reaffirm-available" checked={available} onChange={setAvailable}>
            The vehicle is still available.
          </Check>
          <Check id="reaffirm-proceed" checked={canProceed} onChange={setCanProceed}>
            We are able and willing to proceed with this deal.
          </Check>
          <Check id="reaffirm-trade" checked={tradeAck} onChange={setTradeAck}>
            I understand the buyer&apos;s trade remains subject to our own inspection and appraisal.
          </Check>
        </div>

        {refusal && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] leading-relaxed text-al-danger-fg"
            data-testid="reaffirm-refused"
          >
            <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            {refusal}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] text-al-danger-fg"
            data-testid="reaffirm-error"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!ready || busy}
          data-testid="reaffirm-submit"
          className="min-h-[52px] w-full rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg transition-colors hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
        >
          {busy ? "Confirming…" : available && canProceed ? "Confirm this deal" : "Submit — we cannot proceed"}
        </button>
        <p className="text-[13px] leading-relaxed text-al-text-subtle">
          If you cannot proceed, untick the boxes above and submit. The buyer returns to the other
          offers on their auction and we tell them why.
        </p>
      </div>
    </section>
  );
}

/** Blank rows are what an empty "add a line" leaves behind; they are not line items. */
function cleaned(items: LineItem[]): LineItem[] {
  return items
    .filter((i) => i.label.trim().length > 0 || (i.amountCents ?? 0) !== 0)
    .map((i) => ({ label: i.label.trim(), amountCents: i.amountCents ?? 0 }));
}

/**
 * One editable list of named, priced lines.
 *
 * Every row is a real `<label>`/`<input>` pair with its own id, the remove control names the line
 * it removes, and the running total is text rather than a colour — a dealership reading this on a
 * phone in a showroom gets the same information as one on a desktop with a mouse.
 */
function LineItems({
  title,
  hint,
  testId,
  items,
  onChange,
}: {
  title: string;
  hint: string;
  testId: string;
  items: LineItem[];
  onChange: (next: LineItem[]) => void;
}) {
  const total = items.reduce((sum, i) => sum + (i.amountCents ?? 0), 0);
  function update(index: number, patch: Partial<LineItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  return (
    <fieldset className="rounded-al-md border border-al-border px-4 py-3" data-testid={testId}>
      <legend className="px-1 text-[14px] font-medium text-al-text">{title}</legend>
      <p className="mb-2 text-[13px] leading-relaxed text-al-text-subtle">{hint}</p>

      {items.length === 0 && (
        <p className="mb-2 text-[13px] text-al-text-subtle" data-testid={`${testId}-empty`}>
          None on this offer.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${testId}-label-${index}`} className="sr-only">
                {title} line {index + 1} description
              </label>
              <input
                id={`${testId}-label-${index}`}
                value={item.label}
                placeholder="Description"
                onChange={(e) => update(index, { label: e.target.value })}
                className={inputClass}
                data-testid={`${testId}-label-${index}`}
              />
            </div>
            <div className="w-32 shrink-0">
              <label htmlFor={`${testId}-amount-${index}`} className="sr-only">
                {title} line {index + 1} amount in dollars
              </label>
              <input
                id={`${testId}-amount-${index}`}
                type="number"
                inputMode="decimal"
                value={item.amountCents != null ? (item.amountCents / 100).toFixed(2) : ""}
                onChange={(e) =>
                  update(index, {
                    amountCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100),
                  })
                }
                className={inputClass}
                data-testid={`${testId}-amount-${index}`}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="min-h-[44px] rounded-al-md border border-al-border-strong px-3 text-[14px] font-medium text-al-text-muted hover:text-al-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
              data-testid={`${testId}-remove-${index}`}
            >
              Remove<span className="sr-only"> {item.label || `line ${index + 1}`}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...items, { label: "", amountCents: 0 }])}
          className="min-h-[44px] rounded-al-md border border-al-border-strong px-3 text-[14px] font-medium text-al-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
          data-testid={`${testId}-add`}
        >
          Add a line
        </button>
        <p className="text-[13px] font-medium text-al-text-muted" data-testid={`${testId}-total`}>
          {title} total: ${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
    </fieldset>
  );
}

const inputClass =
  "w-full rounded-al-md border border-al-border-strong bg-al-surface px-3 py-2.5 text-[15px] text-al-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2";

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[14px] font-medium text-al-text">
        {label}
      </label>
      {hint && <p className="mb-1.5 mt-0.5 text-[13px] leading-relaxed text-al-text-subtle">{hint}</p>}
      {children}
    </div>
  );
}

function Check({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-al-text">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-al-border-strong text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
        data-testid={id}
      />
      <span>{children}</span>
    </label>
  );
}
