// Shared types for the /admin/social dashboard.
// Extracted from SocialDashboardClient.tsx (PR: social dashboard decomposition,
// step 1) so tab modules and the shell import from one place instead of a
// single 4,600-line file. Pure types — no runtime code.

export interface FranchiseRow {
  id: string;
  slug: string;
  name: string;
  platforms: string[];
  cadence: string;
  requiresReview: boolean;
  active: boolean;
  avgLeadScore: number | null;
  postsGenerated: number;
}
export interface PlatformConnection {
  platform: string;
  connected: boolean;
}
export interface ProviderConnections {
  meta: { connected: boolean };
  tiktok: { connected: boolean };
  linkedin: { connected: boolean; pageId: string };
  runway: { connected: boolean };
  automationMode: string;
}
export interface MarketIndexLast {
  title: string | null;
  summary: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  linkedInUrl: string | null;
  status: string | null;
}
export type AutomationMode = "MANUAL_REVIEW" | "HYBRID_AUTO" | "FULL_AUTO";

export interface VideoLite {
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}
export interface Post {
  id: string;
  platform: string;
  contentType: string;
  hookType: string | null;
  hook: string;
  script: string;
  caption: string;
  hashtags: string[];
  ctaText: string | null;
  funnelDestination: string | null;
  trackedUrl: string | null;
  complianceNotes: string | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  leadScore: number;
  make: string | null;
  model: string | null;
  metro: string | null;
  franchise: { slug: string; name: string } | null;
  video: VideoLite | null;
}
export interface Signal {
  id: string;
  signalType: string;
  make: string | null;
  model: string | null;
  city: string | null;
  signalValue: number | null;
  assetsGenerated: boolean;
  assetCount: number;
  detectedAt: string;
}
export interface Stats {
  posts: { draft: number; pending: number; approved: number; scheduled: number; published: number; failed: number };
  videos: { queued: number; generating: number; ready: number; failed: number };
  performance: { totalReach: number; totalClicks: number; totalRequests: number; totalLeadScore: number };
  topFranchise: string;
  topHook: string;
  topPlatform: string;
  revenue?: {
    totalCents: number;
    dealsWon: number;
    byFranchise: { franchise: string; revenueCents: number }[];
    byPlatform: { platform: string; revenueCents: number }[];
    topPost: { hook: string; revenueCents: number } | null;
  };
}
export interface TrendingData {
  tiktokHashtags?: string[];
  redditTopics?: string[];
  googleTrends?: string[];
}
export interface SocialLead {
  id: string;
  platform: string | null;
  franchise: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmHook: string | null;
  landingPage: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  vehicleInterest: string | null;
  make: string | null;
  model: string | null;
  budget: string | null;
  timeline: string | null;
  status: string;
  nurtureSequence: string | null;
  nurtureStep: number;
  lastEmailSentAt: string | null;
  convertedAt: string | null;
  createdAt: string;
}
export interface LeadsResponse {
  leads: SocialLead[];
  total: number;
  stats: {
    thisWeek: number;
    today: number;
    topPlatform: string;
    conversionRate: number;
    byPlatform: { platform: string; count: number }[];
    byLandingPage: { page: string; count: number }[];
  };
}
export interface Creator {
  id: string;
  name: string;
  email: string | null;
  platform: string;
  handle: string | null;
  status: string;
  followerCount: number | null;
  commissionRate: number | null;
  affiliateId: string | null;
  packagesSent: number;
  clicks: number;
  leads: number;
  revenueCents: number;
  createdAt: string;
}
export interface CreatorsResponse {
  creators: Creator[];
  stats: {
    total: number;
    active: number;
    totalClicks: number;
    revenueAttributedCents: number;
  };
}
