import { defineConfig } from "vitest/config";

// `include` is scoped to src/ deliberately. `tsc -p tsconfig.json` emits a
// compiled copy of every *.test.ts into dist/ alongside the package's real
// output, and vitest's default glob collects both — so `vitest list` reported
// `dist/notice.test.js` and `dist/search.test.js` next to their sources and every
// test was counted twice. The reported total was double the truth, which made the
// suite look larger than it is and would have hidden a test that stopped running.
//
// dist/ is excluded explicitly as well, so the scoping survives a future widening
// of `include`. apps/api and apps/web already do exactly this, for the same reason
// (`nest build` and their own builds emit the same artefacts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
