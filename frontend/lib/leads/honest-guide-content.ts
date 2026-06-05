// Phase C-Leads — content for the lead-magnet deliverables.
//
// The deliverable is rendered inline on /guide/thank-you (gated behind capture)
// and linked from the delivery email. Each magnet maps to a set of sections.
// Compliance: no specific dollar-savings claims, no guarantees, no fake
// testimonials — factual mechanics only.

export interface GuideSection {
  heading: string;
  body: string[]; // paragraphs
  points?: string[]; // optional bullet list
}

export interface GuideContent {
  slug: string;
  title: string;
  intro: string;
  sections: GuideSection[];
}

const HONEST_GUIDE: GuideContent = {
  slug: "honest-guide",
  title: "The Car Buyer's Honest Guide",
  intro:
    "Most buyers walk into a dealership at a disadvantage — not because they're bad negotiators, but because they're missing information the dealer has and they don't. This guide closes that gap. It works in every US market, for any make or model.",
  sections: [
    {
      heading: "The 3 numbers that decide whether you got a good deal",
      body: [
        "Forget the monthly payment for a moment. A good deal comes down to three numbers, and dealers prefer you focus on only one of them.",
      ],
      points: [
        "Selling price — the price of the vehicle before tax and fees. This is what you actually negotiate.",
        "Out-the-door (OTD) price — selling price plus taxes and legitimate government fees. This is the number you compare between dealers.",
        "Trade-in value — handled completely separately, so a high payment can't hide a low trade offer.",
      ],
    },
    {
      heading: "Every dealer fee, sorted into three buckets",
      body: [
        "When you see the fee sheet, every line falls into one of three buckets. Knowing which is which is most of the battle.",
      ],
      points: [
        "Required by your state — title and registration. Same at every dealer. Not negotiable.",
        "Negotiable — documentation/processing fees (capped by law in some states), GAP, extended warranties. Ask for reductions; buy GAP and warranties cheaper elsewhere.",
        "Pure markup — market adjustments, nitrogen tires, VIN etching, paint/fabric protection, dealer add-ons. These can and should be removed entirely.",
      ],
    },
    {
      heading: "The exact lines that get add-ons removed",
      body: [
        "You don't need to be aggressive. You need to be clear and consistent. These lines work because they're reasonable and easy to repeat.",
      ],
      points: [
        '"Please remove the add-ons — I only want the vehicle."',
        '"What\'s your out-the-door price, all fees included?"',
        '"I\'m comparing this against other dealers\' total price."',
        '"I\'ll buy GAP and any warranty from my own provider."',
      ],
    },
    {
      heading: "How to compare dealers without getting played",
      body: [
        "Dealers compete on the parts of the deal you let them hide. Force every quote into a single out-the-door number and the games stop working.",
        "Ask each dealer for the full OTD price in writing for the exact same vehicle and trim. Then compare those totals — not payments, not 'discounts off MSRP.'",
      ],
    },
    {
      heading: "When to walk — and what happens when you do",
      body: [
        "Walking away is the most underused tool a buyer has. If the fees won't come off or the OTD price isn't competitive, you're allowed to leave. Most pressure evaporates the moment a dealer believes you'll buy elsewhere.",
        "The easiest way to skip the showroom standoff entirely: let dealers compete for you privately. With AutoLenis, up to 8 local dealers submit their best out-the-door price in a 48-hour auction, and you pick the winner. No haggling, no walking out — the competition does the work.",
      ],
    },
  ],
};

// Lighter deliverables for the cluster-aligned magnets reuse the relevant
// sections of the flagship guide so every magnet has real, compliant content.
const DEALER_FEE_CHEATSHEET: GuideContent = {
  slug: "dealer-fee-cheatsheet",
  title: "The Dealer Fee Cheat Sheet",
  intro:
    "A fast verdict on every fee a dealer can put in front of you, plus the line to say when each one appears.",
  sections: [
    HONEST_GUIDE.sections[1], // three buckets
    HONEST_GUIDE.sections[2], // the lines that work
    {
      heading: "Use the free Dealer Fee Calculator",
      body: [
        "Enter any fee from your worksheet and get a state-aware verdict — required, negotiable, or reject — at /tools/dealer-fee-calculator. It knows the doc-fee caps and typical ranges for your state.",
      ],
    },
  ],
};

const TRADE_IN_PLAYBOOK: GuideContent = {
  slug: "trade-in-playbook",
  title: "The Trade-In Value Playbook",
  intro:
    "How dealers value trade-ins, and how to keep your trade from being used to hide a worse deal on the car.",
  sections: [
    {
      heading: "Negotiate the car and the trade separately",
      body: [
        "Dealers can move money between the new-car price and your trade-in to make a deal look better than it is. Settle the vehicle's out-the-door price first. Only then discuss the trade as its own number.",
      ],
    },
    {
      heading: "Know your floor before you walk in",
      body: [
        "Get a couple of instant cash offers from online buyers and an independent valuation. That's your floor — the dealer has to beat it, including any sales-tax credit your state gives on the trade-in amount.",
      ],
    },
    HONEST_GUIDE.sections[0], // the 3 numbers
  ],
};

const OTD_WORKSHEET: GuideContent = {
  slug: "otd-price-worksheet",
  title: "The Out-the-Door Price Worksheet",
  intro:
    "Turn confusing quotes into one comparable out-the-door number for every dealer.",
  sections: [
    HONEST_GUIDE.sections[0], // 3 numbers
    HONEST_GUIDE.sections[3], // compare without getting played
    {
      heading: "Your comparison grid",
      body: [
        "For each dealer, write down: selling price, doc/processing fee, government fees (title + registration), taxes, and add-ons. Add them for the true OTD total. The lowest legitimate OTD wins — ignore everything else.",
      ],
    },
  ],
};

const LEASE_KIT: GuideContent = {
  slug: "lease-decision-kit",
  title: "The Lease vs. Buy Decision Kit",
  intro:
    "The handful of numbers that decide whether leasing or buying is right for you.",
  sections: [
    {
      heading: "Money factor and residual in plain English",
      body: [
        "Money factor is the lease's interest rate in disguise — multiply it by 2,400 to get the approximate APR. Residual is what the car is projected to be worth at lease end; a higher residual means a lower payment. Both are negotiable levers dealers rarely volunteer.",
      ],
    },
    {
      heading: "When leasing actually wins",
      body: [
        "Leasing tends to win when you want a new car every few years, drive predictable mileage, and value a lower payment over ownership. Buying wins when you keep cars long-term — the cheapest miles are always the ones after the loan is paid off.",
      ],
    },
    HONEST_GUIDE.sections[0],
  ],
};

const GUIDES: Record<string, GuideContent> = {
  "honest-guide": HONEST_GUIDE,
  "dealer-fee-cheatsheet": DEALER_FEE_CHEATSHEET,
  "trade-in-playbook": TRADE_IN_PLAYBOOK,
  "otd-price-worksheet": OTD_WORKSHEET,
  "lease-decision-kit": LEASE_KIT,
};

export function getGuideContent(slug: string | null | undefined): GuideContent {
  if (slug && GUIDES[slug]) return GUIDES[slug];
  return HONEST_GUIDE;
}
