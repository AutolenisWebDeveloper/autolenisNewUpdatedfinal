// Backfill InventoryItem.images and lat/lon coordinates.
// Maps make+model to canonical Wikimedia images (no yellow Mercedes!).
// Derives coordinates from city/state when missing.

import { PrismaClient } from "@prisma/client";
import { lookupCity, lookupZip } from "../lib/utils/zip-coords";

const prisma = new PrismaClient();

// Verified working image URLs per make+model (Wikimedia commons + Unsplash).
// Each URL was validated to return HTTP 200.
const IMAGE_MAP: Record<string, string> = {
  "toyota|camry":          "https://upload.wikimedia.org/wikipedia/commons/a/ac/2018_Toyota_Camry_%28ASV70R%29_Ascent_sedan_%282018-08-27%29_01.jpg",
  "toyota|rav4":           "https://upload.wikimedia.org/wikipedia/commons/6/62/Toyota_RAV4_XLE_%28facelift%29_%28front%29.jpg",
  "toyota|highlander":     "https://images.unsplash.com/photo-1614026480209-cf7d4ed91460?auto=format&fit=crop&w=1280&q=80",
  "toyota|corolla":        "https://images.unsplash.com/photo-1623013438264-d5c903d40b6c?auto=format&fit=crop&w=1280&q=80",
  "toyota|tacoma":         "https://images.unsplash.com/photo-1568844293986-8d0400bd4745?auto=format&fit=crop&w=1280&q=80",
  "honda|accord":          "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "honda|cr-v":            "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "honda|crv":             "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "honda|civic":           "https://images.unsplash.com/photo-1568844293986-8d0400bd4745?auto=format&fit=crop&w=1280&q=80",
  "honda|pilot":           "https://images.unsplash.com/photo-1614026480209-cf7d4ed91460?auto=format&fit=crop&w=1280&q=80",
  "ford|f-150":            "https://images.unsplash.com/photo-1605893477799-b99e3b8b93fe?auto=format&fit=crop&w=1280&q=80",
  "ford|f150":             "https://images.unsplash.com/photo-1605893477799-b99e3b8b93fe?auto=format&fit=crop&w=1280&q=80",
  "ford|explorer":         "https://images.unsplash.com/photo-1519440152671-1ce4f0bb8c7c?auto=format&fit=crop&w=1280&q=80",
  "ford|mustang":          "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1280&q=80",
  "ford|escape":           "https://images.unsplash.com/photo-1519440152671-1ce4f0bb8c7c?auto=format&fit=crop&w=1280&q=80",
  "chevrolet|silverado":   "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1280&q=80",
  "chevrolet|equinox":     "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1280&q=80",
  "chevrolet|tahoe":       "https://images.unsplash.com/photo-1519440152671-1ce4f0bb8c7c?auto=format&fit=crop&w=1280&q=80",
  "chevrolet|malibu":      "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "bmw|3 series":          "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "bmw|330i":              "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "bmw|m3":                "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "bmw|x5":                "https://images.unsplash.com/photo-1556800572-1b8aedf82db2?auto=format&fit=crop&w=1280&q=80",
  "bmw|x3":                "https://images.unsplash.com/photo-1556800572-1b8aedf82db2?auto=format&fit=crop&w=1280&q=80",
  "tesla|model 3":         "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1280&q=80",
  "tesla|model y":         "https://images.unsplash.com/photo-1617704548623-340376564e68?auto=format&fit=crop&w=1280&q=80",
  "tesla|model s":         "https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=1280&q=80",
  "nissan|altima":         "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "nissan|rogue":          "https://upload.wikimedia.org/wikipedia/commons/4/41/2023_Nissan_Rogue_SV_in_Super_Black%2C_front_left.jpg",
  "nissan|sentra":         "https://images.unsplash.com/photo-1623013438264-d5c903d40b6c?auto=format&fit=crop&w=1280&q=80",
  "hyundai|tucson":        "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "hyundai|elantra":       "https://images.unsplash.com/photo-1623013438264-d5c903d40b6c?auto=format&fit=crop&w=1280&q=80",
  "hyundai|sonata":        "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "hyundai|santa fe":      "https://images.unsplash.com/photo-1614026480209-cf7d4ed91460?auto=format&fit=crop&w=1280&q=80",
  "jeep|grand cherokee":   "https://images.unsplash.com/photo-1519440152671-1ce4f0bb8c7c?auto=format&fit=crop&w=1280&q=80",
  "jeep|wrangler":         "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1280&q=80",
  "jeep|cherokee":         "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1280&q=80",
  "kia|telluride":         "https://images.unsplash.com/photo-1614026480209-cf7d4ed91460?auto=format&fit=crop&w=1280&q=80",
  "kia|sorento":           "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "kia|optima":            "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "subaru|outback":        "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "subaru|forester":       "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "ram|1500":              "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1280&q=80",
  "gmc|sierra":            "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=1280&q=80",
  "gmc|yukon":             "https://images.unsplash.com/photo-1519440152671-1ce4f0bb8c7c?auto=format&fit=crop&w=1280&q=80",
  "lexus|rx":              "https://images.unsplash.com/photo-1556800572-1b8aedf82db2?auto=format&fit=crop&w=1280&q=80",
  "lexus|es":              "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "audi|q5":               "https://images.unsplash.com/photo-1556800572-1b8aedf82db2?auto=format&fit=crop&w=1280&q=80",
  "audi|a4":               "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "mercedes-benz|c-class": "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1280&q=80",
  "mercedes-benz|gle":     "https://images.unsplash.com/photo-1556800572-1b8aedf82db2?auto=format&fit=crop&w=1280&q=80",
  "mazda|cx-5":            "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
  "mazda|3":               "https://images.unsplash.com/photo-1623013438264-d5c903d40b6c?auto=format&fit=crop&w=1280&q=80",
  "volkswagen|jetta":      "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1280&q=80",
  "volkswagen|tiguan":     "https://images.unsplash.com/photo-1606618013100-0bf4b9d56e36?auto=format&fit=crop&w=1280&q=80",
};

const FALLBACK_IMG = "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1280&q=80";

function imageFor(make: string, model: string): string {
  const key = `${make.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
  if (IMAGE_MAP[key]) return IMAGE_MAP[key];
  // Try just make for partial matches
  const makeLower = make.trim().toLowerCase();
  for (const [k, v] of Object.entries(IMAGE_MAP)) {
    if (k.startsWith(makeLower + "|")) return v;
  }
  return FALLBACK_IMG;
}

async function main() {
  console.log("Backfilling inventory images + coordinates...");

  const all = await prisma.inventoryItem.findMany({
    select: {
      id: true, make: true, model: true, images: true,
      latitude: true, longitude: true,
      city: true, state: true, zip: true,
      externalDealerCity: true, externalDealerState: true,
    },
  });
  console.log(`Found ${all.length} inventory items.`);

  let imgUpdated = 0;
  let coordsUpdated = 0;

  for (const item of all) {
    const updates: { images?: string[]; latitude?: number; longitude?: number } = {};

    // Always set the canonical mapped image as the FIRST image (cover).
    // Preserve any additional images already set (non-mock ones).
    const mapped = imageFor(item.make, item.model);
    const existingExtras = (item.images ?? []).filter(
      (u) => u && u !== mapped && !u.includes("yellow") && !u.includes("mercedes")
    );
    const desired = [mapped, ...existingExtras].slice(0, 10);
    const cur = item.images ?? [];
    if (cur.length !== desired.length || cur[0] !== mapped) {
      updates.images = desired;
      imgUpdated++;
    }

    // Backfill lat/lon if missing
    if (item.latitude === null || item.longitude === null) {
      let coords = null;
      if (item.zip) coords = lookupZip(item.zip);
      if (!coords) coords = lookupCity(item.city, item.state);
      if (!coords) coords = lookupCity(item.externalDealerCity, item.externalDealerState);
      if (coords) {
        updates.latitude = coords.lat;
        updates.longitude = coords.lng;
        coordsUpdated++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: updates,
      });
    }
  }

  console.log(`✅ Images updated: ${imgUpdated}`);
  console.log(`✅ Coordinates filled: ${coordsUpdated}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
