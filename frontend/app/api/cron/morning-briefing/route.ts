// Generates the daily admin briefing and emails it to the SUPER_ADMIN.
// generateAndSaveBriefing() handles in-DB persistence; this cron wires the email send.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { generateAndSaveBriefing } from "@/lib/services/admin/morning-briefing.service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

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
      console.error("[morning-briefing] email failed:", err);
    }
  }

  return NextResponse.json({ success: true, data: { emailedTo: adminEmail } });
}
