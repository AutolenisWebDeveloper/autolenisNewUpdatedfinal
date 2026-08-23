// /admin/social — Social Intelligence & Media Engine console.
// Server shell: enforces admin auth and hands the client the current automation
// mode, franchises, and platform-connection status (derived from env presence).
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { AUTOMATION_MODE } from "@/lib/social/config";
import SocialDashboardClient, {
  type FranchiseRow,
  type PlatformConnection,
} from "./SocialDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminSocialPage() {
  await requireAdmin();

  // The social tables are provisioned via a manual Supabase migration that may
  // not be applied in every environment. If the table/model is missing, the
  // query throws — degrade gracefully to an empty list instead of crashing the
  // whole route so the dashboard shell still renders.
  let franchises: FranchiseRow[] = [];
  try {
    franchises = (await prisma.contentFranchise.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        platforms: true,
        cadence: true,
        requiresReview: true,
        active: true,
        avgLeadScore: true,
        postsGenerated: true,
      },
    })) as FranchiseRow[];
  } catch (err) {
    logger.error("[admin/social] franchises query failed:", err);
    // franchises stays as an empty array
  }

  // Platform "connected" = the retained direct-API access token is present in
  // the environment. Buffer has been retired, so channels now map to their own
  // provider tokens (Meta for facebook/instagram, TikTok, LinkedIn).
  const platformConnections: PlatformConnection[] = [
    { platform: "facebook", connected: Boolean(process.env.META_ACCESS_TOKEN) },
    { platform: "instagram", connected: Boolean(process.env.META_ACCESS_TOKEN) },
    { platform: "tiktok", connected: Boolean(process.env.TIKTOK_ACCESS_TOKEN) },
    // YouTube publishing retired with Buffer — no direct publish surface
    { platform: "youtube", connected: false },
    { platform: "linkedin", connected: Boolean(process.env.LINKEDIN_ACCESS_TOKEN) },
  ];

  return (
    <SocialDashboardClient
      automationMode={AUTOMATION_MODE}
      franchises={franchises}
      platformConnections={platformConnections}
      videoEnabled={process.env.ENABLE_HIGGSFIELD_VIDEO === "true"}
    />
  );
}
