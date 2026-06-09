// AutoLenis Social Engine — Attribution hook.
//
// Non-destructive bridge from any vehicle-request route into the social UTM
// attribution service. Callable from non-protected routes (e.g.
// /api/public/request-vehicle) inside an after() block so it never blocks or
// fails the buyer's submission.
//
// It only does work when the request actually came from a social platform; for
// every other source it returns early. Everything is wrapped in try/catch so it
// never throws into its caller.

import { captureUtmAttribution } from "@/lib/social/attribution.service";

const SOCIAL_PLATFORMS = new Set(["facebook", "instagram", "tiktok", "youtube", "linkedin"]);

export interface TriggerSocialAttributionInput {
  vehicleRequestId: string;
  buyerOpportunityId: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  utmHook?: string;
  utmPlatform?: string;
  utmCreator?: string;
  utmAffiliate?: string;
}

export async function triggerSocialAttribution(
  input: TriggerSocialAttributionInput,
): Promise<void> {
  try {
    const source = input.utmSource?.toLowerCase() ?? "";
    if (!SOCIAL_PLATFORMS.has(source)) {
      // Not a social-sourced request — nothing to attribute.
      return;
    }

    await captureUtmAttribution({
      vehicleRequestId: input.vehicleRequestId,
      buyerOpportunityId: input.buyerOpportunityId,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      utmHook: input.utmHook,
      utmPlatform: input.utmPlatform,
      utmCreator: input.utmCreator,
      utmAffiliate: input.utmAffiliate,
    });

    console.log("[attribution-hook] social attribution captured");
  } catch (err) {
    console.error(
      "[attribution-hook] failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}
