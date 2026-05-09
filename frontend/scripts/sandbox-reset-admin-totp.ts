// Sandbox helper: reset admin TOTP to a documented sandbox secret so testers can
// reproduce the MFA verification flow. SANDBOX/TEST USE ONLY.
//
// Usage: yarn tsx scripts/sandbox-reset-admin-totp.ts
//
// After running, scan the printed otpauth URI in any authenticator app
// (or use the printed secret directly), then sign in to /admin/signin.
// You can also call scripts/sandbox-totp.ts to print the current 6-digit code.

import { PrismaClient } from "@prisma/client";
import { encryptTotpSecret } from "../lib/admin-auth";
import * as OTPAuth from "otpauth";

async function main() {
  const prisma = new PrismaClient();

  const admin = await prisma.admin.findFirst({ include: { user: true } });
  if (!admin) {
    console.error("No admin row found. Seed an admin first.");
    process.exit(1);
  }

  // Generate a fresh sandbox TOTP secret
  const newSecret = new OTPAuth.Secret({ size: 20 }).base32;
  const encrypted = encryptTotpSecret(newSecret);

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      totpSecret: encrypted,
      totpEnabled: true,
      pendingRecoveryCodes: [],
      // Also clear any active MFA lockout so a locked-out admin can sign in
      failedMfaAttempts: 0,
      mfaLockedUntil: null,
    },
  });

  const totp = new OTPAuth.TOTP({
    issuer: "AutoLenis",
    label: admin.user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(newSecret),
  });

  console.log("─── Admin TOTP reset (SANDBOX) ───");
  console.log("Email:        ", admin.user.email);
  console.log("Sandbox secret:", newSecret);
  console.log("otpauth URI:  ", totp.toString());
  console.log("Current code: ", totp.generate());
  console.log("──────────────────────────────────");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
