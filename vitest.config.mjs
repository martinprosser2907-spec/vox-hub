import { defineConfig } from "vitest/config";

// These tests need the Firestore emulator running, so they are deliberately
// their own command:  npm run test:rules
export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false
  }
});
