"use client";

// Buyer financing application form. Collects the application inputs and posts them
// to the encrypting API (SSN/income are encrypted server-side; nothing sensitive is
// stored in component state beyond the in-flight submission). Accessible: labelled
// inputs, an inline error alert, and a disabled-until-valid submit.
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Fields {
  amountRequested: string;
  termMonths: string;
  ssn: string;
  annualIncome: string;
  employment: string;
}

const EMPTY: Fields = { amountRequested: "", termMonths: "60", ssn: "", annualIncome: "", employment: "" };

export function FinancingApplicationForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const dollarsToCents = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, "")) * 100);
  const valid =
    dollarsToCents(f.amountRequested) > 0 &&
    Number(f.termMonths) >= 6 &&
    /^\d{3}-?\d{2}-?\d{4}$/.test(f.ssn) &&
    dollarsToCents(f.annualIncome) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/financing/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dealId,
          amountRequestedCents: dollarsToCents(f.amountRequested),
          termMonths: Number(f.termMonths),
          ssn: f.ssn,
          annualIncomeCents: dollarsToCents(f.annualIncome),
          employment: f.employment || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "Could not submit your application.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-[var(--color-al-border)] bg-[var(--color-al-surface)] px-3 py-2 text-[15px] text-[var(--color-al-text)]";
  const label = "block text-[13px] font-medium text-[var(--color-al-text-muted)]";

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" aria-describedby="fin-privacy">
      <p id="fin-privacy" className="text-[13px] text-[var(--color-al-text-subtle)]">
        Your Social Security number and income are encrypted and used only to request financing.
      </p>

      <div>
        <label htmlFor="amt" className={label}>Amount to finance</label>
        <input id="amt" inputMode="decimal" placeholder="$25,000" value={f.amountRequested} onChange={set("amountRequested")} className={field} required />
      </div>
      <div>
        <label htmlFor="term" className={label}>Term (months)</label>
        <input id="term" inputMode="numeric" value={f.termMonths} onChange={set("termMonths")} className={field} required />
      </div>
      <div>
        <label htmlFor="ssn" className={label}>Social Security number</label>
        <input id="ssn" inputMode="numeric" autoComplete="off" placeholder="123-45-6789" value={f.ssn} onChange={set("ssn")} className={field} required aria-describedby="fin-privacy" />
      </div>
      <div>
        <label htmlFor="income" className={label}>Annual income</label>
        <input id="income" inputMode="decimal" placeholder="$90,000" value={f.annualIncome} onChange={set("annualIncome")} className={field} required />
      </div>
      <div>
        <label htmlFor="emp" className={label}>Employer (optional)</label>
        <input id="emp" value={f.employment} onChange={set("employment")} className={field} />
      </div>

      {error && (
        <p role="alert" className="text-[14px] text-[var(--color-al-danger)]">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy || !valid}
        className="w-full rounded-md bg-[var(--color-al-primary)] px-4 py-2.5 text-[15px] font-medium text-[var(--color-al-primary-fg)] disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
