// Single source of truth for marketing / lifestyle photography used
// across public pages. Swap asset URLs here to update everywhere.

export const MARKETING_IMAGES = {
  // Hero — salesman high-fiving a kid at the dealer desk, family watching.
  // Evokes "deal closed, everyone happy" — perfect primary CTA pair.
  homeHero:
    "https://customer-assets.emergentagent.com/job_78d31185-4147-4a3f-a9c0-a07349eaa67e/artifacts/39rja9p1_iStock-1468922964.jpg",

  // For Buyers — Black family in car, daughter in driver's seat with steering wheel.
  // Joyful family-first ownership moment.
  buyersHero:
    "https://customer-assets.emergentagent.com/job_78d31185-4147-4a3f-a9c0-a07349eaa67e/artifacts/rz5r615t_iStock-1331295443.jpg",

  // How It Works — family peering into a premium car interior at a showroom.
  // Shows the "evaluating the vehicle" moment in the buying journey.
  howItWorks:
    "https://customer-assets.emergentagent.com/job_78d31185-4147-4a3f-a9c0-a07349eaa67e/artifacts/9630qk7u_iStock-1646846553.jpg",

  // Pricing / success — three adults with arms raised celebrating next to a car.
  // Aspirational "yes, we got it" moment that pairs well with pricing tiers.
  pricingCelebration:
    "https://customer-assets.emergentagent.com/job_78d31185-4147-4a3f-a9c0-a07349eaa67e/artifacts/xpyskmdk_iStock-1472186226.jpg",

  // Refinance / about / trust — warm sales handshake moment with family.
  // Works as a trust image on refinance, contract-shield, or about pages.
  trustMoment:
    "https://customer-assets.emergentagent.com/job_78d31185-4147-4a3f-a9c0-a07349eaa67e/artifacts/4wpkadfc_iStock-1287415122.jpg",
} as const;

export type MarketingImageKey = keyof typeof MARKETING_IMAGES;
