// Sandbox helper: generate a current TOTP code for the seeded admin
import { PrismaClient } from "@prisma/client";
import { decryptTotpSecret } from "../lib/admin-auth";
import * as OTPAuth from "otpauth";

async function main() {
  const prisma = new PrismaClient();
  const admin = await prisma.admin.findFirst({ include: { user: true } });
  if (!admin || !admin.totpSecret) {
    console.error("No admin/totp found");
    process.exit(1);
  }
  const secretBase32 = decryptTotpSecret(admin.totpSecret);
  const totp = new OTPAuth.TOTP({
    issuer: "AutoLenis",
    label: admin.user.email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  console.log(totp.generate());
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
