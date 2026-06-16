// AutoLenis Social Engine — Meta retargeting audience builder.
//
// Uploads SHA-256-hashed emails of non-converting social leads (last 90 days)
// into a Meta Custom Audience so the ads layer can retarget them. No-ops
// gracefully when META_ACCESS_TOKEN / META_AD_ACCOUNT_ID are unset. Emails are
// hashed (lowercased + trimmed) before upload — raw addresses never leave here.

import { logger } from "@/lib/logger";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export async function buildRetargetingAudience(): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId) {
    logger.info("[retargeting] META credentials not set — skipping");
    return;
  }

  // Find non-converting social leads from last 90 days
  const leads = await prisma.socialLead.findMany({
    where: {
      convertedAt: null,
      status: { in: ["NEW", "NURTURING"] },
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      email: { not: "" },
    },
    select: { email: true },
    take: 1000,
  });

  if (leads.length === 0) {
    logger.info("[retargeting] no leads to upload");
    return;
  }

  // Hash emails with SHA-256
  const hashedEmails = leads.map((l) => [
    crypto.createHash("sha256").update(l.email.toLowerCase().trim()).digest("hex"),
  ]);

  // Find or create the custom audience
  const audienceName = "AutoLenis Non-Converters";
  let audienceId: string | null = null;

  try {
    // Search for existing audience
    const searchRes = await fetch(
      `https://graph.facebook.com/v18.0/${adAccountId}/customaudiences` +
        `?fields=id,name&access_token=${token}`,
      { method: "GET" },
    );
    const searchData = (await searchRes.json()) as {
      data?: { id: string; name: string }[];
    };
    const existing = searchData.data?.find((a) => a.name === audienceName);
    if (existing) {
      audienceId = existing.id;
    } else {
      // Create new audience
      const createRes = await fetch(
        `https://graph.facebook.com/v18.0/${adAccountId}/customaudiences`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: token,
            name: audienceName,
            subtype: "CUSTOM",
            description: "Social leads who did not convert",
            customer_file_source: "USER_PROVIDED_ONLY",
          }),
        },
      );
      const createData = (await createRes.json()) as { id?: string };
      audienceId = createData.id ?? null;
    }
  } catch (err) {
    logger.error("[retargeting] audience find/create failed:", err);
    return;
  }

  if (!audienceId) return;

  // Upload hashed emails in batches of 100
  const batchSize = 100;
  let uploaded = 0;
  for (let i = 0; i < hashedEmails.length; i += batchSize) {
    const batch = hashedEmails.slice(i, i + batchSize);
    try {
      await fetch(`https://graph.facebook.com/v18.0/${audienceId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: token,
          payload: {
            schema: ["EMAIL_SHA256"],
            data: batch,
          },
        }),
      });
      uploaded += batch.length;
    } catch (err) {
      logger.error("[retargeting] batch upload failed:", err);
    }
  }

  logger.info(`[retargeting] uploaded ${uploaded} emails to Meta audience`);
}
