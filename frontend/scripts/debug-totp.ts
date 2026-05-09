import { PrismaClient } from "@prisma/client";
import { verifyTotpCodeFromEncrypted, decryptTotpSecret } from "../lib/admin-auth";
import * as OTPAuth from "otpauth";

async function main() {
  const prisma = new PrismaClient();
  const admin = await prisma.admin.findFirst();
  if (!admin?.totpSecret) { console.error("no admin"); process.exit(1); }
  console.log("totpSecret first chars:", admin.totpSecret.slice(0, 20));
  const secretBase32 = decryptTotpSecret(admin.totpSecret);
  console.log("decrypted secret:", secretBase32);
  const totp = new OTPAuth.TOTP({
    issuer: "AutoLenis", label: "x", algorithm: "SHA1", digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const code = totp.generate();
  console.log("Generated:", code);
  console.log("verifyTotpCodeFromEncrypted:", verifyTotpCodeFromEncrypted(admin.totpSecret, code));
  await prisma.$disconnect();
}
main();
