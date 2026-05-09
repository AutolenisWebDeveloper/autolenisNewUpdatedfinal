// Curated, verified-real Unsplash photo IDs grouped by make and body type.
// Goal: every seeded vehicle gets photos that match its body type at minimum,
// and matches its make where a make-specific photo exists. No more Mercedes-on-Accord.
//
// Each ID was verified to return HTTP 200 from
//   https://images.unsplash.com/{ID}?w=400&q=70
// before being added here.

export type BodyType = "SUV" | "SEDAN" | "TRUCK";

// Body-type generic fallback photos (no obvious wrong-brand badges).
// Used when no make-specific photo exists for the requested make.
const BY_BODY: Record<BodyType, string[]> = {
  TRUCK: [
    "photo-1605893477799-b99e3b8b93fe", // pickup truck blue
    "photo-1612825173281-9a193378527e", // white pickup
    "photo-1591293836027-e05b48473b67", // off-road truck
    "photo-1567808291548-fc3ee04dbcf0", // red truck
    "photo-1542314831-068cd1dbfeeb",    // truck profile
  ],
  SUV: [
    "photo-1493238792000-8113da705763", // generic SUV
    "photo-1606220838315-056192d5e927", // white SUV
    "photo-1568844293986-8d0400bd4745", // SUV
    "photo-1606664515524-ed2f786a0bd6", // luxury SUV
    "photo-1485291571150-772bcfc10da5", // silver SUV-ish
  ],
  SEDAN: [
    "photo-1583121274602-3e2820c69888", // black sedan
    "photo-1570733577524-3a047079e80d", // sedan
    "photo-1606016159991-dfe4f2746ad5", // sedan profile
  ],
};

// Make-specific photos. When a make is listed here we prefer these,
// because the photo is verified to show the correct brand (or close enough that
// no badge mismatch is visible).
// Key: make name as it appears in the catalog.
const BY_MAKE: Record<string, Partial<Record<BodyType, string[]>>> = {
  Honda: {
    SEDAN: [
      "photo-1555215695-3004980ad54e", // Honda Civic-style sedan
    ],
  },
  Jeep: {
    SUV: [
      "photo-1542228262-3d663b306a53",  // Jeep
      "photo-1517524008697-84bbe3c3fd98", // Jeep Wrangler
    ],
  },
  Ford: {
    TRUCK: [
      "photo-1542314831-068cd1dbfeeb", // Ford-style truck
      "photo-1605893477799-b99e3b8b93fe", // pickup
    ],
  },
};

/**
 * Pick a deterministic photo ID for a vehicle based on make + body type.
 * `seed` is used to vary photos across vehicles of the same make/body.
 */
export function pickPhotoIds(make: string, body: BodyType, seed: number): string[] {
  const makeBucket = BY_MAKE[make]?.[body] ?? [];
  const bodyBucket = BY_BODY[body];
  // Prefer make-specific bucket for the primary photo, body-generic for the secondary.
  const primary =
    makeBucket.length > 0
      ? makeBucket[seed % makeBucket.length]
      : bodyBucket[seed % bodyBucket.length];
  const secondary = bodyBucket[(seed + 3) % bodyBucket.length];
  return [primary, secondary];
}

/** Build full Unsplash CDN URLs for the given photo IDs. */
export function buildPhotoUrls(ids: string[]): string[] {
  return ids.map((id) => `https://images.unsplash.com/${id}?w=1200&q=80&auto=format&fit=crop`);
}

/** Map a model definition body string to our BodyType. */
export function bodyOf(model: { body: "SUV" | "SEDAN" | "TRUCK" }): BodyType {
  return model.body;
}
