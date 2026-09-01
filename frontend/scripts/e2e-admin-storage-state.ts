// Mint a Playwright storageState carrying an authenticated admin session.
//
// WHY THIS IS SAFE TO EXIST. Admin auth is a self-contained JWT cookie —
// lib/auth/admin-session.ts says so explicitly ("NEVER touches Supabase auth")
// — signed with ADMIN_JWT_SECRET or JWT_SECRET. Anyone holding that secret can
// already mint this token in five lines; this script adds no capability, it
// only packages one so a CI job does not open-code it.
//
// WHY IT REFUSES TO RUN ANYWHERE ELSE. It creates an admin row with
// mfaVerified baked into the token, bypassing TOTP. That is correct for a
// throwaway CI database and catastrophic anywhere else, so the database name is
// checked before anything is written. The guard is on the DSN, matching the
// convention every spec in tests/e2e already uses.
//
// Usage: E2E_STORAGE_STATE=/tmp/admin.json tsx scripts/e2e-admin-storage-state.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { signAdminJwt, ADMIN_TOKEN_COOKIE } from "../lib/admin-auth";

const EMAIL = "e2e-admin@autolenis.test";

async function main() {
  const dsn = process.env.DATABASE_URL ?? "";
  if (!/autolenis_e2e/.test(dsn)) {
    throw new Error(
      "Refusing to mint an admin session: DATABASE_URL must target autolenis_e2e",
    );
  }
  const out = process.env.E2E_STORAGE_STATE;
  if (!out) throw new Error("E2E_STORAGE_STATE must name the file to write");

  const baseUrl = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000");

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      update: {},
      create: { email: EMAIL, supabaseId: `e2e-admin-${Date.now()}`, role: "SUPER_ADMIN" },
    });
    const admin = await prisma.admin.upsert({
      where: { userId: user.id },
      update: { isActive: true },
      // No password hash and no TOTP secret: this account cannot be signed into
      // through the real form. The cookie is the only way in, and it expires.
      create: { userId: user.id, role: "SUPER_ADMIN", isActive: true, recoveryCodes: [], pendingRecoveryCodes: [] },
    });

    const token = await signAdminJwt({
      adminId: admin.id,
      role: admin.role,
      email: EMAIL,
      mfaVerified: true,
    });

    const state = {
      cookies: [
        {
          name: ADMIN_TOKEN_COOKIE,
          value: token,
          domain: baseUrl.hostname,
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
          httpOnly: true,
          secure: baseUrl.protocol === "https:",
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    };

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(state, null, 2));
    console.log(`[e2e] admin storage state written to ${out} (admin ${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
