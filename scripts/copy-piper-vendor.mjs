import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "node_modules", "@mintplex-labs", "piper-tts-web", "dist");
const destDir = path.join(root, "public", "vendor", "piper");

if (!fs.existsSync(srcDir)) {
  console.warn("[copy-piper-vendor] piper-tts-web dist not found; skip");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith(".js")) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}

console.log(`[copy-piper-vendor] copied Piper assets to ${destDir}`);
