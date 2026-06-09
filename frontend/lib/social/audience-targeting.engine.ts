// AutoLenis Social Engine — Audience Targeting Engine.
//
// Translates a post's metro + make into a Meta Ads targeting spec: a city set
// (Meta geo keys), a fixed age band, and automotive interest ids (plus the
// make-specific interest when known). Pure + side-effect free — consumed by the
// ads/boost layer when building targeted campaigns from organic posts.

export interface MetaTargeting {
  geo_locations: {
    cities?: { key: string; name: string }[];
    country_groups?: string[];
  };
  age_min: number;
  age_max: number;
  interests: { id: string; name: string }[];
}

const METRO_TO_META_CITIES: Record<string, { key: string; name: string }[]> = {
  "dallas-fort worth": [
    { key: "2421836", name: "Dallas" },
    { key: "2421837", name: "Fort Worth" },
    { key: "2508428", name: "Plano" },
    { key: "2508429", name: "Frisco" },
    { key: "2508427", name: "McKinney" },
  ],
  "houston": [{ key: "2421649", name: "Houston" }],
  "austin": [{ key: "2420420", name: "Austin" }],
  "san antonio": [{ key: "2421977", name: "San Antonio" }],
  "miami": [
    { key: "2421765", name: "Miami" },
    { key: "2421766", name: "Miami Beach" },
  ],
  "atlanta": [{ key: "2420406", name: "Atlanta" }],
  "chicago": [{ key: "2420931", name: "Chicago" }],
  "los angeles": [{ key: "2420644", name: "Los Angeles" }],
  "new york": [{ key: "2421869", name: "New York City" }],
  "phoenix": [{ key: "2421886", name: "Phoenix" }],
  "denver": [{ key: "2421156", name: "Denver" }],
  "seattle": [{ key: "2422177", name: "Seattle" }],
  "nashville": [{ key: "2421832", name: "Nashville" }],
  "charlotte": [{ key: "2421019", name: "Charlotte" }],
  "tampa": [{ key: "2422065", name: "Tampa" }],
};

const AUTOMOTIVE_INTERESTS = [
  { id: "6003113862816", name: "Automobile buying" },
  { id: "6003107902433", name: "Vehicles" },
  { id: "6003139266461", name: "Automobile financing" },
  { id: "6003108433498", name: "Automobile dealership" },
];

const MAKE_INTERESTS: Record<string, { id: string; name: string }> = {
  ford: { id: "6003109432711", name: "Ford Motor Company" },
  toyota: { id: "6003480468700", name: "Toyota" },
  chevrolet: { id: "6003193660054", name: "Chevrolet" },
  honda: { id: "6003116743250", name: "Honda" },
};

export function buildMetaTargeting(post: {
  metro?: string | null;
  geoTarget?: string | null;
  make?: string | null;
}): MetaTargeting {
  const metro = (post.metro ?? post.geoTarget ?? "").toLowerCase();
  const cities =
    METRO_TO_META_CITIES[metro] ??
    Object.values(METRO_TO_META_CITIES).flat().slice(0, 3);

  const interests = [...AUTOMOTIVE_INTERESTS];
  const make = (post.make ?? "").toLowerCase();
  if (MAKE_INTERESTS[make]) {
    interests.push(MAKE_INTERESTS[make]);
  }

  return {
    geo_locations: { cities },
    age_min: 25,
    age_max: 65,
    interests,
  };
}
