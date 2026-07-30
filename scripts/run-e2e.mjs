import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { PNG } from "pngjs";

import { hasVisibleCanvasContent } from "./canvas-visual-check.mjs";

const host = "127.0.0.1";
const port = 3100;
const configuredBaseUrl = process.env.ECHOFORM_E2E_BASE_URL;
const serverUrl = configuredBaseUrl ?? `http://${host}:${port}`;
const startupTimeoutMs = 120_000;
const shutdownTimeoutMs = 10_000;
const screenshotDirectory = "tests/artifacts/playwright";

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once("error", () => {
      reject(new Error(`Port ${port} is already in use; stop the local server before running E2E tests.`));
    });

    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
}

async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

async function assertCanvasScreenshotsHaveContent() {
  const screenshotFiles = (await findFiles(screenshotDirectory))
    .filter((file) => /canvas-(desktop|tablet|mobile)\.png$/.test(file))
    .sort();

  if (screenshotFiles.length !== 3) {
    throw new Error("Expected exactly three canvas screenshots from the E2E smoke test.");
  }

  for (const screenshotFile of screenshotFiles) {
    const screenshot = PNG.sync.read(await readFile(screenshotFile));

    if (!hasVisibleCanvasContent(screenshot)) {
      throw new Error(`The canvas screenshot is visually blank: ${screenshotFile}`);
    }
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`The local E2E server exited with code ${server.exitCode}.`);
    }

    try {
      const response = await fetch(serverUrl);

      if (response.ok) {
        return;
      }
    } catch {
      // The local server has not finished listening yet.
    }

    await delay(250);
  }

  throw new Error(`The local E2E server did not start within ${startupTimeoutMs}ms.`);
}

async function stopServer(server) {
  if (server.exitCode !== null || server.killed) {
    return;
  }

  server.kill();

  await Promise.race([
    once(server, "exit"),
    delay(shutdownTimeoutMs).then(() => {
      throw new Error("The local E2E server did not stop cleanly.");
    }),
  ]);
}

async function runPlaywright(testFiles) {
  const testRunner = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...testFiles],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [code] = await once(testRunner, "exit");

  return code ?? 1;
}

let exitCode = 1;
let server;

try {
  if (configuredBaseUrl) {
    await waitForServer(undefined);
  } else {
    await assertPortAvailable();
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "--hostname", host, "--port", String(port)],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        windowsHide: true,
      },
    );
    await waitForServer(server);
  }

  const foundationTest = "tests/e2e/foundationComponents.visual.spec.ts";
  const allTestFiles = (await findFiles("tests/e2e"))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".spec.ts"));
  const applicationTestFiles = allTestFiles.filter((file) => (
    file !== foundationTest
  ));

  exitCode = await runPlaywright(applicationTestFiles);

  if (exitCode === 0) {
    await assertCanvasScreenshotsHaveContent();
    exitCode = await runPlaywright([foundationTest]);
  }
} finally {
  if (server) {
    await stopServer(server);
  }
}

process.exitCode = exitCode;
