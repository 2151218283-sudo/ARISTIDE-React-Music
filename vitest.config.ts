import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/e2e/**", "tests/artifacts/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
