import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Allow primitive-based plans in unit tests; production/smoke default is layer-map-only.
      MCORCH_LAYER_MAP_ONLY: "false",
    },
    environment: "node",
    // Explicitly exclude the agent test suite so it never runs during npm test.
    // Agent tests live in tests/agent/ and are run via npm run test:agent.
    exclude: ["dist/**", "node_modules/**", "tests/agent/**"],
  },
});
