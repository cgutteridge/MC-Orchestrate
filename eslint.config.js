import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.test.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/generated/**",
      "spigot-plugin/**",
      "minecraft-server/**",
      ".m2/**",
    ],
  },
);
