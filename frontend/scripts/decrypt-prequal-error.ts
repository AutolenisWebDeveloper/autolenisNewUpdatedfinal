import * as dotenv from "dotenv";
import * as path from "path";
import { createDecipheriv } from "crypto";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const blob = process.argv[2];
if (!blob) {
  console.error("Usage: npx tsx scripts/decrypt-prequal-error.ts <base64-blob>");
  process.exit(1);
}

const keyHex = process.env.PREQUAL_ENCRYPTION_KEY;
if (!keyHex || keyHex.length !== 64) {
  console.error("PREQUAL_ENCRYPTION_KEY missing or not 64-char hex");
  process.exit(1);
}

try {
  const key = Buffer.from(keyHex, "hex");
  const buf = Buffer.from(blob, "base64");
  const iv  = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct  = buf.slice(28);
  const d   = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  const out = Buffer.concat([d.update(ct), d.final()]);
  const parsed = JSON.parse(out.toString("utf8"));
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.error("Decryption failed:", err);
  process.exit(1);
}
