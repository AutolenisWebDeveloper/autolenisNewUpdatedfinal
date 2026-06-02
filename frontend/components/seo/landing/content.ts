// Shared, compliance-safe copy for the SEO landing system. Kept in one module
// so the visible UI and the JSON-LD (HowTo / Service) never drift apart.
//
// COMPLIANCE: buyer-side language only. AutoLenis is a concierge / buyer's
// agent — never a dealer, lender, or issuer of credit/loan approvals.

export interface ReverseAuctionStep {
  name: string;
  text: string;
}

export const REVERSE_AUCTION_STEPS: ReverseAuctionStep[] = [
  {
    name: "Tell us what you want",
    text: "Submit one free request with the vehicle, budget, and timeline. It takes about 60 seconds and starts a soft prequalification only — no credit impact.",
  },
  {
    name: "We source it",
    text: "We search dealer inventory and dealer auctions across the metro to find your exact vehicle, including hard-to-find trims you can't see on a local lot.",
  },
  {
    name: "Dealers compete",
    text: "Verified dealers submit private, written offers in a reverse auction. They can't see each other's bids, so they compete for your business on price.",
  },
  {
    name: "We negotiate for you",
    text: "As your buyer's agent we push on the out-the-door price, fees, and terms, and coordinate financing if you need it. We work for you, not the dealer.",
  },
  {
    name: "You choose from home",
    text: "Compare written offers side by side and pick the one you want. No showroom laps, no four-square worksheets, no pressure.",
  },
];

export interface ConciergeCapability {
  title: string;
  text: string;
}

export const CONCIERGE_CAPABILITIES: ConciergeCapability[] = [
  { title: "Search dealer inventory", text: "We comb franchise and independent dealer inventory across the metro for the exact vehicle you specified." },
  { title: "Search dealer auctions", text: "We also tap dealer-only auctions — a channel individual buyers can't access — to widen the search." },
  { title: "Negotiate price & fees", text: "We negotiate the out-the-door price, challenge junk fees, and pin down the real number before you commit." },
  { title: "Coordinate financing", text: "We coordinate financing options with your chosen dealer. We don't issue credit; a soft prequalification keeps your score untouched." },
  { title: "Source hard-to-find vehicles", text: "Need a specific trim, color, or package? We source it across inventory and auctions instead of settling for what's nearby." },
];

export interface ComparisonRow {
  feature: string;
  autolenis: string;
  dealership: string;
  costco: string;
  marketplace: string;
}

// Factual, compliance-safe comparison. No disparagement, no fabricated claims.
export const COMPARISON_ROWS: ComparisonRow[] = [
  { feature: "Who they represent", autolenis: "You, the buyer", dealership: "The dealership", costco: "A pre-set dealer network", marketplace: "Listings / lead buyers" },
  { feature: "Dealers compete for you", autolenis: "Yes — private reverse auction", dealership: "No", costco: "Pre-negotiated, not a live auction", marketplace: "No — you contact each seller" },
  { feature: "Searches dealer auctions", autolenis: "Yes", dealership: "Their own stock", costco: "No", marketplace: "No" },
  { feature: "Negotiates on your behalf", autolenis: "Yes", dealership: "You negotiate alone", costco: "Set price, limited negotiation", marketplace: "You negotiate alone" },
  { feature: "Sources hard-to-find trims", autolenis: "Yes", dealership: "Limited to their lot", costco: "Limited to network stock", marketplace: "Whatever is listed" },
  { feature: "Sells your data to third parties", autolenis: "Never", costco: "Varies", dealership: "Varies", marketplace: "Common — lead resale" },
];

export interface SeoFaqItem {
  q: string;
  a: string;
}

// Category-level FAQs reused on the hub and as the base set on city pages.
// Answer-first 40–60 word capsules for AI citation.
export const CORE_FAQS: SeoFaqItem[] = [
  {
    q: "What is a car-buying concierge?",
    a: "A car-buying concierge is a buyer's agent who handles the entire purchase for you — finding the vehicle, negotiating price and fees, and coordinating financing. AutoLenis is a buyer-side concierge that also runs a private reverse auction so verified dealers compete for your business.",
  },
  {
    q: "How does a car broker work?",
    a: "A car broker shops on your behalf instead of selling you a car. You specify the vehicle and budget; the broker sources it, negotiates, and brings you offers. AutoLenis works this way but adds a reverse auction where dealers submit competing written offers you compare from home.",
  },
  {
    q: "Are car brokers and concierges worth it?",
    a: "They're worth it when they save you time and surface real dealer competition. AutoLenis charges no dealer commissions and never sells your data, so the incentive stays aligned with you. You compare written offers side by side and choose — or walk away — with no obligation.",
  },
  {
    q: "Do car brokers save you money?",
    a: "Making dealers compete tends to lower the out-the-door price versus negotiating alone, though savings vary by vehicle, market, and demand. AutoLenis exposes the real market price through a private reverse auction. We never guarantee a specific figure, but the structure is built to favor the buyer.",
  },
  {
    q: "Is AutoLenis a dealership or a lender?",
    a: "No. AutoLenis is a buyer-side car-buying concierge and reverse-auction platform. We are not a dealer, broker-of-record, or lender. We represent you, coordinate financing with your chosen dealer, and never originate loans or extend credit ourselves.",
  },
  {
    q: "How much does AutoLenis cost?",
    a: "Submitting a vehicle request is free. A one-time, non-refundable $99 Auction Access Fee activates your private dealer auction — it is not a deposit and is not credited toward a purchase. A premium concierge package is available for fully hands-off service.",
  },
];
