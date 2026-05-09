import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { sendDealerPasswordResetEmail } from "@/lib/services/email/resend.service";

const schema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: true });

    const { email } = parsed.data;

    // Always return success — never reveal whether account exists
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase().trim(), role: "DEALER" } });

    if (user) {
      // Use Supabase admin API to send a password reset email via Supabase's built-in flow.
      // Fall back gracefully if Supabase is unavailable (e.g. CI environment).
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";
        const redirectUrl = `${appUrl}/dealer/reset-password`;

        const { createClient } = await import("@supabase/supabase-js");
        const supabaseAdmin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: email.toLowerCase().trim(),
          options: { redirectTo: redirectUrl },
        });

        // Use the real tokenized link from Supabase; fall back to the redirect URL
        // only if Supabase didn't return a link (e.g. non-existent user).
        const resetUrl = linkData?.properties?.action_link ?? redirectUrl;

        const contactName = user.email.split("@")[0];
        await sendDealerPasswordResetEmail({
          to: email.toLowerCase().trim(),
          contactName,
          resetUrl,
        });
      } catch {
        // Never expose errors to client
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // Always return success
  }
}
