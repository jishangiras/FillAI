import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const browser = process.argv[2] === "firefox" ? "firefox" : "chrome";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist", browser);

await mkdir(outDir, { recursive: true });
await copyFile(
  resolve(root, "src", `manifest.${browser}.json`),
  resolve(outDir, "manifest.json")
);

console.log(`Wrote ${browser} manifest to ${outDir}/manifest.json`);
