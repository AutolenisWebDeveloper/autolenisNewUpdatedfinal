"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Car, X, ChevronLeft, ChevronRight, RotateCcw, Images } from "lucide-react";

/** px of horizontal drag needed for a full 360° rotation */
const SPIN_DRAG_WIDTH_PX = 300;

interface Props {
  images: string[];
  alt: string;
  laneLabel: string;
  laneClasses: string;
  /** True when inventory record signals 360° frame coverage */
  has360?: boolean;
}

export default function VehicleGalleryClient({ images, alt, laneLabel, laneClasses, has360 = false }: Props) {
  const safe = images.filter(Boolean);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [mode, setMode] = useState<"gallery" | "spin">(has360 && safe.length >= 8 ? "spin" : "gallery");

  // 360° drag-to-spin
  const spinRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const frameAtDragStart = useRef(0);
  const isDragging = useRef(false);

  const spinFrame = useCallback((clientX: number) => {
    if (dragStart.current === null) return;
    const delta = clientX - dragStart.current;
    const framesPerPx = safe.length / SPIN_DRAG_WIDTH_PX;
    const newFrame = Math.round(frameAtDragStart.current - delta * framesPerPx);
    setActive(((newFrame % safe.length) + safe.length) % safe.length);
  }, [safe.length]);

  useEffect(() => {
    if (mode !== "spin") return;
    const el = spinRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => { dragStart.current = e.clientX; frameAtDragStart.current = active; isDragging.current = true; };
    const onMouseMove = (e: MouseEvent) => { if (isDragging.current) spinFrame(e.clientX); };
    const onMouseUp = () => { isDragging.current = false; dragStart.current = null; };
    const onTouchStart = (e: TouchEvent) => { dragStart.current = e.touches[0].clientX; frameAtDragStart.current = active; isDragging.current = true; };
    const onTouchMove = (e: TouchEvent) => { if (isDragging.current) spinFrame(e.touches[0].clientX); };
    const onTouchEnd = () => { isDragging.current = false; dragStart.current = null; };
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [mode, active, spinFrame]);

  const next = useCallback(() => setActive(i => (i + 1) % safe.length), [safe.length]);
  const prev = useCallback(() => setActive(i => (i - 1 + safe.length) % safe.length), [safe.length]);

  useEffect(() => {
    if (!lightbox) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox, next, prev]);

  const canSpin = has360 && safe.length >= 8;

  return (
    <>
      {/* Mode toggle — only when 360° available */}
      {canSpin && (
        <div className="flex gap-1.5 mb-2" data-testid="gallery-mode-toggle">
          <button
            onClick={() => setMode("gallery")}
            data-testid="gallery-mode-photos"
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${mode === "gallery" ? "bg-[#0B5FD1] text-white border-[#0B5FD1]" : "bg-white text-slate-600 border-slate-200 hover:border-[#0B5FD1]"}`}
          >
            <Images size={11} /> Photos
          </button>
          <button
            onClick={() => setMode("spin")}
            data-testid="gallery-mode-360"
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${mode === "spin" ? "bg-[#0B5FD1] text-white border-[#0B5FD1]" : "bg-white text-slate-600 border-slate-200 hover:border-[#0B5FD1]"}`}
          >
            <RotateCcw size={11} /> 360°
          </button>
        </div>
      )}

      {/* 360° spin viewport */}
      {mode === "spin" ? (
        <div
          ref={spinRef}
          className="relative aspect-[16/9] bg-slate-900 rounded-xl overflow-hidden mb-3 border border-[#E5E7EB] select-none cursor-grab active:cursor-grabbing"
          data-testid="gallery-spin-viewport"
        >
          <span className={`absolute top-4 left-4 z-10 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full border ${laneClasses}`}>{laneLabel}</span>
          <img src={safe[active]} alt={`${alt} — 360° frame ${active + 1}`} className="w-full h-full object-cover pointer-events-none" draggable={false} data-testid="gallery-spin-frame" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center pb-3 pointer-events-none">
            <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1.5">
              <RotateCcw size={11} /> Drag to spin
            </span>
          </div>
        </div>
      ) : (
        /* Regular gallery */
        <div className="relative aspect-[16/9] bg-[#F8F9FB] rounded-xl overflow-hidden mb-3 border border-[#E5E7EB] cursor-zoom-in" data-testid="vehicle-main-image" onClick={() => safe.length && setLightbox(true)}>
          {safe.length ? (
            <img src={safe[active]} alt={alt} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Car size={64} className="text-[#DBEAFE]" /></div>
          )}
          <span className={`absolute top-4 left-4 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full border ${laneClasses}`}>{laneLabel}</span>
          {safe.length > 1 && (
            <span className="absolute bottom-4 right-4 bg-black/50 text-white text-xs font-semibold px-2.5 py-1 rounded-full pointer-events-none">
              {active + 1} / {safe.length}
            </span>
          )}
        </div>
      )}

      {/* Thumbnails */}
      {mode === "gallery" && safe.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin"
          data-testid="vehicle-thumbnails"
        >
          {safe.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              data-testid={`thumb-${i}`}
              className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                i === active
                  ? "border-[#0B5FD1] ring-2 ring-[#0B5FD1]/20"
                  : "border-[#E5E7EB] hover:border-[#93C5FD]"
              }`}
              style={{ width: "80px", height: "60px" }}
            >
              <img
                src={src}
                alt={`${alt} ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && safe.length > 0 && mode === "gallery" && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" data-testid="lightbox" onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full" data-testid="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightbox(false); }}><X size={20} /></button>
          {safe.length > 1 && (
            <>
              <button className="absolute left-4 top-1/2 -translate-y-1/2 text-white p-2 hover:bg-white/10 rounded-full" data-testid="lightbox-prev" onClick={(e) => { e.stopPropagation(); prev(); }}><ChevronLeft size={28} /></button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 text-white p-2 hover:bg-white/10 rounded-full" data-testid="lightbox-next" onClick={(e) => { e.stopPropagation(); next(); }}><ChevronRight size={28} /></button>
            </>
          )}
          <img src={safe[active]} alt={alt} className="max-w-full max-h-[90vh] object-contain" onClick={(e) => e.stopPropagation()} />
          <span className="absolute bottom-6 text-white/80 text-xs">{active + 1} / {safe.length}</span>
        </div>
      )}
    </>
  );
}
