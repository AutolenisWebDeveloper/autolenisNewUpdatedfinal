"use client";

// ShortlistClient — client component for interactive shortlist page
// Handles vehicle card clicks, delete with confirmation, and live list updates.
//
// AVAILABILITY. A shortlist entry can outlive the vehicle it points at:
// ShortlistItem.inventoryItemId has no foreign key, and the stale sweep deactivates
// listings the market has moved on from. This page used to drop those items entirely (a
// saved car silently vanished) or render them as live cards linking to a page that 404s.
//
// The rule now: an unavailable item stays VISIBLE and is EXCLUDED from the request. It does
// not consume one of the five candidate slots, does not satisfy the activation gate, and
// cannot be carried into an auction — but the buyer sees it, is told plainly that it is
// gone, and is offered a Vehicle Request pre-filled from what they had chosen.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, ArrowRight, Car, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MAX_SHORTLIST_ITEMS, INVENTORY_LANES } from "@/lib/constants";

interface ShortlistVehicle {
  itemId: string;
  inventoryItemId: string;
  /** False when the listing was deactivated or its inventory row no longer exists. */
  available: boolean;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  mileage?: number | null;
  priceCents: number;
  lane: string;
  bodyType?: string | null;
  images: string[];
  readinessState: string;
  /** Pre-filled Vehicle Request for an unavailable vehicle; null when it is still available. */
  similarRequestHref: string | null;
}

interface ShortlistClientProps {
  initialItems: ShortlistVehicle[];
  canActivate: boolean;
  hasPrequal: boolean;
}

export default function ShortlistClient({ initialItems, canActivate, hasPrequal }: ShortlistClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<ShortlistVehicle[]>(initialItems);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function handleDelete(itemId: string) {
    setConfirmId(null);
    setDeletingId(itemId);
    try {
      const res = await fetch(`/api/buyer/shortlist/${itemId}`, { method: "DELETE" });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.itemId !== itemId));
        router.refresh();
      }
    } finally {
      setDeletingId(null);
    }
  }

  const available = items.filter(i => i.available);
  const unavailable = items.filter(i => !i.available);
  // Every count on this page is the AVAILABLE count. Showing "5 of 5" when three have sold
  // tells the buyer their shortlist is full while the auction has two candidates in it.
  const count = available.length;
  const pct = Math.round((count / MAX_SHORTLIST_ITEMS) * 100);
  const activateDisabled = count === 0;

  function removeControl(item: ShortlistVehicle, i: number | string) {
    const isConfirming = confirmId === item.itemId;
    return (
      <div className="absolute bottom-3 right-3">
        {isConfirming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleDelete(item.itemId)}
              className="text-xs bg-red-500 text-white px-2 py-1 rounded font-semibold hover:bg-red-600"
              data-testid={`shortlist-confirm-delete-${i}`}
            >
              Remove
            </button>
            <button
              onClick={() => setConfirmId(null)}
              className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-semibold hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmId(item.itemId)}
            data-testid={`shortlist-remove-${i}`}
            className="p-2 text-slate-400 hover:text-red-500 bg-white border border-slate-200 rounded-lg transition-colors shadow-sm"
            aria-label="Remove from shortlist"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  }

  function vehicleTitle(item: ShortlistVehicle) {
    if (!item.make && !item.model) return "Saved vehicle";
    return `${item.year} ${item.make} ${item.model}${item.trim ? ` ${item.trim}` : ""}`;
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="shortlist-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Shortlist</h1>
          <p className="text-sm text-slate-500 mt-0.5">{count} of {MAX_SHORTLIST_ITEMS} vehicles</p>
        </div>
        <div className="relative group">
          {activateDisabled ? (
            <button
              disabled
              data-testid="activate-auction-btn"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold h-10 px-5 py-2 bg-al-primary text-white opacity-50 cursor-not-allowed"
            >
              Activate My Auction <ArrowRight size={15} />
            </button>
          ) : (
            <Button href="/buyer/deposit" data-testid="activate-auction-btn">
              Activate My Auction <ArrowRight size={15} />
            </Button>
          )}
          {activateDisabled && (
            <div className="absolute right-0 top-full mt-1 bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {unavailable.length > 0
                ? "Add an available vehicle to activate"
                : "Add at least 1 vehicle to activate"}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-al-primary rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
            data-testid="shortlist-progress-bar"
          />
        </div>
        <p className="text-xs text-slate-400 mt-1">{count}/{MAX_SHORTLIST_ITEMS} slots used</p>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div
          className="text-center py-20 bg-white border border-slate-200 rounded-2xl"
          data-testid="shortlist-empty"
        >
          <Car size={48} className="mx-auto text-slate-200 mb-4" />
          <p className="text-slate-700 font-semibold mb-1">Your shortlist is empty</p>
          <p className="text-slate-400 text-sm mb-6">Browse vehicles to add up to 5.</p>
          <Button href="/buyer/search" data-testid="browse-from-shortlist-btn">
            Browse Inventory <ArrowRight size={15} />
          </Button>
        </div>
      ) : (
        <>
          {/* Available vehicles */}
          {available.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {available.map((item, i) => {
                const laneInfo = INVENTORY_LANES[item.lane as keyof typeof INVENTORY_LANES] ?? INVENTORY_LANES.LANE_3;
                const isDeleting = deletingId === item.itemId;
                const isAuctionReady = item.readinessState === "AUCTION_READY";

                return (
                  <div
                    key={item.itemId}
                    data-testid={`shortlist-item-${i}`}
                    className={`relative bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <Link href={`/buyer/inventory/${item.inventoryItemId}`} className="block group">
                      <div className="relative aspect-[16/9] bg-slate-100">
                        {item.images[0] ? (
                          <img
                            src={item.images[0]}
                            alt={vehicleTitle(item)}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Car size={32} className="text-slate-300" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <Badge variant={laneInfo.chipColor as "green" | "blue" | "gray"}>{laneInfo.label}</Badge>
                        </div>
                        {isAuctionReady && (
                          <div className="absolute top-2 right-2">
                            <Badge variant="green" className="text-xs">AUCTION READY</Badge>
                          </div>
                        )}
                      </div>

                      <div className="p-4 pb-12">
                        <h3 className="font-bold text-slate-900 text-sm leading-tight">
                          {vehicleTitle(item)}
                        </h3>
                        <p className="text-lg font-bold text-al-primary mt-1">
                          ${(item.priceCents / 100).toLocaleString()}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {item.mileage != null && (
                            <span className="text-xs text-slate-400">{item.mileage.toLocaleString()} mi</span>
                          )}
                          {item.bodyType && (
                            <span className="text-xs text-slate-400">{item.bodyType}</span>
                          )}
                        </div>
                      </div>
                    </Link>

                    {removeControl(item, i)}
                  </div>
                );
              })}
            </div>
          )}

          {/* No longer available — visible, but excluded from the auction */}
          {unavailable.length > 0 && (
            <section className="mt-10" data-testid="shortlist-unavailable-section">
              <h2 className="text-sm font-bold text-slate-700">
                No longer available ({unavailable.length})
              </h2>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                {unavailable.length === 1 ? "This vehicle has" : "These vehicles have"} left the
                market since you saved {unavailable.length === 1 ? "it" : "them"}.{" "}
                {unavailable.length === 1 ? "It does" : "They do"} not count toward your{" "}
                {MAX_SHORTLIST_ITEMS} slots and {unavailable.length === 1 ? "will" : "will"} not be
                sent to dealers. We can find you one like it instead.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {unavailable.map((item, i) => {
                  const isDeleting = deletingId === item.itemId;
                  return (
                    <div
                      key={item.itemId}
                      data-testid={`shortlist-unavailable-item-${i}`}
                      className={`relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
                    >
                      {/* Deliberately NOT a Link: /buyer/inventory/{id} notFound()s for these. */}
                      <div className="relative aspect-[16/9] bg-slate-100">
                        {item.images[0] ? (
                          <img
                            src={item.images[0]}
                            alt={vehicleTitle(item)}
                            className="w-full h-full object-cover grayscale opacity-60"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Car size={32} className="text-slate-300" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <Badge variant="gray">No longer available</Badge>
                        </div>
                      </div>

                      <div className="p-4 pb-12">
                        <h3 className="font-bold text-slate-600 text-sm leading-tight">
                          {vehicleTitle(item)}
                        </h3>
                        {item.priceCents > 0 && (
                          <p className="text-sm font-semibold text-slate-400 mt-1 line-through">
                            ${(item.priceCents / 100).toLocaleString()}
                          </p>
                        )}
                        {item.similarRequestHref && (
                          <Link
                            href={item.similarRequestHref}
                            data-testid={`shortlist-find-similar-${i}`}
                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-al-primary hover:underline"
                          >
                            <Search size={13} />
                            Find one like this near me
                          </Link>
                        )}
                      </div>

                      {removeControl(item, `u${i}`)}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* Pre-qual prompt */}
      {!hasPrequal && count > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800" data-testid="shortlist-prequal-prompt">
          <p className="font-semibold mb-1">Complete prequalification to activate your auction</p>
          <Link href="/buyer/prequal" className="text-amber-700 font-semibold hover:underline" data-testid="shortlist-prequal-link">
            Start Prequalification →
          </Link>
        </div>
      )}
    </div>
  );
}
