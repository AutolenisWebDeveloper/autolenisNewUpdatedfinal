// VehicleGallery — image gallery with optional 360° drag-to-spin support
// Feature 14: Phase 3 — Buyer Deal Confidence
// 360° mode activates when `has360` is true AND images array has ≥8 frames.
// Drag left/right (or click prev/next) to spin through all frames.
// Graceful empty state when no images are available.
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, RotateCcw, Images } from "lucide-react";

/** px of horizontal drag needed for a full 360° rotation */
const SPIN_DRAG_WIDTH_PX = 300;

interface VehicleGalleryProps {
  images: string[];
  title: string;
  /** True when the inventory record signals 360° frame coverage */
  has360?: boolean;
}

export default function VehicleGallery({ images, title, has360 = false }: VehicleGalleryProps) {
  const safe = images.filter(Boolean).slice(0, 36);
  const [current, setCurrent] = useState(0);
  const [mode, setMode] = useState<"gallery" | "spin">(has360 && safe.length >= 8 ? "spin" : "gallery");
  const [lightbox, setLightbox] = useState(false);

  // 360° drag-to-spin state
  const spinRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const frameAtDragStart = useRef(0);
  const isDragging = useRef(false);

  const spinFrame = useCallback((clientX: number) => {
    if (dragStart.current === null) return;
    const delta = clientX - dragStart.current;
    const framesPerPx = safe.length / SPIN_DRAG_WIDTH_PX;
    const newFrame = Math.round(frameAtDragStart.current - delta * framesPerPx);
    setCurrent(((newFrame % safe.length) + safe.length) % safe.length);
  }, [safe.length]);

  useEffect(() => {
    if (mode !== "spin") return;
    const el = spinRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      dragStart.current = e.clientX;
      frameAtDragStart.current = current;
      isDragging.current = true;
    };
    const onMouseMove = (e: MouseEvent) => { if (isDragging.current) spinFrame(e.clientX); };
    const onMouseUp = () => { isDragging.current = false; dragStart.current = null; };
    const onTouchStart = (e: TouchEvent) => {
      dragStart.current = e.touches[0].clientX;
      frameAtDragStart.current = current;
      isDragging.current = true;
    };
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
  }, [mode, current, spinFrame]);

  const prev = () => setCurrent(i => (i - 1 + safe.length) % safe.length);
  const next = () => setCurrent(i => (i + 1) % safe.length);

  if (!safe.length) {
    return (
      <div className="w-full aspect-[16/7] bg-slate-100 flex items-center justify-center" data-testid="vehicle-gallery-empty">
        <div className="text-center text-slate-300">
          <ImageIcon size={40} className="mx-auto mb-2" />
          <p className="text-sm">No images available</p>
        </div>
      </div>
    );
  }

  const canSpin = has360 && safe.length >= 8;

  return (
    <div className="relative w-full bg-black" data-testid="vehicle-gallery">

      {/* Mode toggle tabs — only shown when 360° is available */}
      {canSpin && (
        <div className="absolute top-3 left-3 z-10 flex gap-1.5" data-testid="gallery-mode-toggle">
          <button
            onClick={() => setMode("gallery")}
            data-testid="gallery-mode-photos"
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${mode === "gallery" ? "bg-white text-slate-900" : "bg-black/50 text-white hover:bg-black/70"}`}
          >
            <Images size={12} /> Photos
          </button>
          <button
            onClick={() => setMode("spin")}
            data-testid="gallery-mode-360"
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${mode === "spin" ? "bg-white text-slate-900" : "bg-black/50 text-white hover:bg-black/70"}`}
          >
            <RotateCcw size={12} /> 360°
          </button>
        </div>
      )}

      {/* Main image / spin viewport */}
      {mode === "spin" ? (
        <div
          ref={spinRef}
          className="aspect-[16/7] bg-slate-900 overflow-hidden relative select-none cursor-grab active:cursor-grabbing"
          data-testid="gallery-spin-viewport"
        >
          <img
            src={safe[current]}
            alt={`${title} — 360° frame ${current + 1}`}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
            data-testid="gallery-spin-frame"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center pb-3 pointer-events-none">
            <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1.5">
              <RotateCcw size={11} /> Drag left or right to spin
            </span>
          </div>
          <div className="absolute bottom-4 right-4 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
            {current + 1} / {safe.length}
          </div>
        </div>
      ) : (
        <div className="aspect-[16/7] bg-slate-100 overflow-hidden relative" onClick={() => setLightbox(true)}>
          <img
            src={safe[current]}
            alt={`${title} — image ${current + 1}`}
            className="w-full h-full object-cover cursor-zoom-in"
            data-testid={`gallery-main-image-${current}`}
          />

          {safe.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prev(); }}
                data-testid="gallery-prev-btn"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); next(); }}
                data-testid="gallery-next-btn"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}

          <div className="absolute bottom-4 right-4 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
            {current + 1} / {safe.length}
          </div>
        </div>
      )}

      {/* Thumbnails — gallery mode only */}
      {mode === "gallery" && safe.length > 1 && (
        <div className="flex gap-2 p-4 bg-white overflow-x-auto" data-testid="gallery-thumbnails">
          {safe.map((src, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              data-testid={`gallery-thumb-${i}`}
              className={`w-16 h-12 rounded-md overflow-hidden shrink-0 border-2 transition-colors ${
                i === current
                  ? "border-[#0B5FD1] ring-2 ring-[#0B5FD1]/20"
                  : "border-transparent hover:border-[#93C5FD]"
              }`}
            >
              <img src={src} alt={`Thumbnail ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox — gallery mode only */}
      {lightbox && mode === "gallery" && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          data-testid="gallery-lightbox"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full"
            data-testid="lightbox-close"
            onClick={e => { e.stopPropagation(); setLightbox(false); }}
          >✕</button>
          {safe.length > 1 && (
            <>
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white p-2 hover:bg-white/10 rounded-full"
                data-testid="lightbox-prev"
                onClick={e => { e.stopPropagation(); prev(); }}
              ><ChevronLeft size={28} /></button>
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white p-2 hover:bg-white/10 rounded-full"
                data-testid="lightbox-next"
                onClick={e => { e.stopPropagation(); next(); }}
              ><ChevronRight size={28} /></button>
            </>
          )}
          <img
            src={safe[current]}
            alt={title}
            className="max-w-full max-h-[90vh] object-contain"
            onClick={e => e.stopPropagation()}
          />
          <span className="absolute bottom-6 text-white/80 text-xs">{current + 1} / {safe.length}</span>
        </div>
      )}
    </div>
  );
}
