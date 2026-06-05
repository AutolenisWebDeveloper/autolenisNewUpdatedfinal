// ─────────────────────────────────────────────────────────────────────────────
//  AutoLenis Tier 4 — SEO Content Engine keyword database (Phase C1)
//
//  The complete, typed target-keyword set the content engine generates against.
//  Each entry maps 1:1 to a future ContentArticle / /buying-guide/[slug] page.
//
//  160 keywords across 5 clusters:
//    1. dealer_quotes  — 50  ([make] [model] dealer quotes [city] TX)
//    2. otd_price      — 50  ([make] [model] OTD price [city] TX)
//    3. dealer_fees    — 20  (fee-education content, no make/model)
//    4. trade_in       — 20  (trade-in equity content)
//    5. leasing        — 20  (lease/finance content)
//
//  DFW-only to start: marketplace SEO works when supply + demand are
//  concentrated. The vehicle clusters are a curated 10 models × 5 cities so each
//  vehicle cluster is exactly 50 high-intent pages — quality over quantity.
//
//  This file is the single source of truth. Phase C2's generation engine reads
//  CONTENT_KEYWORDS, skips slugs that already exist as a ContentArticle, and
//  generates the rest. Nothing here writes to the DB.
// ─────────────────────────────────────────────────────────────────────────────

export type ContentCluster =
  | "dealer_quotes"
  | "otd_price"
  | "dealer_fees"
  | "trade_in"
  | "leasing";

export type SearchIntent = "transactional" | "commercial" | "informational";

export interface ContentKeyword {
  slug: string;
  cluster: ContentCluster;
  make?: string;
  model?: string;
  city: string;
  state: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  searchIntent: SearchIntent;
  priority: 1 | 2 | 3; // 1 = highest
}

// ── Shared dimensions ────────────────────────────────────────────────────────

const STATE = "TX";

/** DFW target cities. Marketplace SEO concentrates supply + demand. */
const CITIES = ["Dallas", "Fort Worth", "Plano", "Frisco", "McKinney"] as const;

/**
 * Curated 10-model set for the vehicle clusters (10 × 5 cities = 50 each).
 * Highest-intent, highest-volume DFW models across the core makes.
 */
const VEHICLES: ReadonlyArray<{ make: string; model: string }> = [
  { make: "Toyota", model: "Camry" },
  { make: "Toyota", model: "RAV4" },
  { make: "Toyota", model: "Highlander" },
  { make: "Toyota", model: "Tacoma" },
  { make: "Toyota", model: "Tundra" },
  { make: "Honda", model: "CR-V" },
  { make: "Honda", model: "Accord" },
  { make: "Honda", model: "Pilot" },
  { make: "Ford", model: "F-150" },
  { make: "Ford", model: "Explorer" },
];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ── Cluster 1 — Dealer Quotes (50) ───────────────────────────────────────────
// Pattern: "[make] [model] dealer quotes [city] TX". Buyer has chosen the
// vehicle and wants competitive pricing. Highest commercial intent.

const dealerQuotes: ContentKeyword[] = VEHICLES.flatMap(({ make, model }) =>
  CITIES.map((city) => ({
    slug: `${slugify(make)}-${slugify(model)}-dealer-quotes-${slugify(city)}-tx`,
    cluster: "dealer_quotes" as const,
    make,
    model,
    city,
    state: STATE,
    targetKeyword: `${make} ${model} dealer quotes ${city} TX`,
    title: `${make} ${model} Dealer Quotes — ${city}, TX | AutoLenis`,
    metaDescription: `Get competing ${make} ${model} dealer quotes in ${city}, TX. Dealers compete in a private 48-hour auction — you compare every offer and pick the best.`,
    h1: `${make} ${model} Dealer Quotes in ${city}, Texas`,
    searchIntent: "transactional" as const,
    priority: 1 as const,
  })),
);

// ── Cluster 2 — OTD Pricing (50) ─────────────────────────────────────────────
// Pattern: "[make] [model] OTD price [city] TX". Same vehicles/cities as
// Cluster 1. Buyer researching total out-the-door cost before purchase.

const otdPrice: ContentKeyword[] = VEHICLES.flatMap(({ make, model }) =>
  CITIES.map((city) => ({
    slug: `${slugify(make)}-${slugify(model)}-otd-price-${slugify(city)}-tx`,
    cluster: "otd_price" as const,
    make,
    model,
    city,
    state: STATE,
    targetKeyword: `${make} ${model} OTD price ${city} TX`,
    title: `${make} ${model} Out-the-Door Price — ${city}, TX`,
    metaDescription: `See what ${city}, TX dealers will offer out-the-door on a ${make} ${model}. Understand every cost from invoice to delivery, then let dealers compete.`,
    h1: `${make} ${model} Out-the-Door Price in ${city}, Texas`,
    searchIntent: "commercial" as const,
    priority: 1 as const,
  })),
);

// ── Cluster 3 — Dealer Fees (20) ─────────────────────────────────────────────
// Fee-education content. No make/model. Buyers trying to understand / avoid
// junk fees. Mostly informational intent feeding the auction CTA.

interface FeeSeed {
  slug: string;
  city: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  intent?: SearchIntent;
  priority?: 1 | 2 | 3;
}

const feeSeeds: FeeSeed[] = [
  {
    slug: "dealer-doc-fees-texas",
    city: "Dallas",
    targetKeyword: "dealer doc fees texas",
    title: "Dealer Doc Fees in Texas — What's Legal, What's Junk",
    metaDescription: "What Texas dealers can legally charge for documentation fees, what counts as junk, and how to keep fees honest by making dealers compete.",
    h1: "Dealer Doc Fees in Texas: What's Legal and What's Junk",
  },
  {
    slug: "dealer-fees-dallas-tx",
    city: "Dallas",
    targetKeyword: "dealer fees dallas tx",
    title: "Dealer Fees in Dallas, TX — The Complete Breakdown",
    metaDescription: "A plain-English breakdown of every dealer fee you'll see in Dallas, TX — which are mandatory, which are negotiable, and how competition makes them disappear.",
    h1: "Dealer Fees in Dallas, TX: The Complete Breakdown",
  },
  {
    slug: "what-dealer-fees-are-negotiable-texas",
    city: "Dallas",
    targetKeyword: "what dealer fees are negotiable texas",
    title: "What Dealer Fees Are Negotiable in Texas?",
    metaDescription: "Not every dealer fee is set in stone. Learn which Texas dealer fees are negotiable, which are mandatory, and how to stop overpaying on add-ons.",
    h1: "What Dealer Fees Are Negotiable in Texas?",
  },
  {
    slug: "hidden-dealer-fees-texas",
    city: "Dallas",
    targetKeyword: "hidden dealer fees texas",
    title: "Hidden Dealer Fees Texas Buyers Need to Know",
    metaDescription: "Dealer markups, add-ons, and surprise line items inflate your Texas car purchase. Here's how to spot hidden dealer fees and avoid paying them.",
    h1: "Hidden Dealer Fees Texas Buyers Need to Know",
  },
  {
    slug: "dealer-doc-fee-texas-explained",
    city: "Fort Worth",
    targetKeyword: "doc fee texas explained",
    title: "The Texas Doc Fee, Explained for Car Buyers",
    metaDescription: "What the Texas documentation fee actually covers, why it varies by dealership, and how to factor it into your real out-the-door price.",
    h1: "The Texas Doc Fee, Explained for Car Buyers",
  },
  {
    slug: "out-the-door-price-vs-msrp-texas",
    city: "Dallas",
    targetKeyword: "out the door price vs msrp",
    title: "Out-the-Door Price vs MSRP — What Dealers Don't Explain",
    metaDescription: "MSRP is only the starting point. Learn how fees, taxes, and add-ons turn the sticker into your real out-the-door price — and what dealers leave out.",
    h1: "Out-the-Door Price vs MSRP: What Dealers Don't Explain",
  },
  {
    slug: "dealer-add-on-fees-texas",
    city: "Plano",
    targetKeyword: "dealer add on fees texas",
    title: "Dealer Add-On Fees in Texas — Paint, Nitrogen & More",
    metaDescription: "Paint protection, nitrogen tires, VIN etching, and other dealer add-ons in Texas — what they cost, what they're worth, and how to decline them.",
    h1: "Dealer Add-On Fees in Texas: What They Are and How to Decline",
  },
  {
    slug: "dealer-markup-fees-texas",
    city: "Frisco",
    targetKeyword: "dealer markup adm texas",
    title: "Dealer Markups (ADM) in Texas — How to Avoid Them",
    metaDescription: "Additional Dealer Markup stickers add thousands over MSRP. Learn how ADM works in Texas and how competing offers make markups vanish.",
    h1: "Dealer Markups (ADM) in Texas: How to Avoid Paying Over Sticker",
  },
  {
    slug: "dealer-fees-fort-worth-tx",
    city: "Fort Worth",
    targetKeyword: "dealer fees fort worth tx",
    title: "Dealer Fees in Fort Worth, TX — What to Expect",
    metaDescription: "A breakdown of the fees Fort Worth, TX dealers charge, which ones are required, and how to compare real out-the-door numbers across dealerships.",
    h1: "Dealer Fees in Fort Worth, TX: What to Expect",
  },
  {
    slug: "dealer-fees-plano-tx",
    city: "Plano",
    targetKeyword: "dealer fees plano tx",
    title: "Dealer Fees in Plano, TX — What to Expect",
    metaDescription: "Every dealer fee Plano, TX buyers run into, explained — mandatory vs junk — plus how to make dealers compete on the total out-the-door price.",
    h1: "Dealer Fees in Plano, TX: What to Expect",
  },
  {
    slug: "dealer-fees-frisco-tx",
    city: "Frisco",
    targetKeyword: "dealer fees frisco tx",
    title: "Dealer Fees in Frisco, TX — What to Expect",
    metaDescription: "What Frisco, TX dealers charge in fees, which are negotiable, and how a competing-offer process keeps the total out-the-door price honest.",
    h1: "Dealer Fees in Frisco, TX: What to Expect",
  },
  {
    slug: "dealer-fees-mckinney-tx",
    city: "McKinney",
    targetKeyword: "dealer fees mckinney tx",
    title: "Dealer Fees in McKinney, TX — What to Expect",
    metaDescription: "A clear guide to dealer fees in McKinney, TX — what's legitimate, what's padding, and how competing dealer offers expose the real price.",
    h1: "Dealer Fees in McKinney, TX: What to Expect",
  },
  {
    slug: "vin-etching-fee-texas",
    city: "Dallas",
    targetKeyword: "vin etching fee texas",
    title: "VIN Etching Fees in Texas — Worth It or Junk?",
    metaDescription: "Dealers often add a VIN etching fee in Texas. Learn what it is, what it should cost, and whether to pay for it or decline.",
    h1: "VIN Etching Fees in Texas: Worth It or Junk?",
  },
  {
    slug: "nitrogen-tire-fee-dealer-texas",
    city: "Plano",
    targetKeyword: "nitrogen tire fee dealer texas",
    title: "Nitrogen Tire Fees at Texas Dealers — Skip or Pay?",
    metaDescription: "The nitrogen tire fill fee is one of the most common dealer add-ons in Texas. Here's what it's really worth and how to decline it.",
    h1: "Nitrogen Tire Fees at Texas Dealers: Skip or Pay?",
  },
  {
    slug: "dealer-prep-fee-texas",
    city: "Frisco",
    targetKeyword: "dealer prep fee texas",
    title: "Dealer Prep Fees in Texas — Should You Pay?",
    metaDescription: "Many Texas dealers list a vehicle prep or delivery fee. Learn what it covers, whether it's legitimate, and how to negotiate it out of the deal.",
    h1: "Dealer Prep Fees in Texas: Should You Pay?",
  },
  {
    slug: "ttl-fees-texas-car-purchase",
    city: "Dallas",
    targetKeyword: "ttl fees texas car",
    title: "TT&L Fees in Texas — Tax, Title & License Explained",
    metaDescription: "Tax, title, and license are unavoidable in Texas — but they're often mispresented. Here's exactly what TT&L costs and how it fits your out-the-door price.",
    h1: "TT&L Fees in Texas: Tax, Title & License Explained",
  },
  {
    slug: "how-to-avoid-dealer-junk-fees-texas",
    city: "Fort Worth",
    targetKeyword: "how to avoid dealer junk fees texas",
    title: "How to Avoid Dealer Junk Fees in Texas",
    metaDescription: "A practical guide to spotting and removing junk dealer fees in Texas — and why making dealers compete is the fastest way to a clean deal.",
    h1: "How to Avoid Dealer Junk Fees in Texas",
  },
  {
    slug: "are-dealer-doc-fees-capped-texas",
    city: "McKinney",
    targetKeyword: "are dealer doc fees capped texas",
    title: "Are Dealer Doc Fees Capped in Texas?",
    metaDescription: "Some states cap documentation fees. Find out how Texas handles dealer doc fees, what's typical, and how to keep yours from ballooning.",
    h1: "Are Dealer Doc Fees Capped in Texas?",
  },
  {
    slug: "new-car-fees-explained-texas",
    city: "Plano",
    targetKeyword: "new car fees explained texas",
    title: "New Car Fees in Texas — Every Line Item Explained",
    metaDescription: "From doc fees to inventory tax, here's every fee on a Texas new-car purchase order explained in plain English — and which ones you can push back on.",
    h1: "New Car Fees in Texas: Every Line Item Explained",
  },
  {
    slug: "used-car-dealer-fees-texas",
    city: "Dallas",
    targetKeyword: "used car dealer fees texas",
    title: "Used Car Dealer Fees in Texas — What's Real",
    metaDescription: "Used-car fees in Texas differ from new-car fees. Learn what's legitimate on a used purchase, what's padding, and how to compare true out-the-door prices.",
    h1: "Used Car Dealer Fees in Texas: What's Real and What's Padding",
  },
];

const dealerFees: ContentKeyword[] = feeSeeds.map((seed) => ({
  slug: seed.slug,
  cluster: "dealer_fees",
  city: seed.city,
  state: STATE,
  targetKeyword: seed.targetKeyword,
  title: seed.title,
  metaDescription: seed.metaDescription,
  h1: seed.h1,
  searchIntent: seed.intent ?? "informational",
  priority: seed.priority ?? 2,
}));

// ── Cluster 4 — Trade-In (20) ────────────────────────────────────────────────
// Buyer with an existing vehicle figuring out equity. Get it valued before
// dealers use it against you.

interface TradeSeed {
  slug: string;
  city: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  intent?: SearchIntent;
  priority?: 1 | 2 | 3;
}

const tradeSeeds: TradeSeed[] = [
  {
    slug: "maximize-trade-in-value-dallas",
    city: "Dallas",
    targetKeyword: "maximize trade in value dallas",
    title: "How to Maximize Your Trade-In Value in Dallas",
    metaDescription: "Practical steps to get the most for your trade-in in Dallas, TX — and why having dealers compete for your trade beats a single appraisal.",
    h1: "How to Maximize Your Trade-In Value in Dallas",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "trade-in-value-dallas-tx",
    city: "Dallas",
    targetKeyword: "trade in value dallas tx",
    title: "Trade-In Value in Dallas, TX — Get a Real Number",
    metaDescription: "How trade-in values are set in Dallas, TX, what affects your number, and how competing dealer offers reveal what your car is really worth.",
    h1: "Trade-In Value in Dallas, TX: How to Get a Real Number",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "trade-in-vs-sell-privately-texas",
    city: "Dallas",
    targetKeyword: "trade in vs sell privately texas",
    title: "Trade-In vs Selling Privately in Texas — Which Wins?",
    metaDescription: "The real math on trading in versus selling privately in Texas — including the sales-tax credit that often makes trading in the smarter move.",
    h1: "Trade-In vs Selling Privately in Texas: Which Wins?",
  },
  {
    slug: "best-time-to-trade-in-car-dallas",
    city: "Dallas",
    targetKeyword: "best time to trade in car dallas",
    title: "The Best Time to Trade In Your Car in Dallas",
    metaDescription: "Timing affects your trade-in value. Learn the best time to trade in a car in Dallas, TX and how to lock in a strong number with competing offers.",
    h1: "The Best Time to Trade In Your Car in Dallas",
  },
  {
    slug: "trade-in-value-fort-worth-tx",
    city: "Fort Worth",
    targetKeyword: "trade in value fort worth tx",
    title: "Trade-In Value in Fort Worth, TX — What to Expect",
    metaDescription: "What drives trade-in values in Fort Worth, TX and how to get multiple dealers competing for your car instead of taking the first lowball offer.",
    h1: "Trade-In Value in Fort Worth, TX: What to Expect",
    intent: "commercial",
  },
  {
    slug: "trade-in-value-plano-tx",
    city: "Plano",
    targetKeyword: "trade in value plano tx",
    title: "Trade-In Value in Plano, TX — Get the Most",
    metaDescription: "How to find your real trade-in value in Plano, TX and use competing dealer offers to push it higher before you buy your next car.",
    h1: "Trade-In Value in Plano, TX: How to Get the Most",
    intent: "commercial",
  },
  {
    slug: "trade-in-value-frisco-tx",
    city: "Frisco",
    targetKeyword: "trade in value frisco tx",
    title: "Trade-In Value in Frisco, TX — What Yours Is Worth",
    metaDescription: "Understand how Frisco, TX dealers value trade-ins and how to get several competing offers so you know exactly what your car is worth.",
    h1: "Trade-In Value in Frisco, TX: What Yours Is Worth",
    intent: "commercial",
  },
  {
    slug: "trade-in-value-mckinney-tx",
    city: "McKinney",
    targetKeyword: "trade in value mckinney tx",
    title: "Trade-In Value in McKinney, TX — Get a Fair Offer",
    metaDescription: "What your trade-in is worth in McKinney, TX and how letting dealers compete for it produces a fairer number than a single appraisal.",
    h1: "Trade-In Value in McKinney, TX: How to Get a Fair Offer",
    intent: "commercial",
  },
  {
    slug: "how-trade-in-value-is-calculated-texas",
    city: "Dallas",
    targetKeyword: "how is trade in value calculated",
    title: "How Trade-In Value Is Calculated in Texas",
    metaDescription: "Mileage, condition, demand, and reconditioning all shape your trade-in number. Here's how Texas dealers calculate trade-in value — and where you have leverage.",
    h1: "How Trade-In Value Is Calculated in Texas",
  },
  {
    slug: "trade-in-sales-tax-credit-texas",
    city: "Dallas",
    targetKeyword: "trade in sales tax credit texas",
    title: "The Texas Trade-In Sales Tax Credit, Explained",
    metaDescription: "In Texas, your trade-in reduces the taxable price of your new car. Learn how the trade-in sales-tax credit works and what it's worth to you.",
    h1: "The Texas Trade-In Sales Tax Credit, Explained",
  },
  {
    slug: "negative-equity-trade-in-texas",
    city: "Dallas",
    targetKeyword: "negative equity trade in texas",
    title: "Trading In a Car With Negative Equity in Texas",
    metaDescription: "Owe more than your car is worth? Learn how negative equity affects a Texas trade-in, your options, and how to avoid rolling debt into a new loan.",
    h1: "Trading In a Car With Negative Equity in Texas",
  },
  {
    slug: "prepare-car-for-trade-in",
    city: "Plano",
    targetKeyword: "how to prepare car for trade in",
    title: "How to Prepare Your Car for Trade-In",
    metaDescription: "Simple, low-cost steps to prep your car before a trade-in appraisal so dealers can't justify a lowball — and how to get competing offers.",
    h1: "How to Prepare Your Car for Trade-In",
  },
  {
    slug: "trade-in-appraisal-tips-texas",
    city: "Fort Worth",
    targetKeyword: "trade in appraisal tips",
    title: "Trade-In Appraisal Tips for Texas Buyers",
    metaDescription: "What to expect at a trade-in appraisal in Texas, the questions to ask, and how multiple competing appraisals protect you from a lowball.",
    h1: "Trade-In Appraisal Tips for Texas Buyers",
  },
  {
    slug: "should-i-trade-in-or-sell-my-car-texas",
    city: "Frisco",
    targetKeyword: "should i trade in or sell my car",
    title: "Should I Trade In or Sell My Car in Texas?",
    metaDescription: "A clear decision framework for Texas owners weighing convenience, taxes, and money — when to trade in versus when to sell your car yourself.",
    h1: "Should I Trade In or Sell My Car in Texas?",
  },
  {
    slug: "trade-in-value-vs-kbb-texas",
    city: "Dallas",
    targetKeyword: "trade in value vs kbb",
    title: "Trade-In Value vs KBB — Why Yours May Differ",
    metaDescription: "Why your real trade-in offer often differs from KBB or Edmunds estimates, what dealers actually pay, and how to verify with competing offers.",
    h1: "Trade-In Value vs KBB: Why Your Real Offer May Differ",
  },
  {
    slug: "trade-in-high-mileage-car-texas",
    city: "McKinney",
    targetKeyword: "trade in high mileage car texas",
    title: "Trading In a High-Mileage Car in Texas",
    metaDescription: "High mileage doesn't mean no value. Learn how Texas dealers price high-mileage trade-ins and how to get several offers to find the best one.",
    h1: "Trading In a High-Mileage Car in Texas",
  },
  {
    slug: "trade-in-leased-car-texas",
    city: "Plano",
    targetKeyword: "trade in leased car texas",
    title: "Can You Trade In a Leased Car in Texas?",
    metaDescription: "Trading in a leased vehicle in Texas has its own rules. Learn how lease equity works, when it makes sense, and how to compare buyout-and-trade offers.",
    h1: "Can You Trade In a Leased Car in Texas?",
  },
  {
    slug: "get-multiple-trade-in-offers-dallas",
    city: "Dallas",
    targetKeyword: "get multiple trade in offers dallas",
    title: "How to Get Multiple Trade-In Offers in Dallas",
    metaDescription: "One appraisal is a guess. Learn how to get multiple competing trade-in offers in Dallas, TX so you know your car's true market value.",
    h1: "How to Get Multiple Trade-In Offers in Dallas",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "dealer-trade-in-tricks-to-avoid-texas",
    city: "Fort Worth",
    targetKeyword: "dealer trade in tricks texas",
    title: "Dealer Trade-In Tricks to Avoid in Texas",
    metaDescription: "The most common trade-in tactics Texas dealers use — payment-packing, blended numbers, and lowballs — and how to keep your trade and price separate.",
    h1: "Dealer Trade-In Tricks to Avoid in Texas",
  },
  {
    slug: "trade-in-value-suv-truck-dallas",
    city: "Dallas",
    targetKeyword: "trade in value suv truck dallas",
    title: "Trade-In Values for SUVs & Trucks in Dallas",
    metaDescription: "Trucks and SUVs hold value well in DFW. Learn what drives SUV and truck trade-in values in Dallas, TX and how to get competing offers.",
    h1: "Trade-In Values for SUVs & Trucks in Dallas",
    intent: "commercial",
  },
];

const tradeIn: ContentKeyword[] = tradeSeeds.map((seed) => ({
  slug: seed.slug,
  cluster: "trade_in",
  city: seed.city,
  state: STATE,
  targetKeyword: seed.targetKeyword,
  title: seed.title,
  metaDescription: seed.metaDescription,
  h1: seed.h1,
  searchIntent: seed.intent ?? "informational",
  priority: seed.priority ?? 2,
}));

// ── Cluster 5 — Leasing & Financing (20) ─────────────────────────────────────
// Buyer evaluating payment options. Compare lease + finance offers from
// competing dealers.

interface LeaseSeed {
  slug: string;
  make?: string;
  model?: string;
  city: string;
  targetKeyword: string;
  title: string;
  metaDescription: string;
  h1: string;
  intent?: SearchIntent;
  priority?: 1 | 2 | 3;
}

const leaseSeeds: LeaseSeed[] = [
  {
    slug: "toyota-camry-lease-deals-dallas-tx",
    make: "Toyota",
    model: "Camry",
    city: "Dallas",
    targetKeyword: "toyota camry lease deals dallas tx",
    title: "Toyota Camry Lease Deals — Dallas, TX",
    metaDescription: "How to compare Toyota Camry lease offers in Dallas, TX — money factor, residual, and cap cost — and let dealers compete for your lease.",
    h1: "Toyota Camry Lease Deals in Dallas, TX",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "toyota-rav4-lease-deals-dallas-tx",
    make: "Toyota",
    model: "RAV4",
    city: "Dallas",
    targetKeyword: "toyota rav4 lease deals dallas tx",
    title: "Toyota RAV4 Lease Deals — Dallas, TX",
    metaDescription: "Compare Toyota RAV4 lease offers in Dallas, TX the smart way. Understand the lease math and get competing dealer lease quotes side by side.",
    h1: "Toyota RAV4 Lease Deals in Dallas, TX",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "honda-crv-lease-deals-dallas-tx",
    make: "Honda",
    model: "CR-V",
    city: "Dallas",
    targetKeyword: "honda cr-v lease deals dallas tx",
    title: "Honda CR-V Lease Deals — Dallas, TX",
    metaDescription: "Honda CR-V lease offers in Dallas, TX explained — what a good money factor and residual look like, and how to make dealers compete for your lease.",
    h1: "Honda CR-V Lease Deals in Dallas, TX",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "honda-accord-lease-deals-plano-tx",
    make: "Honda",
    model: "Accord",
    city: "Plano",
    targetKeyword: "honda accord lease deals plano tx",
    title: "Honda Accord Lease Deals — Plano, TX",
    metaDescription: "Compare Honda Accord lease quotes in Plano, TX. Learn the lease terms that matter and get competing dealer offers instead of one take-it-or-leave-it deal.",
    h1: "Honda Accord Lease Deals in Plano, TX",
    intent: "commercial",
  },
  {
    slug: "ford-f150-lease-deals-fort-worth-tx",
    make: "Ford",
    model: "F-150",
    city: "Fort Worth",
    targetKeyword: "ford f-150 lease deals fort worth tx",
    title: "Ford F-150 Lease Deals — Fort Worth, TX",
    metaDescription: "How to compare Ford F-150 lease offers in Fort Worth, TX, what drives the payment, and how to get competing dealer lease quotes.",
    h1: "Ford F-150 Lease Deals in Fort Worth, TX",
    intent: "commercial",
  },
  {
    slug: "toyota-highlander-lease-deals-frisco-tx",
    make: "Toyota",
    model: "Highlander",
    city: "Frisco",
    targetKeyword: "toyota highlander lease deals frisco tx",
    title: "Toyota Highlander Lease Deals — Frisco, TX",
    metaDescription: "Toyota Highlander lease offers in Frisco, TX, broken down — cap cost, residual, and money factor — plus how to get dealers competing for your lease.",
    h1: "Toyota Highlander Lease Deals in Frisco, TX",
    intent: "commercial",
  },
  {
    slug: "suv-lease-deals-dallas-tx",
    city: "Dallas",
    targetKeyword: "suv lease deals dallas tx",
    title: "SUV Lease Deals in Dallas, TX — How to Compare",
    metaDescription: "Shopping SUV lease deals in Dallas, TX? Learn how to read a lease offer and get competing dealer quotes so you lease on your terms.",
    h1: "SUV Lease Deals in Dallas, TX: How to Compare Offers",
    intent: "commercial",
  },
  {
    slug: "truck-lease-deals-fort-worth-tx",
    city: "Fort Worth",
    targetKeyword: "truck lease deals fort worth tx",
    title: "Truck Lease Deals in Fort Worth, TX",
    metaDescription: "How truck leasing works in Fort Worth, TX, when it makes sense, and how to get competing lease offers on the pickup you want.",
    h1: "Truck Lease Deals in Fort Worth, TX",
    intent: "commercial",
  },
  {
    slug: "lease-vs-finance-texas",
    city: "Dallas",
    targetKeyword: "lease vs finance texas",
    title: "Lease vs Finance in Texas — The Real Math",
    metaDescription: "Should you lease or finance your next car in Texas? A clear, no-spin comparison of cost, ownership, taxes, and flexibility to help you decide.",
    h1: "Lease vs Finance in Texas: The Real Math",
  },
  {
    slug: "how-car-leasing-works-texas",
    city: "Dallas",
    targetKeyword: "how car leasing works texas",
    title: "How Car Leasing Works in Texas",
    metaDescription: "A plain-English guide to car leasing in Texas — money factor, residual, cap cost, and how Texas taxes leases — so you can compare offers with confidence.",
    h1: "How Car Leasing Works in Texas",
  },
  {
    slug: "what-is-money-factor-lease",
    city: "Plano",
    targetKeyword: "what is money factor lease",
    title: "What Is a Money Factor on a Car Lease?",
    metaDescription: "The money factor is lease-speak for your interest rate. Learn how to read it, convert it to APR, and spot a marked-up lease before you sign.",
    h1: "What Is a Money Factor on a Car Lease?",
  },
  {
    slug: "lease-residual-value-explained",
    city: "Frisco",
    targetKeyword: "lease residual value explained",
    title: "Lease Residual Value, Explained",
    metaDescription: "Residual value sets your lease payment and your buyout. Learn how residuals work, why higher is better for lessees, and how to use it when comparing offers.",
    h1: "Lease Residual Value, Explained",
  },
  {
    slug: "best-apr-deals-suvs-dallas",
    city: "Dallas",
    targetKeyword: "best apr deals suvs dallas",
    title: "How to Find the Best APR on an SUV in Dallas",
    metaDescription: "Low-APR offers come and go. Learn how to evaluate finance APR deals on SUVs in Dallas, TX and get competing dealer offers on the same vehicle.",
    h1: "How to Find the Best APR on an SUV in Dallas",
    intent: "commercial",
  },
  {
    slug: "how-to-compare-lease-offers-multiple-dealers",
    city: "Dallas",
    targetKeyword: "how to compare lease offers multiple dealers",
    title: "How to Compare Lease Offers From Multiple Dealers",
    metaDescription: "Lease quotes are easy to manipulate. Learn how to normalize offers from multiple dealers — term, miles, money factor — and pick the real best deal.",
    h1: "How to Compare Lease Offers From Multiple Dealers",
    intent: "commercial",
    priority: 1,
  },
  {
    slug: "0-down-lease-texas-explained",
    city: "Plano",
    targetKeyword: "0 down lease texas",
    title: "$0-Down Leases in Texas — What They Really Cost",
    metaDescription: "A $0-down lease isn't free money. Learn what zero-drive-off leases really cost in Texas and how to compare them against money-down offers.",
    h1: "$0-Down Leases in Texas: What They Really Cost",
  },
  {
    slug: "lease-buyout-texas-guide",
    city: "Fort Worth",
    targetKeyword: "lease buyout texas",
    title: "Lease Buyout in Texas — Is It Worth It?",
    metaDescription: "When your lease ends, should you buy the car? A Texas guide to lease buyouts, equity, taxes, and how to know if your residual is a good deal.",
    h1: "Lease Buyout in Texas: Is It Worth It?",
  },
  {
    slug: "auto-loan-preapproval-texas",
    city: "McKinney",
    targetKeyword: "auto loan preapproval texas",
    title: "Auto Loan Pre-Approval in Texas — Why It Matters",
    metaDescription: "Walking in pre-approved changes the conversation. Learn how auto loan pre-approval works in Texas and how it strengthens your hand when dealers compete.",
    h1: "Auto Loan Pre-Approval in Texas: Why It Matters",
  },
  {
    slug: "dealer-financing-vs-bank-texas",
    city: "Dallas",
    targetKeyword: "dealer financing vs bank texas",
    title: "Dealer Financing vs Your Bank in Texas",
    metaDescription: "Should you finance through the dealer or your own bank in Texas? Compare rates, convenience, and markup — and how competing offers keep dealers honest.",
    h1: "Dealer Financing vs Your Bank in Texas",
  },
  {
    slug: "best-lease-deals-dallas",
    city: "Dallas",
    targetKeyword: "best lease deals dallas",
    title: "How to Find the Best Lease Deals in Dallas",
    metaDescription: "Where the real lease value is in Dallas, TX, how to read an advertised lease, and how to get competing dealer lease offers on the car you want.",
    h1: "How to Find the Best Lease Deals in Dallas",
    intent: "commercial",
  },
  {
    slug: "lease-mileage-limits-explained-texas",
    city: "Frisco",
    targetKeyword: "lease mileage limits explained",
    title: "Lease Mileage Limits, Explained for Texas Drivers",
    metaDescription: "Mileage caps make or break a lease. Learn how lease mileage limits and overage fees work, how to pick the right allowance, and how to compare offers.",
    h1: "Lease Mileage Limits, Explained for Texas Drivers",
  },
];

const leasing: ContentKeyword[] = leaseSeeds.map((seed) => ({
  slug: seed.slug,
  cluster: "leasing",
  make: seed.make,
  model: seed.model,
  city: seed.city,
  state: STATE,
  targetKeyword: seed.targetKeyword,
  title: seed.title,
  metaDescription: seed.metaDescription,
  h1: seed.h1,
  searchIntent: seed.intent ?? "informational",
  priority: seed.priority ?? 2,
}));

// ── Aggregate export ─────────────────────────────────────────────────────────

export const CONTENT_KEYWORDS: ContentKeyword[] = [
  ...dealerQuotes, // 50
  ...otdPrice, // 50
  ...dealerFees, // 20
  ...tradeIn, // 20
  ...leasing, // 20
];

export const KEYWORD_COUNT = CONTENT_KEYWORDS.length;

/** Per-cluster keyword totals — used by the admin breakdown table (Phase C3). */
export const CLUSTER_COUNTS: Record<ContentCluster, number> = CONTENT_KEYWORDS.reduce(
  (acc, k) => {
    acc[k.cluster] = (acc[k.cluster] ?? 0) + 1;
    return acc;
  },
  { dealer_quotes: 0, otd_price: 0, dealer_fees: 0, trade_in: 0, leasing: 0 },
);

/** Human-readable cluster labels for UI. */
export const CLUSTER_LABELS: Record<ContentCluster, string> = {
  dealer_quotes: "Dealer Quotes",
  otd_price: "OTD Price",
  dealer_fees: "Dealer Fees",
  trade_in: "Trade-In",
  leasing: "Leasing",
};

/** Lookup a single keyword definition by slug. */
export function getKeywordBySlug(slug: string): ContentKeyword | undefined {
  return CONTENT_KEYWORDS.find((k) => k.slug === slug);
}
