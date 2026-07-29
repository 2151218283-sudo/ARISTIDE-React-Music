import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  projectRoot,
  "docs",
  "research",
  "raw",
  "asset-manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const missing = [];
const empty = [];
const counts = new Map();

for (const asset of manifest) {
  counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1);

  const destination = path.resolve(projectRoot, asset.localPath);

  try {
    if ((await stat(destination)).size === 0) {
      empty.push(asset.localPath);
    }
  } catch {
    missing.push(asset.localPath);
  }
}

if (missing.length > 0 || empty.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing assets:\n${missing.join("\n")}`);
  }

  if (empty.length > 0) {
    console.error(`Empty assets:\n${empty.join("\n")}`);
  }

  process.exitCode = 1;
} else {
  const summary = [...counts.entries()]
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  console.log(`Verified ${manifest.length} assets: ${summary}.`);
}
