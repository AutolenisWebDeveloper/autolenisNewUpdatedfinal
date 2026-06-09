// AutoLenis Social Engine — Viral Hashtag Builder.
//
// Builds a per-platform hashtag set blending live trending tags, franchise tags,
// automotive-niche tags, the brand tag, and optional make/geo tags — capped to
// each platform's optimal count.

const FRANCHISE_HASHTAGS: Record<string, string[]> = {
  dealer_secret_daily: ["#DealerSecrets", "#CarBuyingTips", "#SaveMoney"],
  city_market_alert: ["#CarDeals", "#LocalDeals", "#BuyerTips"],
  vehicle_price_watch: ["#OTDPrice", "#CarPrice", "#FairPrice"],
  how_autolenis_works: ["#CarAuction", "#CompetingOffers", "#SmartBuyer"],
  dealer_fee_breakdown: ["#DealerFees", "#HiddenFees", "#DocFee"],
  buyer_win_story: ["#CarBuying", "#SmartShopper", "#WinnerWinner"],
  financing_friday: ["#CarLoan", "#AutoFinancing", "#CarPayment"],
  trade_in_tuesday: ["#TradeIn", "#CarTradeIn", "#GetMoreMoney"],
  autolenis_market_index: ["#AutomotiveMarket", "#CarMarket", "#BuyerPower"],
  auction_countdown: ["#CarAuction", "#BestOffer", "#DealerCompetition"],
  offer_received: ["#CarOffers", "#DealerOffer", "#NegotiatingTips"],
  dealer_growth: ["#DealerGrowth", "#AutomotiveSales", "#DealerBusiness"],
  market_stats_dealer: ["#AutomotiveData", "#DealerInsights", "#CarMarket"],
};

export function buildViralHashtags(input: {
  platform: string;
  franchise: string;
  make?: string | null;
  city?: string | null;
  metro?: string | null;
  trendingHashtags?: string[];
}): string[] {
  const trending = (input.trendingHashtags ?? []).slice(0, 5);
  const franchiseTags = FRANCHISE_HASHTAGS[input.franchise] ?? [];
  const brand = "#AutoLenis";

  const makeTags: Record<string, string> = {
    toyota: "#Toyota",
    ford: "#Ford",
    chevrolet: "#Chevy",
    honda: "#Honda",
    ram: "#Ram",
    gmc: "#GMC",
    hyundai: "#Hyundai",
    kia: "#Kia",
    jeep: "#Jeep",
    bmw: "#BMW",
    mercedes: "#Mercedes",
    nissan: "#Nissan",
  };
  const makeTag = input.make
    ? makeTags[(input.make ?? "").toLowerCase()] ?? null
    : null;

  const city = input.city ?? input.metro ?? "";
  const geoTag = city
    ? `#${city.replace(/\s+/g, "").replace(/-/g, "")}`
    : null;

  const automotiveNiche = ["#CarBuying101", "#CarShoppingTips"];

  let tags: string[] = [];

  switch (input.platform) {
    case "tiktok":
      // Max 10: 3 trending + 2 franchise + 2 niche + brand + make + geo
      tags = [
        ...trending.slice(0, 3),
        ...franchiseTags.slice(0, 2),
        ...automotiveNiche.slice(0, 2),
        brand,
        ...(makeTag ? [makeTag] : []),
        ...(geoTag ? [geoTag] : []),
      ];
      break;

    case "instagram":
      // Max 15: 4 trending + 3 franchise + 3 niche + 2 local + brand + make
      tags = [
        ...trending.slice(0, 4),
        ...franchiseTags.slice(0, 3),
        ...automotiveNiche,
        "#CarBuyingGuide",
        brand,
        ...(makeTag ? [makeTag] : []),
        ...(geoTag ? [geoTag] : []),
      ];
      break;

    case "facebook":
      // Max 5: 2 trending + 2 automotive + brand
      tags = [
        ...trending.slice(0, 2),
        ...franchiseTags.slice(0, 2),
        brand,
      ];
      break;

    case "linkedin":
      // Max 5: professional only
      tags = [
        "#Automotive",
        "#CarBuying",
        "#ConsumerAdvice",
        "#AutoLenis",
        "#PersonalFinance",
      ];
      break;

    case "youtube":
      // Max 5: 2 trending + 2 automotive + brand
      tags = [
        ...trending.slice(0, 2),
        ...franchiseTags.slice(0, 2),
        brand,
      ];
      break;

    default:
      tags = [...franchiseTags.slice(0, 3), brand];
  }

  // Deduplicate
  return [...new Set(tags.filter(Boolean))].slice(0, 15);
}
