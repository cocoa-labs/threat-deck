import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow underscore-prefixed unused vars/params (standard convention)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Handled by Biome (noExplicitAny: warn) — disable here to avoid dual-suppression conflicts
      "@typescript-eslint/no-explicit-any": "off",
      // False positives in R3F/Three.js patterns: ref reads in useMemo for layout measurement
      // and texture caching are intentional and working correctly
      "react-hooks/refs": "off",
      // False positive: Date.now() in render for cosmetic age display is acceptable
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
