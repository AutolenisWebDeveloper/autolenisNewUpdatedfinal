"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface FeaturedVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  mileage?: number | null;
  priceCents: number;
  images: string[];
  externalDealerCity?: string | null;
  externalDealerState?: string | null;
}

interface Props {
  vehicles: FeaturedVehicle[];
}

const ROTATION_INTERVAL = 15_000; // 15s

const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800&q=80",
  "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800&q=80",
  "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800&q=80",
  "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&q=80",
  "https://images.unsplash.com/photo-1542362567-b07e54358753?w=800&q=80",
] as const;

function getFallbackImage(vehicleId: string): string {
  const hash = vehicleId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FALLBACK_IMAGES[hash % FALLBACK_IMAGES.length] ?? FALLBACK_IMAGES[0]!;
}

export default function FeaturedInventoryCarousel({ vehicles }: Props) {
  // Responsive: 2 rows × 1 col mobile, 2 col tablet, 3 col desktop
  const [perPage, setPerPage] = useState(6);
  const [page,    setPage]    = useState(0);
  const [paused,  setPaused]  = useState(false);
  const [animKey, setAnimKey] = useState(0); // trigger re-animation on change
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalPages = Math.ceil(vehicles.length / perPage);

  // ── Respond to window width ───────────────────────────────────────────────
  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      // Mobile: 2 rows × 1 col = 2 | Tablet: 2 rows × 2 col = 4 | Desktop: 2 rows × 3 col = 6
      setPerPage(w < 640 ? 2 : w < 1024 ? 4 : 6);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Reset page when perPage changes to avoid overflowing ─────────────────
  useEffect(() => { setPage(0); }, [perPage]);

  // ── Auto-rotation ─────────────────────────────────────────────────────────
  const advance = useCallback(() => {
    setPage(p => (p + 1) % Math.max(1, Math.ceil(vehicles.length / perPage)));
    setAnimKey(k => k + 1);
  }, [vehicles.length, perPage]);

  useEffect(() => {
    if (paused) { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(advance, ROTATION_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [paused, advance]);

  function goTo(p: number) {
    setPage(p);
    setAnimKey(k => k + 1);
    // Reset timer
    if (timerRef.current) clearInterval(timerRef.current);
    if (!paused) timerRef.current = setInterval(advance, ROTATION_INTERVAL);
  }

  function prev() { goTo((page - 1 + totalPages) % totalPages); }
  function next() { goTo((page + 1) % totalPages); }

  const start   = page * perPage;
  const visible = vehicles.slice(start, start + perPage);
  // colCount drives grid columns (always 2 rows)
  const colCount = perPage === 2 ? 1 : perPage === 4 ? 2 : 3;

  if (vehicles.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="featured-carousel"
    >
      {/* Vehicle cards */}
      <div
        key={animKey}
        className="grid gap-6 animate-in fade-in duration-500"
        style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        data-testid="featured-carousel-grid"
      >
        {visible.map(v => (
          <VehicleCard key={v.id} vehicle={v} />
        ))}
      </div>

      {/* Navigation arrows */}
      {totalPages > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Previous vehicles"
            data-testid="carousel-prev"
            className="absolute -left-5 top-1/2 -translate-y-1/2 w-10 h-10 bg-white border border-[#E5E7EB] rounded-full shadow-md flex items-center justify-center text-[#0B5FD1] hover:bg-[#EFF6FF] transition-colors z-10"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={next}
            aria-label="Next vehicles"
            data-testid="carousel-next"
            className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 bg-white border border-[#E5E7EB] rounded-full shadow-md flex items-center justify-center text-[#0B5FD1] hover:bg-[#EFF6FF] transition-colors z-10"
          >
            <ArrowRight size={16} />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8" data-testid="carousel-dots">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to page ${i + 1}`}
              data-testid={`carousel-dot-${i}`}
              className="w-2.5 h-2.5 rounded-full transition-all duration-300"
              style={{ background: i === page ? "#0B5FD1" : "#E5E7EB" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual Vehicle Card ──────────────────────────────────────────────────

function VehicleCard({ vehicle: v }: { vehicle: FeaturedVehicle }) {
  const imageUrl =
    (v.images as string[] | null)?.[0] ??
    getFallbackImage(v.id);

  return (
    <Link
      href={`/inventory/${v.id}`}
      data-testid={`featured-vehicle-${v.id}`}
      className="group relative overflow-hidden rounded-2xl bg-white border border-[#E5E7EB] hover:border-[#93C5FD] shadow-sm hover:shadow-lg hover:shadow-[#0B5FD1]/10 transition-all"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[#F0F6FF]">
        <img
          src={imageUrl}
          alt={`${v.year} ${v.make} ${v.model}`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
        {/* VERIFIED badge — all carousel vehicles are LANE_1 */}
        <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-[#50D14E]/15 text-[#1A6B18] border-[#50D14E]/30">
          Verified
        </span>
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-bold text-[#111827] text-base leading-tight">
            {v.year} {v.make} {v.model}
          </h3>
          <p className="text-lg font-bold text-[#0B5FD1] shrink-0">
            ${(v.priceCents / 100).toLocaleString()}
          </p>
        </div>

        {v.trim && <p className="text-xs text-[#6B7280] mb-3">{v.trim}</p>}

        <div className="flex items-center gap-3 text-xs text-[#94A3B8]">
          <span>{(v.mileage ?? 0).toLocaleString()} mi</span>
        </div>

        <div className="mt-4 pt-4 border-t border-[#E5E7EB] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#0B5FD1]">View Opportunity →</span>
          <ArrowRight size={14} className="text-[#0B5FD1] group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
