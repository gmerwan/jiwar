# SDD ledger — plan: docs/superpowers/plans/2026-09-15-jiwar-m1-publish-and-discover.md

Spec: docs/superpowers/specs/2026-09-15-jiwar-m1-design.md (read; binding authority)
Branch strategy: **one PR per task** (user changed this after Task 1 was dispatched, 2026-09-15).
  Each task gets branch `task-<N>-<slug>` off `main`, pushed, PR opened. The next task does NOT start
  until the user merges the previous PR. `main` is only ever advanced by the user's merge.
  Per-task flow: implementer -> task review (spec + quality) -> fix loop if needed -> push branch -> open PR -> STOP.
  The user merges on GitHub and then explicitly tells me to continue. I do NOT auto-detect the merge,
  do NOT merge myself, and do NOT start the next task without their word.
Repo: https://github.com/gmerwan/jiwar (PRIVATE)

## Pre-flight conflict scan

### Shared-file rows (files touched by more than one task)

| File | Tasks | Produces vs consumes | Finding |
|---|---|---|---|
| `packages/contracts/src/index.ts` | 1, 3 | T1 writes `CONTRACTS_VERSION` placeholder so the build has something to compile; T3 replaces it with the barrel | Benign. Intentional overwrite, and T3's Step 4 gives the full replacement content. |
| `apps/api/src/app.module.ts` | 4, 6, 8, 9 | T4 creates it; T6 adds ParticipantsModule; T8 adds Categories+Notices; T9 adds Geocode | Benign. T4/T6/T8 each give the complete file content. T9 says "add GeocodeModule to imports" in prose without a block — the smallest of the four edits and unambiguous, but see Ruling 1. |
| `apps/web/src/App.tsx` | 10, 12, 13 | T10 creates with only the NotFound route; T12 adds `/`; T13 adds `/submit` and `/n/:publicId` | Benign. Each task gives the complete file. |
| `tsconfig.json` | 4, 10 | Two different files: `apps/api/tsconfig.json` and `apps/web/tsconfig.json` | Not a conflict. The Files list abbreviates paths relative to each app; the code blocks name full paths (plan lines 720, 3030). |
| `apps/web/package.json` | 10, 14 | T10 creates it already containing the `e2e` script T14 needs | Benign. T14's Files line says "already has the e2e script from Task 10" — no edit required. |

### Per-task self-agreement rows

| Task | Tests vs code | Files created vs later touched | Finding |
|---|---|---|---|
| 1 | build-only verification (no unit tests) | root + contracts scaffold | Consistent. Verification is `pnpm build` + a cache-hit check + a TS-6 pin assertion. |
| 2 | `scripts/verify-postgis.sh` asserts metres, not degrees | compose + env template | Consistent. The metre assertion is the real test of the geography choice. |
| 3 | 11 schema cases | contracts src | Consistent. All Zod 4 APIs used were verified empirically before planning. |
| 4 | `parseWkbPoint` unit test | api scaffold + schema + migrations | Consistent. Task warns to grep the generated migration for `geography(Point,4326)` and `USING gist`. |
| 5 | 4 harness cases incl. metre assertion | Testcontainers harness | Consistent. Image matches Task 2's `imresamu/postgis:18-3.6`. |
| 6 | 5 cookie cases incl. forged-signature | participants module | Consistent. |
| 7 | 15 search + 2 cancel cases | repository + mapper | Consistent. Antimeridian, grace boundary, fallback, and cross-participant cancel all covered. |
| 8 | 12 API cases incl. contract-drift parse | notices + categories HTTP | Consistent. |
| 9 | 6 geocode cases with stubbed fetch | geocode proxy | Consistent. No network in tests; one manual real call at the end. |
| 10 | 6 client cases | web scaffold + client | Consistent. |
| 11 | 4 format + 6 location cases | i18n, format, location | Consistent. |
| 12 | 5 card + 6 list cases | discovery components | Consistent. |
| 13 | 6 wizard cases | submit + detail | Consistent. Mocks LocationPicker because jsdom cannot render MapLibre. |
| 14 | 3 Playwright cases | e2e + README | Consistent. |

### Cross-cutting checks

- **i18n keys:** 62 distinct `t(...)` calls across all tasks; all 62 are defined in Task 11's `en.ts`. Verified after correcting an initial grep that matched `set(`/`get(` as `t(`. No missing keys.
- **Interface handoffs:** every symbol declared in a task's *Produces* block is consumed under the same name downstream (`geographyPoint`, `parseWkbPoint`, `startTestDb`, `ParticipantsService.ensure`, `CurrentParticipant`, `NoticesRepository.*`, `toNotice`/`toNoticeWithDistance`, `createApiClient`, `useChosenLocation`, `AddressSearch`, `OPENFREEMAP_STYLE`, `LocationPicker`, `useNotices`, `formatDistance`/`formatDateTime`, `GeocodeService`, `loadConfig`, `APP_CONFIG`, `DRIZZLE`). No renames.
- **Rubric vs plan:** no task mandates anything the review rubric treats as a defect. No test asserts nothing; no logic block is duplicated verbatim (the six-category list appears in both `seed.ts` and the test harness, which is fixture data for an isolated container, not shared logic).

### Rulings

Ruling 1 (pre-flight): Task 9's app.module.ts edit is prose ("add GeocodeModule to imports") rather than a full code block, unlike Tasks 4/6/8 which give complete file content. I am treating the prose as sufficient rather than halting to rewrite the plan — the edit is a single import plus a single array entry into a file the implementer will have just read, and Task 9's own verification step (`curl /v1/geocode`) fails loudly if the module is not wired. Cost if wrong: one fix round on Task 9 to add the import.

Ruling 2 (pre-flight): `.superpowers/` is not in `.gitignore`, so the SDD workspace would be committed as project files. Task 1 creates `.gitignore` without it. I will add `.superpowers/` to that file's content when dispatching Task 1, since the workspace is scratch that must never reach the GitHub repo. Cost if wrong: none — it is git-ignored scratch either way; the risk is only that ledger noise lands in a commit.

## Task log

Task 1: dispatched (sonnet) at BASE dc5876d — brief task-1-brief.md, report task-1-report.md; carried Ruling 2 (add .superpowers/ to .gitignore)
Ruling 3 (mid-Task-1): the user switched to one-PR-per-task while the Task 1 implementer was running. It had created files but not yet committed, and all files were untracked, so I created `task-1-monorepo-skeleton` and switched to it in place — untracked files carry across cleanly and `main` stayed at dc5876d. I messaged the live implementer telling it the branch changed and forbidding push/switch, rather than killing and re-dispatching it. Cost if wrong: if it had already committed to main I would have needed a reset; verified before switching that it had not.

Ruling 4: the SDD workflow's "continuous execution, do not check in between tasks" rule is now overridden by an explicit user instruction — tasks gate on the user's merge. A merge is also one of the four things the skill says to stop for (a side effect outside this worktree that norms say to ask about). So I stop after each PR and wait. Cost if wrong: none; this is the user's stated preference and it supersedes the skill default.

Task 1: implementer DONE — commit 45bec25 on branch task-1-monorepo-skeleton, main untouched at dc5876d.
  Verified by controller: commit msg clean (no AI trailer), .superpowers/ ignored, typescript 6.0.2 in both packages, tree clean.
  Implementer concerns: (a) pnpm auto-appended minimumReleaseAgeExclude to pnpm-workspace.yaml — controller confirmed no global
  minimumReleaseAge set and no resolved version changed; sent to reviewer to adjudicate. (b) transient eslint-not-found during the
  branch switch, 5 later runs clean, not a brief-required check. (c) self-caught AI trailer, amended out — verified absent.
Task 1: task review dispatched (sonnet) — package review-dc5876d..45bec25.diff
Task 1: review CLEAN — spec ✅, quality Approved. Reviewer independently re-ran the build (cold miss 295ms, warm FULL TURBO 24ms,
  typescript@6.0.2 both importers, git ls-files = exactly 10 files) rather than trusting the report; report found accurate.
  Adjudication A: minimumReleaseAgeExclude block is a deterministic function of the pinned versions, does not affect resolution,
  and would be re-added on any later install — commit as-is. Expect pnpm-workspace.yaml to behave like a semi-generated file.
  Adjudication B: AI trailer confirmed absent (reflog shows 2d8a611 had it, amended to 45bec25 which does not).
Task 1: minor (deferred): turbo.json `test` declares outputs ["coverage/**"] but contracts' test script has no --coverage, so
  `pnpm test` prints a benign "no output files found" warning. Plan-mandated in both files; likely resolves in Task 3. Carry to final review.
Task 1: complete (commit 45bec25, review clean) — pushed task-1-monorepo-skeleton, PR #1 opened
  https://github.com/gmerwan/jiwar/pull/1 — STOPPED, awaiting user merge + explicit "continue".
Task 1: amended per user request — added .nvmrc pinning 24.18.0 (commit 8d2413d), pushed to PR #1, PR body updated.
  Verified `nvm use` resolves to v24.18.0 and that it satisfies engines.node ">=24.15".

CORRECTION (2026-09-16): earlier in this session I reported the folder rename community-notices -> jiwar as DONE.
  It was not. Only the Claude memory dir had been created at the -jiwar key; the working directory was still
  community-notices the whole time. The rename is now genuinely done (mv verified, git toplevel = .../jiwar,
  node_modules intact, pnpm build still FULL TURBO). Anything earlier in this transcript claiming the folder
  was already jiwar was wrong.

Session-continuity note: this session's live transcript is still written to the OLD project key
  (~/.claude/projects/-Users-gho0001m-git-personal-community-notices/) because the session started there.
  Reconciled without data loss: the -jiwar dir's stale Sep-15 jsonl copies were moved to
  stale-pre-rename-backup/ (not deleted), and -jiwar/*.jsonl are now symlinks to the live files.
  CN/memory (which was empty) is a symlink to JW/memory (which has the 3 real memories). Both paths resolve
  to one transcript and one memory store. New sessions started from the renamed folder use the -jiwar key directly.

Task 1: MERGED by user as 1102a04 (PR #1). main now has 11 files incl. .nvmrc. Local task-1 branch deleted.
Task 2: dispatched (sonnet) at BASE 1102a04 on branch task-2-postgis-compose. Docker 29.8.0 aarch64 confirmed
  running, port 55432 free. Brief task-2-brief.md, report task-2-report.md.
Task 2: implementer DONE_WITH_CONCERNS — commit 6618e97. One deviation from the brief, which I independently verified.
  Ruling 5 (Task 2): the brief specifies `jiwar_pgdata:/var/lib/postgresql/data`. On imresamu/postgis:18-3.6 (Postgres 18 base)
  that mount makes the container Exited(1) with "in 18+, these Docker images are configured to store database data in a format
  which is compatible with pg_ctlcluster ... /var/lib/postgresql/data (unused mount/volume)". PG18 moved PGDATA to a versioned
  path and treats a populated .../data mount as an unmigrated pre-18 cluster. I reproduced the failure MYSELF in an isolated
  probe project (separate compose project pgprobe, port 55439, own volume, torn down with `down -v`, 0 volumes left) before
  accepting the change. The implementer's fix — mount one level up at /var/lib/postgresql — is correct and is the documented
  upstream remedy. Ruling: ACCEPT the deviation; the brief is wrong, the spec's intent (a working PostGIS with metre distances)
  is served. Cost if wrong: a future `docker compose down -v` + up would recreate the cluster at the mount root; acceptable for
  a dev-only database that Task 5 replaces with Testcontainers for tests.
  Controller-verified evidence (not taken from the report): container Up (healthy) on 55432, PostGIS 3.6 USE_GEOS=1 USE_PROJ=1,
  geography distance = 11901 m vs the same pair in geometry = 0.1304 degrees (proves units are metres, not degrees),
  committed script runs clean and prints "Distance: 4882 m / PASS", script mode bit committed as 100755, .env untracked (local
  .env exists but is gitignored).
Task 2: task review dispatched (sonnet).
Task 2: review CLEAN — spec ✅ (with Ruling 5's accepted deviation), quality Approved. No Critical/Important.
  Reviewer independently verified: down/up preserves data; `down -v` + up re-initialises cleanly with correct geography
  distance on the fresh cluster; /var/lib/postgresql is EMPTY in a pristine image (no shadowing, entrypoint chmods $PGDATA
  itself); healthcheck is path-independent; grep found no stale /var/lib/postgresql/data reference in any committed file
  (only the historical plan doc). Tried to force a false PASS and could not: ::geometry yields "Distance: 0 m" -> FAIL exit 1,
  and set -euo pipefail aborts on container/SQL/extension failure before reaching PASS.
Task 2: minor (deferred): verify-postgis.sh compares with bash -lt/-gt, which needs an integer. Safe today because
  round(double precision) prints without a decimal, but a future edit dropping round() could break the comparison and fall
  through to PASS. Flag for whoever edits this script (likely Task 7). Carry to final review.
Task 2: minor (deferred): docker-compose.yml has no comment explaining why the volume mounts at /var/lib/postgresql rather
  than .../data, so a maintainer diffing against the in-repo plan doc may read it as a typo. Documented in the PR body
  instead of the file, per the skill's rule that minors do not enter the fix loop. Carry to final review.
Task 2: complete (commit 6618e97, review clean, 1 accepted deviation + 2 deferred minors) — PR #2 opened
  https://github.com/gmerwan/jiwar/pull/2 — STOPPED, awaiting user merge + explicit "continue".

Task 2: MERGED by user as 5827568 (PR #2). Local branch deleted.
Task 3: dispatched (sonnet) at BASE 5827568 on branch task-3-zod-contracts. Brief task-3-brief.md, report task-3-report.md.
  Carries pre-flight scan row: T3 intentionally REPLACES T1's CONTRACTS_VERSION placeholder in packages/contracts/src/index.ts.
Task 3: implementer DONE — commit 5559944. 10/10 tests pass; build + typecheck clean; ~standard/vendor:"zod" confirmed on all
  5 consumer-facing schemas (Standard Schema intact for NestJS 12 + zod-openapi).
  Ruling 6 (Task 3 — my error, not the implementer's): I told the implementer "all 11 test cases". The plan's Task 3 section
  says "Expected: PASS — all 11 cases" (plan line 4323) but contains exactly 10 it() blocks. I diffed the brief's it() list
  against the plan's Task 3 section: IDENTICAL, so the brief extraction is faithful and the PLAN's own count is off by one.
  The implementer correctly refused to invent an 11th test and flagged the mismatch instead — exactly the right call.
  Ruling: 10 tests is correct and complete for this task. The untested exports (CategorySchema, GeocodeResultSchema,
  AttendanceSchema, NoticeStatusSchema, NoticeWithDistanceSchema, Lat/LongitudeSchema, NoticeSearchResultSchema) are not a
  coverage gap: they are either composed into the tested schemas or covered by later tasks that own their behaviour
  (Task 8 has 12 cases incl. categories, Task 9 has 6 incl. geocode). Cost if wrong: a schema bound ships untested until
  Task 8/9 exercise it; acceptable because those tasks assert against real HTTP responses, which is a stronger test.
  Ruling 7 (Task 3): vitest has no config excluding dist/, so after `pnpm build` the root `pnpm test` picks up the COMPILED
  dist/*.test.js as well as src, reporting 4 files / 20 tests instead of 2 / 10. I reproduced this directly. The brief did not
  ask for a vitest config, so the implementer left it alone — correct per spec, but this will silently double every future test
  count in this package and will confuse CI. Ruling: NOT a Task 3 defect (plan-mandated omission), routed as a deferred minor
  for the final review, where a `test.exclude`/`dist` fix belongs alongside the other tooling cleanups. Cost if wrong: noisy
  duplicate test counts until then; no false green, since both copies genuinely pass.
Task 3: minor (deferred): no vitest config excluding dist/ -> root `pnpm test` double-counts (4 files/20 tests vs 2/10). See Ruling 7.
Task 3: minor (deferred, pre-existing): `pnpm lint` fails repo-wide with "Command eslint not found" — turbo declares a lint task
  but no eslint is installed anywhere. Predates Task 3 (noted in Task 1 too). Belongs in the final review's triage.
Task 3: task review dispatched (sonnet).
Task 3: review CLEAN — spec ✅ (files byte-identical to brief, verified by programmatic diff), quality Approved.
  No Critical. Reviewer independently re-ran: 2 files/10 tests pass, tsc --noEmit exit 0, and ~standard vendor:"zod" version:1
  present on ALL 12 exports including the refined CreateNoticeSchema (refinement does not strip Standard Schema in Zod 4.6.5).
  Confirmed CONTRACTS_VERSION has zero remaining references repo-wide. Tests judged meaningful, not tautological.
  Ruling 8 (Task 3, IMPORTANT finding, load-bearing -> carried forward not fixed here): reviewer extended my ruling-2 check and
  found GeocodeResultSchema/GeocodeResultsSchema are never .parse()'d by ANY test in the whole 14-task plan, while Task 10's
  production client DOES call GeocodeResultsSchema.parse(body). I verified: `grep -c 'GeocodeResult[s]*Schema\.parse'` over the
  plan = 0 hits, vs 1 for NoticeSearchResult/NoticeWithDistance. So the geocode schema is load-bearing in production but
  asserted nowhere; the plan's claimed client-side "drift guard" does not actually cover geocoding. Task 9 stubs fetch and
  asserts plain shape; Tasks 11/13 vi.mock api.geocode entirely. NOT a Task 3 defect (brief copied verbatim, and inventing
  tests beyond the brief is what I told the implementer not to do). Ruling: do not fix in Task 3 — instead CARRY into the
  Task 9 and Task 10 dispatches as an explicit instruction to add one schema-parse assertion each. Cost if wrong: a Nominatim
  response-shape change ships uncaught until a user hits it; mitigated by the carry-forward.
  Same pattern, lower severity: AttendanceSchema's "invitation_only"/"restricted" and NoticeStatusSchema's "cancelled"/"removed"
  members are never parsed through the schema (Task 8 fixtures insert those literals straight into Drizzle). z.enum boilerplate,
  low risk — deferred, not carried.
  Ruling 9 (Task 3, MINOR per reviewer but I verified it is more plausible than framed): z.coerce.number() turns BOTH null AND
  empty-string into 0, which is in-range for lat/lng. I confirmed against the compiled schema: {lat:null,lng:"3"} and
  {lat:"",lng:"3"} both parse to lat:0 rather than throwing; only "abc" throws (invalid_type). So `?lat=&lng=` — exactly what a
  browser sends for an empty form field — would silently search from (0,0) in the Gulf of Guinea and return "no notices near
  you" instead of an error. The brief mandates z.coerce.number() and the spec is silent on null/empty, so this is plan-mandated,
  not an implementer defect. Ruling: do NOT change the contract in Task 3 (an unreviewed schema edit would ripple into every
  dependent task); CARRY into the Task 8 dispatch, which owns query-param validation and can add the guard plus its own test.
  Cost if wrong: an empty-param search returns misleading empty results until Task 8 hardens it.
Task 3: complete (commit 5559944, review clean, 2 findings carried forward to Tasks 8/9/10, 2 minors deferred)
Task 3: PR #3 opened https://github.com/gmerwan/jiwar/pull/3 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for later dispatches (from Rulings 8 & 9):
  - Task 8 dispatch MUST include: add a guard + test so ?lat=&lng= (empty/null coercing to 0) is rejected, not searched from (0,0).
  - Task 9 dispatch MUST include: add one GeocodeResultSchema.parse assertion in geocode.service.test.ts.
  - Task 10 dispatch MUST include: add one GeocodeResultsSchema.parse assertion covering api.geocode in the client test.

Task 3: MERGED by user as 6768312 (PR #3). Local branch deleted.
Task 4: dispatched (opus — largest brief at 499 lines, custom Drizzle column type + NestJS DI + migration correctness,
  needs design judgment not transcription) at BASE 6768312 on branch task-4-nestjs-drizzle.
Task 4: implementer DONE_WITH_CONCERNS — commit fce9b40. FOUR deviations, ALL verified by me directly, all accepted.
  CONTROLLER-VERIFIED (not taken from the report):
    - migrations/0001_boring_mercury.sql:21 = `"location" geography(Point,4326) NOT NULL,` (unquoted) and :40 = USING gist. ✓
    - LIVE DB: geography_columns shows notices.location Point/4326; ZERO of our tables appear in geometry_columns (the 12 rows
      there are PostGIS's own tiger geocoder tables). So the column is genuinely geography, not geometry. ✓
    - pg_indexes confirms notices_location_gist USING gist (location). ✓
  Ruling 10 (Task 4, drizzle-kit patch — the one I scrutinised hardest, since patching a dependency is a supply-chain change):
    ACCEPTED. I proved necessity myself rather than trusting the report: temporarily reverted the allowlist entry in the
    in-use store copy and re-ran `drizzle-kit generate` against the real schema. Unpatched output = `"location"
    "geography(Point,4326)" NOT NULL` — DOUBLE-QUOTED, which Postgres rejects as a nonexistent type. Patched output is
    unquoted and correct. Restored the patch immediately and verified (geography count back to 1, git tree 0 changes,
    probe files removed). Also confirmed there is no upgrade escape: semver-sorted npm versions show 0.31.10 IS the highest
    stable, nothing above it, newest overall is 1.0.0-rc.5 (an RC, and the report says it lacks the fix). Patch content
    reviewed line by line: three identical one-line additions inserting "geography" beside the existing "geometry" in a type
    allowlist. No logic change, no scripts, no network. Tracked via pnpm-workspace.yaml patchedDependencies + lockfile so
    Task 5 reproduces it. Cost if wrong: a drizzle-kit upgrade silently drops the patch and regenerates a broken migration —
    mitigated because the patch is version-pinned and pnpm errors if the hash stops matching.
  Ruling 11 (Task 4, WKB fixture): ACCEPTED — the BRIEF is factually wrong. Verified with PostGIS ST_AsText: the brief's hex
    0101000020E6100000AE47E17A14AE0840D7A3703D0A6B4240, labelled POINT(3.06 36.75), actually decodes to
    POINT(3.085 36.83625), so the brief's own assertions could never have passed. The committed fixture
    0101000020E61000007B14AE47E17A08400000000000604240 decodes to exactly POINT(3.06 36.75), matching the untouched
    assertions (toBeCloseTo 3.06 / 36.75). Implementer replaced the fixture, not the assertions — correct choice.
  Ruling 12 (Task 4, zod-openapi): ACCEPTED — brief pins 5.6.1 which was NEVER PUBLISHED (npm shows highest 5.x = 5.4.6).
    Verified independently. Implementer pinned 5.4.6 and confirmed its createSchema signature accepts main.ts's exact call
    shape, so main.ts stayed verbatim. Cost if wrong: none; an unpublished pin cannot install at all.
  Ruling 13 (Task 4, two file additions): ACCEPTED. (a) vitest.config.mts scoping collection to src/**/*.test.ts — necessary
    because nest build compiles tests into dist/ where vitest then collides. This is the SAME root cause as Task 3's deferred
    dist/ minor, so it is a real fix, not scope creep. (b) Used `drizzle-kit generate --custom` for the postgis extension
    migration rather than hand-writing the file, because the migrator reads ONLY meta/_journal.json — a hand-written file is
    absent from the journal and would be SILENTLY SKIPPED, and would also collide at 0000. Good catch; a hand-written file
    would have failed on a fresh database while appearing fine locally.
  Also accepted: narrow per-package allowBuilds block in pnpm-workspace.yaml (esbuild true, four others false) to clear
    ERR_PNPM_IGNORED_BUILDS, which otherwise breaks every `pnpm --filter` script. Consistent with Ruling A (that file behaves
    as semi-generated).
Task 4: CARRY TO TASK 5 dispatch: test:int references vitest.int.config.ts which does not exist yet — Task 5 creates it and
  needs the same src-only scoping as vitest.config.mts, or nest-built dist tests will be collected again.
Task 4: minor (deferred): .env.example line 9 NOMINATIM_USER_AGENT has unquoted parens, so `. .env` fails to parse in a shell.
  Harmless to the app (dotenv handles it) but worth quoting. Carry to final review.
Task 4: task review dispatched (opus — largest diff, supply-chain patch, DDL correctness).
Task 4: review — spec ✅, quality Approved with 1 Important + 4 Minor. Reviewer verified far beyond my checks: schema
  field-by-field against design spec §5 (16 cols / 3 idx / 2 FK all intended; is_past correctly absent; enums match contracts
  verbatim), GiST opclass is gist_geography_ops and EXPLAIN shows ST_DWithin IS index-driven (Index Cond with _st_expand),
  fresh-clone install+migrate against a brand-new db reproduces, and drizzle-kit generate in a fresh clone reports
  "No schema changes" (so committed SQL is not stale). Patch blast radius tested destructively: deleting the patch file ->
  pnpm install exit 254; version drift -> ERR_PNPM_UNUSED_PATCH exit 1. Both failure modes are LOUD, no silent-drop path.
  drizzle-kit is devDep of apps/api only, absent from dist/, not in the runtime path.
  Ruling 14 (Task 4, IMPORTANT -> FIX LOOP, not deferred): parseWkbPoint validates only hex-ness and length >=42, then trusts
  offsets. It never checks the geometry type or SRID. I reproduced independently: byte-order byte = 7 yields
  {lng:-4.2e+183, lat:-3.7e+161} with NO throw, and an SRID-3857 point is accepted as if it were degrees. Silent garbage into
  a distance calc or a map pin is the worst failure shape. Postgres's typmod does reject these at WRITE time, so the parser
  cannot be fed them from THIS column today — but Task 7 is one ST_Centroid or ::geography cast away from routing an
  unconstrained value through the same parser. Fix is ~6 lines + 3 tests, in the file this task owns, before Task 7 builds on
  it. Ruling: FIX NOW in Task 4 rather than defer. Cost if not fixed: a wrong-shaped geography silently becomes plausible
  coordinates in Task 7's results.
Task 4: minor (deferred): pg pool never closed — DrizzleModule has no OnModuleDestroy and main.ts no enableShutdownHooks, so
  the process hangs after ctx.close() (reviewer confirmed: still alive 3s later, needed process.exit(9)). Will bite Task 5's
  integration tests. CARRY TO TASK 5 dispatch as an explicit fix instruction.
Task 4: minor (deferred): public_id is varchar(16) but bare nanoid() returns 21 chars and Postgres HARD-ERRORS (no truncation).
  Task 6 must call nanoid(N) with N<=16. CARRY TO TASK 6 dispatch.
Task 4: minor (deferred): .env.example line 9 unquoted parens (already logged). Minor 5 (test:int config missing) already
  carried to Task 5.
Task 4: fix round 1/5 dispatched — resuming original implementer with the parseWkbPoint hardening only.
Task 4: fix round 1/5 (1 addressed, 0 open; commits fce9b40..cd9a8d7). Controller-verified the hardened parser myself:
  real LE Point 4326 -> {3.06,36.75} unchanged; byte-order 7 -> THROWS "expected 0 or 1, got 7"; SRID 3857 -> THROWS
  "Expected SRID 4326, got 3857"; no-SRID 42-char layout still parses. 8/8 tests (was 2). Implementer verified the 4 new
  negative tests FAIL against the pre-fix file (real regression guards, not tautologies) and used PostGIS-emitted fixtures
  in both byte orders rather than hand-written hex.
  Ruling 15 (Task 4, disclosed PointZ gap): the implementer flagged that EWKB PointZ still parses with Z dropped, and correctly
  did NOT fix it because my fix message did not name it (I had listed it among reproduced behaviours but omitted it from the
  four requested changes — my omission, and respecting the scope boundary was the right call). I verified the gap myself:
  PostGIS emits type word 0xa0000001 for PointZ, and 0xa0000001 & 0x0fffffff == 1, so it passes the Point check; the ISO
  encoding (type 1001) is now rejected but the EWKB one is not. Ruling: ACCEPT AS-IS, do not open a round 2. Dropping Z is
  correct behaviour for a 2D reader — the app has no altitude concept anywhere in the spec — and the column typmod rejects a
  Z value at write time, so this path cannot produce wrong lng/lat, only ignore an extra dimension it has no use for. The
  silent-garbage class of bug (plausible-but-wrong coordinates) is fully closed; this residue is "ignores data it does not
  model", which is not the same defect. Cost if wrong: a 3D geography from some future computed expression loses its altitude
  silently; acceptable for M1 and cheap to add later.
Task 4: complete (commits fce9b40..cd9a8d7, review clean after 1 fix round, 4 minors deferred, 3 carried to Tasks 5/6)
Task 4: scoped re-review VERDICT ADDRESSED, no new breakage. Re-reviewer hand-decoded 7 PostGIS-emitted fixtures and confirmed
  the mask arithmetic (WKB_TYPE_MASK 0x0fffffff strips SRID/M/Z; base type 1=Point, 2=LineString, 3=Polygon), that the no-SRID
  42-char layout is NOT broken (hasSrid false -> SRID branch skipped, offset stays 5), and that all 4 negative tests assert on
  a specific message regex rather than bare .toThrow(), so a future wrong-error refactor still fails. 8/8 tests, tsc clean,
  git status clean, no other parseWkbPoint call sites outside schema.ts.
Task 4: PR #4 opened https://github.com/gmerwan/jiwar/pull/4 — STOPPED, awaiting user merge + explicit "continue".

Task 4: MERGED by user as 332b2c8 (PR #4). Local branch deleted. drizzle-kit patch verified still applied post-merge.
Task 5: dispatched (opus — Testcontainers lifecycle + must resolve 3 carried findings, one of which HANGS the suite if wrong)
  at BASE 332b2c8 on branch task-5-testcontainers. Carries: (a) pool never closed -> process hangs after ctx.close(),
  (b) vitest.int.config.ts missing and needs src-only scoping, (c) same dist/ collection trap as Task 3/4.
Task 5: implementer DONE — commit c5bad37. Controller-verified independently:
  - `pnpm test:int` REAL exit code 0 in 2s, 4/4 tests. No hang. Confirmed no process.exit / forceExit / --force anywhere in
    vitest.int.config.ts, test/, or package.json — the leak fix is genuine DI code (POSTGRES_CLIENT provider +
    DrizzleModule implements OnModuleDestroy -> client.end(), plus main.ts enableShutdownHooks()).
  - Harness runs the REAL migrations via drizzle-orm migrator against MIGRATIONS_FOLDER resolved from import.meta.url
    (not a hand-written DDL copy) — verified in db-harness.ts.
  - Metre assertion present and bounded 4000<m<6000 against ::geography in the container.
  Ruling 16 (Task 5, IMPORTANT -> FIX LOOP): the implementer added apps/api/tsconfig.test.json to bring test/ under typecheck,
  because apps/api/tsconfig.json has "exclude": ["node_modules","dist","test"]. Good diagnosis — but the fix DOES NOT WORK and
  I caught it only by probing rather than reading. tsconfig.test.json extends tsconfig.json and sets include
  ["src/**/*","test/**/*"] but never overrides the inherited `exclude`, and in TypeScript `exclude` filters `include`.
  Proof: `tsc -p tsconfig.test.json --listFiles | grep -c '/apps/api/test/'` = 0, and appending
  `const x: number = "nope"` to test/db-harness.ts still typechecks with exit 0. Combined with vitest not typechecking
  (esbuild transpiles only), the harness that Tasks 6/7/8 depend on is type-checked NOWHERE. This is exactly the failure the
  implementer said it was preventing ("I could have shipped a type-broken harness green") — it shipped that anyway.
  Ruling: FIX NOW, one round: override `exclude` in tsconfig.test.json (or drop "test" from the base exclude) and prove it by
  showing a deliberate type error failing. Cost if not fixed: a type-broken harness passes CI and Tasks 6-8 inherit it.
Task 5: fix round 1/5 dispatched — resuming original implementer, tsconfig.test.json exclude only.
Task 5: fix round 1/5 (1 addressed, 0 open; commits c5bad37..b547e9b). Controller-verified the fix myself:
  tsc --listFiles now compiles BOTH test/db-harness.ts and test/harness.int.test.ts (was 0, now 2); a deliberate type error
  in the harness makes `pnpm typecheck` exit 2 (was exit 0 silently); clean again after restore with no probe residue.
  Implementer correctly did NOT touch the base tsconfig — its "test" exclude is what keeps nest build from emitting test files
  to dist/ — and instead restated exclude in the child config.
  SECOND BUG the fix flushed out, disclosed rather than hidden: enabling the check surfaced TS1470 — `import.meta` is illegal
  in this package because apps/api has no "type":"module" (CommonJS). vitest passed anyway since esbuild supplies import.meta
  when transpiling, so this would have sat latent until someone ran the harness through tsc/tsx instead of vitest, which
  Tasks 6-8 plausibly would. Changed to join(__dirname, "../src/db/migrations"). I verified: no "type" field in package.json
  so the TS1470 claim holds, and cwd-independence still works — `pnpm --filter @jiwar/api test:int` from the REPO ROOT passes
  4/4 exit 0. This vindicates Ruling 16: the typecheck gap was hiding a real defect, not just a hypothetical one.
  dist/ check: 4 test artifacts exist in dist/ but they are src/db/geography.test.ts compiled by nest build — PRE-EXISTING from
  Task 4 (verified against merged main in a throwaway worktree, since removed), not caused by this fix. ZERO test/ files reach
  dist/, and `vitest list` shows neither the unit nor the int config collects any dist/ test. Contract intact.
Task 5: minor (deferred): nest build compiles src/db/geography.test.ts into dist/ (4 artifacts). Harmless today — no vitest
  config collects them — but it ships test code in the build output. Belongs with the other tooling cleanups at final review.
Task 5: scoped re-review dispatched (sonnet) on the fix diff only.
Task 5: task review — spec ✅; TWO Criticals, both verified by me before acting.
  Ruling 17 (Task 5, CRITICAL 1 -> FIX NOW): decorators authored in test/ do not parse. vitest's transform reads
  apps/api/tsconfig.json by convention only — it never sees tsconfig.test.json — and tsconfig.json excludes "test", so files
  there get no experimentalDecorators. I reproduced with a decorated @Controller/@Injectable probe in test/: vitest exits 1
  with "SyntaxError: Invalid or unexpected token". This breaks Task 6 at its FIRST step: the plan's participants.int.test.ts
  (plan line ~1350) authors @Controller/@Get/@CurrentParticipant and a @Module class inside the test file. The failure looks
  like a syntax error, not "feature not built", so it would burn a debugging round. IMPORTING decorated src/ classes works
  fine (src/ is inside tsconfig.json) — only decorators authored IN test/ break.
  I verified the reviewer's proposed 3-line apps/api/test/tsconfig.json myself: with it the same probe exits 0 AND
  Reflect.getMetadata("design:paramtypes") resolves to the injected class, so emitDecoratorMetadata survives — which NestJS DI
  requires for the constructor-injection style used by NoticesController/CategoriesController/GeocodeController.
  Cost if not fixed: Task 6 fails at step 2 with a misleading error.
  Ruling 18 (Task 5, CRITICAL 2 -> DOCUMENT + CARRY, not a harness change): truncate() clears only notices+participants, so
  anything a test does to `categories` survives every later test in the file (reviewer measured an inserted extra category and
  a mutated active=false both persisting). Preserving categories IS the plan's intent (Tasks 7/8 seed once in beforeAll), so
  changing the truncate list would break the Task 7/8 contract. Ruling: do NOT change truncate()'s behaviour; document the
  contract on the function, and carry into Task 8 that its categories test must assert CATEGORIES.length, not a bare 6.
  Confirmed the hazard is real: plan line 2313 is `expect(response.body).toHaveLength(6)`.
Task 5: minor (deferred): startTestDb() leaks a container for ~10s if it throws AFTER boot (e.g. broken migration) because the
  container ref is unreachable and afterAll's testDb?.stop() no-ops. Ryuk reaps it (reviewer waited and confirmed by t+10s).
  A try/catch around migrate that stops and rethrows would close it; likely event during Task 6/7 schema iteration.
Task 5: minor (deferred): POSTGRES_CLIENT is now eagerly instantiated, so a test that boots the real module graph with
  DATABASE_URL exported opens an (unused, lazy) pool to the DEV db on 55432. Not destructive — services inject DRIZZLE, which
  the tests override, and no TRUNCATE reaches dev — but a guard throwing when databaseUrl is falsy would make Task 8's
  APP_CONFIG override fail loudly instead of silently pointing at a nonexistent local Postgres.
Task 5: minor (deferred): one container PER int test file, not shared (reviewer confirmed 2 create + 2 destroy, distinct
  ports). Matches the plan's intent; the config comment slightly misdescribes it.
Task 5: fix round 2/5 dispatched — test/tsconfig.json + truncate() contract docs only.
Task 5: fix round 2/5 (2 addressed, 0 open; commits b547e9b..d6ff7ef). Controller-verified:
  Critical 1 CLOSED — apps/api/test/tsconfig.json added with a thorough why-this-exists comment. I ran Task 6's exact shape
  (@Controller + @Get + createParamDecorator + @Module declared inside beforeAll): exit 0 WITH the file, exit 1 "Parse failure"
  with the file moved aside. design:paramtypes resolves to the injected class, so emitDecoratorMetadata survives — the
  implementer additionally proved that assertion is load-bearing by forcing emitDecoratorMetadata:false and watching it fail.
  Round 1's tripwire still works (--listFiles = 2 test files, deliberate type error still exits 2), so the second tsconfig did
  not disturb it. Base tsconfig untouched.
  Critical 2 CLOSED as documentation — `git diff b547e9b d6ff7ef -- db-harness.ts` shows NO change to the TRUNCATE statement,
  so behaviour is untouched as ruled; the contract is documented with measured numbers (count=7, 'extra' present,
  funeral.active=false, categories_id_seq=7) plus the instruction to look category ids up by slug.
  Implementer also corrected its own earlier false claim that fileParallelism stops files contending for one container — it
  does not; each file boots its own (verified ports 55086/55087). Self-correction rather than quietly leaving the record wrong.
  All four gates green: typecheck 0, build 0, test 0, test:int 0 (4/4).
Task 5: scoped re-review dispatched (sonnet) on the two fix commits.
Task 5: scoped re-review — ALL THREE findings ADDRESSED, no new breakage in the fix diff. Re-reviewer independently replanted
  the type-error probe (exit 2), re-ran the decorator counterfactual, and — better — reproduced the truncate() doc comment's
  four measured numbers against a live container (count=7, extra present, funeral.active=false, seq last_value=7): all four
  match the comment exactly. Confirmed module/target/strict/decorator flags are identical across all three tsconfigs (all from
  tsconfig.base.json), so nothing is checked twice under contradictory settings. Confirmed `nest build --force` after rm -rf
  dist emits NO dist/test directory. Confirmed "exclude": [] does not pull in stray .js (allowJs off).
  Ruling 19 (Task 5, new observation from the re-review — PARKED, no round 3): `tsc -p apps/api/test/tsconfig.json` fails with
  TS6059 because it inherits rootDir "./src" while including test/. I verified: exit 2. BUT I also tested the re-reviewer's
  suggested one-line fix ("rootDir": ".") and it DOES NOT WORK — it merely relocates the error, now complaining that
  src/config.ts is not under rootDir test/ (because the harness imports from src/). A correct fix needs rootDir ".." plus
  matching include, i.e. redesigning the file. Weighed against: nothing in package.json/turbo.json/any script invokes that
  config (I grepped), vitest reads only its compilerOptions and never runs a program-level check, and `pnpm typecheck` covers
  test/ via tsconfig.test.json which is correct. So the only exposure is a developer or IDE running that config directly and
  getting a confusing rootDir error on otherwise-fine files. Ruling: PARK. Fixing it means redesigning a file whose one job
  (feeding vitest's transform decorator flags) works and is proven by counterfactual; a round 3 chasing a fix the re-reviewer
  itself got wrong is worse value than a documented known-issue. Cost if wrong: someone runs that config directly, sees TS6059,
  and loses a few minutes — mitigated because the file's own comment already says it is for vitest's transform only.
Task 5: complete (commits c5bad37..d6ff7ef, review clean after 2 fix rounds, 1 parked, 4 minors deferred)
Task 5: PR #5 opened https://github.com/gmerwan/jiwar/pull/5 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS (cumulative, for later dispatches):
  - Task 6: nanoid() bare returns 21 chars into varchar(16) -> Postgres HARD-ERRORS. Must use nanoid(N), N<=16. (Ruling, Task 4)
  - Task 8: query-param guard so ?lat=&lng= (empty/null -> 0) is rejected, not searched from (0,0). (Ruling 9)
  - Task 8: categories test must assert CATEGORIES.length, not bare 6 (plan line 2313). (Ruling 18)
  - Task 9: add one GeocodeResultSchema.parse assertion in geocode.service.test.ts. (Ruling 8)
  - Task 10: add one GeocodeResultsSchema.parse assertion covering api.geocode. (Ruling 8)

Task 5: MERGED by user as e9e322e (PR #5). Local branch deleted. test/tsconfig.json confirmed present on main.
CORRECTION to a carry-forward: I had logged the nanoid/varchar(16) warning against Task 6. Wrong — Task 6 is cookie-only
  (middleware, service, module, decorator). nanoid appears only in TASK 7 (plan lines 1641, 2137), and the plan already calls
  nanoid(12), which fits varchar(16). So the trap is already avoided by the plan; the note moves to Task 7 as a
  verify-don't-change item: confirm it stays nanoid(12) and never becomes bare nanoid().
Task 6: dispatched (sonnet — 251-line brief, complete code, mechanical; cookie crypto is the only subtle part) at BASE e9e322e
  on branch task-6-participant-cookie.
Task 6: implementer DONE_WITH_CONCERNS — commit 92cbc20. 9/9 int + 8/8 unit, typecheck clean.
  Ruling 20 (Task 6, timing-safety — ACCEPTED): implementer found cookie-parser@1.4.7 pins cookie-signature@1.0.6, whose
  unsign() compares sha1(mac) == sha1(val) — NOT constant time. Added a pnpm override to cookie-signature 1.2.2 (already in
  the tree via express/supertest). I verified independently: cookie-parser now resolves
  node_modules/.pnpm/cookie-signature@1.2.2/..., that file contains timingSafeEqual, and contains NO sha1 string compare.
  Pure lockfile/override change, no app code. This is exactly the timing-safe requirement I added on top of the brief, and the
  implementer found the gap was in a transitive dep rather than in its own code. Cost if wrong: an override drifts on a future
  install; mitigated because pnpm errors on an unused/mismatched override.
  Ruling 21 (Task 6, IMPORTANT -> FIX LOOP): the BRIEF's own test case 5 ("issues a fresh id when the cookie signature is
  invalid") does not test what it claims. It sends `jiwar_pid=s:forged-value.bad-signature`, and `forged-value` is not
  UUID-shaped, so ParticipantsService.ensure()'s UUID_PATTERN guard (participants.service.ts:14) rejects it BEFORE signature
  verification is ever the deciding factor. I proved it: I weakened the middleware to read the raw unsigned cookie instead of
  req.signedCookies, re-ran the brief's suite, and test 5 STILL PASSED (only the unrelated "reuses the same id" test failed).
  So the plan's one security assertion for this feature would pass with signature verification entirely removed. The real
  vulnerability class — replaying a VICTIM's UUID-shaped id with a garbage signature to impersonate them — is genuinely blocked
  by the shipped code (implementer verified via a throwaway test, and my weakened-middleware run corroborates the mechanism),
  but nothing in the committed suite guards it. Ruling: FIX NOW — add a test that forges a UUID-shaped victim id, since Task 8
  builds cancel-my-own-notice authorisation directly on this. Cost if not fixed: a future refactor silently removes signature
  verification and the suite stays green.
Task 6: fix round 1/5 dispatched — add the impersonation test only.
Task 6: fix round 1/5 (1 addressed, 0 open; commits 92cbc20..134dcf7). Committed test:
  "does not let a forged cookie carrying another participant's real id impersonate them" — captures a genuine victim id, then
  replays that exact UUID with GARBAGE_SIGNATURE and asserts the attacker gets a different fresh UUID.
  CONTROLLER COUNTERFACTUAL — and I got it wrong on my first attempt, worth recording: I first weakened the middleware to read
  req.cookies instead of req.signedCookies. That is an INVALID weakening — cookie-parser with a secret routes "s:"-prefixed
  cookies into signedCookies ONLY, so req.cookies was empty and every request got a fresh id. Result: the legitimate
  "reuses the same id" test failed and the impersonation test passed for the WRONG reason (no id was ever reused, forged or not).
  Corrected by weakening to parse the RAW Cookie header (bypassing HMAC while preserving the value), which is what the
  implementer actually did. With that: 2 failed / 4 passed — the impersonation test FAILS as designed, and the brief's other
  four cases still pass. Restored, tree clean, full suite 6/6 green.
  This vindicates Ruling 21 twice over: the brief's own case 5 survives a real HMAC bypass; the new test does not.
Task 6: scoped re-review dispatched (sonnet) on the fix commit.
Task 6: task review (opus, adversarial) — spec ✅, NO Critical. Reviewer attacked the boundary with throwaway integration tests
  and could NOT break it: unsigned cookie without s: prefix, s:<uuid> with no dot, empty signature, dot inside the id,
  s:s:/j: prefixes, 5000-char signature, 9000-char value, duplicate jiwar_pid (cookie@0.7.2 parse is first-occurrence-wins),
  and a JSON j: cookie ALL yield a fresh id; a correctly-signed victim id IS honoured (control proves the probe was live).
  ensure() does not trust the id — it requires a row: a correctly-signed cookie for an absent UUID, and for a participant whose
  row was then DELETEd, both get a fresh id. Best defensive choice in the diff: CurrentParticipant THROWS when
  req.participantId is missing, turning any wiring mistake into a 500 rather than "authorised as nobody".
  Ruling 22 (Task 6, IMPORTANT #1 -> FIX LOOP): three single-line regressions are invisible to the suite. I verified two myself:
  (a) replacing the entire DB-lookup block in participants.service.ts with `return existingId;` (trust any well-signed UUID,
  never check the DB) -> suite still 6/6 PASS; (b) changing forRoutes("*") to forRoutes("/never-matches-anything") -> suite
  still 6/6 PASS. Root cause: the committed test builds its own app with app.use(middleware.use.bind(middleware)) and never
  imports ParticipantsModule, so neither the real wiring nor the row-lookup gate has any coverage. Reviewer also showed
  deleting secure/maxAge/path from res.cookie keeps 6/6 green (only httpOnly and SameSite=Lax are asserted). This is the SAME
  class of gap as Ruling 21 and it matters more now: Task 8 builds cancel-your-own-notice on exactly these two mechanisms.
  Ruling: FIX NOW.
  Ruling 23 (Task 6, IMPORTANT #2 -> FIX LOOP): `secure: process.env.NODE_ENV === "production"`. I grepped the whole repo —
  NODE_ENV appears on exactly ONE line, the line that reads it. No Dockerfile, no fly.toml, no CI, no package.json script, not
  in .env.example or docker-compose.yml. Neither `nest start` nor `node dist/main.js` sets it. So the app's only credential
  would ship WITHOUT Secure over plain HTTP unless an operator remembers an env var nothing documents, and tests pass either
  way. Ruling: FIX NOW — derive from explicit config via loadConfig() so it cannot be silently forgotten.
Task 6: minor (deferred): unbounded participant row creation — 25 cookie-less GETs = 25 rows, and 5 hits on a NONEXISTENT route
  = 5 rows (middleware runs before the 404). Only no-cookie no-body write path; every crawler/scanner mints a row that
  notices.author_participant_id FKs to. Needs a rate limit or a lazier create; out of scope for M1.
Task 6: minor (deferred): SameSite=Lax is correct in dev (same-site ignores port, so :5173 and :3000 are same site; CORS handles
  cross-origin) but is an UNDECIDED PRODUCTION RISK — if web and API land on different registrable domains (jiwar.dz +
  jiwar-api.fly.dev) Lax silently drops the cookie on every XHR and identity breaks entirely. Same registrable domain
  (jiwar.dz + api.jiwar.dz) is fine. Decision needed at deploy time; record: one domain, or SameSite=None; Secure.
  Also: the web client MUST send credentials:'include' — carry to Task 10.
Task 6: minor (deferred): COOKIE_SECRET has no weak default in code (loadConfig throws when absent ✅) but required() only
  rejects empty, so a 1-char secret boots, and .env.example ships a publicly-known placeholder that would boot silently in
  production. Add a >=32 length assert and reject the literal placeholder.
Task 6: minor (deferred): GET /v1 (prefix root, no trailing slash) bypasses the middleware — Nest emits ['/v1$','/v1/*'] and the
  $ form does not match under express 5 / path-to-regexp 8. Not exploitable in M1 (no root controller) and fails closed via the
  throwing decorator, but a trap for any future prefix-root endpoint.
Task 6: minor (deferred): req.signedCookies[name] is FALSE on a bad signature, not undefined — the code comment at
  participant.middleware.ts:13 and the report both state this wrongly. The `as string | undefined` cast is unsound (can be
  false, or a parsed object for a j: payload). Benign today because ensure()'s regex rejects all of them, but ensure()'s
  declared signature gives Task 8 false confidence. Worth a typeof narrow + comment fix.
Task 6: minor (deferred): no rolling expiry — res.cookie only fires when the id changes, so a daily visitor silently loses
  cancel ability exactly one year after first issue, with no login to recover. Also: single secret, no rotation path
  (cookie-parser accepts string[] precisely for this). Also: cookie tossing via a sibling subdomain with a longer Path can
  shadow the real cookie (denial, not impersonation); __Host- prefix would fix it plus Ruling 23, but changes the cookie name
  Task 8 depends on — a decision, not a patch.
Task 6: fix round 2/5 dispatched — coverage tests + secure-from-config.
Task 6: fix round 2/5 (2 addressed, 0 open; commits 134dcf7..edfb669). Int suite 6 -> 13 tests.
  CONTROLLER-VERIFIED both regressions I had previously proved invisible:
    - gut the DB lookup (return existingId) -> NOW FAILS on "issues a fresh id when a validly signed cookie names a
      participant absent from the database" (1 failed / 8 passed). Previously 6/6 green.
    - forRoutes("/never-matches-anything") -> NOW FAILS on "issues the participant cookie on a v1-prefixed route through
      ParticipantsModule's real forRoutes wiring" (1 failed / 8 passed). Previously 6/6 green.
    Each regression is caught by exactly the test written for it, and only that test. Restored both, tree clean.
  Ruling 23 CLOSED: secure now reads this.config.cookieSecure (middleware:28) from AppConfig.cookieSecure
  (config.ts:6/31, COOKIE_SECURE env), documented in .env.example:11. NODE_ENV now appears in the repo ONLY inside an
  explanatory comment — zero functional references, so the silent-insecure-default trap is gone.
  Comment at middleware:17 corrected (forged signature yields false, not undefined). Comment-only.
  Gates: typecheck 0, test 0 (8/8), test:int 0 (13/13).
  Implementer flagged one thing itself: the row-lookup test reimplements cookie-signature's 4-line sign() in the test file
  because cookie-signature is transitive (via cookie-parser), not a direct dep, so a bare import is not reliably resolvable.
  It verified the reimplementation against the real package's unsign() before trusting it. Noted as a deferred minor — a second
  place to update if the signing scheme ever changes.
Task 6: minor (deferred): test-local 4-line reimplementation of cookie-signature sign(); verified against the real unsign() but
  is a duplicate of the signing scheme. Alternative: add cookie-signature as an explicit devDependency.
Task 6: scoped re-review dispatched (sonnet) on the round-2 fix diff.
Task 6: scoped re-review — Finding 1 ADDRESSED, Finding 2 ADDRESSED, no new breakage. Re-reviewer verified the
  signCookieValue reimplementation byte-for-byte against the REAL cookie-signature@1.2.2 (signed with the helper, fed to the
  real unsign(), got the UUID back; tampered signature correctly returns false) — so the row-lookup test is not passing for the
  wrong reason. Also confirmed the new APP_CONFIG constructor arg resolves in both real DI (consumer.apply goes through the
  container; APP_CONFIG is @Global from DrizzleModule) and the one manual construction in the test, and that grep finds no other
  `new ParticipantMiddleware` anywhere.
  Ruling 24 (Task 6, residual gap -> ONE more fix round): NO test detects a wrong `Secure` value. I verified this in both
  directions, which mattered because my first probe misled me:
    - Inverting to `secure: !cookieSecure` DOES fail the suite (1/13) — but on "reuses the same participant id", incidentally,
      because secure:true over supertest's plain HTTP means the cookie is never returned. That is not an assertion on Secure.
    - Hardcoding `secure: false` — which is exactly what a production misconfiguration looks like — passes 13/13.
  So the one attribute finding 2 was entirely about is the one attribute nothing asserts. Given Task 8 builds authorisation on
  this cookie and the app has no CI to catch it at another layer, this is worth closing now rather than deferring.
  Also carrying the re-reviewer's judgment on the config: cookieSecure defaults to false SILENTLY and nothing cross-checks it
  against webOrigin (verified: webOrigin defaults to http://localhost:5173, cookieSecure independent, no validation), so an
  operator who copies only COOKIE_SECRET/DATABASE_URL into prod reproduces the original bug in a new guise. Asking for a
  boot-time assertion, which converts it from fail-open to fail-closed.
Task 6: fix round 3/5 dispatched — Secure assertions + fail-closed config check.
Task 6: fix round 3/5 (2 addressed, 0 open; commits edfb669..2741b62). Int 13->15, unit 8->11.
  CONTROLLER-VERIFIED both:
    - Ruling 24 CLOSED: hardcoding `secure: false` (the production-misconfig shape that previously passed 13/13) now FAILS on
      exactly "marks the cookie Secure when config says cookieSecure is true" (1 failed / 14 passed). Restored, tree clean.
    - Fail-closed config CLOSED: I called loadConfig() directly with three combinations. https://jiwar.dz + COOKIE_SECURE unset
      -> THROWS naming both variables; https + true -> boots; http://localhost + false -> boots. So production cannot silently
      ship an insecure cookie, and the local dev loop is untouched.
  Implementer also ran the inversion counterfactual against the NEW tests (3 failures: the old incidental one plus both new
  tests failing by name in both directions), which is the check I asked for.
Task 6: complete (commits 92cbc20..2741b62, review clean after 3 fix rounds, 8 minors deferred)
Task 6: PR #6 opened https://github.com/gmerwan/jiwar/pull/6 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS (cumulative):
  - Task 7: verify nanoid stays nanoid(12) (fits varchar(16)); bare nanoid() = 21 chars = Postgres hard error.
  - Task 8: guard ?lat=&lng= (empty/null coerce to 0) — reject, do not search from (0,0). (Ruling 9)
  - Task 8: categories test must assert CATEGORIES.length, not bare 6 (plan line 2313). (Ruling 18)
  - Task 8: ensure()'s declared `string | undefined` is unsound (can be false) — do not lean on it for authorisation.
  - Task 9: add one GeocodeResultSchema.parse assertion. (Ruling 8)
  - Task 10: add one GeocodeResultsSchema.parse assertion; web client MUST send credentials:'include'. (Rulings 8, Task 6 minor)

Task 6: MERGED by user as 4fadae3 (PR #6). Local branch deleted.
INFRA NOTE (2026-09-18): Docker Desktop had quit (user mentioned an update), so the daemon was down and jiwar_db was
  "Exited (0) 8 hours ago". Restarted Docker Desktop and `docker compose up -d`; healthy in ~4s. Data survived intact
  (6 categories / 0 notices / 0 participants) and geography_columns still reports Point SRID 4326 — which incidentally
  validates Ruling 5's /var/lib/postgresql mount across a full daemon restart, not just a container restart.
Task 7: dispatched (opus — 650-line brief, 16 integration tests, the app's core feature; antimeridian + grace-window +
  cursor-pagination correctness needs judgment, not transcription) at BASE 4fadae3 on branch task-7-radius-search.
  Carry-forward verified BEFORE dispatch: the brief already uses nanoid(12) at lines 71 and 567, so the varchar(16) trap
  is avoided by the plan itself — dispatch says verify-don't-change.
Task 7: implementer DONE_WITH_CONCERNS — commit 8660607. 42/42 int (16 brief + 11 added regressions + harness/participants),
  17/17 unit, typecheck + build clean. CONTROLLER-VERIFIED independently:
    - Distances: ST_Distance geography = 4882.45937586 vs geometry = 0.05000000000000071 on the reference pair. Metres confirmed.
    - No geometry cast in the distance/filter path: repository uses bare `n.location` for ST_DWithin and ST_Distance; the
      `::geometry` casts at lines 136/205 are ST_X/ST_Y coordinate extraction only, which is correct usage.
    - gist index: EXPLAIN on ST_DWithin -> "Index Scan using notices_location_gist" with Index Cond via _st_expand;
      the ST_Distance < x form -> "Seq Scan". Better than my one-off check: the assertion is a COMMITTED test
      (notices-search.int.test.ts:427-434) that seeds 20000 rows via generate_series and asserts Index Scan present AND
      Seq Scan absent, so a future index-defeating change fails CI.
    - nanoid(12) preserved (repository.ts:177) — varchar(16) trap avoided.
    - Dev DB left clean: 0 notices / 0 participants / 6 categories.
  Ruling 25 (Task 7, deviation 1 — ACCEPTED): brief types NoticeRow.startsAt as Date, but raw db.execute() returns STRINGS
  because drizzle-orm/postgres-js/driver.js installs identity parsers over postgres-js's date decoders and a raw execute has no
  column metadata to reapply one. All 14 search/cancel cases failed with "row.startsAt.toISOString is not a function" before the
  fix. I confirmed postgres-js alone DOES return Date, so the loss is specific to Drizzle's raw-execute path as described.
  Fixed with a permissive `RowTimestamp = Date | string` union plus a toDate() normaliser, so the query-builder path still
  type-checks. Accepted. Disclosed precision loss: postgres sends microseconds, Date holds milliseconds, so ...240416+00
  truncates to ...240Z — asserted in a unit test rather than left implicit. Cost if wrong: sub-millisecond ordering ties are
  indistinguishable; irrelevant for event start times.
  Ruling 26 (Task 7, deviation 2 — ACCEPTED): brief's `= ANY(${params.categories})` does not work and its comment about IN vs
  ANY is backwards. Drizzle's sql template expands a raw JS array into a parenthesised LIST, so it renders ANY(($7)). I verified
  at the database: `'wedding' = ANY(('wedding','funeral'))` -> ERROR "op ANY/ALL (array) requires array on right side", while
  ANY(ARRAY[...]) works. Fixed with sql.param(params.categories), chosen over `IN ${arr}` to keep one statement shape
  regardless of filter length (better for plan caching). Accepted.
  Ruling 27 (Task 7, deviation 3 — ACCEPTED): NoticeRow had to become a `type` alias; as an `interface` both db.execute call
  sites fail TS2344 because TypeScript grants an implicit index signature to a type alias of an object literal but NOT to an
  interface. I reproduced standalone under TS 6.0.2: needsIndexSig(interfaceValue) -> TS2345 "Index signature for type 'string'
  is missing", needsIndexSig(aliasValue) -> fine. Exported name unchanged, so Task 8's imports are unaffected. Accepted.
  Notable: a GREEN integration suite hid deviation 3 entirely — vitest's esbuild transform strips types without checking them,
  so only `pnpm typecheck` caught it. Same class as the Task 5 tsconfig gap; worth remembering that int tests are not a typecheck.
Task 7: task review dispatched (opus — core feature, 650-line brief, 3 accepted deviations, correctness-critical SQL).
Task 7: task review (opus) — spec ✅, 2 Important + 3 Minor, NO Critical. Reviewer went well beyond the brief's tests:
  ANTIMERIDIAN PROVEN, not assumed: built a 20000-row fixture spanning -180..+180, then cross-checked the indexed result against
  a forced Seq Scan (enable_indexscan=off) — identical row sets. That rules out the real risk, which is the INDEX pruning a row
  the filter would keep. _st_expand on geography builds its bounding volume in geocentric Cartesian space, so ±180 is not a
  discontinuity. No bounding box or lng comparison exists anywhere.
  GRACE BOUNDARY: `>= cutoff` upcoming / `< cutoff` past partitions the row space with no gap or overlap; verified a row at the
  exact boundary appears in exactly one branch.
  ORDERING/CURSOR CONSISTENCY: ORDER BY (sortKey, public_id) matches the row-comparison cursor predicate exactly — the correct
  composite-keyset form, not the naive OR-form that usually breaks. Number(last.sortKey) is load-bearing (postgres returns it as
  a string; without the coercion every cursor is rejected and pagination silently restarts at page 1).
  MUTATION AUDIT: 9 of 11 added tests directly killed by mutation. Strongest result — M2 (::geometry casts on ST_DWithin/
  ST_Distance) leaves the BRIEF's antimeridian case GREEN (0.2 deg < 30000 in a degree comparison, so the row is found by
  accident) while the ADDED distance control fails. Exactly the trap the brief warned about and did not test.
  CANCEL PATH ✅: single parameterised UPDATE with and(publicId, authorParticipantId, status='published') — no read-then-write
  race. Full hostile matrix (stranger, nonexistent, double-cancel, removed notice, SQL metacharacters, LIKE wildcards, empty and
  injected participantId) all fail closed; only the intended row ever changed.
  INJECTION ✅: no string interpolation into SQL; every ${} is a bound param or nested sql fragment; no sql.raw/sql.identifier.
  Ruling 28 (Task 7, IMPORTANT 1 -> FIX LOOP): a cursor whose `p` contains a NUL byte throws a 500. decodeCursor
  (repository.ts:45-53) validates only `typeof parsed?.p === "string"`, so "a\0b" passes and reaches postgres, which rejects NUL
  in text at the protocol level regardless of parameterisation. I confirmed both halves: the DB errors with
  "invalid byte sequence for encoding UTF8: 0x00", and the guard has no character validation. Reachable unauthenticated in
  Task 8 via a hand-crafted ?cursor= (SearchNoticesSchema accepts any string). The added test literally named "ignores a
  malformed cursor rather than throwing" asserts the invariant this violates — its fixtures just miss it. FIX NOW.
  Ruling 29 (Task 7, IMPORTANT 2 -> FIX LOOP): the past-notice fallback loses rows when a notice is published mid-scroll.
  search() re-decides the fallback per request and the cursor carries no record of which branch minted it, so a past cursor gets
  applied to the upcoming branch: reviewer measured page 1 = [Old 1, Old 2], then one publish, then page 2 = [NEW] with
  nextCursor null — Old 3..6 silently unreachable. Design spec §6 explicitly promises "a notice published mid-scroll cannot
  cause a duplicate or a skipped row", so this is a spec violation, not just a rough edge. FIX NOW, together with Minor 1
  (a cursor from a different sort order replays rows: a metres key and an epoch-millis key are both plain numbers, so neither is
  detectable as foreign) — one `when`/`sort` discriminator in the cursor payload closes both.
  Ruling 30 (Task 7, Minor 2 -> FIX NOW, cheap): two mutations survive all 27 tests. I reproduced M5 myself: hardcoding
  `make_interval(hours => 24)` so options.pastGraceHours is ignored leaves 27/27 GREEN, because every committed test uses
  pastGraceHours: 24. M8 (deleting `|| params.when === "past"` from the fallback guard) also survives, because the brief's
  case 7 uses an EMPTY table so both branches find nothing. Two three-line tests kill both. Fixing now because Task 8 builds on
  this and a config parameter that is wired to nothing is the kind of thing that stays broken for months.
Task 7: minor (deferred): ORDER BY extract(epoch from starts_at)*1000 defeats notices_starts_at_idx (top-N heapsort instead of
  Incremental Sort). Irrelevant at M1 scale — the gist index still drives the radius filter and the sort runs over ~60 rows in
  3ms — and the epoch expression is what makes the cursor key portable. Worth a comment if result sets grow.
Task 7: minor (deferred): the category filter does not check categories.active, so deactivating a category leaves its existing
  notices discoverable while insert() does check active. Probably intended (stop new, don't retroactively hide) but undocumented.
Task 7: fix round 1/5 dispatched — NUL guard, cursor discriminator, 2 mutation-killing tests.
Task 7: fix round 1/5 (4 addressed, 0 open; commits 8660607..f341f6b). Search file 27 -> 37 cases; int 42 -> 52.
  CONTROLLER-VERIFIED all four:
    - Ruling 28 CLOSED: guard is now CURSOR_TIEBREAKER_PATTERN = /^[A-Za-z0-9_-]{1,16}$/ plus a Number.isFinite(k) check
      (repository.ts:67,78-79). I rebuilt the reviewer's exact NUL token (eyJrIjowLCJwIjoiYVx1MDAwMGIifQ) and confirmed the
      OLD typeof-only guard accepts it while the NEW pattern rejects it; the 10KB p and SQL-metacharacter probes are also
      rejected, and a real nanoid still accepted.
    - Ruling 30 CLOSED: M5 (hardcode make_interval(hours => 24)) now FAILS 1/37 — previously survived 27/27. Verified myself.
    - M8 (drop `|| params.when === "past"`) now FAILS 1/37. Verified myself.
    - Rulings 29 + Minor 1 CLOSED via a cursor discriminator. Implementer made a deliberate ASYMMETRIC choice and justified it:
      PIN for the fallback branch (Fix 2) because ignoring would restart the reader at page 1 and re-serve every already-read row
      as a duplicate — the other half of what spec §6 forbids; DISCARD for a crossed sort (Fix 3) because changing sort is an
      explicit reader action, so page 1 of the new ordering is what they asked for and pinning would trap them in the ordering
      they just left. I accept both — they are opposite treatments of superficially similar cases, and the reasoning is sound.
  IMPLEMENTER CORRECTED THE REVIEWER (and itself), verified by me: the reviewer's suggested M8 fixture ("add one upcoming row")
  does NOT kill that mutation — the implementer tried it, got 36/36 green, and worked out why: dropping the guard re-runs the
  SAME past branch minus the cursor, which is output-equivalent when there are no past rows, so `fallback` is still false. The
  guard is only observable when the CURSOR is what emptied the primary. Its committed test walks a past scroll and cancels the
  unreached rows mid-scroll instead. It kept the reviewer's case too, with a comment noting it is a correct but non-discriminating
  assertion. My M8 run confirms the committed test kills the mutant.
  Disclosed wire-format note (not a defect): Cursor gained `s` and `w`, so cursors minted by 8660607 no longer decode and are
  treated as malformed — the reader pages from the start rather than erroring. Invisible at M1 since Task 8 has not shipped the
  endpoint and no cursor outlives a deploy.
Task 7: complete (commits 8660607..f341f6b, review clean after 1 fix round, 2 minors deferred)
Task 7: PR #7 opened https://github.com/gmerwan/jiwar/pull/7 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Task 8 (next):
  - Guard ?lat=&lng= (empty string / null coerce to 0 via z.coerce.number) — reject, do not search from (0,0). (Ruling 9)
  - Categories test must assert CATEGORIES.length, not bare 6 (plan line 2313). (Ruling 18)
  - ensure()'s declared `string | undefined` is unsound (signedCookies can be false) — do not lean on it for authorisation.
  - Task 8 exposes ?cursor= publicly; the NUL/oversize guard now lives in decodeCursor, so no extra work, but its own tests
    should include a malformed-cursor case at the HTTP layer.

Task 7: MERGED by user as 9a5e7b0 (PR #7). Local branch deleted.
INFRA: Docker was down again (second time); restarted Desktop + compose, jiwar_db healthy with 6 categories intact.
Task 8: dispatched (opus — 466-line brief, 13 cases, HTTP boundary + Zod Standard Schema validation, and it must resolve THREE
  carried findings) at BASE 9a5e7b0 on branch task-8-notices-api.
  ALL THREE CARRY-FORWARDS CONFIRMED AS REAL GAPS IN THE BRIEF BEFORE DISPATCH:
    - brief line 93 is `expect(response.body).toHaveLength(6)` — the bare-6 assertion Ruling 18 predicted. No CATEGORIES.length
      anywhere in the brief.
    - brief contains ZERO mentions of `cursor`, so the HTTP layer exposes ?cursor= with no test covering it.
    - brief has no empty-string/null lat-lng guard, so Ruling 9's (0,0) search is still open at the HTTP boundary.
Task 8: implementer DONE_WITH_CONCERNS — commit 487577a. CONTROLLER-VERIFIED:
  - 101/101 integration (52 from Tasks 1-7 + 49 new), 34/34 unit, typecheck 0, build 0.
  - Carry-forward 1 CLOSED: no bare toHaveLength(6) remains; notices-api.int.test.ts:113 asserts CATEGORIES.length, with a
    comment explaining truncate()'s contract. Implementer added the nuance that CATEGORIES.length alone is NOT sufficient under
    a LEAKING mutation — the finally-restore is what actually closes it. Fair correction; do not over-credit the constant.
  - Carry-forward 3 CLOSED: 16 cursor references in the API test file (brief had zero).
  - nestjs-zod correctly absent; NestJS 12 native Standard Schema validation used.
  - LIVE curl against dist/main.js on port 3111 (my own run, dev DB): ?lat=&lng= -> 400 with
    {"message":["lat: lat is required and must be a number","lng: lng is required..."],"statusCode":400};
    no params -> 400; lat=0&lng=0 -> 200 (a REAL request for that location still works — a blanket reject-zero would have
    broken it); valid Algiers -> 200; malformed cursor -> 200 not 500; categories -> 200. Ruling 9 CLOSED at the HTTP boundary.
  Ruling 31 (Task 8, create-body Null Island — PARKED, deliberately not fixed): I verified against the compiled contracts that
  CreateNoticeSchema.safeParse accepts BOTH {lat: null} and {lat: ""} as lat: 0 (while "abc" is correctly rejected). So the
  Gulf-of-Guinea bug still exists on the POST body, not just the query. The implementer did NOT fix it and reported instead,
  which is what I told it to do: .extend() throws "Cannot overwrite keys on object schemas containing refinements" on a refined
  schema, and the z.looseObject({}).pipe(...) workaround collapses the Swagger request body to {"type":"object","properties":{}},
  breaking the brief's Step 8. Six tasks import that schema. Ruling: PARK for the final review as a contracts-level change
  (a z.preprocess on LatitudeSchema/LongitudeSchema mapping blank -> undefined fixes both call sites at once). It is pinned by a
  test asserting current behaviour, so a later contract fix surfaces the decision rather than silently changing it.
  Cost if wrong: a client that POSTs an empty lat creates a notice at (0,0). Mitigated because the submit wizard (Task 13) uses
  a map picker, so an empty coordinate is not a normal path.
  Ruling 32 (Task 8, two brief bugs in test wiring — ACCEPTED): (1) .overrideProvider(DRIZZLE) is a SILENT NO-OP here — it ends
  in Module.replace guarded by hasProvider(), and no imported module declares DRIZZLE/APP_CONFIG, so NoticesRepository cannot
  resolve. Replaced with a @Global test module mirroring how DrizzleModule exposes those tokens in production. (2)
  `new ParticipantMiddleware(app.get(ParticipantsService))` does not compile — Task 6 gave the middleware a second arg. Dropped
  the manual wiring so ParticipantsModule's own forRoutes("*") installs it, which is also what production does. Both accepted;
  the second is the better test anyway (it exercises real wiring, the gap Ruling 22 was about). Also added @HttpCode(200) to
  cancel because Nest defaults POST to 201 while the brief's own case 11 asserts 200.
  IMPLEMENTER CAUGHT ITS OWN WORTHLESS COUNTERFACTUAL: its first cursor mutation test passed with Task 7's pattern check removed,
  because its raw NUL byte made JSON.parse throw inside decodeCursor's own try/catch and never reached the check. Rewritten as a
  JSON \u0000 escape, it produced the real 500. Same class of error I made twice on Task 6 — worth noting the pattern.
SANDBOX NOTE (not worked around): the agent's cleanup DELETE against the dev DB was blocked as a shared-resource mutation and it
  did not circumvent it. I am NOT circumventing it either. Left in jiwar_dev: 1 cancelled notice (VMYn-_2S24R7, "Funeral prayer
  for the late Ahmed Benali") and 25 participants from the curl walkthrough + middleware minting. Inert; surfaced to the user.
Task 8: task review dispatched (opus — HTTP boundary, 49 new tests, 3 carried findings, contract Task 10/14 depend on).
Task 8: task review (opus) — spec ✅; 1 Critical + 1 Important + 4 Minor.
  CONTRACT VERIFIED BY PARSING, not reading: reviewer parsed every live response through the compiled contracts AND re-parsed
  through z.strictObject(Schema.shape) so a surplus OR missing key fails. All six endpoints exact. Confirms Task 10/14 will not
  hit a type surprise: distanceMetres is a NUMBER (integer-rounded) not a string; GET /:id has NO distanceMetres key;
  organizerName/organizerContact are present-but-null rather than omitted (which .nullable() requires and omission would break);
  dates round-trip new Date(v).toISOString() === v; nextCursor verified in both states; cancelled notice 200 + parses (§6/§10).
  AUTHORISATION HOLDS: 11 widening attempts (body participantId/authorParticipantId/author_participant_id, headers
  x-participant-id/participantId/x-forwarded-user, ?participantId=, unsigned cookie with the real author UUID, s:-prefixed with
  no signature, bogus signature, duplicate jiwar_pid) — ALL 403 with the row left published; author's own cookie then 200.
  A create carrying status/publicId/authorParticipantId in the body was ignored (verified by direct SQL).
  TESTS HONEST: 49 confirmed (40 it + 9 it.each). 17 mutations, each killed by the test that names it — including my three asks:
  removing the blank-lat guard fails exactly 4 tests with "got 200" (the silent Null Island search); removing Task 7's
  CURSOR_TIEBREAKER_PATTERN fails the cursor test with 500; a naive `if (!value)` isBlank fails 5 unit tests including both zero
  cases. Reviewer hex-dumped the committed cursor fixture to confirm it is the WORKING \u0000-escape rewrite, not the worthless
  raw-byte version the implementer had self-corrected.
  Ruling 33 (Task 8, CRITICAL -> FIX LOOP): the NUL-byte 500 generalises. Task 7 guarded ONLY the cursor tiebreaker; Task 8
  exposed four more inputs that reach Postgres as bound text, unguarded. I reproduced all three reachable-by-GET/POST cases
  myself against a live server: GET /v1/notices/a%00b -> 500, POST /v1/notices/a%00b/cancel -> 500,
  GET ?categories=a%00b -> 500, while clean input gives 404/200 and Task 7's guarded ?cursor= NUL escape correctly gives 200.
  Server logs the full SQL plus every bound parameter on each. Contained (no breach, no corruption, pool healthy after 60
  sequential + 40 concurrent) but a 500 is the wrong code for client garbage, and Task 10's ApiError / Task 14's e2e will see an
  opaque "Internal server error". What makes it a Task 8 finding rather than a Task 7 leftover: repository.ts:60-65 spells out
  this exact mechanism and names "once Task 8 exposes ?cursor=" — the knowledge existed and was not carried across. FIX NOW for
  publicId (path param) and categories (query); the BODY fields need a contracts decision, so they join the parked Null Island item.
  Ruling 34 (Task 8, IMPORTANT -> FIX LOOP, narrow): a participants row is inserted on EVERY cookieless request including pure
  reads — measured 50 GET /v1/notices -> +50 rows, 50 GET /v1/categories -> +50, 20 detail 404s -> +20, 20 400s -> +20, even 10
  unknown-route 404s -> +10. forRoutes("*") plus an unconditional ensure(undefined) insert. This is Task 6 code but Task 8 is
  where it becomes live (before this there were no routes to observe it on). Already logged as a Task 6 deferred minor; promoting
  to a fix now because it is unbounded write amplification on a public surface and the narrow fix is small: mint an identity only
  on the routes that consume @CurrentParticipant() (create and cancel). Real browsers unaffected.
Task 8: minor (deferred): one test ("guards only lat and lng, leaving every other contract field untouched", int line 653) parses
  the contract locally and asserts on its OWN parse, so it tests the contracts package, not the server — mutation-confirmed green
  when the service discards sort/limit/categories. Drift IS covered by two other tests; this one just doesn't cover its name.
Task 8: minor (deferred): `message` is string[] for validation failures but a plain string for service rejections. Nest's default
  shape, not a Task 8 defect, but Task 10's String(body.message) comma-joins arrays and Task 13 wants per-field errors — decide
  the client handling before Task 13.
Task 8: minor (deferred): coercion quirks from the contract — ?lat=0x10 is accepted as latitude 16, and radiusKm=1e-300 passes
  .positive() giving a zero-radius search. Same family as the parked Null Island item; fold in if the coordinate schemas get tightened.
Task 8: minor (deferred): unknown body keys silently accepted (verified they cannot set author/status/publicId), so a typo like
  venue_name reports "venueName: expected string, received undefined" rather than naming the unknown key.
Task 8: minor (deferred): no endpoint documents a RESPONSE schema — components.schemas is empty, so a generator types every
  response `any`. Brief's Step 8 only asked for the request body, so compliant; wiring the response decorators helps Tasks 10/13.
Task 8: fix round 1/5 dispatched — NUL guard on publicId + categories, and narrow the participant middleware.
Task 8: fix round 1/5 (2 addressed, 0 open; commits 487577a..ca1f1da). Int 101 -> 125, unit 34/34, typecheck 0, build 0.
  CONTROLLER-VERIFIED LIVE (my own server on 3113, dev DB):
    - Ruling 33 CLOSED for the two inputs in scope: GET /v1/notices/a%00b 500 -> 404; POST .../a%00b/cancel 500 -> 403
      (cancel keeps its anti-enumeration 403 rather than switching to 404 — correct, consistent with the existing route);
      GET ?categories=a%00b 500 -> 400. Controls unaffected: ?categories=wedding 200, valid-shape unknown id 404.
    - Ruling 34 CLOSED: 50 cookieless read requests (20 searches, 20 categories, 5 detail 404s, 5 unknown-route 404s) moved
      participants 49 -> 49. Zero rows, down from +50.
  Implementer swept the rest of the query surface unprompted and found only `categories` was exposed — lat/lng/radiusKm/limit/
  when/sort already 400 because their number/enum validators reject a NUL before binding. Good instinct: it checked whether the
  finding generalised further rather than fixing only what I named.
  Ruling 35 (Task 8, lazy minting vs narrowing forRoutes — ACCEPTED, and it chose the better option): I asked it to narrow
  forRoutes to the routes consuming @CurrentParticipant(). It instead made the middleware attach a memoised resolver that does
  no DB work, so the async decorator mints on first use. Its reasoning: the set of routes needing an identity is a property of
  the handlers, not of a path list someone must keep in sync — a future third route reading the decorator just works, where a
  stale path list would 500. It probed that Nest awaits an async param decorator against this exact version rather than assuming,
  and checked BEFORE choosing that every Task 6 test hits /whoami (which does consume the decorator) so none were weakened.
  I accept this over my own instruction; it is more robust and it verified the assumption the approach depends on.
  Ruling 36 (Task 8, concurrency race — ACCEPTED, and promoted to a permanent test): the implementer nearly missed that Nest
  resolves handler parameters concurrently via Promise.all, so an UNmemoised resolver races itself — two @CurrentParticipant()
  params produced two different ids and two rows. It promoted the probe to test/participant-minting.int.test.ts with the
  mechanism documented (cites createPipesFn). Correct call: the same race would appear in production the moment a guard and a
  handler both read the identity.
  Implementer self-corrected a false alarm: a `grep -c` suggested two NUL errors survived the fix, but the phrase appears on both
  the message line and its code:'22021' line — one event, and the stack trace confirms it is the known NoticesRepository.insert
  body gap. Also flagged that in its malformed-id it.each, only the NUL cases fail without the guard (quote/SQLi/over-long pass
  either way because parameterisation handles them) — breadth against a future non-parameterised query, not evidence of a bug.
  PARKED ITEM NOW WIDER: the POST body NUL remains a 500, pinned with an explicit toBe(500) test so it cannot be mistaken for
  handled. Same blocked route as Ruling 31 (refined schema, .extend() throws, looseObject().pipe() destroys the Swagger body).
  A z.preprocess on the contract's string+coordinate fields would close the Null Island AND body-NUL cases together.
SANDBOX NOTE: this round's live verification added 2 more dev-DB notices and 1 participant row; agent again did not circumvent the
  block, nor did I. Still the user's call (docker compose down -v clears it).
Task 8: scoped re-review dispatched (sonnet) on the fix diff only.
Task 8: scoped re-review — BOTH findings ADDRESSED, no new breakage. Re-reviewer went past my checks:
  - Fuzzed the publicId guard with 5000 random nanoid-alphabet strings plus ids starting with '-' and '_' and all-'-'/all-'_':
    zero false rejections. Boundaries: len 0 false, 1 true, 16 true, 17 false. So no legitimate id can be refused.
  - PROVED the categories .check() did not alter the OpenAPI contract: ran zod-openapi's createSchema in the same io:"input" mode
    main.ts uses, against the bare contract field and the guarded field — rendered anyOf JSON byte-identical. That was the risk
    with chaining onto a shared schema and it is measurably absent.
  - Swept more control characters (bell, backspace, unit separator, escape, %2F, double-encoded NUL, doubled NULs) on publicId
    and categories: no 500s. Task 7's cursor guard still intact.
  - MEMOISATION ISOLATION verified in the dangerous direction: 8 concurrent cookieless requests from different clients each got a
    DISTINCT id with exactly 8 rows, and two persistent interleaved agents never saw an id cross over across 5+ runs. That rules
    out cross-request identity leakage, which would have been far worse than the bug being fixed. (It noted supertest's in-process
    server occasionally throws ECONNRESET under high concurrency — an infra artifact, isolated by lowering concurrency and
    confirming the leakage assertion held on every fulfilled response.)
  - Confirmed the parked POST-body 500 is pinned honestly: notices-api.int.test.ts:795-801 is a real expect(...).toBe(500),
    not skipped, not inverted.
  - Probed the untested edge I asked about: a route consuming @CurrentParticipant() whose ensure() throws resolves to a clean 500
    with no crash or hang and the app keeps serving. Not covered by the shipped suite but the behaviour is correct.
Task 8: complete (commits 487577a..ca1f1da, review clean after 1 fix round, 6 minors deferred, 1 contracts decision parked)
Task 8: PR #8 opened https://github.com/gmerwan/jiwar/pull/8 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Task 9 (next):
  - Add one GeocodeResultSchema.parse assertion in geocode.service.test.ts (Ruling 8) — the geocode schemas are load-bearing in
    Task 10's client but asserted by NO test anywhere in the plan.
  - Task 9's app.module.ts wiring is PROSE in the plan, not a code block (Ruling 1) — verify GeocodeModule is actually imported;
    its own curl check should fail loudly if not.

Task 8: MERGED by user as 7811fd1 (PR #8). Local branch deleted.
Task 9: dispatched (sonnet — 285-line brief, 6 cases, stubbed fetch, mechanical; the two carried findings are the only judgment)
  at BASE 7811fd1 on branch task-9-geocode-proxy.
  BOTH CARRY-FORWARDS CONFIRMED AS REAL GAPS BEFORE DISPATCH:
    - Ruling 8: the brief imports GeocodeResult as a TYPE only (`import type`) and contains ZERO `Schema.parse` calls. So the
      geocode schemas remain load-bearing in Task 10's client (api.geocode calls GeocodeResultsSchema.parse) while asserted by
      no test anywhere in the plan. Dispatch requires one runtime parse assertion.
    - Ruling 1: brief line 259 is prose — "Add GeocodeModule to apps/api/src/app.module.ts imports alongside the others" — with
      no code block, unlike Tasks 4/6/8. Dispatch requires verifying the import actually lands and that the module resolves.
Task 9: implementer DONE — commit 9f2c41b. 43/43 api unit (9 in geocode.service.test.ts: brief's 6 + schema-parse + TTL expiry),
  20/20 contracts, typecheck 0, build 0. CONTROLLER-VERIFIED:
  - Ruling 8 CLOSED: geocode.service.test.ts:2 imports the schemas as VALUES (not `import type`) and lines 97-99 call
    GeocodeResultSchema.safeParse per result plus GeocodeResultsSchema.safeParse on the wrapped array; 4 parse calls total.
    I ran the counterfactual MYSELF and needed three attempts, which is worth recording: (1) my regex hit the `reverse(lat: ...)`
    function SIGNATURE, producing `lat: String(number)` — a syntax error, zero tests collected, proving nothing. (2) The return is
    shorthand `{ label, lat, lng }`, so a `lat:`-targeted regex found nothing to mutate and the suite stayed green — again proving
    nothing. (3) Removing the `Number()` coercion on line 61 so a raw string leaks through: 4 FAILED / 5 passed, including both
    schema-parse tests. Only the third attempt is evidence. Same lesson as Task 6's invalid req.cookies weakening — a
    counterfactual only counts if the mutation is the one you think you are applying.
  - Ruling 1 CLOSED: GeocodeModule is genuinely imported (app.module.ts:4) AND present in the imports array (line 9), not just
    an unused import. Implementer verified at runtime too: boot log shows "GeocodeModule dependencies initialized" with both
    routes mapped, and a live curl to /v1/geocode?q=Algiers returned real Nominatim data
    (label "Alger ⴷⵣⴰⵢⴻⵔ الجزائر, Daïra Sidi M'Hamed...", lat 36.7729333, lng 3.0588445). Prose-only wiring instruction survived.
  - No live network in the unit tests: fetch stubbed, and no nominatim.openstreetmap.org URL anywhere in the test file.
  - Implementer also hit /v1/reverse-geocode with an invalid lat and got a clean 400 with no extra upstream call, proving that
    route's validation without a second hit on a rate-limited free service.
Task 9: task review dispatched (sonnet — small surface, stubbed fetch, but it is an outbound-network integration with a
  rate-limited third party, so cache correctness and failure handling matter more than size suggests).
Task 9: task review (sonnet) — spec ✅; 2 CRITICAL + 1 Important + 3 Minor. NOT approved as-is.
  Reviewer confirmed solid: cache key `s:${trimmed.toLowerCase()}` is case-insensitive and collision-free (Algiers/algiers/
  ALGIERS/"  algiers  " = 1 upstream call); reverse key namespaced `r:` separately; cache hit genuinely skips fetch;
  CACHE_MAX_ENTRIES=500 bounds growth and the controller caps q at 200 chars; NO retry/backoff (correctly absent — it would
  amplify load on a failing upstream); reverse-geocode rejects bad input with 400 before any upstream call; NO parameter
  injection (URLSearchParams.set percent-encodes NUL/&/#/newlines, base URL and path are fixed constants); privacy clean — the
  query text and upstream body are never logged, only warn-level status + fixed pathname, and no config leaks to the client even
  on a 500. All three requested mutations died on their named tests (cache read disabled, wrong User-Agent, widened TTL).
  Ruling 37 (Task 9, CRITICAL 1 -> FIX LOOP): no in-flight deduplication. I verified myself against the compiled service with a
  stubbed fetch: 5 CONCURRENT identical searches -> 5 upstream calls, while 3 SEQUENTIAL identical searches -> 1 call. So the
  cache protects repeats but not simultaneity, because it is only written after `await this.request(...)` resolves. This is the
  proxy's entire stated purpose (spec §7: Nominatim allows ~1 req/sec and requires an identifying User-Agent) and it does not
  hold under exactly the access pattern a type-ahead produces — ten keystrokes, a React StrictMode double-fire, or a browser
  retry all bypass it. FIX NOW with an in-flight promise map.
  Ruling 38 (Task 9, CRITICAL 2 -> FIX LOOP): no timeout on the outbound fetch. Verified: a fetch that never resolves leaves
  search() STILL PENDING past 1500ms with no AbortController and no setTimeout race anywhere in request(). Combined with
  Ruling 37 there is no upper bound on concurrently-open requests against a degraded upstream. FIX NOW with an AbortController.
  Ruling 39 (Task 9, IMPORTANT -> FIX LOOP): a 200 OK body in an unexpected SHAPE crashes instead of degrading. Reviewer built a
  real Nest app with supertest: /search returning an object instead of an array throws
  "TypeError: (places ?? []).flatMap is not a function" -> unhandled 500; a null entry inside a valid array throws
  "Cannot read properties of null (reading 'lat')" -> unhandled 500. The try/catch in request() covers network and JSON-parse
  failure only (both confirmed graceful). Fixing this with the Zod schemas already in this codebase is the obvious move and
  closes Ruling 8's gap at the INPUT boundary too, not just the output one.
Task 9: minor (deferred): cache eviction is FIFO by insertion order, not LRU — Map.set on an existing key does not reorder it, so
  a hot query can be evicted at the 500 cap while colder entries survive. Low impact at this scale given the 10-min TTL.
Task 9: minor (deferred, but ASK): failures are cached as empty results for the full 10-min TTL, so a transient Nominatim outage
  silently poisons that exact query for up to 10 minutes after recovery. This is arguably the CORRECT considerate-client tradeoff
  (it prevents retry-storming) but the report does not say it was chosen deliberately. Flagging in the PR for the user's call.
Task 9: minor (deferred): /reverse-geocode with empty-string lat/lng coerces to (0,0) rather than 400 — the same
  LatitudeSchema/LongitudeSchema coercion parked as a contracts decision in Rulings 9/31, not introduced by Task 9.
Task 9: fix round 1/5 dispatched — in-flight dedup, fetch timeout, upstream shape validation.
Task 9: fix round 1/5 (3 addressed, 0 open; commits 9f2c41b..00fa098). Unit 43 -> 56 (geocode file 9 -> 22).
  CONTROLLER-VERIFIED by re-running the EXACT probe that exposed the Criticals:
    - Ruling 37 CLOSED: 5 concurrent identical searches now make 1 upstream call (was 5). Sequential cache still 3 -> 1.
      inFlight Map<string, Promise> registered before any await, removed via .finally() so a failure cannot wedge the key.
    - Ruling 38 CLOSED — and my first re-check was WRONG, worth recording: my probe waited 1500ms while the timeout is 5000ms,
      so "STILL PENDING" was my test being impatient, not a failure. Re-ran waiting 8s: search() RESOLVED after 5004ms -> [],
      reverse() RESOLVED after 5002ms -> null, AbortSignal fired true, each with a clean warn log
      ("Nominatim request timed out after 5000ms for /search"). Third time this session a counterfactual gave me the wrong
      verdict for the wrong reason (Task 6 req.cookies, Task 9 regex-on-signature, now this).
    - Ruling 39 CLOSED: NominatimPlaceSchema/NominatimPlacesSchema validate the upstream body via safeParse BEFORE mapping;
      a parse failure degrades through the same warn+empty path as any other upstream failure. Implementer honestly reported
      that reverse()'s pre-fix code already handled its two malformed cases by coincidence of existing null-checks, so only the
      two search() cases showed a pre-fix crash — it did not overclaim 4 pre-fix failures.
  Timeout chosen 5000ms with stated reasoning: above a normal Nominatim round-trip (<1s) but bounded, because Fix 1 means
  multiple waiters now share one pending request and a stuck request must not stall everyone behind it. Sound.
  NEGATIVE-CACHE QUESTION ANSWERED: the 10-minute negative cache was inherited VERBATIM from the brief's Step-3 code, not an
  independent choice — the implementer copied the brief's control flow as instructed. It judges the tradeoff defensible
  (prevents retry-storming a ~1 req/s service) but costs up to 10 minutes of a recovered service staying hidden, with no user
  refresh path. Its recommendation if changed: a distinctly shorter negative TTL of 30-60s, which needs writeCache to accept a
  per-write TTL. Left unchanged as instructed — surfacing to the user in the PR.
Task 9: scoped re-review dispatched (sonnet) on the fix diff only.
Task 9: scoped re-review — all three findings ADDRESSED, but it found a REGRESSION INTRODUCED BY THE FIX plus two honest
  test-attribution corrections. Re-reviewer verified the coalescing mechanism by probing (same-key reuse after failure works,
  keys namespaced, no map leak, waiter-at-settle sound by inspection), confirmed the timer is cleared (getTimerCount 0 after
  success), confirmed the abandoned fetch promise cannot produce an unhandled rejection, and — importantly — confirmed the new
  Nominatim schema is CORRECTLY PERMISSIVE by parsing a realistic full payload (place_id, licence, osm_type, boundingbox, class,
  type, importance, addresstype, name, display_name, lat, lon, nested address). A guard that rejected real responses would have
  been worse than the crash it replaced; it does not.
  Ruling 40 (Task 9, REGRESSION from the timeout fix -> FIX LOOP): to attach .catch() before Promise.race, the fix moved
  `fetchPromise = this.fetchImpl(...)` OUTSIDE the try block. So a SYNCHRONOUS throw from fetchImpl now escapes request(),
  search() and reverse() uncaught, where the pre-fix code caught it. I verified against shipped dist: a fetch stub that throws
  synchronously makes BOTH search() and reverse() THROW (TypeError propagates out), while the async-rejection control still
  degrades to [] with a clean warn. Re-reviewer confirmed real Node undici CAN throw synchronously (invalid header value throws
  from Headers.append during Request construction, before any promise exists) and that pre-fix commit 9f2c41b caught the same
  stub. Trigger is narrow (nominatimUserAgent is a developer-controlled env var, not user input) but it breaks the exact
  never-throw-always-degrade invariant Fix 3 was establishing. FIX NOW — one-line try/catch around the fetchImpl call.
  Ruling 41 (Task 9, test-coverage gap -> FIX with the above): removing clearTimeout leaves all 56 tests passing. The shipped
  code is correct (timer count 0 verified) but nothing asserts it, so a future refactor could leak a timer per request silently.
  Cheap to close with a getTimerCount assertion while the file is open.
  TWO HONEST CORRECTIONS from the re-reviewer, both of which I accept and neither of which is a defect:
    - The "removes the in-flight entry... successfully or not" test uses DIFFERENT keys per phase (failure-key then another-key),
      so it proves cross-key isolation, not same-key reuse after failure. The re-reviewer probed same-key reuse separately and it
      does work — the docstring overstates what the test covers.
    - Of the four malformed-shape tests, only the two search() cases were real pre-fix crashes; the two reverse() cases already
      passed pre-fix by coincidence of the existing `place ? toResult(place) : null` ternary plus toResult's NaN guard. The
      implementer's report characterised all four as closing the gap; only two demonstrably did. The schema is still correct and
      harmless — this is attribution, not a bug.
Task 9: fix round 2/5 dispatched — restore the never-throw invariant, assert timer cleanup, correct the two overstated claims.
Task 9: fix round 2/5 (2 addressed + 1 record correction, 0 open; commits 00fa098..551823c). Unit 56 -> 60.
  CONTROLLER-VERIFIED all three behaviours hold SIMULTANEOUSLY (the risk was that fixing the regression would undo round 1):
    - Ruling 40 CLOSED: sync-throwing fetch now degrades — search() -> [], reverse() -> null (was: both THREW).
    - Round 1's timeout still works: RESOLVED after 5005ms -> [], AbortSignal fired; reverse() 5003ms -> null.
    - Round 1's coalescing still works: 5 concurrent -> 1 upstream call; sequential cache 3 -> 1.
    - Ruling 41 CLOSED: a vi.getTimerCount() assertion now exists; commenting out clearTimeout fails exactly that one test.
  Record corrections made as asked: the cross-key test is renamed to say what it actually proves, a NEW same-key-after-failure
  test was added so the original claim is now genuinely covered, and the report states plainly that only the two search()
  malformed-shape cases were real pre-fix crashes.
  ATTRIBUTION DISCREPANCY, flagged by the agent and ruled on by me: commit 551823c carries
  "Co-Authored-By: Claude Sonnet 5" rather than the "Claude Opus 5 (1M context)" line I specified. The agent's own attribution
  reminder had changed mid-round and its precedence rule says only the user's own instructions (e.g. CLAUDE.md) override it — a
  coordinator message does not. It followed the reminder and told me explicitly rather than silently diverging. Ruling: LEAVE IT.
  The trailer is factually correct (Sonnet wrote that commit), the agent applied the documented precedence correctly, and
  rewriting history to satisfy my own instruction would make the record LESS accurate. Task 9 now has two Opus-attributed commits
  and one Sonnet-attributed commit, which is exactly what happened.
Task 9: complete (commits 9f2c41b..551823c, review clean after 2 fix rounds, 3 minors deferred, 1 question for the user)
Task 9: PR #9 opened https://github.com/gmerwan/jiwar/pull/9 — STOPPED, awaiting user merge + explicit "continue".
  PR surfaces the negative-cache TTL as an explicit DECISION for the user (10 min inherited from the plan vs a suggested 30-60s).
CARRY-FORWARD REMINDERS for Task 10 (next — first frontend task):
  - Add one GeocodeResultsSchema.parse assertion covering api.geocode in the client test (Ruling 8's web half).
  - The web client MUST send credentials:'include' or the participant cookie never reaches the API (Task 6 minor).
  - Task 8's error body: `message` is string[] for validation failures but a plain string for service rejections — the client's
    String(body.message) comma-joins arrays. Decide the shape before Task 13 needs per-field errors.
  - Contract facts verified in Task 8 that the client depends on: distanceMetres is a NUMBER; GET /:id has NO distanceMetres key;
    organizerName/organizerContact are present-but-null, never omitted.

Task 9: MERGED by user as 347f732 (PR #9). Local branch deleted.
Task 10: dispatched (sonnet — 525-line brief, complete code, first frontend task; mostly scaffolding + a typed fetch wrapper)
  at BASE 347f732 on branch task-10-web-shell.
  CARRY-FORWARD AUDIT before dispatch:
    - CF1 (credentials:'include') ALREADY HANDLED BY THE BRIEF: line 300 sets it and line 192 is a test asserting
      init.credentials === "include". No action needed — good, since without it the participant cookie never reaches the API
      and cancel-my-own-notice would silently fail.
    - CF2 (Ruling 8's web half) STILL A GAP: api.geocode calls GeocodeResultsSchema.parse in PRODUCTION (brief line 348) but the
      brief's 6 test cases never call geocode or reverseGeocode. So the schema stays unexercised on the client side too.
      Dispatch requires a test.
    - CF3 (error body shape) PARTIALLY A GAP: the brief's error tests use only STRING messages (lines 212, 222). Task 8 returns
      message as string[] for validation failures, so String(body.message) comma-joins an array. Dispatch requires a test with
      the array shape so the behaviour is pinned rather than discovered in Task 13.
Task 10: implementer DONE — commit 2257205. 92/92 tests (contracts 20, api 60, web 12), typecheck green in all 4 projects,
  build green in all 3 buildable, dev server served on :5173. CONTROLLER-VERIFIED:
  - CF2 CLOSED (Ruling 8's web half, open since Task 3): client.test.ts:105 parses a geocode response through
    GeocodeResultsSchema AND :119 asserts it THROWS when the response drifts from the contract. Both halves of the geocode gap
    are now closed — server in Task 9, client here.
  - CF3 CLOSED as a pin, not a redesign: client.test.ts:169 "pins how ApiError renders a string[] validation message" with a
    realistic two-issue array. Implementer's note for Task 13: the result is comma-joined with NO space and per-field info is
    unrecoverable, so Task 13 must not try to parse it back — it needs a client or contract change. Exactly the documented
    starting point I wanted.
  - credentials: "include" still at client.ts:48.
  Ruling 42 (Task 10, tsx/vitest override — ACCEPTED after I tested the claim, which did NOT hold as stated): the implementer
  added `tsx: 4.20.6` to pnpm-workspace.yaml overrides, diagnosing that drizzle-kit's tsx@4.23.13 vs apps/api's tsx@4.20.6 made
  pnpm build two physically distinct vitest@5.0.1 instances, so the single hoisted @testing-library/jest-dom patched the wrong
  chai prototype and broke .rejects.toThrow() file-wide — failing the brief's own required test #6, 11/12.
  MY CHECK CONTRADICTED THE HEADLINE CLAIM: the store still holds 5 vitest dirs and BOTH tsx versions, so "collapses to a single
  vitest instance" is not literally true. But resolution is what matters, and I verified that directly: apps/api, apps/web and
  packages/contracts ALL resolve the identical vitest path (...tsx@4.20.6...). The extra store dirs are unpruned leftovers, not
  live resolutions. And the bug itself is gone — a probe asserting .rejects.toThrow(), .rejects.toMatchObject() and a jest-dom
  matcher passes 3/3 in apps/web. Ruling: ACCEPT. The fix works; only the wording overstated it. Cost if wrong: a future
  `pnpm install --frozen-lockfile` on a clean store could resolve differently, which the lockfile should prevent.
  Ruling 43 (Task 10, @types/react 19.3.1 -> 19.3.0 — ACCEPTED): brief pins @types/react and @types/react-dom at 19.3.1, which
  I confirmed is NOT PUBLISHED (npm view errors). 19.3.0 is the latest real version. Third unpublished-version error in this
  plan after zod-openapi@5.6.1 (Task 4) and the mislabelled WKB fixture — the plan's version pins were not all verified against
  the registry. Cost if wrong: none; an unpublished pin cannot install.
Task 10: task review dispatched (sonnet — the client is the contract seam every later frontend task imports, so response-shape
  fidelity and error handling matter more than the scaffold).
Task 10: task review (sonnet) — spec ✅, quality APPROVED, no Critical/Important. Reviewer confirmed the client agrees with
  every contract fact Task 8 established by parsing real responses: distanceMetres z.number(); getNotice uses the BARE NoticeSchema
  which has no distanceMetres field, matching toNotice() vs toNoticeWithDistance() on the server; organizerName/Contact are
  .nullable() with present-but-null semantics (verified live: .parse({}) throws "expected string, received undefined" while
  .parse({organizerName: null}) passes); envelope exactly {items, nextCursor, fallback}.
  URL CONSTRUCTION SURVIVES THE ?lat=&lng= 400: lat/lng/radiusKm are REQUIRED in the SearchParams TS interface and always set
  unconditionally, so no type-safe caller can send an empty string; optional params are only set `if (params.x)`; categories uses
  query.append per item (repeated params), matching the server's union schema. The trap I worried about cannot be triggered.
  All four sampled mutations were caught by their named test (credentials -> "omit" fails 3; schema.parse -> `body as T` fails 3
  including both geocode drift tests; categories comma-join fails 1; hardcoded 500 status fails 2). Tests are honest.
  Routing is additive — App.tsx has only the catch-all, so Tasks 12/13 add routes without restructuring. Vite proxies /v1 to
  localhost:3000, matching the API's default port and setGlobalPrefix("v1").
  Ruling 44 (Task 10, error-surface asymmetry — PARKED, carry to Task 13, NOT a Task 10 defect): I probed this myself with a
  throwaway vitest file (since removed, tree clean). Measured:
    - 502 with an HTML body -> ApiError, instanceof ApiError TRUE, "Request failed with status 502"  ✓
    - network failure (fetch rejects) -> raw TypeError, instanceof ApiError FALSE
    - 200 with a contract-violating body -> raw ZodError, instanceof ApiError FALSE
  So `catch (e) { if (e instanceof ApiError) ... }` misses two real cases. Crucially NEITHER silently resolves to empty data —
  both reject — so there is no wrong-data path, only a wrong-error-branch path. The brief prescribes this exact call() shape
  verbatim and no test claims otherwise, so it is not an implementer defect. Ruling: PARK and carry into Task 13's dispatch,
  which owns user-facing error rendering and must handle non-ApiError throwables anyway. Cost if wrong: Task 13 shows a generic
  fallback message instead of a specific one for an offline user; no data corruption.
Task 10: complete (commits 347f732..2257205, review clean with no fix round, 1 parked for Task 13)
Task 10: PR #10 opened https://github.com/gmerwan/jiwar/pull/10 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Tasks 11-13:
  - Task 11: AddressSearch is a TYPE-AHEAD against /v1/geocode. Task 9 added in-flight coalescing server-side, but the client
    should still debounce — coalescing protects Nominatim, not the user's bandwidth or the API's own request count.
  - Task 13: handle NON-ApiError throwables (raw TypeError on network failure, raw ZodError on contract drift) — Ruling 44.
  - Task 13: the string[] validation message is comma-joined and per-field info is UNRECOVERABLE; do not try to parse it back.
  - Task 13: jsdom cannot render MapLibre, so LocationPicker must be mocked in its tests (the plan already says this).

Task 10: MERGED by user as 2b5cfe4 (PR #10). Local branch deleted.
Task 11: dispatched (sonnet — 492-line brief, 11 cases, complete code; browser-API mocking (geolocation) and Intl formatting
  are the only subtle parts) at BASE 2b5cfe4 on branch task-11-location-i18n.
  CARRY-FORWARD AUDIT: the debounce concern is ALREADY HANDLED by the brief — AddressSearch is debounced at 500ms (line 397)
  with Nominatim's ~1 req/sec limit cited as the reason, and line 424 uses setTimeout. Combined with Task 9's server-side
  in-flight coalescing, the type-ahead is protected at both layers. No action needed.
Task 11: implementer DONE — commit 10e7cb2. 23/23 web (11 new: 4 formatDistance + 1 formatDateTime + 6 useChosenLocation),
  60/60 api, 20/20 contracts, typecheck + build green. Files copied verbatim, no deviations claimed. CONTROLLER-VERIFIED:
  - All three geolocation outcomes covered via vi.stubGlobal("navigator", ...) — granted, denied, unavailable. Good: denial is
    the common real-world case and the brief has a dedicated user-facing string for it.
  - It cross-checked AddressSearch's t() calls against the string table and found no missing keys, and reported the ACTUAL Intl
    output on this machine ("Thu, Oct 1, 2026, 02:30 PM") rather than loosening an assertion — exactly what I asked for.
  - Race guard IS implemented (cancelled flag + cleanup at AddressSearch.tsx:22,28,30,32,37) and debounce IS 500ms (line 34).
  Ruling 45 (Task 11, IMPORTANT -> FIX LOOP): AddressSearch has NO TEST AT ALL and neither does any other task. The brief's 11
  cases are three describe blocks — formatDistance, formatDateTime, useChosenLocation — and `find` confirms only
  useChosenLocation.test.ts, format.test.ts and client.test.ts exist. Tasks 12 and 13 both RENDER AddressSearch for real
  (plan lines 589, 595, 864) and neither mocks it, so it ships into two screens untested.
  I proved the gap by mutation rather than inferring it: setting the debounce to 0ms leaves 23/23 GREEN, and removing the
  stale-response race guard on the success path also leaves 23/23 GREEN. So the two things that make this component correct —
  the Nominatim rate-limit protection and the classic autocomplete race fix — are both unasserted. The implementer did not
  deviate; the BRIEF omits these tests. Ruling: FIX NOW, because Task 12 is next and will render this component immediately.
Task 11: fix round 1/5 dispatched — AddressSearch tests for debounce, race, and the pick callback.
Task 11: fix round 1/5 (1 addressed, 0 open; commits 10e7cb2..6e79cad). Web 23 -> 27, total 107 across packages.
  Ruling 45 CLOSED — verified by re-running MY OWN two mutations, the ones that previously survived:
    - debounce 500ms -> 0ms: NOW FAILS (1 failed / 26 passed). Was 23/23 green.
    - remove the stale-response race guard: NOW FAILS (1 failed / 26 passed). Was 23/23 green.
    Each mutation fails exactly ONE test with no collateral, so the tests are targeted rather than incidentally coupled.
  Fix commit is test-only — AddressSearch.tsx untouched (git show confirms), as instructed.
  IMPLEMENTER CAUGHT ITS OWN FALSE-POSITIVE TEST, unprompted and disclosed: its first draft of the race test resolved the STALE
  query before the fresh one, which passed even with the guard removed. It found this via the mutation check itself, fixed the
  resolution order (fresh resolves first, stale arrives late), and re-verified. That is the fourth time this session a
  counterfactual initially gave a wrong verdict for a wrong reason (my Task 6 req.cookies weakening, my Task 9 regex-on-signature,
  my Task 9 too-short timeout, and now this) — but the first time a subagent caught its own before reporting.
  Also found and fixed a real infra detail: this project's vitest.config.ts sets globals:false, so @testing-library/react's
  auto-cleanup never registers and DOM nodes leaked across tests in the new file. Added explicit cleanup() in afterEach.
  I verified globals:false is genuinely set, so the explanation holds.
Task 11: complete (commits 10e7cb2..6e79cad, review clean after 1 fix round, 0 minors deferred)
Task 11: PR #11 opened https://github.com/gmerwan/jiwar/pull/11 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Tasks 12-13 (frontend, both add component tests):
  - vitest.config.ts sets globals:false, so @testing-library/react auto-cleanup does NOT register — component test files need
    an explicit cleanup() in afterEach or DOM nodes leak between tests (found in Task 11).
  - Task 13: handle NON-ApiError throwables — raw TypeError on network failure, raw ZodError on contract drift (Ruling 44).
  - Task 13: the string[] validation message is comma-joined with no space and per-field info is UNRECOVERABLE; do not parse it back.
  - Task 13: jsdom cannot render MapLibre, so LocationPicker must be mocked (the plan already says this).
  - Both: AddressSearch is now covered (debounce + race), so it can be rendered for real without leaving those properties unasserted.

Task 11: MERGED by user as 5be9012 (PR #11). Local branch deleted.
Task 12: dispatched (opus — 698-line brief, 5 new components incl. a MapLibre map, infinite-query pagination over Task 7's
  cursor, and the first real screen; jsdom cannot render MapLibre so test strategy needs judgment) at BASE 5be9012 on branch
  task-12-discovery.
  PRE-DISPATCH AUDIT of the brief, two gaps found:
    - NO cleanup()/afterEach anywhere in the brief, despite Task 11 proving that globals:false means @testing-library/react's
      auto-cleanup never registers and DOM nodes leak between tests. This brief adds MORE component tests than Task 11 did.
    - The 11 cases are only two describe blocks (NoticeCard, NoticeList). NOTHING covers useNotices (the infinite-query hook
      that consumes Task 7's cursor pagination — the most failure-prone piece), FilterBar, or NoticeMap.
Task 12: implementer DONE_WITH_CONCERNS — commit 4b44994. Web 27 -> 61 tests (brief's 11 + 23 added), 141 total across packages,
  typecheck + build clean. CONTROLLER-VERIFIED:
  - Both flagged gaps closed: cleanup() present in ALL FIVE new component test files, and useNotices/FilterBar/NoticeMap now have
    tests the brief omitted. I verified cleanup() is load-bearing myself: removing afterEach(cleanup) from NoticeList.test.tsx
    fails 1/6 with "Found multiple elements" — so it is preventing real cross-test pollution, not decorative.
  Ruling 46 (Task 12, MapLibre worker bug — ACCEPTED, and it is the most valuable find of this task): the map rendered NO TILES.
    maplibre-gl 6.9.1 derives its worker URL from import.meta.url, which Vite rewrites; the worker 404'd in dev and — worse — in
    the PRODUCTION build the URL returned HTTP 200 with Content-Type: text/html, because the SPA fallback served index.html.
    Symptom either way: canvas, controls, marker and attribution all present, blank cream rectangle, NO thrown error, only a
    console 404. I verified the fix against the real built output served by vite preview:
      /assets/maplibre-gl-worker-CfgxK1ZU.js -> HTTP 200, Content-Type: text/javascript, body starts
        "(function(){/*** MapLibre GL JS* @license 3-Clause BSD."
      /assets/does-not-exist.mjs             -> HTTP 200, Content-Type: text/html   <- the SPA-fallback shape being avoided
      the built entry index-BL8Gcxp8.js references the hashed worker asset.
    Fix is 3 lines in main.tsx (setWorkerUrl + ?worker&url). It correctly rejected `?url` alone (the worker imports a sibling
    maplibre-gl-shared.mjs that ?url does not emit — consistent with the 507KB bundled worker I see in dist) and rejected
    optimizeDeps.exclude because that fixes dev only and leaves the build broken. vite.config.ts confirmed UNMODIFIED.
    main.tsx is the one file outside the brief's list; unavoidable for a task that ships a map view. ACCEPTED.
  WHY THIS MATTERS BEYOND THE BUG: it was invisible to the suite BY CONSTRUCTION — the tests mock MapLibre because jsdom has no
  WebGL, so no jsdom test can ever observe tile loading. Only the "run it and look" verification step found it. That is the
  strongest argument so far for keeping that step in every frontend dispatch rather than trusting a green suite.
  Counterfactuals: all 23 added tests verified (13 distinct breaks, each restored). Two worth noting — narrowing isError to
  ApiError broke 2 tests, confirming Ruling 44's raw TypeError/ZodError paths are genuinely covered; and making onMoveEnd search
  directly broke the spec §6 "panning must not refetch" case.
  It also exercised the real fallback:true path end to end by adding one past notice near Oran, and saw
  "Nothing upcoming nearby. Showing the most recent past notices instead." above a card marked "This event has already taken
  place." — so the misleading-past-notices risk I flagged is handled in the UI, not just in the data.
  Minor/pre-existing: a console 404 for /favicon.ico (index.html has declared no icon since Task 10), and three benign MapLibre
  style warnings from OpenFreeMap's own liberty stylesheet.
  Note: vite.config.ts hardcodes its dev proxy to localhost:3000, so running the API on another port needs a forwarder. The agent
  used a throwaway TCP forwarder rather than editing a committed file — right call.
Task 12: task review dispatched (opus — first real screen, 5 new components, and Task 14's e2e will drive exactly this DOM).
Task 12: task review (opus) — spec ✅, Approved with 1 Important + 3 Minor. Exceptional review: it drove a REAL browser with
  real mouse drags rather than the mock, and ran TASK 14'S ACTUAL SELECTORS against the live DOM.
  TASK 14 COMPATIBILITY CONFIRMED — every selector passes: "use my location" button, the notice title link inside h2, the map/list
  tabs (count 1 each, no ambiguity), view=map and view=list URL assertions, the deep link, aria-selected, and controls.count()>3.
  Zero pageerror and zero console.error. One caveat it correctly assigned to Task 14 rather than here: Task 14's test 2 clicks
  "Use my location", which only exists while location === null, so it depends on a fresh context per test (Task 14 does use one).
  SPEC §6 VERIFIED LIVE, not from the mock: after a real drag, 0 /v1/notices requests during 1.2s idle, "Search this area"
  appeared, clicking it issued exactly 1 request and wrote the panned centre (36.7119, 3.1285) to storage.
  useNotices PAGINATION CORRECT on every point I asked about: nextCursor threads back exactly, stops at null with no further
  request, no duplication/skipping, and — the important one — the cursor is NOT in the queryKey, it is the page param, so a
  filter change is a different key and React Query starts fresh at initialPageParam: undefined. Verified no path serves one
  filter's page 2 under another. Also: unnarrowed query.isError means Ruling 44's raw TypeError and ZodError both reach the
  error state.
  Ruling 47 (Task 12, IMPORTANT -> FIX LOOP): the MAP never tells the reader that fallback results are PAST notices. I confirmed
  NoticeMapProps is {notices, centre, onSearchArea} — no fallback, no isPast. The reviewer clicked the Oran past notice live and
  got a popup reading "Funeral prayer held last week ... Sat, Sep 5, 2026" with NO past marker and NO banner anywhere on screen.
  The LIST gives two independent signals (banner + per-card "This event has already taken place"); the map gives none, and
  /?view=map is a shareable URL a user can land on directly. Spec §6 says the flag exists "so the UI can label them honestly".
  The date alone reads as a detail, not a warning. Both i18n keys already exist. FIX NOW — this is the same honesty guarantee the
  list already keeps, on the other view this task ships.
  Ruling 48 (Task 12, Minor 4a -> FIX with the above, cheap): lat/lng and `when` are in the queryKey but UNTESTED. I verified with
  a clean control: dropping lat/lng -> 61/61 green; dropping `when` -> 61/61 green; dropping radiusKm -> 1 FAILED. So the probe
  method works and those two specific members escape. This is exactly the bug class Task 7's review found in the cursor layer
  (one filter's cached page served under another), so two assertions mirroring the existing radius/sort case are worth having.
Task 12: minor (deferred): the empty state is hardcoded "No upcoming notices within {radius} km." and NoticeList never receives
  `when`, so an explicit Past search with 0 results reads "No upcoming notices..." while the Past filter is selected. Factually
  wrong but low harm; needs a when-aware i18n key.
Task 12: minor (deferred): the map does not recentre when the chosen location changes — initialViewState is read only on mount, so
  picking Oran while in map view leaves the map at Algiers with the marker ~10,000px off-screen (measured x = -10128). Recoverable
  by switching tabs (which remounts), so recoverable only by accident. A key={lat,lng} on NoticeMap or controlled lon/lat fixes it.
  NOT promoting to a fix because Task 14's e2e clicks the Map tab fresh rather than after changing location — but it is a real
  user-visible wart and belongs in the final review's triage.
Task 12: minor (deferred): NoticeList checks isError before notices.length, so a failed loadMore() after page 1 replaces already-
  loaded cards with the error panel (measured isError=true with notices=['a','b']). retry() recovers. Rendering the list plus an
  inline retry would be kinder and matches the brief's own "additive" description of load-more.
Task 12: note (not a finding): the four FilterBar labels wrap a span showing the current VALUE, not the field name, so the `when`
  select is labelled "Upcoming". Unique and unambiguous for getByLabel so nothing in Task 14 breaks; brief's own markup; a future
  a11y pass will want field-name keys.
Task 12: fix round 1/5 dispatched — map fallback honesty + two queryKey assertions.
Task 12: fix round 1/5 (2 addressed, 0 open; commits 4b44994..6edf4aa). Web 61 -> 68, 148 total.
  CONTROLLER-VERIFIED by re-running my own three probes plus a new one:
    - Ruling 48 CLOSED: drop lat/lng -> NOW 1 FAILED (was 61/61 green); drop `when` -> NOW 1 FAILED (was 61/61 green);
      control drop radiusKm -> still 1 FAILED. All three flip correctly.
    - Ruling 47 CLOSED: NoticeMapProps now has a REQUIRED `fallback: boolean` (not optional) with a doc comment citing spec §6,
      and line 40 renders {fallback && <p role="status">{t("discovery.fallback")}</p>}. I verified the compile-time guard myself:
      removing fallback from ONLY the NoticeMap element in Home.tsx (leaving NoticeList's identical prop intact) makes
      tsc --noEmit exit 1. So the label cannot be silently dropped again — a stronger fix than a test alone.
  Making the prop required rather than optional was the implementer's own choice and is the right one.
  IMPLEMENTER DISCLOSED TWO INVALID PROBES OF ITS OWN, unprompted — both instructive:
    1. Its first typecheck counterfactual used a regex that matched NoticeList's IDENTICAL `fallback={notices.fallback}` line, so
       it failed at line 109 and "proved" the wrong component. Redone with an exact-block replacement that asserts it applied;
       then failed at line 120 (NoticeMap). I hit the same hazard and avoided it by scoping my regex to the <NoticeMap> element.
    2. Its first browser control reused one context and reset localStorage mid-run, but addInitScript re-runs on every navigation
       and restored Oran — so the control REPORTED THE BUG AS STILL PRESENT. Redone with a fresh context per case. Worth
       recording: that failure mode makes a control look like it reproduces the bug, i.e. a false NEGATIVE on a fix.
    That is the fifth and sixth invalid counterfactual this session (my Task 6 req.cookies, my Task 9 regex-on-signature, my
    Task 9 short timeout, the Task 11 stale-ordering race test, and these two) — and the second time a subagent caught its own.
  Regression check after adding an element above the map: spec §6 still holds (1 request before the drag, 1 after 1.2s idle,
  button appears, click issues exactly one more, button hides, banner persists), and Task 14's selectors still resolve at count 1.
  Disclosed interaction with deferred item 2: since initialViewState is mount-only, changing location while in map view now updates
  the banner but NOT the viewport, so a reader could see a correct banner over the wrong area. Strictly better than silence;
  item 2 is what makes it fully coherent. Left deferred — noted in the final-review triage list.
Task 12: complete (commits 4b44994..6edf4aa, review clean after 1 fix round, 4 minors deferred)
Task 12: PR #12 opened https://github.com/gmerwan/jiwar/pull/12 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Task 13 (next):
  - vitest globals:false -> component test files need explicit cleanup() in afterEach (Task 11/12 finding).
  - Handle NON-ApiError throwables: raw TypeError on network failure, raw ZodError on contract drift (Ruling 44).
  - The string[] validation message is comma-joined with no space; per-field info is UNRECOVERABLE. Do not parse it back —
    Task 13 wants per-field errors and cannot get them from the current shape without a client/contract change.
  - jsdom cannot render MapLibre: LocationPicker MUST be mocked (the plan says so). The Task 12 worker fix is in main.tsx already.
  - CreateNoticeSchema still accepts lat:null / lat:"" as 0 (parked Rulings 31/9). The submit wizard uses a map picker so it is not
    a normal path, but do not add a code path that could POST an empty coordinate.
  - Two prod-facing decisions still open for the user at final review: SameSite=Lax topology, and the 10-min negative geocode cache.

Task 12: MERGED by user as 7884faf (PR #12). Local branch deleted.
Task 13: dispatched (opus — 625-line brief, the publish half of the app, a 4-step wizard + detail page + the cancel flow that
  Task 6's whole cookie exists for) at BASE 7884faf on branch task-13-submit-wizard.
  PRE-DISPATCH AUDIT, three gaps found:
    - ZERO cleanup() mentions, again — third brief in a row, and Tasks 11/12 both proved globals:false means auto-cleanup never
      registers (Task 12's removal probe gave "Found multiple elements").
    - Only 7 cases, all in ONE describe (SubmitWizard). Nothing covers NoticeDetail or the CANCEL flow — and cancel is the entire
      reason Task 6's signed cookie exists. Task 6's review also proved a 403-vs-200 authorisation boundary there.
    - Line 268 is `error instanceof ApiError ? error.message : t("error.generic")` — the EXACT Ruling 44 hazard. Task 10's client
      throws a raw TypeError on network failure and a raw ZodError on contract drift, so an offline publisher gets the generic
      fallback. That is defensible for a network error but wrong for contract drift, and worth making deliberate.
Task 13: implementer DONE_WITH_CONCERNS — commit b75b60f. 170/170 (contracts 20, api 60, web 90 — was 76), typecheck + build
  green, and a REAL publish-then-cancel worked end to end in Chrome: published, appeared on / and at /n/_2MS7NTO7q-0, cancelled,
  banner shown, delisted from / but still URL-reachable, and a stranger's browser got a real HTTP 403 with a useful message.
  DB rows confirm the writes. That exercises Task 6's cookie boundary through the actual UI for the first time.
  CONTROLLER-VERIFIED: all three of my flagged gaps closed — cleanup() in both new test files (SubmitWizard, NoticeDetail),
  detail page + cancel now covered (22 added cases), routes additive (/, /submit, /n/:publicId, catch-all).
  Ruling 49 (Task 13, brief does not compile — ACCEPTED): useForm<CreateNotice> gives 6 errors headed by
  "Type 'Resolver<{...lat: unknown...}>' is not assignable to 'Resolver<{...lat: number...}>'" because CreateNoticeSchema's INPUT
  and OUTPUT genuinely differ (defaults on description/organizerConsent, z.coerce.number() on lat/lng). Fixed with
  useForm<WizardValues, unknown, CreateNotice> plus a small form.ts for the shared types, and the brief's
  `as unknown as CreateNotice` cast is GONE. Verified: useForm< generics at SubmitWizard.tsx:71, form.ts exists. A cast would
  have hidden the mismatch; parameterising the generics is the right fix.
  Ruling 50 (Task 13, brief's own test cannot pass against brief's own component — ACCEPTED): all five category cases failed with
  'Value "funeral" not found in options' because findByLabelText(/category/i) resolves on first paint while options arrive a tick
  later. Fixed TEST-side by awaiting the option; rendered structure unchanged so Task 14 is unaffected — but TASK 14 MUST AWAIT
  THE OPTION TOO. Carried.
  Ruling 51 (Task 13, real bug found by the walkthrough — ACCEPTED): blank organizer fields produced an "Organizer" heading with
  NOTHING under it. The wizard POSTed "" for untouched optionals (confirmed on the wire) and the detail page's !== null check
  accepted it. Fixed both halves — wizard omits blank optionals, page trims (NoticeDetail.tsx:78-80 uses ?.trim() ?? "" and
  hasOrganizer). This is the empty-labelled-block leak I flagged for null, arriving as "". Found by running it, not by tests.
  Ruling 52 (Task 13, Null Island in the BRIEF's own LocationPicker — ACCEPTED, and it is the third appearance of this bug):
  the brief's numeric fallback wrote Number(event.target.value) straight into the form, and Number("") is 0, which
  z.coerce.number() accepts as a legal latitude — a cleared box would have silently published a notice at 0N/0E. The fix holds
  the boxes as raw strings and commits only when both parse. I initially MISREAD the guard as isFinite-only (Number("") is 0,
  which IS finite) but the code has an explicit `nextLat.trim() === "" || nextLng.trim() === ""` check BEFORE the isFinite test,
  so empty and whitespace-only are both rejected and "abc" is caught by isFinite. Guard is correct.
  Ruling 53 (Task 13, the offline branch — ACCEPTED ITS RECOMMENDATION, no change): I asked whether a distinct offline message
  was better; it recommended AGAINST adding one now and did not, with reasoning I accept: the wizard cannot distinguish offline
  from CORS failure, DNS failure, or a dead dev server — all four are one indistinguishable fetch rejection — and
  navigator.onLine reports link state, not reachability (true on a captive portal). It proposed the honest fix belongs in Task 10,
  which knows it was a fetch rejection: NetworkError extends ApiError with status 0, which every existing instanceof ApiError
  branch picks up for free. Behaviour left as the brief has it, pinned by a test. Good judgment — it declined to add something I
  offered and explained why.
  Ruling 54 (Task 13, MY count was wrong): I asked for "the brief's 7 cases"; the brief's test block has FIVE it() blocks while
  its own Step 5 prose says "all six". My 7 was wrong and the brief is internally inconsistent. The agent flagged it rather than
  inventing two tests to match my number — the same correct pushback the Task 3 implementer gave on my "11 cases".
  Ruling 55 (Task 13, IMPORTANT -> FIX LOOP): the coordinate guard is correct but UNTESTED. I removed the emptiness check myself
  and the suite stayed 90/90 GREEN. Given this is the THIRD appearance of the Null Island bug (Ruling 9 in the query, Ruling 31
  in the POST body, Ruling 52 here in the picker), the one place it is now actually prevented must have a test. FIX NOW.
Task 13: fix round 1/5 dispatched — a test for the coordinate guard.
Task 13: fix round 1/5 (1 addressed, 0 open; commits b75b60f..8f77a81). Web 90 -> 104, 184 total. TEST-ONLY commit verified:
  git diff shows ONE file, +209 lines, so LocationPicker.tsx is provably untouched.
  Ruling 55 CLOSED — verified by re-running my own probe: removing the emptiness check now fails 11 CASES (it left 90/90 green
  before this round). The agent also ran CF-E, restoring the BRIEF's original direct Number() write — the actual 0N bug — which
  fails 10 cases. And CF-C (deleting onChange entirely) fails 2, so cases 1-3 cannot pass by the component simply never firing;
  that was the vacuity risk I flagged in point 4 of the dispatch and it is genuinely closed.
  HONEST NEGATIVE RESULT, disclosed rather than papered over — and I verified it: `Number.isFinite` is UNREACHABLE from the
  rendered inputs, so removing it leaves 104/104 GREEN. Cause: <input type="number"> sanitises every unparseable value to ""
  (abc, 1e, -, ., 1.2.3, 0x10, Infinity, NaN), so anything non-finite arrives as empty and is caught by the emptiness check one
  line earlier. The agent could not write a passing-honest test for that branch and SAID SO instead of shipping one that implied
  coverage it lacked. It also disclosed that its first attempt at my case 3 measured the wrong guard (typing "abc" exercised
  emptiness, not isFinite) and that it wrote then DELETED a NaN test that looked like it pinned isFinite but did not.
  Ruling 56 (Task 13, keep the unreachable isFinite — ACCEPTED): it left the branch in place, reasoning that commit() is also
  reached from the address-search and map-click paths, which hand over whatever the geocoder or MapLibre produced rather than a
  browser-sanitised string, so it is real defence for non-DOM callers. Correct trade: removing untestable code that guards those
  callers to satisfy a coverage metric would be worse than leaving a documented dead branch. Both facts are documented at the
  relevant cases in the test file so the next reader does not rediscover them.
  NULL ISLAND STATUS across the plan: covered at 2 of 3 appearances (Task 8's search query, and this picker). The middle one —
  CreateNoticeSchema coercing lat:"" -> 0 — is still PARKED, so this picker remains the only thing between a real user and a
  notice in the Gulf of Guinea. Carried to the final review as the single highest-value parked item.
Task 13: complete (commits b75b60f..8f77a81, review clean after 1 fix round, 1 documented dead branch, 0 minors deferred)
Task 13: PR #13 opened https://github.com/gmerwan/jiwar/pull/13 — STOPPED, awaiting user merge + explicit "continue".
CARRY-FORWARD REMINDERS for Task 14 (LAST TASK — e2e + README):
  - Task 12's review already ran Task 14's ACTUAL selectors against the live DOM and all passed (both tabs count 1, deep link,
    aria-selected, controls.count()>3, the title link inside h2). Re-checked after Task 12's banner was added.
  - Task 14's test 2 clicks "Use my location", which only renders while no location is chosen — needs a FRESH context per test
    (Task 14 already uses one). Do not let it inherit localStorage.
  - MUST await the category option before selecting it (Ruling 50) — options arrive a tick after first paint.
  - The wizard FLAKES under coordinate-based Playwright clicks (page scrolls as the error paragraph appears and the map resizes);
    use an in-page DOM dispatch rather than a hit-tested click.
  - vitest globals:false -> any new component test needs explicit cleanup() (not relevant to Playwright, but is for unit tests).

Task 13: MERGED by user as 117afac (PR #13). Local branch deleted.
Task 14: dispatched (opus — FINAL task; 3 Playwright specs against a real stack plus the README, which is the only artefact a
  new contributor reads) at BASE 117afac on branch task-14-e2e-readme.
  PRE-DISPATCH AUDIT: two of three carry-forwards are already handled by the brief — it opens a fresh context at line 97 for the
  cold-link check, and it uses role-based locators throughout rather than coordinate clicks (so Task 13's hit-test flake is
  avoided by construction). ONE GAP REMAINS: line 61 is
    await page.getByLabel(/category/i).selectOption("gathering");
  with no wait for the option to exist. That is exactly Ruling 50 — the category options arrive a tick after first paint, and in
  Task 13 this produced 'Value "funeral" not found in options' five times against the brief's own component. Dispatch requires
  awaiting the option.
Task 14: implementer DONE_WITH_CONCERNS — commit aff14aa. CONTROLLER-VERIFIED:
  - I ran the e2e suite MYSELF twice against the live stack: 4 passed both times (4.4s, 4.1s), exit 0, no flake. Combined with the
    implementer's 11 runs (retries: 0) that is 13 clean runs. It also verified the suite FAILS honestly with the API down —
    3 of 4 fail at the category guard with a message naming the cause.
  - 184/184 tests matching the exact pre-task baseline (contracts 20, api 60, web 104), typecheck 4/4, build 3/3.
  - README documents both traps I asked for (TS 6.0.2 pin x2 mentions, drizzle-kit patch x2) and it verified the patch fails
    loudly by actually deleting patches/.
  Ruling 57 (Task 14, nothing in the repo loaded .env — ACCEPTED): the README's documented flow
  `cp .env.example .env && pnpm dev` COULD NEVER HAVE WORKED. I verified: the pre-task dev script was bare `nest start --watch`,
  and neither dotenv nor @nestjs/config is a dependency anywhere in the repo. Every prior task (including my own verification
  runs) passed the vars inline, so the documented path had never once been executed. Fix is one line:
  `nest start --watch --env-file ../../.env`. Shell vars still take precedence (node's documented behaviour, verified), so no
  earlier flow breaks. Sharp detail it found: `--env-file-if-exists` is ACCEPTED by the Nest CLI and silently DROPPED — only
  --env-file is forwarded — so a missing .env now gives `node: ../../.env: not found` rather than the config error. Accepted;
  that is a better failure than a silently unloaded env.
  Ruling 58 (Task 14, the brief's third test was wrong AND vacuous — ACCEPTED): `expect(controls.count()).toBeGreaterThan(3)`
  got exactly 3, because the wizard shows ONE STEP AT A TIME and step 1 renders a select, an input and a button. Bumping to >2
  would have gone green while still not testing its own name — counting controls passes even if Tab never reaches them and Enter
  never submits. It rewrote the test to complete all four steps BY KEYBOARD ALONE and assert a published notice, and split the
  "reachable and labelled" half into a FOURTH test auditing every control's accessible name per step. Suite is 4 tests, not 3.
  That is the right call: it fixed the assertion's honesty rather than its threshold.
  Two real browser behaviours it found by probing and documented in-file: on macOS ArrowDown opens a <select> without committing
  (typing the first letter commits), and typing digits into datetime-local runs across segment boundaries — "25122026" produced
  the year 202614 — so it fills with arrow keys per segment and asserts the resulting value is in the future.
  Ruling 59 (Task 14, following its own README found a SECOND missing step — ACCEPTED): on a clean clone `pnpm dev` brought up
  only the web server, dying with `TS2307: Cannot find module '@jiwar/contracts'` because packages/contracts/dist does not exist
  yet. Its warm working copy hid this entirely. Added `pnpm build` to the setup block WITH the error a contributor would see, then
  re-ran the whole flow in a clean /tmp clone: all servers up, /api/docs 200, Vite proxy working, e2e 4/4. This is exactly why I
  asked it to follow its own README from a clean shell rather than proofread it — proofreading would never have caught either
  missing step.
  Trap 1 (the category race) CLOSED and PROVEN load-bearing rather than assumed: with the categories response delayed, 0 options
  exist at first paint and the brief's unguarded selectOption TIMES OUT, while the guarded version succeeds.
  Also unlike Task 13, this suite runs on Playwright's own pinned chromium (1243) with no channel override.
Task 14: complete (commit aff14aa, e2e 4/4 over 13 total clean runs, 0 minors deferred)
Task 14: PR #14 opened https://github.com/gmerwan/jiwar/pull/14 — STOPPED, awaiting user merge.
ALL 14 TASKS IMPLEMENTED. After this merge the remaining SDD step is the FINAL WHOLE-BRANCH REVIEW on the most capable model,
  pointed at the deferred-minor and parked lists below, then finishing-a-development-branch.

FINAL WHOLE-BRANCH REVIEW (opus) complete. 2 MUST-FIX, 9 SHOULD-FIX, rest fine to leave. Privacy clean, no SQL injection.
  Ruling 60 (final review, M1 — CONFIRMED WORSE THAN RECORDED): I verified CreateNoticeSchema myself and lat: null, "" AND
  false AND [] all parse as lat=0 (only "abc" is rejected). Number([]) === 0 and Number([""]) === 0, which is why an array slips
  through — a case none of the three earlier Null Island rulings had identified. The reviewer posted all four to the live API and
  got 201 with rows at (0,0) that are then RETURNED by a search. So the picker guard really is the only defence, and it does not
  cover a non-browser client at all.
  Ruling 61 (final review, M2 — CONFIRMED, and this is the one dangerous item): I called loadConfig() directly. A 1-character
  COOKIE_SECRET BOOTS. The shipped .env.example placeholder BOOTS. Only an empty string throws. The reviewer cracked a 1-char
  secret in <=62 tries and reproduced a valid forged cookie for a victim's uuid — i.e. cancel someone else's notice. The cookie IS
  authorship, so the default posture is unsafe.
  Ruling 62 (final review, S1 — ACCEPTED as a genuine SPEC MISS, not polish): spec line 217 promises "every view — including a
  filtered map at a chosen radius — is a shareable link". I verified Home.tsx reads only view/when/sort/category from
  searchParams; lat/lng/radiusKm live in localStorage. So a shared /?view=map link drops a fresh recipient on "choose a location"
  with no map, no radius, no origin. The two most load-bearing parts of the promise are the two that are missing.
  Ruling 63 (final review, S8 — CONFIRMED): the "184/184" headline is inflated. packages/contracts has no vitest include, so
  `vitest list` shows dist/notice.test.js and dist/search.test.js alongside src/ — 10 real tests counted twice. api and web
  correctly scope to src/. Real total ~174. Also confirmed: `pnpm lint` is a no-op that FAILS (no eslint installed anywhere), so
  this project has never had linting despite declaring a lint task.
  FIX WAVE dispatched on branch final-review-fixes: M1 + M2 + S3 (NUL body) + S8 + S9. Deliberately NOT in the wave: S1 (spec miss,
  but a feature-shaped change the owner should scope), S2 (needs a throttler dependency), S4-S7 (deploy decisions and UX polish).
FIX WAVE complete — commit 73eee15 on final-review-fixes. CONTROLLER-VERIFIED:
  - Ruling 60 CLOSED: my own probe now shows lat null/""/false/[] ALL REJECTED while 36.75 still parses. Live API confirms
    all four blank bodies 400 (were 201), genuine 0,0 still 201.
  - Ruling 61 CLOSED: 1-char secret THROWS "COOKIE_SECRET is too short: 1 character(s)"; the shipped placeholder THROWS
    "still the placeholder value shipped"; a 40-char secret boots; empty still throws.
  - Fix 3: NUL title -> 400 "title: must not contain a NUL byte". Log after a full probe run is 3.5KB with ZERO
    invalid-byte-sequence/PostgresError hits, so the log-amplification vector is gone, not just the status code.
  - Fix 4: vitest list shows 0 dist/ tests; include scoped to src/**/*.test.ts with a comment explaining why.
  - Fix 5: lint task removed from turbo.json; README now documents that no linter is set up.
  - Gates: test 254 (contracts 81, api 69, web 104), typecheck 4/4, build 3/3, test:int 138/138, e2e 4/4 on BOTH my runs.
  Ruling 64 (final review, MY Fix-5 finding was WRONG — corrected by the implementer, verified by me): I told the user
  `pnpm lint` FAILS repo-wide with "Command eslint not found". That error comes from `rtk` 0.49.0 at /opt/homebrew/bin/rtk,
  a local CLI proxy on this machine, NOT from the repo. I verified: pre-fix turbo.json declared `"lint": {}` but NO package
  declared a lint script, so turbo had nothing to run and exited 0 with "No tasks were executed". The task was a silent no-op,
  not a failure. Removing it is still right — a gate that returns green having checked nothing is worse in CI than one that
  fails loudly — but my characterisation to the user was wrong and the README now says the accurate thing.
  Ruling 65 (final review, safeExtend — ACCEPTED): Fix 3 needed `safeExtend`, which zod 4 names in the very error that made
  Task 8 park this ("Cannot overwrite keys on object schemas containing refinements"). The consent .refine() is re-applied to
  the extended object with a test pinning that it still fires, and the Swagger request body is verified UNCHANGED — the
  looseObject().pipe() wrapper Task 8 rejected would have collapsed it. So the parked blocker had a solution the whole time.
  Ruling 66 (final review, keep the redundant query guard — ACCEPTED): SearchNoticesQuerySchema is now partly redundant with the
  contract fix but was kept as instructed. It still earns its place: its .meta() is what keeps lat/lng rendering as bounded
  numbers in /api/docs through the z.unknown() pipe, its message is field-specific where the contract's is generic, and its
  categories NUL guard is untouched. Dropping the redundant half is a safe separate cleanup, not this wave's job.
  Disclosed side effect, accepted: rotating this machine's gitignored .env to a fresh 64-char secret INVALIDATES existing local
  participant cookies, so dev notices published from this browser earlier can no longer be cancelled from it. Inherent to key
  rotation; dev data only.
  Three tripwires fired as designed: two integration tests and one unit test named "documents the contract bug it exists to fix"
  had pinned these as known gaps and failed when the gaps closed. All three inverted to assert the new behaviour.
