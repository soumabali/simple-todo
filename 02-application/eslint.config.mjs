import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "workers/**",
      "drizzle/**",
    ],
  },
  {
    rules: {
      // The better-auth adapter boundary legitimately uses `any` for
      // createUser / linkAccount with additionalFields; the rest of the app
      // is strictly typed.
      "@typescript-eslint/no-explicit-any": "off",
      // Unused vars are mostly warnings during active development.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
