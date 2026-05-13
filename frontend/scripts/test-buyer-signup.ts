// E2E live test — triggers the same buyer-signup path as `signUpAction`.
// Run with: npx tsx scripts/test-buyer-signup.ts <email>
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { sendWelcomeEmail } from "../lib/services/email/resend.service";

async function main() {
  const email = (process.argv[2] ?? "").toLowerCase().trim();
  if (!email) {
    console.error("Usage: npx tsx scripts/test-buyer-signup.ts <email>");
    process.exit(1);
  }
  const password = "TestSignup-" + Math.random().toString(36).slice(2, 10) + "!1";
  const firstName = "Test";
  const lastName = "Buyer";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://repo-mirror-check.preview.emergentagent.com").trim();

  console.log("=== AutoLenis Buyer Signup E2E Test ===");
  console.log(`To:       ${email}`);
  console.log(`AppUrl:   ${appUrl}`);
  console.log(`Password: ${password}\n`);

  const prisma = new PrismaClient();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`❌ User already exists in DB (id=${existing.id}). Delete it first or use a fresh email.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supaUrl || !serviceKey) {
    console.error("❌ Supabase env not set");
    process.exit(1);
  }
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const callbackUrl = new URL(`${appUrl}/auth/callback`);

  console.log("→ Calling Supabase admin generateLink({type:'signup'})...");
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      redirectTo: callbackUrl.toString(),
      data: { firstName, lastName, role: "BUYER", plan: "STANDARD", referralCode: null,
              termsAcceptedAt: new Date().toISOString(), termsVersion: "2026-01-01" },
    },
  });
  if (error) {
    console.error("❌ generateLink failed:", error.message, "status:", (error as { status?: number }).status);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!linkData?.properties?.action_link) {
    console.error("❌ no action_link in response");
    await prisma.$disconnect();
    process.exit(1);
  }
  const verificationUrl = linkData.properties.action_link;
  console.log("✅ action_link generated\n   ", verificationUrl.slice(0, 80) + "...\n");

  console.log("→ Sending branded welcome email via Resend...");
  try {
    const result = await sendWelcomeEmail({ to: email, firstName, verificationUrl });
    if (result.sent) {
      console.log(`✅ Resend accepted (id=${result.resendId})`);
    } else {
      console.log(`⚠️ Email skipped or already sent (resendId=${result.resendId ?? "n/a"})`);
    }
  } catch (e) {
    console.error("❌ Resend send failed:", e);
  }

  // Quick post-state report
  const user = await prisma.user.findUnique({ where: { email } });
  const buyer = user ? await prisma.buyer.findFirst({ where: { userId: user.id } }) : null;
  const log = await prisma.emailSendLog.findFirst({ where: { recipient: email }, orderBy: { sentAt: "desc" } });

  console.log("\n=== Post-state ===");
  console.log(`Prisma User:    ${user ? `✅ id=${user.id}` : "(not yet — created on /auth/callback)"}`);
  console.log(`Prisma Buyer:   ${buyer ? `✅ id=${buyer.id}` : "(not yet — created on /auth/callback)"}`);
  console.log(`EmailSendLog:   ${log ? `✅ status=${log.status} resendId=${log.resendId ?? "n/a"} sentAt=${log.sentAt.toISOString()}` : "❌ no row"}`);

  console.log("\n=== Next Steps ===");
  console.log(`1. Inbox: ${email} — open the AutoLenis welcome email`);
  console.log(`2. Click the verification link → it routes to ${callbackUrl.toString()}`);
  console.log(`3. Expected outcome: Buyer + User rows created, redirect to /buyer/dashboard or /buyer/welcome`);
  console.log(`4. If sign-in is required, password is logged above`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
