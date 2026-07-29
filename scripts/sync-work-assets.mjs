import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ORIGIN = "https://aristidebenoist.com";
const SOURCE_ROUTE = "/house-of-gucci?xhr=true&device=d&webp=true";
const SOURCE_VERSION = "2";
const DOWNLOAD_CONCURRENCY = 8;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(projectRoot, "src", "data", "projects.json");
const projectWorksPath = path.join(projectRoot, "src", "data", "projectWorks.json");
const manifestPath = path.join(
  projectRoot,
  "docs",
  "research",
  "raw",
  "asset-manifest.json",
);

const [projects, currentManifest, response] = await Promise.all([
  readJson(projectsPath),
  readJson(manifestPath),
  fetch(`${SOURCE_ORIGIN}${SOURCE_ROUTE}`),
]);

if (!response.ok) {
  throw new Error(`${response.status} ${response.statusText}: ${SOURCE_ROUTE}`);
}

const payload = await response.json();
const sourceWorks = payload?.data?.work;

if (!Array.isArray(sourceWorks) || sourceWorks.length !== projects.length) {
  throw new Error("The source work payload does not match the local project list.");
}

const workBySlug = new Map(
  sourceWorks.map((work) => [String(work.url).replace(/^\//, ""), work]),
);
const projectWorks = [];
const workAssets = [];

for (const project of projects) {
  const source = workBySlug.get(project.slug);

  if (!source || !Array.isArray(source.media) || source.media.length !== source.mediaL) {
    throw new Error(`Invalid source work data for ${project.slug}.`);
  }

  const media = source.media.map((slot, sequence) => {
    const largeSource = `${SOURCE_ORIGIN}/static/media/${source.folder}/w/l/${sequence}.webp?${SOURCE_VERSION}`;
    const thumbnailSource = `${SOURCE_ORIGIN}/static/media/${source.folder}/w/s/${sequence}.webp?${SOURCE_VERSION}`;
    const largeLocalPath = `public/assets/work/${project.slug}/l/${sequence}.webp`;
    const thumbnailLocalPath = `public/assets/work/${project.slug}/s/${sequence}.webp`;

    workAssets.push(
      createManifestAsset("work-image", largeSource, largeLocalPath),
      createManifestAsset("work-thumbnail", thumbnailSource, thumbnailLocalPath),
    );

    return {
      slot,
      large: `/assets/work/${project.slug}/l/${sequence}.webp`,
      thumbnail: `/assets/work/${project.slug}/s/${sequence}.webp`,
      width: 1600,
      height: 900,
    };
  });

  projectWorks.push({
    slug: project.slug,
    title: project.title,
    titleRows: project.titleRows,
    background: source.color.work,
    foreground: source.color.txt.rgb,
    visitUrl: typeof source.visit === "string" ? source.visit : null,
    media,
  });
}

await writeFile(projectWorksPath, `${JSON.stringify(projectWorks, null, 2)}\n`, "utf8");

const manifest = [
  ...currentManifest.filter(
    (asset) => !String(asset.localPath).startsWith("public/assets/work/"),
  ),
  ...workAssets,
];

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

let downloaded = 0;
let skipped = 0;
let cursor = 0;

async function downloadNext() {
  while (cursor < workAssets.length) {
    const asset = workAssets[cursor];
    cursor += 1;
    const destination = resolveProjectPath(asset.localPath);

    try {
      if ((await stat(destination)).size > 0) {
        skipped += 1;
        continue;
      }
    } catch {
      // The missing file is downloaded below.
    }

    const assetResponse = await fetch(asset.sourceUrl);

    if (!assetResponse.ok) {
      throw new Error(
        `${assetResponse.status} ${assetResponse.statusText}: ${asset.sourceUrl}`,
      );
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, new Uint8Array(await assetResponse.arrayBuffer()));
    downloaded += 1;
  }
}

await Promise.all(
  Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, workAssets.length) },
    downloadNext,
  ),
);

console.log(
  `Work assets ready: ${projectWorks.length} projects, ${downloaded} downloaded, ${skipped} skipped.`,
);

function createManifestAsset(kind, sourceUrl, localPath) {
  return {
    id: createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16),
    kind,
    sourceUrl,
    localPath,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function resolveProjectPath(localPath) {
  const destination = path.resolve(projectRoot, localPath);
  const relativeDestination = path.relative(projectRoot, destination);

  if (relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) {
    throw new Error(`Refusing to write outside the project: ${localPath}`);
  }

  return destination;
}
