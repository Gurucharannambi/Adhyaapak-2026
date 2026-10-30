import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the React plugin is not needed for tests (esbuild handles TSX).
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: false,
  },
});
