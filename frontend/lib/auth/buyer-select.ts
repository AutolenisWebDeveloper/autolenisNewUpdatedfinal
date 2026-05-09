// Explicit Prisma select for buyer queries that is backward-safe against the
// lifecycle migration (20260603000000_add_buyer_lifecycle_fields).
//
// The migration adds archived_at / disabled_at / purged_at to the buyers table.
// Until it is applied to every environment the Prisma include-based query
// (which selects ALL model columns) will fail with "column does not exist".
// This select deliberately omits those three columns so the fallback query
// succeeds even on a pre-migration database.
export const BUYER_BACKWARD_SAFE_SELECT = {
  id: true,
  userId: true,
  firstName: true,
  lastName: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
  onboardingComplete: true,
  termsAcceptedAt: true,
  termsVersion: true,
  profilePictureUrl: true,
  employmentStatus: true,
  incomeRange: true,
  affiliateId: true,
  plan: true,
  planUpgradedAt: true,
  isSuspended: true,
  createdAt: true,
  updatedAt: true,
  user: true,
  preQualification: true,
} as const;
