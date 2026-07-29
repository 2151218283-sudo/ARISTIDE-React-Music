import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  outputDir: "tests/artifacts/playwright",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "off",
    trace: "retain-on-failure",
  },
});
