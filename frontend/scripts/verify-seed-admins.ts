// LOCAL VERIFICATION FIXTURE — Batch 5. NOT application code, NOT for production.
//
// Creates one MFA-enrolled admin per AdminRole against a local throwaway
// database so authenticated admin surfaces can be exercised in a browser.
// Reuses the repo's own encryptTotpSecret (lib/admin-auth) and bcrypt hashing so
// the accounts are validated by the real signin path — no auth is bypassed,
// mocked, or weakened anywhere.
//
// Usage (with .env.local exported):  pnpm exec tsx scripts/verify-seed-admins.ts

import { PrismaClient, type AdminRole } from "@prisma/client";
import { encryptTotpSecret } from "../lib/admin-auth";
import { hash } from "bcryptjs";
import * as OTPAuth from "otpauth";
import { randomUUID } from "node:crypto";

const ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
];

// Local-only password. This database is a throwaway created for one verification
// run and is never reachable from outside this sandbox.
const PASSWORD = "LocalVerify!2026";

async function main() {
  const prisma = new PrismaClient();
  const passwordHash = await hash(PASSWORD, 10);
  const out: { role: string; email: string; secret: string; code: string }[] = [];

  for (const role of ROLES) {
    const email = `${role.toLowerCase().replace(/_/g, "-")}@verify.local`;
    const secret = new OTPAuth.Secret({ size: 20 }).base32;

    const user = await prisma.user.upsert({
      where: { email },
      update: { role },
      create: { email, role, supabaseId: randomUUID() },
    });

    await prisma.admin.upsert({
      where: { userId: user.id },
      update: {
        role,
        passwordHash,
        totpSecret: encryptTotpSecret(secret),
        totpEnabled: true,
        isActive: true,
        failedMfaAttempts: 0,
        mfaLockedUntil: null,
      },
      create: {
        userId: user.id,
        role,
        passwordHash,
        totpSecret: encryptTotpSecret(secret),
        totpEnabled: true,
        isActive: true,
      },
    });

    const totp = new OTPAuth.TOTP({
      issuer: "AutoLenis",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    out.push({ role, email, secret, code: totp.generate() });
  }

  console.log("─── Local verification admins (NON-PRODUCTION) ───");
  console.log("password:", PASSWORD);
  for (const r of out) console.log(`  ${r.role.padEnd(17)} ${r.email.padEnd(34)} secret=${r.secret}`);
  console.log("──────────────────────────────────────────────────");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
