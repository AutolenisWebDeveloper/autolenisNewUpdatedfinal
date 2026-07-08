// /admin/inventory/coverage-map — ENH-12
// Leaflet.js only — NOT Google Maps (hard constraint)
// Live market data from /api/admin/inventory/coverage-map (MarketCoverage);
// coordinates come from a static geo lookup for known metros.

"use client";

import { logger } from "@/lib/logger";
import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { ErrorState } from "@/components/ui/kit";

interface CoverageMarket {
  city: string;
  state: string;
  zip: string | null;
  listingCount: number;
}

// Geo lookup for marker placement (markets without an entry still render as cards).
const CITY_GEO: Record<string, { lat: number; lng: number }> = {
  "new york": { lat: 40.7128, lng: -74.006 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "chicago": { lat: 41.8781, lng: -87.6298 },
  "houston": { lat: 29.7604, lng: -95.3698 },
  "atlanta": { lat: 33.749, lng: -84.388 },
  "dallas": { lat: 32.7767, lng: -96.797 },
  "miami": { lat: 25.7617, lng: -80.1918 },
  "phoenix": { lat: 33.4484, lng: -112.074 },
  "philadelphia": { lat: 39.9526, lng: -75.1652 },
  "san antonio": { lat: 29.4241, lng: -98.4936 },
  "san diego": { lat: 32.7157, lng: -117.1611 },
  "austin": { lat: 30.2672, lng: -97.7431 },
  "jacksonville": { lat: 30.3322, lng: -81.6557 },
  "charlotte": { lat: 35.2271, lng: -80.8431 },
  "denver": { lat: 39.7392, lng: -104.9903 },
  "seattle": { lat: 47.6062, lng: -122.3321 },
  "nashville": { lat: 36.1627, lng: -86.7816 },
  "tampa": { lat: 27.9506, lng: -82.4572 },
  "orlando": { lat: 28.5384, lng: -81.3789 },
  "detroit": { lat: 42.3314, lng: -83.0458 },
};

export default function AdminCoverageMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInitialized = useRef(false);
  const [markets, setMarkets] = useState<CoverageMarket[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.get<{ markets: CoverageMarket[] }>("/api/admin/inventory/coverage-map")
      .then((d) => setMarkets(d.markets ?? []))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (mapInitialized.current || !mapRef.current || !markets) return;

    // Dynamic import Leaflet — requires browser environment
    import("leaflet").then(L => {
      if (mapInitialized.current || !mapRef.current) return;
      mapInitialized.current = true;

      // Fix Leaflet default marker icons in Next.js
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!).setView([39.5, -98.35], 4);

      // OpenStreetMap tiles — no API key required
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      // Coverage markers for each market with known coordinates
      markets.forEach(market => {
        const geo = CITY_GEO[market.city.trim().toLowerCase()];
        if (!geo) return;
        const color = market.listingCount > 50 ? "#4CAF50" : market.listingCount > 10 ? "#2196F3" : "#0B5FD1";
        const marker = L.circleMarker([geo.lat, geo.lng], {
          radius: Math.max(8, Math.min(20, 8 + market.listingCount / 10)),
          fillColor: color,
          color: "#fff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        }).addTo(map);
        marker.bindPopup(`
          <strong>${market.city}, ${market.state}</strong><br/>
          ${market.listingCount} active listings<br/>
          <small>AutoLenis market coverage</small>
        `);
      });
    }).catch(err => {
      logger.error("Leaflet failed to load:", err);
    });
  }, [markets]);

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="coverage-map-page">
      <div className="flex items-center gap-3 mb-6">
        <MapPin size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Inventory Coverage Map</h1>
        <span className="text-xs text-slate-400">(Leaflet.js — no Google Maps)</span>
      </div>

      {loadError ? (
        <div className="bg-white border border-red-200 rounded-xl mb-6">
          <ErrorState
            title="Failed to load market coverage"
            description="Live listing counts could not be fetched — reload to retry."
            onRetry={() => window.location.reload()}
            data-testid="coverage-load-error"
          />
        </div>
      ) : !markets ? (
        <div className="flex items-center justify-center py-24 text-slate-400" data-testid="coverage-loading">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading markets…
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            <div ref={mapRef} style={{ height: "500px", width: "100%" }} data-testid="leaflet-map" />
          </div>

          {markets.length === 0 ? (
            <div className="text-center py-10 text-slate-400 bg-white border border-slate-200 rounded-xl" data-testid="coverage-empty">
              <p className="font-medium text-slate-500">No active markets yet</p>
              <p className="text-xs mt-1">Markets appear here once market coverage records are active.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {markets.map(market => (
                <div key={`${market.city}-${market.state}`} data-testid={`market-card-${market.city.replace(/[^a-z]/gi, "-").toLowerCase()}`}
                  className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-medium text-slate-800">{market.city}, {market.state}</p>
                  <p className="text-xs text-slate-400">{market.listingCount} listings</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
