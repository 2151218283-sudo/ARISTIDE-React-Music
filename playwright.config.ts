import { defineConfig } from "@playwright/test";

const baseURL = process.env.ECHOFORM_E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  outputDir: "tests/artifacts/playwright",
  reporter: "list",
  use: {
    baseURL,
    screenshot: "off",
    trace: "retain-on-failure",
  },
});
