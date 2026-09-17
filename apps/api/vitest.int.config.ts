import { defineConfig } from "vitest/config";

// Container startup is slow, so the timeouts are generous: a cold `docker pull`
// of the PostGIS image plus running the migrations is far beyond vitest's 5s
// default, and hookTimeout is what covers the beforeAll that boots it.
//
// `include` is deliberately scoped to test/ rather than a bare `**/*.int.test.ts`
// glob. `nest build` emits a CommonJS copy of every compiled test into dist/, and
// vitest would otherwise collect both the source and the build artefact and run
// each case twice — which also doubles the containers. dist/ is excluded
// explicitly as well, so the guard survives a future widening of `include`.
export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Files run one at a time. They never share a container — each file's
    // `beforeAll` calls `startTestDb()` and gets its own (verified: two files in
    // one run bound host ports 55086 and 55087). What this setting does is cap
    // the number of containers alive *at once* at one, so a run costs one
    // container's memory rather than one per file, at the price of wall time.
    fileParallelism: false,
    globals: false,
  },
});
