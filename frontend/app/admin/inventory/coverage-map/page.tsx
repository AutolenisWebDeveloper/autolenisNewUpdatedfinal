// /admin/inventory/coverage-map — ENH-12
// Leaflet.js only — NOT Google Maps (hard constraint)

"use client";

import { useEffect, useRef } from "react";
import { MapPin } from "lucide-react";

const COVERAGE_MARKETS = [
  { city: "New York, NY", lat: 40.7128, lng: -74.0060, count: 0 },
  { city: "Los Angeles, CA", lat: 34.0522, lng: -118.2437, count: 0 },
  { city: "Chicago, IL", lat: 41.8781, lng: -87.6298, count: 0 },
  { city: "Houston, TX", lat: 29.7604, lng: -95.3698, count: 0 },
  { city: "Atlanta, GA", lat: 33.7490, lng: -84.3880, count: 0 },
  { city: "Dallas, TX", lat: 32.7767, lng: -96.7970, count: 0 },
  { city: "Miami, FL", lat: 25.7617, lng: -80.1918, count: 0 },
  { city: "Phoenix, AZ", lat: 33.4484, lng: -112.0740, count: 0 },
];

export default function AdminCoverageMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInitialized = useRef(false);

  useEffect(() => {
    if (mapInitialized.current || !mapRef.current) return;

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

      // Coverage markers for each market
      COVERAGE_MARKETS.forEach(market => {
        const color = market.count > 50 ? "#4CAF50" : market.count > 10 ? "#2196F3" : "#0B5FD1";
        const marker = L.circleMarker([market.lat, market.lng], {
          radius: Math.max(8, Math.min(20, 8 + market.count / 10)),
          fillColor: color,
          color: "#fff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        }).addTo(map);

        marker.bindPopup(`
          <strong>${market.city}</strong><br/>
          ${market.count} active listings<br/>
          <small>AutoLenis market coverage</small>
        `);
      });
    }).catch(err => {
      console.error("Leaflet failed to load:", err);
    });
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="coverage-map-page">
      <div className="flex items-center gap-3 mb-6">
        <MapPin size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Inventory Coverage Map</h1>
        <span className="text-xs text-slate-400">(Leaflet.js — no Google Maps)</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
        <div ref={mapRef} style={{ height: "500px", width: "100%" }} data-testid="leaflet-map" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {COVERAGE_MARKETS.map(market => (
          <div key={market.city} data-testid={`market-card-${market.city.replace(/[^a-z]/gi, "-").toLowerCase()}`}
            className="bg-white border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-slate-800">{market.city}</p>
            <p className="text-xs text-slate-400">{market.count} listings</p>
          </div>
        ))}
      </div>
    </div>
  );
}
