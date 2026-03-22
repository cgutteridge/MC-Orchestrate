import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Explicitly exclude the agent test suite so it never runs during npm test.
    // Agent tests live in tests/agent/ and are run via npm run test:agent.
    exclude: ["dist/**", "node_modules/**", "tests/agent/**"],
  },
});
