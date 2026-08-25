import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-require-imports": "off",
      // These React 19 compiler-oriented rules reject established, valid
      // React 18 patterns used throughout this app (async initial loading,
      // resetting animation state, and computing a current-time boundary).
      // Keep the correctness rules-of-hooks/exhaustive-deps gates enabled.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "dist-worker/**",
    "next-env.d.ts",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
