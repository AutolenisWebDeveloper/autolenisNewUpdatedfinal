// ───────────────────────────────────────────────────────────────────────────
//  AutoLenis programmatic local-SEO location dataset.
//
//  This is the single source of truth for the /car-buying-service hub + city
//  pages. Adding a market = adding an object to SEO_LOCATIONS (no rebuild).
//
//  FUTURE-PROOFING FOR NATIONAL SCALE
//  Every record is keyed by a flat `slug` today (/car-buying-service/frisco),
//  but each also carries `state` + `stateAbbr`, so a future [state]/[city]
//  hierarchy (/car-buying-service/tx/frisco) can be adopted by changing only
//  the route + URL helpers below — the data shape already supports it.
//
//  MIGRATION PATH TO PRISMA
//  The SeoLocation interface maps 1:1 to a future `SeoLocation` Prisma model
//  (slug @unique, city, state, stateAbbr, lat, lng, metro, JSON content blocks).
//  When that model lands, replace the SEO_LOCATIONS array with a DB query and
//  keep the same accessor functions.
//
//  DOORWAY-PAGE SAFETY
//  Each record must carry genuinely unique local content (uniqueIntro,
//  localContext, localFaqs, nearbyAreas). The city template refuses to publish
//  a record that is missing this unique data — thin keyword+city-swap pages are
//  structurally impossible.
//
//  COMPLIANCE: AutoLenis represents the BUYER. Copy here never implies AutoLenis
//  is a dealer, lender, or issues credit/loan approvals. Use concierge, buyer's
//  agent, eligibility, prequalification, financing coordination, and
//  "dealers compete for your business."
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-page form attribution. Value is persisted to VehicleRequest.landingSource
 * (pending migration) so paid vs organic conversions can be segmented.
 */
export type FormSource =
  | "lp_facebook"
  | "seo_texas_hub"
  | "seo_city_allen"
  | "seo_city_arlington"
  | "seo_city_dallas"
  | "seo_city_denton"
  | "seo_city_fort_worth"
  | "seo_city_frisco"
  | "seo_city_little_elm"
  | "seo_city_mckinney"
  | "seo_city_plano"
  | "seo_city_prosper";

export interface SeoLocalFaq {
  q: string;
  a: string;
}

export interface SeoLocation {
  slug: string;              // "frisco" — lowercase, kebab-case. NEVER a metro.
  city: string;              // "Frisco"
  state: "Texas";
  stateAbbr: "TX";
  lat: number;
  lng: number;
  metro: "Dallas-Fort Worth";
  uniqueIntro: string;       // 150+ words, specific to this city
  localContext: string;      // 100+ words on local market dynamics
  localFaqs: SeoLocalFaq[];  // min 3 city-specific Q&A
  nearbyAreas: string[];     // named local areas / neighborhoods
  testimonialSlots: number;  // count of {{CONFIRM_WITH_OWNER}} testimonial slots
  heroImage: string;         // "/images/seo/city-frisco-hero.jpg"
  heroImageAlt: string;
  heroImageCredit?: string;  // Unsplash attribution placeholder ({{CONFIRM_WITH_OWNER}})
}

// Shared Unsplash placeholder credit — every hero image is a launch placeholder
// flagged {{CONFIRM_WITH_OWNER}} for replacement with real local photography.
const PLACEHOLDER_CREDIT = "Photo via Unsplash (placeholder — {{CONFIRM_WITH_OWNER}}: replace with licensed local photography)";

function heroAlt(city: string): string {
  return `Car buying service in ${city}, TX — AutoLenis concierge`;
}

export const SEO_LOCATIONS: SeoLocation[] = [
  {
    slug: "allen",
    city: "Allen",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.1032,
    lng: -96.6706,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Buying a car in Allen usually means circling the dealership corridors along US-75 and Stacy Road, then repeating the same negotiation at three or four stores before you trust the number in front of you. AutoLenis replaces that loop. As a buyer-side concierge, we represent you — not the dealership — and run a private reverse auction where verified North Texas dealers compete for your business. Allen families shopping for a three-row SUV for the school run to Lowery Freshman Center, or a commuter sedan for the daily push down the Central Expressway into Plano and Dallas, tell us the exact vehicle they want. We source it across dealer inventory and dealer auctions, negotiate the out-the-door price, and coordinate financing so you compare real, written offers from home. No showroom laps, no four-square worksheets, no pressure — just dealers bidding for the chance to earn your purchase while you keep your evenings free.",
    localContext:
      "Allen sits in the fast-growing Collin County stretch between McKinney and Plano, and its buyers are overwhelmingly commuters who value time over a Saturday spent dealership-hopping. The retail auto presence is concentrated near the US-75 and Sam Rayburn Tollway interchanges, which gives local shoppers a handful of nearby franchise stores but the same limited leverage. Because AutoLenis pulls offers from dealers across the entire DFW metro — not just the lots a few minutes from Watters Creek — Allen buyers routinely see competition from inventory in Frisco, McKinney, and Dallas they would never have driven to. That wider pool is exactly what a private reverse auction is built to surface.",
    localFaqs: [
      { q: "Do I have to visit Allen dealerships to use AutoLenis?", a: "No. You submit one vehicle request from home and verified dealers across DFW compete for your business. You only meet a dealer once you have chosen a written offer — typically just to complete paperwork and pick up the car." },
      { q: "Can AutoLenis find a specific vehicle near Allen?", a: "Yes. We source across dealer inventory and dealer auctions throughout North Texas, so a hard-to-find trim that isn't on a local US-75 lot can still come to you through a competing dealer." },
      { q: "How far do competing dealers come from for an Allen buyer?", a: "Offers commonly arrive from dealers across the Dallas-Fort Worth metro — including Frisco, McKinney, Plano, and Dallas — not just the stores nearest Allen. That wider pool is what drives competitive pricing." },
    ],
    nearbyAreas: ["Watters Creek", "Twin Creeks", "Allen Station", "Star Creek", "Montgomery Farm"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-allen-hero.jpg",
    heroImageAlt: heroAlt("Allen"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "arlington",
    city: "Arlington",
    state: "Texas",
    stateAbbr: "TX",
    lat: 32.7357,
    lng: -97.1081,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Arlington sits squarely in the middle of the metroplex — between Dallas and Fort Worth, wrapped around the Entertainment District — which means car buyers here have a lot of dealerships within reach and almost no way to make them compete on the same day. AutoLenis fixes that. We are a buyer-side concierge: we work for you, run a private reverse auction, and let verified dealers across both halves of DFW bid for your purchase. Whether you need a durable family SUV for the haul to AT&T Stadium and Globe Life Field traffic, a fuel-sipping commuter for the I-30 and I-20 grind, or a work truck that holds its value, you tell us the vehicle and we bring the offers to you. We negotiate the out-the-door price, fold in trade-in and financing coordination, and hand you written, comparable offers — so the dealerships do the competing instead of you doing the driving.",
    localContext:
      "Arlington is unusual because it is a major city with no commuter rail, so residents drive everywhere and vehicle choice is a serious household decision. Its central position between two downtowns means an Arlington buyer can realistically pull competing offers from Fort Worth dealers to the west and Dallas/Mid-Cities dealers to the east — a genuinely two-sided market that most local shoppers never tap because driving the full spread in a weekend is impractical. AutoLenis runs that spread for you. The Entertainment District and the University of Texas at Arlington also keep demand high for both family-size SUVs and affordable used commuters, the two segments where dealer competition moves price the most.",
    localFaqs: [
      { q: "Can AutoLenis pull offers from both Dallas and Fort Worth dealers for an Arlington buyer?", a: "Yes — that is the advantage of Arlington's central location. Our reverse auction invites verified dealers from both sides of the metroplex, so you see two-sided competition instead of whatever is closest to home." },
      { q: "Is AutoLenis a good fit for a budget used-car purchase in Arlington?", a: "Yes. We coordinate competing offers across price points, and affordable used commuters are one of the segments where dealer competition most reliably lowers the out-the-door price." },
      { q: "Do I need to go to the Entertainment District dealerships in person?", a: "No. You compare written offers from home and only meet a dealer after you have chosen one — usually just to finalize paperwork and take delivery." },
    ],
    nearbyAreas: ["Entertainment District", "Viridian", "Dalworthington Gardens", "Pantego", "North Arlington"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-arlington-hero.jpg",
    heroImageAlt: heroAlt("Arlington"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "dallas",
    city: "Dallas",
    state: "Texas",
    stateAbbr: "TX",
    lat: 32.7767,
    lng: -96.7970,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Dallas has more car dealerships than almost anywhere in Texas, and that abundance is exactly why buying here is so exhausting — the choices are endless and every store wants you to negotiate alone. AutoLenis is the buyer-side concierge that flips it. We represent you, not the dealer, and run a private reverse auction where verified Dallas-area dealers compete for your business while you stay home. From a luxury crossover for Preston Hollow and Lakewood households to a practical commuter for the daily run down Central Expressway or the Dallas North Tollway, you tell us the exact vehicle and budget. We search dealer inventory and dealer auctions across the metro, negotiate the out-the-door price, coordinate financing or a trade-in, and deliver written offers you can compare side by side. In a city this big, the leverage isn't more dealerships to visit — it's making them bid against each other. That is what we do for every Dallas buyer.",
    localContext:
      "Dallas is the dense, high-volume core of the metroplex, with major dealer clusters along Central Expressway, the LBJ corridor, and the Dallas North Tollway. The sheer number of franchise and independent stores means inventory is deep but pricing is opaque — two buyers can pay very different prices for the same car the same week. That opacity is precisely what a reverse auction removes: when verified dealers know they are bidding against each other for a defined Dallas buyer, the structured, written offers expose the real market price. Dallas also has strong demand across every segment, from luxury and EV to budget used, so there is almost always a competing dealer motivated to win the deal.",
    localFaqs: [
      { q: "There are so many Dallas dealerships — why use AutoLenis?", a: "Volume is the problem, not the solution. More stores to visit doesn't give you leverage; making them bid against each other does. We run that private reverse auction so Dallas dealers compete on a written, comparable price." },
      { q: "Can AutoLenis handle luxury or EV purchases in Dallas?", a: "Yes. Dallas has deep demand and inventory across luxury, EV, and budget segments, so we can source and run competition for nearly any vehicle you specify." },
      { q: "Will I get a better price than negotiating a Dallas dealership myself?", a: "Our model is built to expose the real market price by making dealers compete. We never guarantee a specific figure, but structured, side-by-side offers consistently surface a more competitive out-the-door number than solo negotiation." },
    ],
    nearbyAreas: ["Uptown", "Lakewood", "Bishop Arts District", "Preston Hollow", "Deep Ellum"],
    testimonialSlots: 3,
    heroImage: "/images/seo/city-dallas-hero.jpg",
    heroImageAlt: heroAlt("Dallas"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "denton",
    city: "Denton",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.2148,
    lng: -97.1331,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Denton anchors the northwest corner of the metroplex, where two universities, a historic square, and fast suburban growth create a car market unlike the rest of DFW. AutoLenis serves it as a buyer-side concierge — we work for you, not the dealership, and run a private reverse auction so verified North Texas dealers compete for your purchase. A University of North Texas or Texas Woman's University family hunting an affordable, reliable used car, a Robson Ranch retiree wanting a comfortable crossover, or a tradesperson needing a dependable truck all face the same friction: a limited cluster of local lots and a long drive south to widen the search. We remove the drive. You tell us the vehicle and budget; we source across dealer inventory and dealer auctions, negotiate the out-the-door price, and coordinate financing — then bring you written offers to compare at home. The dealers compete; you keep your time and your leverage.",
    localContext:
      "Denton's market is shaped by its university population and its position at the top of I-35E and I-35W, where the metroplex splits toward Dallas and Fort Worth. Local dealer choice is thinner than in the Collin County suburbs, so Denton buyers historically had to drive toward Lewisville or beyond to create real competition. That geography is exactly why a reverse auction pays off here: AutoLenis invites dealers from across the wider metro to bid, so a Denton buyer sees the same competitive pressure as someone shopping in Frisco or Dallas without leaving town. Strong, steady demand for affordable used vehicles — driven by the student and young-professional population — also makes value-segment competition especially active.",
    localFaqs: [
      { q: "Denton has fewer dealerships than the bigger suburbs — does AutoLenis still help?", a: "Especially here. Because local choice is thinner, our reverse auction invites dealers from across the wider metro to compete, so a Denton buyer gets the same pricing pressure as a Frisco or Dallas shopper without the drive south." },
      { q: "Is AutoLenis good for an affordable used car near the universities?", a: "Yes. Value-segment demand around UNT and TWU is strong, and used commuters are one of the categories where dealer competition most reliably improves the out-the-door price." },
      { q: "Can you coordinate financing for a first-time buyer in Denton?", a: "Yes. We coordinate financing as part of the concierge process and run a soft prequalification — we never issue credit ourselves, and submitting a request does not affect your credit score." },
    ],
    nearbyAreas: ["Denton Square", "Robson Ranch", "Rayzor Ranch", "Southridge", "University area"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-denton-hero.jpg",
    heroImageAlt: heroAlt("Denton"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "fort-worth",
    city: "Fort Worth",
    state: "Texas",
    stateAbbr: "TX",
    lat: 32.7555,
    lng: -97.3308,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Fort Worth is its own city with its own character, and its car buyers shouldn't have to settle for whichever west-side lot is closest. AutoLenis is the buyer-side concierge that brings the whole metroplex to you. We represent you — not the dealer — and run a private reverse auction where verified dealers compete for your business while you stay home in Tanglewood, the Near Southside, or out by Alliance. Trucks matter here, and so does value: whether you want a full-size pickup that holds its worth, a family SUV for the Clearfork and TCU-area school runs, or a clean used commuter for the I-35W push, you tell us the vehicle and budget. We source across dealer inventory and dealer auctions, negotiate the out-the-door price, and coordinate financing and trade-in — then deliver written offers you can compare side by side. The dealers do the competing; you keep the leverage and your Saturday.",
    localContext:
      "Fort Worth has a distinct, truck-heavy buying culture and a dealer base concentrated on the west and north sides, including the fast-growing Alliance corridor along I-35W. Because the city sits at the western edge of the metroplex, local buyers often don't realize how many Dallas-side and Mid-Cities dealers would happily bid for their business — driving that full spread is impractical, so most Fort Worth shoppers negotiate with whoever is nearby. AutoLenis runs the spread for you, inviting dealers from across DFW into a private reverse auction. Pickup trucks in particular reward competition: pricing varies widely by store and incentive, so structured, side-by-side offers tend to surface real savings on exactly the vehicles Fort Worth buys most.",
    localFaqs: [
      { q: "Can AutoLenis get competitive truck pricing for a Fort Worth buyer?", a: "Yes — trucks are one of the best categories for our model. Pickup pricing varies widely by store and incentive, so a private reverse auction that makes dealers bid against each other tends to surface real savings." },
      { q: "Do competing offers only come from west-side Fort Worth dealers?", a: "No. We invite verified dealers from across the metroplex, including Dallas-side and Mid-Cities stores, so you get competition you couldn't practically reach by driving." },
      { q: "I live near Alliance — can you still help?", a: "Yes. Your location doesn't limit the auction. Dealers compete to deliver the vehicle you specified regardless of which part of Fort Worth you call home." },
    ],
    nearbyAreas: ["Sundance Square", "TCU / West Cliff", "Clearfork", "Alliance", "Near Southside"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-fort-worth-hero.jpg",
    heroImageAlt: heroAlt("Fort Worth"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "frisco",
    city: "Frisco",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.1507,
    lng: -96.8236,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Frisco grew faster than almost any city in America, and its car market shows it — premium demand, packed dealership corridors along the Sam Rayburn Tollway and Preston Road, and buyers whose time is worth far more than a Saturday of negotiating. AutoLenis is the buyer-side concierge built for exactly that. We represent you, not the dealership, and run a private reverse auction where verified DFW dealers compete for your purchase while you stay home in Stonebriar, Phillips Creek Ranch, or Newman Village. Whether it's a three-row luxury SUV for the family schedule around The Star and Frisco Square, a low-mileage commuter for the Dallas North Tollway run, or a specific hard-to-find trim, you tell us the vehicle and budget. We source across dealer inventory and dealer auctions, negotiate the out-the-door price, coordinate financing and trade-in, and bring you written, comparable offers. In a city that prizes its time, the smartest move is making dealers compete for you.",
    localContext:
      "Frisco is one of the highest-income, fastest-growing suburbs in the country, and its buyers skew toward premium and family-size vehicles with little patience for traditional dealership friction. The Preston Road and Sam Rayburn Tollway corridors are dense with franchise stores, which feels like choice but still leaves shoppers negotiating one lot at a time. Because AutoLenis pulls competing offers from dealers across the entire metroplex, Frisco buyers frequently see bids on inventory in Dallas, Plano, and beyond that they'd never have driven to. High demand for popular SUV and luxury trims also means dealers are motivated to win these deals — ideal conditions for a reverse auction to move price. AutoLenis is headquartered in Frisco, so this is our home market.",
    localFaqs: [
      { q: "Frisco has plenty of dealerships — why use a concierge?", a: "Dense dealer corridors feel like choice, but you're still negotiating one lot at a time. AutoLenis makes verified dealers across the metro bid against each other for your business, which is where the real leverage and time savings come from." },
      { q: "Can AutoLenis find a specific luxury or hard-to-find trim in Frisco?", a: "Yes. We source across dealer inventory and dealer auctions metro-wide, so a specific trim that isn't sitting on a Preston Road lot can still reach you through a competing dealer." },
      { q: "Is AutoLenis based in Frisco?", a: "Yes — AutoLenis is headquartered in Frisco, Texas, so this is our home market and the area we know best." },
    ],
    nearbyAreas: ["Stonebriar", "Frisco Square", "The Star", "Phillips Creek Ranch", "Newman Village"],
    testimonialSlots: 3,
    heroImage: "/images/seo/city-frisco-hero.jpg",
    heroImageAlt: heroAlt("Frisco"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "little-elm",
    city: "Little Elm",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.1626,
    lng: -96.9375,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Little Elm wraps around Lewisville Lake, and its rapid growth has outpaced its local dealership options — which means buyers here almost always drive to Frisco, Denton, or beyond just to start shopping. AutoLenis ends that drive. We are a buyer-side concierge: we work for you, not the dealer, and run a private reverse auction so verified North Texas dealers compete for your purchase while you stay home in Sunset Pointe, Paloma Creek, or near the Lakefront District. Lake-town households tend to need versatile vehicles — a tow-capable SUV, a family three-row, or a dependable commuter for the FM-423 and Eldorado Parkway run toward Frisco — and getting competitive pricing usually meant a half-day of lot-hopping in neighboring cities. Now you tell us the vehicle and budget, and we source across dealer inventory and dealer auctions, negotiate the out-the-door price, coordinate financing, and deliver written offers to compare. The dealers compete; you stay by the lake.",
    localContext:
      "Little Elm is a young, fast-growing community on the shores of Lewisville Lake with comparatively few car dealerships inside its own borders, so residents have historically shopped in adjacent Frisco, Denton, and Lewisville. That dependence on neighboring markets is exactly the friction a reverse auction removes — AutoLenis invites dealers from across the metroplex to bid, so a Little Elm buyer gets metro-wide competition without driving to it. The lake lifestyle also skews demand toward versatile and tow-capable SUVs and trucks, and the area's many growing master-planned neighborhoods like Paloma Creek mean steady demand for practical family vehicles, where dealer competition tends to deliver the clearest savings.",
    localFaqs: [
      { q: "Little Elm doesn't have many dealerships — can AutoLenis still help?", a: "That's exactly when our model helps most. Instead of driving to Frisco or Denton to shop, you submit one request and dealers from across the metro compete to deliver the vehicle you want." },
      { q: "Can AutoLenis source a tow-capable SUV or truck for lake life?", a: "Yes. We source across dealer inventory and dealer auctions metro-wide, so versatile and tow-capable vehicles are well within reach even if they aren't on a nearby lot." },
      { q: "Do I have to drive to a neighboring city to finish the purchase?", a: "Only to take delivery once you've chosen a written offer. The shopping, negotiating, and comparison all happen from home." },
    ],
    nearbyAreas: ["Lakefront District", "Sunset Pointe", "Paloma Creek", "Frisco Lakes", "The Lakes"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-little-elm-hero.jpg",
    heroImageAlt: heroAlt("Little Elm"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "mckinney",
    city: "McKinney",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.1972,
    lng: -96.6398,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "McKinney pairs a beloved historic downtown with some of the fastest suburban growth in Collin County, and its car buyers want the convenience of that lifestyle without the dealership grind. AutoLenis delivers it. We are a buyer-side concierge — we represent you, not the dealer — and run a private reverse auction so verified North Texas dealers compete for your purchase while you stay home in Stonebridge Ranch, Craig Ranch, or near Adriatica Village. A growing family needing a three-row SUV for the schools around Stonebridge, a professional commuting down US-75 toward Plano and Dallas, or a buyer hunting a specific trim all face the same limited-leverage negotiation at the local lots. We change that. You tell us the vehicle and budget; we source across dealer inventory and dealer auctions, negotiate the out-the-door price, coordinate financing and trade-in, and bring you written offers to compare side by side. The dealers do the competing while you enjoy the McKinney you moved here for.",
    localContext:
      "McKinney is the Collin County seat and one of the fastest-growing cities in the nation, with a dealer presence concentrated along US-75 and a buyer base split between established neighborhoods and booming master-planned communities like Stonebridge Ranch and Trinity Falls. That growth means strong, steady demand for family SUVs and commuter sedans, and proximity to the Frisco, Allen, and Plano dealer clusters means a McKinney buyer is surrounded by competition they can't easily harness on their own. A reverse auction harnesses it for them: AutoLenis invites dealers from across the metro to bid, turning McKinney's central-Collin location into genuine pricing leverage instead of just a lot of stores to drive past.",
    localFaqs: [
      { q: "Can AutoLenis make nearby Frisco, Allen, and Plano dealers compete for a McKinney buyer?", a: "Yes. McKinney sits in the middle of those dealer clusters, and our reverse auction invites them all to bid — turning your central location into real pricing leverage." },
      { q: "Is AutoLenis a fit for a growing family in Stonebridge Ranch?", a: "Yes. Family SUVs are a core segment for us, and dealer competition tends to move price most on exactly those high-demand three-row vehicles." },
      { q: "Do I have to negotiate at a US-75 dealership myself?", a: "No. We negotiate the out-the-door price on your behalf and deliver written offers — you only meet a dealer to finalize the purchase you've chosen." },
    ],
    nearbyAreas: ["Historic Downtown McKinney", "Stonebridge Ranch", "Adriatica Village", "Craig Ranch", "Tucker Hill"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-mckinney-hero.jpg",
    heroImageAlt: heroAlt("McKinney"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "plano",
    city: "Plano",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.0198,
    lng: -96.6989,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Plano is corporate headquarters country — Legacy West, the Tollway, and a population of busy professionals who have no interest in spending a Saturday being worked over at a dealership. AutoLenis is the buyer-side concierge that fits that life. We represent you, not the dealer, and run a private reverse auction where verified DFW dealers compete for your purchase while you stay home in West Plano, Willow Bend, or near historic downtown. Whether you want an executive sedan or EV for the Legacy West commute, a three-row SUV for the family schedule, or a specific trim you've already researched down to the option package, you tell us the vehicle and budget. We source across dealer inventory and dealer auctions, negotiate the out-the-door price, coordinate financing and trade-in, and deliver written offers you can compare in minutes. Plano buyers are precise and time-poor — making dealers compete for a clearly defined request is the most efficient way to buy.",
    localContext:
      "Plano is one of DFW's wealthiest and most corporate cities, home to major headquarters around Legacy West and a dense dealer presence along the Dallas North Tollway and Central Expressway. Its buyers tend to be informed, decisive, and short on time, with strong demand for executive sedans, EVs, and premium SUVs. Ironically, all that local dealer density still leaves an individual shopper negotiating one store at a time. AutoLenis converts the density into leverage by running a private reverse auction across the metro, so a Plano buyer's precisely specified request draws competing written offers — including from Frisco, Dallas, and Allen dealers — rather than a single counter from the nearest lot.",
    localFaqs: [
      { q: "I already know the exact trim I want — can AutoLenis just get me the best price?", a: "Yes, and a precise request is ideal for our model. We take your exact specification into a reverse auction so dealers compete on the out-the-door price of that specific vehicle." },
      { q: "Can AutoLenis coordinate an EV or executive sedan purchase in Plano?", a: "Yes. Those are high-demand segments around Legacy West, and we source and run competition across dealer inventory and dealer auctions metro-wide." },
      { q: "How much of my time does this actually take?", a: "Minutes to submit your request, then you compare written offers from home. We handle the sourcing and negotiation, which is the part that normally eats a Plano professional's weekend." },
    ],
    nearbyAreas: ["Legacy West", "Willow Bend", "Downtown Plano (Historic)", "West Plano", "Los Rios"],
    testimonialSlots: 3,
    heroImage: "/images/seo/city-plano-hero.jpg",
    heroImageAlt: heroAlt("Plano"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
  {
    slug: "prosper",
    city: "Prosper",
    state: "Texas",
    stateAbbr: "TX",
    lat: 33.2362,
    lng: -96.8011,
    metro: "Dallas-Fort Worth",
    uniqueIntro:
      "Prosper is one of the fastest-growing affluent towns in Texas, where master-planned communities like Windsong Ranch and Star Trail are filling in faster than local retail can keep up — including car dealerships. That leaves Prosper buyers driving to Frisco or McKinney to even begin shopping. AutoLenis removes the drive. We are a buyer-side concierge: we work for you, not the dealership, and run a private reverse auction so verified North Texas dealers compete for your purchase while you stay home. Prosper households lean toward premium and family-size vehicles — a three-row luxury SUV for the school run, a comfortable commuter for the Dallas North Tollway, or a specific trim worth sourcing carefully — and getting competitive pricing used to mean lot-hopping in neighboring cities. Now you tell us the vehicle and budget, and we source across dealer inventory and dealer auctions, negotiate the out-the-door price, coordinate financing and trade-in, and deliver written offers to compare. The dealers compete; you stay in Prosper.",
    localContext:
      "Prosper is a high-growth, high-income town at the northern edge of Collin County whose dealership footprint hasn't caught up to its population, so residents routinely shop in nearby Frisco and McKinney. That reliance on neighboring markets makes Prosper an ideal fit for a reverse auction — AutoLenis brings metro-wide dealer competition to the buyer instead of sending the buyer out to chase it. Demand here skews strongly toward premium SUVs and family three-row vehicles for the area's many large master-planned neighborhoods, exactly the high-demand segments where motivated dealers compete hardest and structured, side-by-side offers most clearly reveal the best price.",
    localFaqs: [
      { q: "Prosper barely has dealerships — how does AutoLenis help?", a: "That's the point. Instead of driving to Frisco or McKinney to shop, you submit one request and dealers from across the metro compete to deliver the exact vehicle you want." },
      { q: "Can AutoLenis source a premium three-row SUV for a Windsong Ranch family?", a: "Yes. Premium family SUVs are a core, high-demand segment for us, and they're where dealer competition most reliably surfaces a better out-the-door price." },
      { q: "Will competing dealers actually deliver to Prosper?", a: "Yes. Dealers compete to win your business regardless of where you live; once you choose an offer, delivery and paperwork are coordinated for you." },
    ],
    nearbyAreas: ["Windsong Ranch", "Gentle Creek", "Star Trail", "Whitley Place", "Lakes of Prosper"],
    testimonialSlots: 2,
    heroImage: "/images/seo/city-prosper-hero.jpg",
    heroImageAlt: heroAlt("Prosper"),
    heroImageCredit: PLACEHOLDER_CREDIT,
  },
];

// ── Accessors ──────────────────────────────────────────────────────────────

export const SEO_LOCATION_SLUGS: string[] = SEO_LOCATIONS.map(l => l.slug);

export function getLocationBySlug(slug: string): SeoLocation | undefined {
  return SEO_LOCATIONS.find(l => l.slug === slug.toLowerCase());
}

/** FormSource value for a given city slug (e.g. "frisco" -> "seo_city_frisco"). */
export function cityFormSource(slug: string): FormSource {
  return `seo_city_${slug.replace(/-/g, "_")}` as FormSource;
}

/**
 * Validates that a record carries the unique content required to publish.
 * The city template calls this and falls back to notFound() if it returns
 * false — making thin/duplicate doorway pages structurally impossible.
 */
export function hasPublishableContent(loc: SeoLocation): boolean {
  const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  return (
    wordCount(loc.uniqueIntro) >= 120 &&
    wordCount(loc.localContext) >= 80 &&
    loc.localFaqs.length >= 3 &&
    loc.nearbyAreas.length >= 3
  );
}

// ── Geo helpers (haversine) ────────────────────────────────────────────────

const EARTH_RADIUS_MI = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two locations. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/** The N closest OTHER cities to the given one, nearest first. */
export function nearestLocations(slug: string, count = 4): SeoLocation[] {
  const origin = getLocationBySlug(slug);
  if (!origin) return [];
  return SEO_LOCATIONS.filter(l => l.slug !== origin.slug)
    .map(l => ({ loc: l, d: haversineMiles(origin, l) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count)
    .map(x => x.loc);
}
