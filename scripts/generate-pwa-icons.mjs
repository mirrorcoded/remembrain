/**
 * Generates placeholder PWA icons (letter R on emerald background).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const BG = "#059669";
const FG = "#ffffff";

async function renderIcon(size) {
  const radius = Math.round(size * 0.18);
  const fontSize = Math.round(size * 0.52);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${BG}" rx="${radius}"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
      font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-weight="700" font-size="${fontSize}" fill="${FG}">R</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  await fs.mkdir(publicDir, { recursive: true });
  const out = [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ];
  for (const [name, size] of out) {
    const buf = await renderIcon(size);
    await fs.writeFile(path.join(publicDir, name), buf);
    console.log("Wrote", name, size + "×" + size);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
