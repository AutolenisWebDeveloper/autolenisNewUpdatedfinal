import { readFileSync, existsSync } from "fs";
import * as path from "path";
import { createDecipheriv } from "crypto";

// Load ../.env.local if present. Uses a minimal inline parser rather than the
// `dotenv` package so this standalone diagnostic script has no dependency
// outside the project's installed packages and type-checks cleanly in the build.
const envPath = path.resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

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
