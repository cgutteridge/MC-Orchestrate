import { defineConfig } from "vitest/config";

/**
 * Vitest config for AI agent integration tests.
 *
 * These tests make real calls to the configured AI provider and consume tokens.
 * Run with:   npm run test:agent
 * Filter by file: npm run test:agent -- tests/agent/placement-offsets.test.ts
 *
 * Tests skip automatically when no AI provider is configured (no env vars).
 * Set MCORCH_AGENT_TESTS=1 to assert that all tests must run (useful in CI
 * environments that have credentials and want to catch skipped-but-expected tests).
 */
export default defineConfig({
  test: {
    env: {
      MCORCH_LAYER_MAP_ONLY: "false",
    },
    environment: "node",
    include: ["tests/agent/**/*.test.ts"],
    // AI calls can take 10–30 s; allow generous per-test timeout.
    testTimeout: 60_000,
    // Run agent tests sequentially to avoid parallel token spend and rate limits.
    fileParallelism: false,
  },
});
