import { defineConfig } from "vitest/config";

// `nest build` emits CommonJS into dist/, including a compiled copy of every
// *.test.ts. Vitest cannot be required() from CommonJS, so the unit run is
// scoped to src/ to keep it from collecting those build artefacts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
