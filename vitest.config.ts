import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each test gets its own DITO_DATA_DIR; make sure no real keys are used.
    env: { ANTHROPIC_API_KEY: "", EVERMIND_API_KEY: "" },
  },
});
