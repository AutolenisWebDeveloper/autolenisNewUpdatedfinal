// scripts/reset-admin-mfa.ts
// One-time operational recovery script — clears MFA for a specific admin account
// so the admin can sign in with the same email/password and re-enroll Google Authenticator.
//
// SECURITY: This script is for operational recovery only.
//   - Does NOT change email, username, passwordHash, role, or permissions.
//   - Must NOT be exposed as an API route or web endpoint.
//   - Must be run directly on a trusted server with database access.
//
// Usage:
//   pnpm tsx scripts/reset-admin-mfa.ts --email admin@autolenis.com
//
// After running, the admin can sign in with their existing password and will be
// prompted to re-enroll Google Authenticator.

import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

function parseArgs(): { email: string } {
  const args = process.argv.slice(2);
  const emailFlagIdx = args.indexOf("--email");
  if (emailFlagIdx === -1 || !args[emailFlagIdx + 1]) {
    console.error("Error: --email argument is required.");
    console.error("Usage: pnpm tsx scripts/reset-admin-mfa.ts --email admin@autolenis.com");
    process.exit(1);
  }
  const email = args[emailFlagIdx + 1].trim().toLowerCase();
  if (!email.includes("@")) {
    console.error(`Error: '${email}' does not look like a valid email address.`);
    process.exit(1);
  }
  return { email };
}

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function main() {
  const { email } = parseArgs();

  // Look up the admin by email — must be exactly one match.
  // Email is unique in the User model, but we do a defensive count check.
  const matches = await prisma.user.findMany({
    where: {
      email,
      role: {
        in: [
          "SUPER_ADMIN",
          "OPERATIONS_ADMIN",
          "COMPLIANCE_ADMIN",
          "FINANCE_ADMIN",
          "SUPPORT_ADMIN",
        ],
      },
    },
    include: { admin: true },
    take: 2, // fetch at most 2 to detect ambiguous matches cheaply
  });

  if (matches.length === 0) {
    console.error(`Error: No admin user found with email '${email}'.`);
    console.error("Check the email address and ensure the account has an admin role.");
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`Error: Ambiguous match — more than one admin found with email '${email}'. Refusing to proceed.`);
    process.exit(1);
  }

  const user = matches[0];

  if (!user.admin) {
    console.error(`Error: User '${email}' exists but has no associated Admin record.`);
    process.exit(1);
  }

  const admin = user.admin;

  console.log("\n─── Admin MFA Reset via Script ───────────────────────────────────");
  console.log(`  Target email:    ${user.email}`);
  console.log(`  Admin ID:        ${admin.id}`);
  console.log(`  Role:            ${admin.role}`);
  console.log(`  mfaEnrolled:     ${admin.totpEnabled ? "true (ENABLED)" : "false (not enrolled)"}`);
  console.log(`  Recovery codes:  ${admin.recoveryCodes.length} stored`);
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("\nThis operation WILL:");
  console.log("  ✓ Set totpSecret = null");
  console.log("  ✓ Set totpEnabled = false");
  console.log("  ✓ Clear all recovery/backup codes");
  console.log("  ✓ Set mfaVerifiedAt = null");
  console.log("  ✓ Reset failedMfaAttempts = 0");
  console.log("  ✓ Clear mfaLockedUntil");
  console.log("  ✓ Set mfaResetAt = now");
  console.log("  ✓ Invalidate pending MFA email tokens");
  console.log("  ✓ Write ADMIN_MFA_RESET_VIA_SCRIPT audit log");
  console.log("\nThis operation will NOT change:");
  console.log("  ✗ passwordHash");
  console.log("  ✗ role or permissions");
  console.log("  ✗ userId / email");
  console.log("  ✗ any other admin fields");

  const confirmed = await promptConfirm("\nType 'y' to confirm and proceed, anything else to abort: ");
  if (!confirmed) {
    console.log("\nAborted. No changes were made.\n");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log("\nApplying reset...\n");

  // Perform the reset in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.admin.update({
      where: { id: admin.id },
      data: {
        totpSecret: null,
        totpEnabled: false,
        recoveryCodes: [],
        mfaVerifiedAt: null,
        failedMfaAttempts: 0,
        mfaLockedUntil: null,
        lastRecoveryCodeUsedAt: null,
        mfaResetAt: new Date(),
      },
    });

    // Invalidate any pending email confirmation tokens for this admin
    await tx.adminMfaEmailToken.updateMany({
      where: { adminId: admin.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Write audit log — ADMIN_MFA_RESET_VIA_SCRIPT is a critical security event
    await tx.adminAuditLog.create({
      data: {
        adminId: admin.id,
        adminEmail: user.email,
        action: "ADMIN_MFA_RESET_VIA_SCRIPT",
        entityType: "Admin",
        entityId: admin.id,
        reason: "Admin MFA total lockout — operational recovery via reset-admin-mfa.ts script",
        metadata: {
          actor: "cli",
          targetEmail: user.email,
          previousTotpEnabled: admin.totpEnabled,
          previousRecoveryCodeCount: admin.recoveryCodes.length,
          timestamp: new Date().toISOString(),
        },
      },
    });
  });

  console.log("✓ MFA reset complete.\n");
  console.log("Next steps:");
  console.log("  Sign in at /admin/auth/signin with your existing password.");
  console.log("  You will be redirected to the MFA setup flow.\n");

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error("\n[reset-admin-mfa] Fatal error:", err);
  void prisma.$disconnect();
  process.exit(1);
});
