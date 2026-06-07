// AMIPS Phase 1 — Metro geography helpers.
//
// The dealer + market pipelines associate dealers to metros and compute
// metro-level scores. Dealer records carry only city/state/zip (no metro), so
// we anchor each of the top 25 US metros to a center coordinate and use the
// shared Haversine helper to decide metro membership by distance.
//
// TOP_METROS (population, primary state, launch dealer-coverage proxy) is the
// single source of truth defined in the Phase 0 content-queue seeder. We
// re-export it here so the pipelines and seeders never drift apart.

import { TOP_METROS } from "@/lib/amips/seed/content-queue.seed";
import type { LatLng } from "@/lib/utils/zip-coords";

export { TOP_METROS };

// Approximate center coordinate for each of the top 25 metros. Keyed by the
// exact metro name used in TOP_METROS so lookups are O(1) and unambiguous.
export const METRO_CENTERS: Record<string, LatLng> = {
  "Los Angeles": { lat: 34.0522, lng: -118.2437 },
  "New York": { lat: 40.7128, lng: -74.006 },
  "Dallas-Fort Worth": { lat: 32.7767, lng: -96.797 },
  Houston: { lat: 29.7604, lng: -95.3698 },
  Chicago: { lat: 41.8781, lng: -87.6298 },
  Miami: { lat: 25.7617, lng: -80.1918 },
  Atlanta: { lat: 33.749, lng: -84.388 },
  "Washington DC": { lat: 38.9072, lng: -77.0369 },
  Phoenix: { lat: 33.4484, lng: -112.074 },
  Philadelphia: { lat: 39.9526, lng: -75.1652 },
  Detroit: { lat: 42.3314, lng: -83.0458 },
  Boston: { lat: 42.3601, lng: -71.0589 },
  "San Antonio": { lat: 29.4241, lng: -98.4936 },
  Austin: { lat: 30.2672, lng: -97.7431 },
  Seattle: { lat: 47.6062, lng: -122.3321 },
  Denver: { lat: 39.7392, lng: -104.9903 },
  Minneapolis: { lat: 44.9778, lng: -93.265 },
  Tampa: { lat: 27.9506, lng: -82.4572 },
  Charlotte: { lat: 35.2271, lng: -80.8431 },
  "San Diego": { lat: 32.7157, lng: -117.1611 },
  Portland: { lat: 45.5152, lng: -122.6784 },
  "Las Vegas": { lat: 36.1699, lng: -115.1398 },
  Nashville: { lat: 36.1627, lng: -86.7816 },
  Baltimore: { lat: 39.2904, lng: -76.6122 },
  Sacramento: { lat: 38.5816, lng: -121.4944 },
};

// A metro spans well beyond its core city, so membership uses a generous
// radius. Density (the Market Score "dealer competition" component) still uses
// the AMIPS-specified 30-mile radius — see DEALER_DENSITY_RADIUS_MILES.
export const METRO_MEMBERSHIP_RADIUS_MILES = 50;
export const DEALER_DENSITY_RADIUS_MILES = 30;

export interface MetroDef {
  metro: string;
  state: string;
  population: number;
  center: LatLng;
}

// The 25 metros joined to their center coordinate. Skips any metro missing a
// center (none, by construction) so callers can iterate safely.
export function getMetroDefs(): MetroDef[] {
  return TOP_METROS.flatMap((m) => {
    const center = METRO_CENTERS[m.metro];
    if (!center) return [];
    return [{ metro: m.metro, state: m.state, population: m.population, center }];
  });
}
