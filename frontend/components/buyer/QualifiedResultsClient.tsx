"use client";

// QUAL — the live, prequal-gated qualified-results view (§22a; §8.1 row 4; Phase 4).
//
// This is NOT the catalogue. `/buyer/search` reads the swept `inventory_items` table and shows
// everything with an action per card. This asks the provider a question shaped by ONE buyer's
// approval — their ZIP, their approved amount plus the ruled headroom, their condition and
// criteria — and it costs a call from the monthly ledger.
//
// THE ONE THING THIS SCREEN MUST NEVER DO is render a provider failure as an empty market.
// "No cars near you" is a claim about the world; "we could not reach the market" is a claim
// about us. `marketKnown` is the server's answer to which one is true, and every empty state
// below branches on it before it writes the word "none".
//
// It also never saves anything. The server returns an ACTION per card and the buyer takes it.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Clock, Heart, Loader2, MapPin, Search, WifiOff } from "lucide-react";
import { CARD_REFUSAL, findOneLikeThisHref } from "@/components/buyer/shortlist-copy";

type Outcome = "OK" | "NEED_ZIP" | "NOT_QUALIFIED" | "NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" | "BUDGET_EXHAUSTED";

interface Card {
  sourceKey: string;
  vin?: string;
  /** The catalogue row this listing resolves to, or null when we have not ingested it. */
  inventoryItemId: string | null;
  year: number; make: string; model: string; trim?: string;
  mileage?: number; priceCents: number; images: string[];
  city?: string; state?: string;
  distanceMiles: number | null;
  freshness: "FRESH" | "STALE" | "EXPIRED";
  action: "ADD" | "REQUEST_SIMILAR" | "NEED_ZIP";
  reason: string;
  daysOnLot?: number;
}

interface View {
  outcome: Outcome;
  cards: Card[];
  inRadiusCount: number;
  hasZip: boolean;
  offerRequestPath: boolean;
  marketKnown: boolean;
  approvedAmountCents: number | null;
  priceCeilingCents: number | null;
  radiusMiles: number;
  zip: string | null;
  provider: { outcome: string | null; apiCallsUsed: number; numFound: number | null };
}

const money = (c: number) => `$${(c / 100).toLocaleString()}`;

export default function QualifiedResultsClient({ initialZip }: { initialZip: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zip, setZip] = useState(initialZip ?? "");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (withZip?: string) => {
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      const qs = withZip && /^\d{5}$/.test(withZip) ? `?zip=${withZip}` : "";
      const res = await fetch(`/api/buyer/qualified-results${qs}`);
      const json = await res.json();
      if (!res.ok) { setError(json?.message ?? "We could not run that search."); return; }
      setView(json.data as View);
    } catch {
      // A transport failure is reported as a failure. It is NOT "no cars found".
      setError("We could not reach the search just now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  // NO SEARCH ON MOUNT. Each run spends a call from the same monthly provider ledger the
  // daily sweep draws on, so a page that searched on load turned every refresh into a draw —
  // and a few hundred of them into a frozen catalogue. The buyer asks; then we spend. The
  // server-side reserve in `sweepReserveFor` is the second half of the same fix.
  useEffect(() => { setLoading(false); }, []);

  async function addToShortlist(card: Card) {
    // The buyer's choice, never ours: this only ever runs from a click on an ADD card, and
    // the server only marks a card ADD when it resolved to a catalogue row.
    if (!card.inventoryItemId) return;
    setSaving(card.sourceKey);
    try {
      const res = await fetch("/api/buyer/shortlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventoryItemId: card.inventoryItemId }),
      });
      if (res.ok) setSaved((s) => new Set(s).add(card.sourceKey));
      else {
        const json = await res.json();
        setError(json?.message ?? "We could not save that one.");
      }
    } catch {
      setError("We could not save that one. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="qual-loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl h-56 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="bg-white border border-al-danger/30 rounded-xl p-6 text-center" role="alert" data-testid="qual-error">
        <p className="text-sm text-slate-800 font-medium mb-3">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => void load(zip)}>Try again</Button>
      </div>
    );
  }

  // The resting state: nothing has been spent, and the buyer is told what the button does.
  if (!searched && !view) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center" data-testid="qual-idle">
        <h2 className="font-semibold text-slate-900 mb-2">Check the live market</h2>
        <p className="text-sm text-slate-600 mb-5 max-w-md mx-auto">
          We will search dealer listings around you right now, filtered to what you are
          approved for. Nothing is saved to your shortlist unless you add it.
        </p>
        <div className="flex gap-2 justify-center items-center flex-wrap">
          <label htmlFor="qual-zip-idle" className="sr-only">ZIP code</label>
          <input
            id="qual-zip-idle" inputMode="numeric" maxLength={5} value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
            placeholder="ZIP code"
            className="h-10 w-36 rounded-lg border border-slate-200 px-3 text-sm
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
            data-testid="qual-idle-zip"
          />
          <Button onClick={() => void load(zip)} data-testid="qual-search-cta">Search the market</Button>
        </div>
      </div>
    );
  }

  if (!view) return null;

  // ── the gates, each with the one control that resolves it ────────────────
  if (view.outcome === "NOT_QUALIFIED") {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center" data-testid="qual-not-qualified">
        <h2 className="font-semibold text-slate-900 mb-2">Get pre-qualified first</h2>
        <p className="text-sm text-slate-600 mb-5 max-w-md mx-auto">
          These results are filtered to what you are actually approved for, so there is no point
          showing you cars you cannot buy. It takes about a minute and it is a soft check.
        </p>
        <Button href="/buyer/prequal" data-testid="qual-prequal-cta">Start pre-qualification</Button>
      </div>
    );
  }

  if (view.outcome === "NEED_ZIP") {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md mx-auto" data-testid="qual-need-zip">
        <h2 className="font-semibold text-slate-900 mb-2">Where should we look?</h2>
        <p className="text-sm text-slate-600 mb-4">
          We search {view.radiusMiles} miles around you, so we need a ZIP code before we can tell
          you what is reachable.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); void load(zip); }}
        >
          <label htmlFor="qual-zip" className="sr-only">ZIP code</label>
          <input
            id="qual-zip" inputMode="numeric" maxLength={5} value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
            placeholder="ZIP code"
            className="flex-1 h-10 rounded-lg border border-slate-200 px-3 text-sm
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
            data-testid="qual-zip-input"
          />
          <Button type="submit" disabled={zip.length !== 5} data-testid="qual-zip-submit">Search</Button>
        </form>
      </div>
    );
  }

  // A FAILURE, A DEFERRAL, OR A SPEND WE DECLINED — never rendered as an empty market.
  if (!view.marketKnown && view.cards.length === 0) {
    const budget = view.outcome === "BUDGET_EXHAUSTED";
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center" data-testid="qual-market-unknown">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <WifiOff size={20} className="text-slate-500" aria-hidden="true" />
        </div>
        <h2 className="font-semibold text-slate-900 mb-2">
          {budget ? "We have paused live search for now" : "We could not check the market just now"}
        </h2>
        <p className="text-sm text-slate-600 mb-5 max-w-md mx-auto">
          {budget
            ? "This is us, not the market — we cap how often we query so the search stays reliable. Your saved cars and your request are unaffected."
            : "This is a problem on our side, not an empty market. There may well be cars near you; we just could not reach the listing service."}
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button size="sm" variant="secondary" onClick={() => void load(zip)} data-testid="qual-retry">Try again</Button>
          <Button size="sm" href="/buyer/requests/new" data-testid="qual-request-cta">Tell us what you want instead</Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="qual-results">
      {/* What the search was actually bounded by. Stating it is what stops "why is this car
          missing?" being a mystery — and the ceiling is the approval plus headroom, not the
          approval, because that is what was filtered on. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-4" data-testid="qual-bounds">
        {view.zip && <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" /> {view.zip} · within {view.radiusMiles} miles</span>}
        {view.priceCeilingCents != null && <span>· up to {money(view.priceCeilingCents)}</span>}
        <span>· {view.inRadiusCount} we can bring to auction</span>
      </div>

      {view.offerRequestPath && (
        <div
          className="bg-al-primary-subtle border border-al-primary/20 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3 justify-between"
          data-testid="qual-offer-request-path"
        >
          <div className="text-sm text-slate-800">
            <p className="font-semibold">
              {view.cards.length === 0
                ? "Nothing matching in your area right now."
                : view.inRadiusCount === 0
                  ? "None of these are close enough to bring to auction."
                  : "Only a few of these are close enough to bring to auction."}
            </p>
            <p className="text-slate-600 mt-0.5">Tell us what you want and dealers near you will compete for it.</p>
          </div>
          <Button size="sm" href="/buyer/requests/new" data-testid="qual-request-path-cta">Request this car</Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-al-danger mb-4" role="alert" data-testid="qual-inline-error">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {view.cards.map((c, i) => {
          const isSaved = saved.has(c.sourceKey);
          return (
            <article key={c.sourceKey} className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid={`qual-card-${i}`}>
              <div className="relative aspect-[16/9] bg-slate-100">
                {c.images[0] && (
                  <img src={c.images[0]} alt={`${c.year} ${c.make} ${c.model}`} className="w-full h-full object-cover" loading="lazy" />
                )}
                {c.distanceMiles != null && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                    <MapPin size={10} aria-hidden="true" /> {c.distanceMiles} mi
                  </div>
                )}
                {c.freshness !== "FRESH" && (
                  <div className="absolute top-2 left-2">
                    <Badge variant={c.freshness === "STALE" ? "amber" : "gray"}>
                      {c.freshness === "STALE" ? "Quiet listing" : "Not seen in 30 days"}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-slate-900 text-sm">{c.year} {c.make} {c.model}</h3>
                {c.trim && <p className="text-xs text-slate-500 mt-0.5">{c.trim}</p>}
                <p className="text-xs text-slate-400 mt-0.5">
                  {[c.mileage != null ? `${c.mileage.toLocaleString()} mi` : null,
                    c.city && c.state ? `${c.city}, ${c.state}` : null,
                    c.daysOnLot != null ? `${c.daysOnLot} days on lot` : null].filter(Boolean).join(" · ")}
                </p>
                <div className="flex items-center justify-between mt-3 gap-2">
                  <p className="text-lg font-bold text-al-primary">{money(c.priceCents)}</p>
                  {c.action === "ADD" ? (
                    <button
                      type="button"
                      onClick={() => void addToShortlist(c)}
                      disabled={isSaved || saving === c.sourceKey}
                      data-testid={`qual-add-${i}`}
                      className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors
                                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2 ${
                        isSaved ? "bg-green-100 text-green-700" : "bg-al-primary/10 text-al-primary hover:bg-al-primary hover:text-white"
                      }`}
                    >
                      {saving === c.sourceKey
                        ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                        : <Heart size={12} fill={isSaved ? "currentColor" : "none"} aria-hidden="true" />}
                      {isSaved ? "Added" : "Add to shortlist"}
                    </button>
                  ) : (
                    <Link
                      href={findOneLikeThisHref(c)}
                      data-testid={`qual-find-similar-${i}`}
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors
                                 bg-slate-100 text-slate-700 hover:bg-al-primary hover:text-white
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-primary focus-visible:ring-offset-2"
                    >
                      <Search size={12} aria-hidden="true" /> Find one like this
                    </Link>
                  )}
                </div>
                {c.action !== "ADD" && CARD_REFUSAL[c.reason] && (
                  <p className="text-xs text-slate-500 mt-1.5" data-testid={`qual-reason-${i}`}>{CARD_REFUSAL[c.reason]}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {view.cards.length === 0 && view.marketKnown && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center" data-testid="qual-empty-market">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={20} className="text-slate-500" aria-hidden="true" />
          </div>
          <h2 className="font-semibold text-slate-900 mb-2">Nothing matching right now</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            We checked and the market came back empty for what you are after within{" "}
            {view.radiusMiles} miles. That is a real answer, not a glitch — and it is exactly
            what the request path is for.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-6 flex items-center gap-1" data-testid="qual-freshness-note">
        <Clock size={11} aria-hidden="true" />
        Checked just now against the live market. Nothing is saved to your shortlist unless you
        add it.
      </p>
    </div>
  );
}
