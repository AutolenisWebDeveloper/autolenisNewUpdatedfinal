// Generates the daily admin briefing and emails it to the SUPER_ADMIN.
// generateAndSaveBriefing() handles in-DB persistence; this cron wires the email send.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { generateAndSaveBriefing } from "@/lib/services/admin/morning-briefing.service";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  // Get the first SUPER_ADMIN to attribute the briefing to.
  const admin = await prisma.admin.findFirst({
    where: { role: "SUPER_ADMIN" },
    include: { user: { select: { email: true } } },
  });

  if (!admin) {
    return NextResponse.json(
      { success: false, error: { code: "NO_ADMIN", message: "No SUPER_ADMIN found" } },
      { status: 404 },
    );
  }

  const run = await withCronRun("morning-briefing", async () => {
  const content = await generateAndSaveBriefing(admin.id, admin.role);

  // Direct Resend send — non-blocking.
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? admin.user.email;
  if (adminEmail && process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "AutoLenis <noreply@autolenis.com>",
        to: adminEmail,
        subject: `AutoLenis Daily Briefing — ${new Date().toLocaleDateString()}`,
        text: content,
      });
    } catch (err) {
      logger.error("[morning-briefing] email failed:", err);
    }
  }

  return { emailedTo: adminEmail };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "morning-briefing_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
