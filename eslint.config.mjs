import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import prettierRecommended from "eslint-plugin-prettier/recommended"
import globals from "globals"
import tseslint from "typescript-eslint"

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    ignores: ["**/coverage", "**/dist", "**/node_modules", "**/tmp", "**/cdktf.out/**", "**/.gen/**"],
  },
  {
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.entries(globals.browser).map(([key]) => [key, "off"])),
        ...globals.jest,
        ...globals.node,
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
      },

      parser: tsParser,
      ecmaVersion: 2015,
      sourceType: "module",

      parserOptions: {
        ecmaFeatures: {
          jsx: false,
        },
      },
    },

    settings: {
      "import/resolver": {
        typescript: {},
      },
    },

    rules: {
      "prettier/prettier": "error",
      "import/prefer-default-export": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-require-imports": "off",
      curly: "error",
    },
  },
]
