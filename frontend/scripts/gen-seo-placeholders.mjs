// One-off generator for SEO hero placeholder images.
// Produces 1200x630 branded JPGs (<100KB) so /car-buying-service/* pages have a
// valid LCP image at launch. These are PLACEHOLDERS — {{CONFIRM_WITH_OWNER}}:
// replace with licensed local photography post-launch.
//
//   node scripts/gen-seo-placeholders.mjs
//
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "images", "seo");

const CITIES = [
  ["state-texas-hero", "Texas"],
  ["city-allen-hero", "Allen, TX"],
  ["city-arlington-hero", "Arlington, TX"],
  ["city-dallas-hero", "Dallas, TX"],
  ["city-denton-hero", "Denton, TX"],
  ["city-fort-worth-hero", "Fort Worth, TX"],
  ["city-frisco-hero", "Frisco, TX"],
  ["city-little-elm-hero", "Little Elm, TX"],
  ["city-mckinney-hero", "McKinney, TX"],
  ["city-plano-hero", "Plano, TX"],
  ["city-prosper-hero", "Prosper, TX"],
];

function svg(label) {
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0B5FD1"/>
        <stop offset="100%" stop-color="#0a2a55"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="64" y="300" font-family="Arial, sans-serif" font-size="40" fill="#9fc4ff" font-weight="600">AutoLenis · Car Buying Service</text>
    <text x="64" y="380" font-family="Arial, sans-serif" font-size="84" fill="#ffffff" font-weight="800">${label}</text>
    <text x="64" y="560" font-family="Arial, sans-serif" font-size="26" fill="#cfe0ff">Placeholder image — replace with licensed local photography</text>
  </svg>`;
}

await mkdir(OUT, { recursive: true });
for (const [file, label] of CITIES) {
  await sharp(Buffer.from(svg(label)))
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(join(OUT, `${file}.jpg`));
  console.log("wrote", `${file}.jpg`);
}
console.log("done");
