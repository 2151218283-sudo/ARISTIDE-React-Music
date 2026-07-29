import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
const force = process.argv.includes("--force");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

let downloaded = 0;
let skipped = 0;

for (const asset of manifest) {
  if (!asset.sourceUrl.startsWith("https://")) {
    skipped += 1;
    continue;
  }

  const destination = path.resolve(projectRoot, asset.localPath);
  const relativeDestination = path.relative(projectRoot, destination);

  if (relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) {
    throw new Error(`Refusing to write outside the project: ${asset.localPath}`);
  }

  if (!force) {
    try {
      if ((await stat(destination)).size > 0) {
        skipped += 1;
        continue;
      }
    } catch {
      // Missing assets are downloaded below.
    }
  }

  const response = await fetch(asset.sourceUrl);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${asset.sourceUrl}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  downloaded += 1;
  console.log(`Downloaded ${asset.localPath}`);
}

console.log(`Asset download complete: ${downloaded} downloaded, ${skipped} skipped.`);
