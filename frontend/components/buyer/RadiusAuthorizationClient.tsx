"use client";

// §6a step 5 / S6-08b — the buyer's radius decision, as a control.
//
// THREE STATES, AND ONLY ONE OF THEM IS A FORM:
//
//   1. The case is waiting on this decision  → the form.
//   2. The buyer already authorised a figure → what they authorised, and how far we now reach.
//      A buyer who follows a reminder after answering must not be asked again, and must not be
//      shown a blank form that implies their answer was lost.
//   3. The case has moved on                 → where it stands, with no control. The ladder
//      does not re-open a band because a page was loaded.
//
// WHAT THE NUMBER MEANS IS SAID TWICE — once above the input and once in the confirmation —
// because it is the one thing a buyer can misread with a real cost. They are setting a MAXIMUM
// THEY ARE WILLING TO TRAVEL. The platform then searches inside it; it does not promise to
// search all of it, and §6a's S6-11 is why (radius is a server-side policy, never a client
// parameter). A buyer who believes they chose a search radius reads a smaller search as being
// overruled.
//
// PRESETS PLUS A FREE FIELD. The presets are the realistic answers and make the common case one
// click; the free field exists because 2,000 additional miles is the server's bound and a buyer
// with a specific number in mind should not have to pick the nearest preset. Both go through the
// same validation as the route, so the UI never submits what the API will refuse.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import { CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

/** Mirrors `MAX_ADDITIONAL_MILES` in the POST route. Kept in step by the route's own test. */
const MAX_ADDITIONAL_MILES = 2000;

const PRESETS = [50, 100, 250] as const;

interface Props {
  requestId: string;
  /** True only when the case is RADIUS_AUTHORIZATION_REQUIRED. */
  awaiting: boolean;
  /** The ceiling already on the case, if the buyer has answered. */
  alreadyAuthorizedMiles: number | null;
  /** How far we reach today — `min(band outer, authorised)`, or null with no authorisation. */
  currentReachMiles: number | null;
  competingCount: number;
  caseStatus: string;
}

export default function RadiusAuthorizationClient({
  requestId,
  awaiting,
  alreadyAuthorizedMiles,
  currentReachMiles,
  competingCount,
  caseStatus,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | "custom">(PRESETS[1]);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const additionalMiles = selected === "custom" ? Number(custom) : selected;
  const validNumber =
    Number.isFinite(additionalMiles) && additionalMiles > 0 && additionalMiles <= MAX_ADDITIONAL_MILES;

  async function submit() {
    if (!validNumber) {
      setError(`Enter a number between 1 and ${MAX_ADDITIONAL_MILES.toLocaleString()}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/requests/${requestId}/radius-authorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ additionalMiles }),
      });
      const json = await res.json();
      if (!res.ok) {
        // THE SERVER'S REASON, NOT A GENERIC ONE. "The sourcing case moved while this was being
        // recorded" tells a buyer to retry; "Something went wrong" tells them nothing and they
        // retry anyway, or give up on a request they have paid for.
        setError(json?.message ?? json?.error?.message ?? "We could not record that just now.");
        return;
      }
      setDone(json?.data?.authorizedRadiusMiles ?? null);
      // The request page is the running account of what happened; refreshing it means the
      // buyer's own authorisation is already in the timeline when they go back.
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── state 1b: just authorised, in this session ──
  if (done !== null) {
    return (
      <div
        className="mt-6 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-5"
        data-testid="radius-authorized-confirmation"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <Check size={15} aria-hidden="true" /> Thanks — we are widening the search
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          We will look for dealerships out to {done} miles. You will not be asked again for this
          request, and nothing further is needed from you.
        </p>
        <Link
          href={`/buyer/requests/${requestId}`}
          className="mt-4 inline-flex h-10 items-center rounded-lg bg-al-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
          data-testid="return-to-request"
        >
          Back to your request
        </Link>
      </div>
    );
  }

  // ── state 2: already answered ──
  if (alreadyAuthorizedMiles !== null) {
    return (
      <div className={cn(CARD, "mt-6 p-5")} data-testid="radius-already-authorized">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Check size={15} className="text-emerald-600" aria-hidden="true" /> You have already
          widened this search
        </p>
        <p className="mt-1 text-sm text-slate-600">
          You authorised up to {alreadyAuthorizedMiles} miles
          {currentReachMiles !== null && currentReachMiles !== alreadyAuthorizedMiles
            ? `, and we are searching out to ${currentReachMiles} miles so far`
            : ""}
          . {competingCount > 0
            ? `${competingCount} ${competingCount === 1 ? "dealership is" : "dealerships are"} competing.`
            : "We are still looking."}
        </p>
      </div>
    );
  }

  // ── state 3: the case is not waiting on the buyer ──
  if (!awaiting) {
    return (
      <div className={cn(CARD, "mt-6 p-5")} data-testid="radius-not-applicable">
        <p className="text-sm font-semibold text-slate-900">Nothing is needed from you right now</p>
        <p className="mt-1 text-sm text-slate-600">
          This request is {caseStatus === "LAUNCHED" ? "in a live auction" : "still being worked on"}
          {currentReachMiles !== null ? `, and we are searching out to ${currentReachMiles} miles` : ""}.
          If we need you to authorise a wider search, we will email you and this page will show the
          decision.
        </p>
        <Link
          href={`/buyer/requests/${requestId}`}
          className="mt-4 inline-flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Back to your request
        </Link>
      </div>
    );
  }

  // ── state 1: the form ──
  return (
    <div className={cn(CARD, "mt-6 p-5")} data-testid="radius-authorization-form">
      <p className="text-sm text-slate-700">
        We have searched every dealership within 250 miles of you.{" "}
        {competingCount > 0
          ? `${competingCount} ${competingCount === 1 ? "is" : "are"} competing so far, and widening the search would add more.`
          : "None of them can serve this request."}
      </p>

      {/* The honest trade-off, before the control rather than after it. */}
      <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        <p className="flex items-start gap-2">
          <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            You are setting the <strong className="font-semibold text-slate-900">maximum extra
            distance you are willing to travel</strong> — not the distance we will search. We look
            inside the limit you set and stop there. A car further away usually means a longer trip
            to collect it, and sometimes a shipping cost quoted by the dealership.
          </span>
        </p>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-slate-900">
          How much further are you willing to go?
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((miles) => (
            <button
              key={miles}
              type="button"
              onClick={() => {
                setSelected(miles);
                setError(null);
              }}
              aria-pressed={selected === miles}
              data-testid={`radius-preset-${miles}`}
              className={cn(
                "h-10 rounded-lg border px-4 text-sm font-semibold transition-colors",
                selected === miles
                  ? "border-al-primary bg-al-primary text-white"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50",
              )}
            >
              +{miles} miles
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSelected("custom");
              setError(null);
            }}
            aria-pressed={selected === "custom"}
            data-testid="radius-preset-custom"
            className={cn(
              "h-10 rounded-lg border px-4 text-sm font-semibold transition-colors",
              selected === "custom"
                ? "border-al-primary bg-al-primary text-white"
                : "border-slate-200 text-slate-700 hover:bg-slate-50",
            )}
          >
            A specific number
          </button>
        </div>

        {selected === "custom" && (
          <div className="mt-3">
            <label htmlFor="custom-miles" className="text-xs font-medium text-slate-600">
              Additional miles (up to {MAX_ADDITIONAL_MILES.toLocaleString()})
            </label>
            <input
              id="custom-miles"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ADDITIONAL_MILES}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setError(null);
              }}
              data-testid="radius-custom-input"
              className="mt-1 h-10 w-40 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-al-primary focus:outline-none focus:ring-2 focus:ring-al-primary/20"
            />
          </div>
        )}
      </fieldset>

      {/* What the figure becomes, computed in front of the buyer so the number they authorise is
          the number they see. 250 is the ladder's last fixed rung. */}
      {validNumber && (
        <p className="mt-4 text-sm text-slate-700" data-testid="radius-computed-ceiling">
          We will search out to{" "}
          <strong className="font-semibold text-slate-900">{250 + additionalMiles} miles</strong>{" "}
          from you, and no further.
        </p>
      )}

      {error && (
        <p
          className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"
          role="alert"
          data-testid="radius-error"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !validNumber}
          data-testid="radius-submit"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {saving ? "Recording…" : "Authorise this search"}
        </button>
        <Link
          href={`/buyer/requests/${requestId}`}
          className="text-sm text-slate-500 transition-colors hover:text-slate-800"
          data-testid="radius-decline"
        >
          Not right now
        </Link>
      </div>

      {/* "Not right now" is a link, not a refusal we record. §Stage 6 closes an unanswered case
          as abandoned after 14 days with its history preserved, and the reminders at 24h and 72h
          are what ask again — so a buyer who is not ready does not have to say no, and saying
          nothing has a stated consequence rather than a silent one. */}
      <p className="mt-3 text-xs text-slate-400">
        We will remind you once tomorrow and once in three days. If we hear nothing for 14 days we
        will close this search and your $99 deposit remains refundable.
      </p>
    </div>
  );
}
