import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// Flat-config ESLint for this Next.js 15.5 App Router + TypeScript project.
// `next/core-web-vitals` + `next/typescript` are translated from their legacy
// shareable configs via FlatCompat (they apply to all files). The explicit
// `files` entry makes ESLint 9 actually enumerate .ts/.tsx (otherwise `eslint .`
// only walks .js/.cjs/.mjs and silently skips the whole app).
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "coverage/**", // vitest coverage output
      "test-results/**", // Playwright run artifacts
      "post-deploy-report.json", // Playwright post-deploy report
      // Vendored, minified PDF.js worker — third-party build output, never hand-edited.
      // Linting it produced 7 errors + ~1580 warnings that drowned out real findings.
      "public/pdf.worker.min.mjs",
    ],
  },
  { files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Node CommonJS scripts (.cjs) legitimately use require().
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Test files use `any` for fixtures/mocks — pragmatic and isolated from app code.
    //
    // `ignoreRestSiblings` covers the omit-via-rest idiom used to build a fixture that
    // LACKS a property — `const { deleteUrl: _d, ...readOnly } = writable` in
    // unified-tree-node.test.tsx. The binding is unused by design; that is the whole
    // point of the destructure. Without this, the fix people reach for is to delete the
    // property afterwards, which no longer type-checks the absence.
    files: ["**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // url-bridge.ts's `bookmarkletTarget` is embedded VERBATIM into the draggable
    // bookmarklet via `.toString()` and must stay self-contained with no syntax
    // the bundler would down-level into helper calls — hence the deliberate `var`
    // style documented in the file header. `let`/`const` here would be wrong.
    files: ["src/lib/osf/url-bridge.ts"],
    rules: {
      "no-var": "off",
    },
  },
  {
    // PptxViewer renders base64 data-URL images extracted from a .pptx in the
    // browser. next/image can't optimize data URLs (no remote loader / known
    // dimensions), so a plain <img> is correct here.
    files: ["src/components/viewers/PptxViewer.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
