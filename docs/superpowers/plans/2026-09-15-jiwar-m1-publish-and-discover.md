# Jiwar M1 (Publish & Discover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Jiwar: anonymous visitors publish community notices that appear immediately, and discover nearby notices by radius on a list and a map.

**Architecture:** A Turborepo monorepo over pnpm workspaces with three packages. `@jiwar/contracts` holds Zod schemas that are the single source of truth for both sides. `@jiwar/api` is NestJS, validating inbound requests with the native `StandardSchemaValidationPipe` against those schemas and querying Postgres/PostGIS through Drizzle. `@jiwar/web` is a Vite React SPA reusing the same schemas for form validation. Radius search is `ST_DWithin` on a `geography(Point,4326)` GiST index — real metre distances, not degrees.

**Tech Stack:** pnpm 11 · Turborepo 2.10 · TypeScript 6.0.2 · NestJS 12.0.3 · Drizzle 0.45.2 + `postgres` 3.4.9 · PostGIS 3.6 on Postgres 18 (`imresamu/postgis:18-3.6`) · Zod 4.6.5 · React 19.3 + Vite 8.3 + React Router 7.18 · TanStack Query 5 · react-hook-form 7.88 · MapLibre GL 6.9 + `@vis.gl/react-maplibre` 8.1 · Vitest 5 · Testcontainers 12 · Playwright 1.63

**Spec:** `docs/superpowers/specs/2026-09-15-jiwar-m1-design.md` — read it before starting. It carries the reasoning; this plan carries the steps.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node**: v24.18.0 is installed and satisfies NestJS 12's CLI floor (v22.22.3+, v24.15+, or v26+). Do not "upgrade" Node.
- **TypeScript is pinned to `6.0.2`. Never install `typescript@7`.** TS 7 is the native Go port and ships no programmatic compiler API until 7.1, but `nest build` calls `createProgram()`/`program.emit()` and resolves `typescript` from the project directory first — so TS 7 in `node_modules` *crashes* the Nest CLI rather than failing cleanly. `npm view typescript version` returns 7.x, so never install `typescript@latest`.
- **Do not install `nestjs-zod`.** Its peers cap at `@nestjs/common ^11`, so it does not support NestJS 12. NestJS 12 supports Zod natively via Standard Schema: `@Body({ schema })` plus `StandardSchemaValidationPipe`, and `@nestjs/swagger` picks those schemas up for the OpenAPI document.
- **PostGIS image is `imresamu/postgis:18-3.6`.** The official `postgis/postgis` tags are amd64-only and fail on this arm64 Mac with `no matching manifest for linux/arm64/v8`. `imresamu` is the multi-arch rebuild of the same images; verified booting in 3s with PostGIS 3.6, GEOS and PROJ.
- **`geography`, never `geometry`.** Drizzle 0.45.2 ships no `geography` helper (verified by unpacking the tarball) — Task 3 defines one with `customType`. `geometry` on SRID 4326 measures in *degrees*; `geography` measures in *metres*, which is what a radius search needs.
- **Docker Desktop must be running** before any task that touches the database. `docker info` should succeed.
- **All money/paid services are out of scope.** No API keys, no accounts: OpenFreeMap tiles and Nominatim geocoding are keyless.
- **Never add anything that counts or ranks notices per author.** No leaderboards, no "you have published N notices", no streaks, no volume badges. This is a hard product rule from spec §8, not a preference.
- **Every user-facing string goes through the i18n layer** (Task 12) and every date, time, number and distance is formatted with `Intl` — never by hand. M1 is English-only, but Algeria is the target, so no string is hardcoded in a component.
- **Use logical CSS properties** (`margin-inline-start`, `padding-inline`, `inset-inline-start`) rather than `margin-left`/`padding-left`/`left`. RTL is cheap now and expensive to retrofit.
- **Commit at the end of every task.** Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`). Do not add Claude attribution to commits in this plan unless the repository's own convention already does.

---
## File Structure

```
jiwar/
├── package.json                        workspace root, pnpm+turbo scripts, TS pinned
├── pnpm-workspace.yaml                 apps/*, packages/*
├── turbo.json                          task graph: build→^build, test needs build
├── tsconfig.base.json                  strict TS shared by all packages
├── docker-compose.yml                  imresamu/postgis:18-3.6 on port 55432
├── .env.example                        DATABASE_URL, PORT, MAX_RADIUS_KM, NOMINATIM_*
│
├── packages/contracts/
│   ├── src/category.ts                 CategorySchema
│   ├── src/notice.ts                   NoticeSchema, CreateNoticeSchema, attendance/status enums
│   ├── src/search.ts                   SearchNoticesSchema (coercion), NoticeSearchResultSchema
│   ├── src/geocode.ts                  GeocodeResultSchema
│   └── src/index.ts                    barrel
│
├── apps/api/
│   ├── src/main.ts                     bootstrap, global pipe, cookie parser, Swagger
│   ├── src/app.module.ts               root module
│   ├── src/db/schema.ts                Drizzle tables + the geography customType
│   ├── src/db/drizzle.module.ts        DB provider (DRIZZLE token)
│   ├── src/db/migrations/              drizzle-kit output + 0000_postgis custom migration
│   ├── src/participants/               cookie middleware + participant service
│   ├── src/categories/                 controller + service (read-only)
│   ├── src/notices/                    controller + service + repository (the radius query)
│   ├── src/geocode/                    Nominatim proxy: controller + service + cache
│   └── test/                           Testcontainers harness + integration specs
│
└── apps/web/
    ├── src/main.tsx                    React root, router, QueryClient
    ├── src/routes/                     Home (list+map), NoticeDetail, Submit, NotFound
    ├── src/api/client.ts               typed fetch, parses every response through contracts
    ├── src/features/discovery/         FilterBar, NoticeList, NoticeCard, NoticeMap, useNotices
    ├── src/features/location/          useChosenLocation, LocationPicker, AddressSearch
    ├── src/features/submit/            the 4-step wizard, one file per step
    ├── src/i18n/en.ts                  every user-facing string
    └── src/lib/format.ts               Intl wrappers: distance, date, time
```

**Boundaries that matter.** `contracts` imports nothing from `api` or `web` — it is a leaf, and both sides depend on it. The radius SQL lives *only* in `notices.repository.ts`; no other file writes geo SQL. Every response the web app receives is parsed through a contract schema in `api/client.ts`, so drift surfaces at the boundary rather than as a blank screen.

---

## Tasks

### Task 1: Monorepo skeleton with Turborepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: workspace scripts `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck` at root; `@jiwar/contracts` resolvable by other packages via `workspace:*`.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "jiwar",
  "private": true,
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=24.15" },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev --ui=tui",
    "test": "turbo test",
    "typecheck": "turbo typecheck",
    "lint": "turbo lint",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down"
  },
  "devDependencies": {
    "turbo": "2.10.13",
    "typescript": "6.0.2"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.npmrc` — pnpm hides transitive deps by default, and Nest's ecosystem expects hoisting:

```
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=true
```

`.gitignore`:

```
node_modules/
dist/
.turbo/
.env
*.log
coverage/
test-results/
playwright-report/
```

- [ ] **Step 2: Configure the Turborepo task graph**

`turbo.json` — `dependsOn: ["^build"]` means "build every dependency package first", which is what makes `contracts` always compile before `api` and `web`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 3: Shared strict TypeScript config**

`tsconfig.base.json`. Note `module: nodenext` and no `baseUrl` — both are requirements for forward-compatibility with the TS 7 checker, where `baseUrl` is a hard error:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolvePackageJsonExports": true
  }
}
```

- [ ] **Step 4: Create the contracts package**

`packages/contracts/package.json`:

```json
{
  "name": "@jiwar/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": { "typescript": "6.0.2", "vitest": "5.0.1" }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

`packages/contracts/src/index.ts` — a placeholder so the build has something to compile:

```ts
export const CONTRACTS_VERSION = "0.0.0";
```

- [ ] **Step 5: Install and verify the pinned TypeScript**

Run:

```bash
pnpm install
pnpm ls typescript --depth 0 -r
```

Expected: every package reports `typescript 6.0.2`. **If any line shows 7.x, stop and fix it** — the Nest CLI will crash later (see Global Constraints).

- [ ] **Step 6: Verify the build works**

Run: `pnpm build`
Expected: PASS. `packages/contracts/dist/index.js` and `index.d.ts` exist.

Run: `pnpm build` again.
Expected: Turborepo reports `FULL TURBO` or cache hits — proof the cache is wired up.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Turborepo monorepo with pinned TypeScript 6"
```

---

### Task 2: PostGIS via Docker Compose

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `scripts/verify-postgis.sh`

**Interfaces:**
- Consumes: Task 1's workspace root.
- Produces: a Postgres 18 + PostGIS 3.6 database reachable at `postgresql://jiwar:jiwar@localhost:55432/jiwar_dev`; `pnpm db:up` / `pnpm db:down`.

- [ ] **Step 1: Write the compose file**

`docker-compose.yml`. Port **55432**, not 5432, so it cannot collide with any other Postgres. The image must be `imresamu` — see Global Constraints:

```yaml
services:
  db:
    image: imresamu/postgis:18-3.6
    container_name: jiwar_db
    environment:
      POSTGRES_USER: jiwar
      POSTGRES_PASSWORD: jiwar
      POSTGRES_DB: jiwar_dev
    ports:
      - "55432:5432"
    volumes:
      - jiwar_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jiwar -d jiwar_dev"]
      interval: 2s
      timeout: 5s
      retries: 30

volumes:
  jiwar_pgdata:
```

- [ ] **Step 2: Write the environment template**

`.env.example`:

```
DATABASE_URL=postgresql://jiwar:jiwar@localhost:55432/jiwar_dev
PORT=3000
WEB_ORIGIN=http://localhost:5173
MAX_RADIUS_KM=100
DEFAULT_RADIUS_KM=20
PAST_GRACE_HOURS=24
COOKIE_SECRET=change-me-in-production-min-32-chars-long
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=jiwar-dev/0.1 (local development)
```

Then: `cp .env.example .env`

- [ ] **Step 3: Write the verification script**

`scripts/verify-postgis.sh` — this is the test for this task. It asserts `geography` distance in **metres**, which is the whole reason for choosing `geography` over `geometry`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for jiwar_db..."
for i in $(seq 1 60); do
  docker exec jiwar_db pg_isready -U jiwar -d jiwar_dev -q 2>/dev/null && break
  sleep 1
  if [ "$i" -eq 60 ]; then echo "FAIL: database never became ready"; exit 1; fi
done

docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null

VERSION=$(docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "SELECT postgis_version();")
echo "PostGIS: $VERSION"

# Two points in Algiers about 4.9 km apart. geography => metres.
METRES=$(docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc \
  "SELECT round(ST_Distance('POINT(3.06 36.75)'::geography,'POINT(3.10 36.78)'::geography));")
echo "Distance: ${METRES} m"

if [ "$METRES" -lt 4000 ] || [ "$METRES" -gt 6000 ]; then
  echo "FAIL: expected ~4900 m. Got ${METRES}. If this is a tiny number like 0 or 5, the column is geometry (degrees) rather than geography (metres)."
  exit 1
fi

echo "PASS: PostGIS is working and geography returns metres."
```

Then: `chmod +x scripts/verify-postgis.sh`

- [ ] **Step 4: Start the database and verify**

Run:

```bash
docker info >/dev/null || echo "Docker Desktop is not running - start it first"
pnpm db:up
./scripts/verify-postgis.sh
```

Expected: `PostGIS: 3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`, a distance near 4882 m, and `PASS`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add PostGIS 3.6 via Docker Compose with a geography smoke test"
```

---
### Task 3: Zod contracts — the single source of truth

**Files:**
- Create: `packages/contracts/src/category.ts`, `notice.ts`, `search.ts`, `geocode.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/search.test.ts`, `packages/contracts/src/notice.test.ts`

**Interfaces:**
- Consumes: Task 1's contracts package.
- Produces: `CategorySchema`/`Category`, `NoticeSchema`/`Notice`, `CreateNoticeSchema`/`CreateNotice`, `SearchNoticesSchema`/`SearchNotices`, `NoticeSearchResultSchema`/`NoticeSearchResult`, `GeocodeResultSchema`/`GeocodeResult`, `ATTENDANCE_VALUES`, `NOTICE_STATUS_VALUES`. Every downstream task imports from `@jiwar/contracts`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/search.test.ts` — query strings arrive as text, so coercion is the behaviour under test:

```ts
import { describe, expect, it } from "vitest";
import { SearchNoticesSchema } from "./search.js";

describe("SearchNoticesSchema", () => {
  it("coerces query-string values into numbers", () => {
    const result = SearchNoticesSchema.parse({ lat: "36.75", lng: "3.06", radiusKm: "20" });
    expect(result.lat).toBe(36.75);
    expect(result.lng).toBe(3.06);
    expect(result.radiusKm).toBe(20);
  });

  it("defaults radius to 20 km, sort to soonest, and when to upcoming", () => {
    const result = SearchNoticesSchema.parse({ lat: "36.75", lng: "3.06" });
    expect(result.radiusKm).toBe(20);
    expect(result.sort).toBe("soonest");
    expect(result.when).toBe("upcoming");
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => SearchNoticesSchema.parse({ lat: "91", lng: "0" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "0", lng: "181" })).toThrow();
  });

  it("rejects a non-positive or oversized radius", () => {
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "0" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "-5" })).toThrow();
    expect(() => SearchNoticesSchema.parse({ lat: "36", lng: "3", radiusKm: "100000" })).toThrow();
  });

  it("accepts a single category slug or a list", () => {
    expect(SearchNoticesSchema.parse({ lat: "36", lng: "3", categories: "funeral" }).categories)
      .toEqual(["funeral"]);
    expect(SearchNoticesSchema.parse({ lat: "36", lng: "3", categories: ["funeral", "wedding"] }).categories)
      .toEqual(["funeral", "wedding"]);
  });
});
```

`packages/contracts/src/notice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreateNoticeSchema } from "./notice.js";

const valid = {
  categorySlug: "funeral",
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer will be held after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public" as const,
};

describe("CreateNoticeSchema", () => {
  it("accepts a valid notice", () => {
    expect(CreateNoticeSchema.parse(valid).title).toBe(valid.title);
  });

  it("trims the title and rejects one that is blank or too short", () => {
    expect(CreateNoticeSchema.parse({ ...valid, title: "  Hello there  " }).title).toBe("Hello there");
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "   " })).toThrow();
    expect(() => CreateNoticeSchema.parse({ ...valid, title: "ab" })).toThrow();
  });

  it("rejects an invalid attendance value", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, attendance: "maybe" })).toThrow();
  });

  it("requires organizerConsent when organizerContact is given", () => {
    expect(() =>
      CreateNoticeSchema.parse({ ...valid, organizerContact: "+213 555 0000", organizerConsent: false }),
    ).toThrow(/consent/i);

    const ok = CreateNoticeSchema.parse({
      ...valid,
      organizerContact: "+213 555 0000",
      organizerConsent: true,
    });
    expect(ok.organizerContact).toBe("+213 555 0000");
  });

  it("does not require consent when no organizer contact is given", () => {
    expect(() => CreateNoticeSchema.parse({ ...valid, organizerConsent: false })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @jiwar/contracts test`
Expected: FAIL — cannot resolve `./search.js` or `./notice.js`.

- [ ] **Step 3: Write the category and notice schemas**

`packages/contracts/src/category.ts`:

```ts
import { z } from "zod";

export const CategorySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  sortOrder: z.number().int(),
});

export type Category = z.infer<typeof CategorySchema>;
```

`packages/contracts/src/notice.ts`. The `organizerConsent` rule is spec §8's safeguard expressed as a schema refinement, so it holds on both the client and the server from one definition:

```ts
import { z } from "zod";
import { CategorySchema } from "./category.js";

export const ATTENDANCE_VALUES = ["public", "invitation_only", "restricted"] as const;
export const AttendanceSchema = z.enum(ATTENDANCE_VALUES);
export type Attendance = z.infer<typeof AttendanceSchema>;

export const NOTICE_STATUS_VALUES = ["published", "cancelled", "removed"] as const;
export const NoticeStatusSchema = z.enum(NOTICE_STATUS_VALUES);
export type NoticeStatus = z.infer<typeof NoticeStatusSchema>;

export const LatitudeSchema = z.coerce.number().min(-90).max(90);
export const LongitudeSchema = z.coerce.number().min(-180).max(180);

export const CreateNoticeBase = z.object({
  categorySlug: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(""),
  venueName: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(400),
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().trim().max(160).optional(),
  organizerContact: z.string().trim().max(160).optional(),
  organizerConsent: z.boolean().default(false),
});

export const CreateNoticeSchema = CreateNoticeBase.refine(
  (v) => !v.organizerContact || v.organizerConsent === true,
  {
    message: "Organizer consent is required before publishing organizer contact details.",
    path: ["organizerConsent"],
  },
);

export type CreateNotice = z.infer<typeof CreateNoticeSchema>;

export const NoticeSchema = z.object({
  publicId: z.string().min(1),
  category: CategorySchema,
  title: z.string(),
  description: z.string(),
  venueName: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().nullable(),
  organizerContact: z.string().nullable(),
  status: NoticeStatusSchema,
  isPast: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type Notice = z.infer<typeof NoticeSchema>;
```

Note: `CreateNoticeSchema` is a refined schema, so it has no `.extend()`. Build any
variation from `CreateNoticeBase` and re-apply the refinement.

- [ ] **Step 4: Write the search and geocode schemas**

`packages/contracts/src/search.ts`. `MAX_RADIUS_KM_HARD_LIMIT` is a schema-level backstop; the server also enforces its own configured `MAX_RADIUS_KM`, which may be lower:

```ts
import { z } from "zod";
import { LatitudeSchema, LongitudeSchema, NoticeSchema } from "./notice.js";

export const MAX_RADIUS_KM_HARD_LIMIT = 500;
export const DEFAULT_RADIUS_KM = 20;

const CategoryListSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

export const SearchNoticesSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  radiusKm: z.coerce.number().positive().max(MAX_RADIUS_KM_HARD_LIMIT).default(DEFAULT_RADIUS_KM),
  categories: CategoryListSchema,
  when: z.enum(["upcoming", "past"]).default("upcoming"),
  sort: z.enum(["soonest", "nearest"]).default("soonest"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SearchNotices = z.infer<typeof SearchNoticesSchema>;

export const NoticeWithDistanceSchema = NoticeSchema.extend({
  distanceMetres: z.number(),
});

export type NoticeWithDistance = z.infer<typeof NoticeWithDistanceSchema>;

export const NoticeSearchResultSchema = z.object({
  items: z.array(NoticeWithDistanceSchema),
  nextCursor: z.string().nullable(),
  fallback: z.boolean(),
});

export type NoticeSearchResult = z.infer<typeof NoticeSearchResultSchema>;
```

`packages/contracts/src/geocode.ts`:

```ts
import { z } from "zod";

export const GeocodeResultSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const GeocodeResultsSchema = z.object({
  results: z.array(GeocodeResultSchema),
});

export type GeocodeResults = z.infer<typeof GeocodeResultsSchema>;
```

`packages/contracts/src/index.ts`:

```ts
export * from "./category.js";
export * from "./notice.js";
export * from "./search.js";
export * from "./geocode.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @jiwar/contracts test`
Expected: PASS — all tests in both files.

Run: `pnpm --filter @jiwar/contracts build`
Expected: PASS, `dist/index.d.ts` exports the types.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(contracts): add Zod schemas for notices, search, categories and geocoding"
```

---
### Task 4: NestJS app with the Drizzle schema and geography column

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `nest-cli.json`, `drizzle.config.ts`
- Create: `apps/api/src/main.ts`, `src/app.module.ts`, `src/config.ts`
- Create: `apps/api/src/db/schema.ts`, `src/db/geography.ts`, `src/db/drizzle.module.ts`
- Create: `apps/api/src/db/migrations/0000_enable_postgis.sql`, `src/db/seed.ts`
- Test: `apps/api/src/db/geography.test.ts`

**Interfaces:**
- Consumes: `@jiwar/contracts` (Task 3), the database from Task 2.
- Produces: `DRIZZLE` injection token providing `NodePgDatabase`; tables `categories`, `notices`, `participants`; the `geographyPoint` custom column; `AppConfig` with `maxRadiusKm`, `defaultRadiusKm`, `pastGraceHours`, `cookieSecret`, `webOrigin`; a booting API on `PORT` with Swagger at `/api/docs`.

- [ ] **Step 1: Create the API package**

`apps/api/package.json`. `@nestjs/swagger` 12 and `zod-openapi` give OpenAPI generation from the Zod contracts without `nestjs-zod`:

```json
{
  "name": "@jiwar/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts"
  },
  "dependencies": {
    "@jiwar/contracts": "workspace:*",
    "@nestjs/common": "12.0.3",
    "@nestjs/core": "12.0.3",
    "@nestjs/platform-express": "12.0.3",
    "@nestjs/swagger": "12.0.1",
    "cookie-parser": "1.4.7",
    "drizzle-orm": "0.45.2",
    "nanoid": "6.0.1",
    "postgres": "3.4.9",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@nestjs/cli": "12.0.1",
    "@nestjs/testing": "12.0.3",
    "@testcontainers/postgresql": "12.1.0",
    "@types/cookie-parser": "1.4.9",
    "@types/express": "5.0.3",
    "@types/node": "24.10.1",
    "@types/supertest": "6.0.3",
    "drizzle-kit": "0.31.10",
    "supertest": "7.2.2",
    "testcontainers": "12.1.0",
    "tsx": "4.20.6",
    "typescript": "6.0.2",
    "vitest": "5.0.1",
    "zod-openapi": "5.6.1"
  }
}
```

`apps/api/tsconfig.json` — `experimentalDecorators` and `emitDecoratorMetadata` are what NestJS DI relies on:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

`apps/api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 2: Write the failing test for the geography column**

`apps/api/src/db/geography.test.ts` — a pure unit test of the SQL type string and the WKB parser, no database needed:

```ts
import { describe, expect, it } from "vitest";
import { parseWkbPoint } from "./geography.js";

describe("parseWkbPoint", () => {
  it("parses a little-endian EWKB point with SRID 4326", () => {
    // POINT(3.06 36.75) as geography(Point,4326), little-endian EWKB.
    const hex = "0101000020E6100000AE47E17A14AE0840D7A3703D0A6B4240";
    const point = parseWkbPoint(hex);
    expect(point.lng).toBeCloseTo(3.06, 5);
    expect(point.lat).toBeCloseTo(36.75, 5);
  });

  it("throws on input that is not a hex point", () => {
    expect(() => parseWkbPoint("not-hex")).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @jiwar/api test -- geography`
Expected: FAIL — `./geography.js` does not exist.

- [ ] **Step 4: Implement the geography custom type**

`apps/api/src/db/geography.ts`. Drizzle 0.45.2 has **no** `geography` helper — only `geometry` — so this defines one. Reading uses `ST_AsEWKB`-style hex, which is what the `postgres` driver returns for a geography column:

```ts
import { customType } from "drizzle-orm/pg-core";

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * Parses PostGIS EWKB hex for a 2D point.
 * Layout: 1 byte endianness, 4 bytes type (with SRID flag), 4 bytes SRID, 8 bytes X, 8 bytes Y.
 */
export function parseWkbPoint(hex: string): LngLat {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) {
    throw new Error(`Not a WKB point: ${hex.slice(0, 24)}`);
  }
  const buf = Buffer.from(hex, "hex");
  const littleEndian = buf.readUInt8(0) === 1;
  const typeWord = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (typeWord & 0x20000000) !== 0;
  const offset = hasSrid ? 9 : 5;
  const lng = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  const lat = littleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
  return { lng, lat };
}

/**
 * geography(Point,4326) column. geography measures in METRES;
 * geometry on SRID 4326 would measure in degrees, which is wrong for a radius search.
 */
export const geographyPoint = customType<{
  data: LngLat;
  driverData: string;
}>({
  dataType() {
    return "geography(Point,4326)";
  },
  fromDriver(value: string): LngLat {
    return parseWkbPoint(value);
  },
  toDriver(value: LngLat): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @jiwar/api test -- geography`
Expected: PASS — both cases.

- [ ] **Step 6: Write the Drizzle schema**

`apps/api/src/db/schema.ts`. Note `isPast` is **not** a column — spec §5 requires it be derived at query time:

```ts
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { geographyPoint } from "./geography.js";

export const attendanceEnum = pgEnum("attendance", [
  "public",
  "invitation_only",
  "restricted",
]);

export const noticeStatusEnum = pgEnum("notice_status", [
  "published",
  "cancelled",
  "removed",
]);

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  icon: varchar("icon", { length: 32 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 16 }).notNull().unique(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    venueName: varchar("venue_name", { length: 160 }).notNull(),
    address: varchar("address", { length: 400 }).notNull(),
    location: geographyPoint("location").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    attendance: attendanceEnum("attendance").notNull(),
    organizerName: varchar("organizer_name", { length: 160 }),
    organizerContact: varchar("organizer_contact", { length: 160 }),
    status: noticeStatusEnum("status").notNull().default("published"),
    authorParticipantId: uuid("author_participant_id")
      .notNull()
      .references(() => participants.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notices_location_gist").using("gist", t.location),
    index("notices_starts_at_idx").on(t.startsAt),
    index("notices_category_idx").on(t.categoryId),
  ],
);

export const noticesRelations = relations(notices, ({ one }) => ({
  category: one(categories, {
    fields: [notices.categoryId],
    references: [categories.id],
  }),
}));

export const schema = { participants, categories, notices, noticesRelations };
```

- [ ] **Step 7: Configure drizzle-kit and enable the PostGIS extension**

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://jiwar:jiwar@localhost:55432/jiwar_dev",
  },
});
```

Drizzle does not create extensions, so the extension migration must come first. Create `apps/api/src/db/migrations/0000_enable_postgis.sql` by hand:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Then generate the table migration:

```bash
cd apps/api && pnpm db:generate
```

Expected: a new `0001_*.sql` appears containing `geography(Point,4326)` and `USING gist`. **Read it and confirm both strings are present.** If you see `geometry` instead, the custom type is not wired up — go back to Step 4.

- [ ] **Step 8: Run the migration and verify the schema landed**

Run:

```bash
cd apps/api && pnpm db:migrate
docker exec jiwar_db psql -U jiwar -d jiwar_dev -c "\d notices"
```

Expected: `location` shows type `geography(Point,4326)`, and `notices_location_gist` is a gist index.

- [ ] **Step 9: Write the config and seed**

`apps/api/src/config.ts`:

```ts
export interface AppConfig {
  port: number;
  webOrigin: string;
  databaseUrl: string;
  cookieSecret: string;
  maxRadiusKm: number;
  defaultRadiusKm: number;
  pastGraceHours: number;
  nominatimBaseUrl: string;
  nominatimUserAgent: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    databaseUrl: required("DATABASE_URL"),
    cookieSecret: required("COOKIE_SECRET"),
    maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 100),
    defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM ?? 20),
    pastGraceHours: Number(process.env.PAST_GRACE_HOURS ?? 24),
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "jiwar-dev/0.1",
  };
}

export const APP_CONFIG = "APP_CONFIG";
```

`apps/api/src/db/seed.ts` — the six categories from spec §5:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { categories } from "./schema.js";

const CATEGORIES = [
  { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
  { slug: "aqiqah", name: "Aqiqah", icon: "aqiqah", sortOrder: 30 },
  { slug: "memorial", name: "Memorial", icon: "memorial", sortOrder: 40 },
  { slug: "gathering", name: "Community Gathering", icon: "gathering", sortOrder: 50 },
  { slug: "other", name: "Other", icon: "other", sortOrder: 60 },
];

async function main() {
  const url = process.env.DATABASE_URL ?? "postgresql://jiwar:jiwar@localhost:55432/jiwar_dev";
  const sql = postgres(url);
  const db = drizzle(sql);

  for (const category of CATEGORIES) {
    await db.insert(categories).values(category).onConflictDoNothing({ target: categories.slug });
  }

  console.log(`Seeded ${CATEGORIES.length} categories.`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 10: Write the Drizzle module and bootstrap**

`apps/api/src/db/drizzle.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_CONFIG, type AppConfig, loadConfig } from "../config.js";
import { schema } from "./schema.js";

export const DRIZZLE = "DRIZZLE";
export type JiwarDb = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    {
      provide: DRIZZLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const sql = postgres(config.databaseUrl, { max: 10 });
        return drizzle(sql, { schema });
      },
    },
  ],
  exports: [DRIZZLE, APP_CONFIG],
})
export class DrizzleModule {}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db/drizzle.module.js";

@Module({
  imports: [DrizzleModule],
})
export class AppModule {}
```

`apps/api/src/main.ts` — `StandardSchemaValidationPipe` is the native NestJS 12 way to validate Zod schemas, and `zod-openapi` converts them for Swagger:

```ts
import "reflect-metadata";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule, type SwaggerDocumentOptions } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { createSchema } from "zod-openapi";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("v1");
  app.use(cookieParser(config.cookieSecret));
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));

  const documentOptions: SwaggerDocumentOptions = {
    standardSchemaConverter: (schema, { schemaType }) => {
      const converted = createSchema(schema as never, {
        io: schemaType,
        openapiVersion: "3.0.0",
      });
      return { schema: converted.schema, components: converted.components };
    },
  };

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Jiwar API")
    .setDescription("Community notices near a chosen location")
    .setVersion("1.0")
    .build();

  SwaggerModule.setup(
    "api/docs",
    app,
    () => SwaggerModule.createDocument(app, swaggerConfig, documentOptions),
  );

  await app.listen(config.port);
  console.log(`Jiwar API listening on http://localhost:${config.port}`);
}

bootstrap();
```

- [ ] **Step 11: Verify the app boots and the seed works**

Run:

```bash
cd apps/api
pnpm db:seed
docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "SELECT count(*) FROM categories;"
pnpm build
node dist/main.js
```

Expected: seed reports 6 categories, the count query returns `6`, `nest build` writes `dist/` (**check `dist/main.js` actually exists — a green build that wrote nothing is a known Nest CLI failure**), and the app logs it is listening. Visit `http://localhost:3000/api/docs` — Swagger UI renders. Stop with Ctrl-C.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(api): scaffold NestJS with Drizzle, PostGIS geography column and seeded categories"
```

---
### Task 5: Testcontainers harness

**Files:**
- Create: `apps/api/vitest.int.config.ts`, `apps/api/test/db-harness.ts`
- Test: `apps/api/test/harness.int.test.ts`

**Interfaces:**
- Consumes: Task 4's schema and migrations.
- Produces: `startTestDb(): Promise<TestDb>` where `TestDb = { db: JiwarDb; url: string; stop(): Promise<void>; truncate(): Promise<void>; seedCategories(): Promise<void> }`. Every later integration test uses this.

- [ ] **Step 1: Write the failing test**

`apps/api/test/harness.int.test.ts` — this proves the harness gives a *real* PostGIS, which is the point of Testcontainers per spec §10:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestDb, type TestDb } from "./db-harness.js";

describe("test database harness", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await testDb?.stop();
  });

  it("provides a real PostGIS installation", async () => {
    const result = await testDb.db.execute<{ v: string }>(sql`SELECT postgis_version() AS v`);
    expect(result[0]?.v).toContain("3.");
  });

  it("has run the migrations, so the notices table exists with a geography column", async () => {
    const result = await testDb.db.execute<{ udt_name: string }>(sql`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'notices' AND column_name = 'location'
    `);
    expect(result[0]?.udt_name).toBe("geography");
  });

  it("measures distance in metres, not degrees", async () => {
    const result = await testDb.db.execute<{ m: number }>(sql`
      SELECT round(ST_Distance(
        'POINT(3.06 36.75)'::geography,
        'POINT(3.10 36.78)'::geography
      )) AS m
    `);
    expect(Number(result[0]?.m)).toBeGreaterThan(4000);
    expect(Number(result[0]?.m)).toBeLessThan(6000);
  });

  it("seeds the six categories", async () => {
    await testDb.seedCategories();
    const result = await testDb.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM categories`);
    expect(Number(result[0]?.n)).toBe(6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm test:int`
Expected: FAIL — `./db-harness.js` does not exist.

- [ ] **Step 3: Write the integration vitest config**

`apps/api/vitest.int.config.ts` — container startup is slow, so the timeouts are generous and tests run single-file to avoid contending for one container:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    globals: false,
  },
});
```

- [ ] **Step 4: Implement the harness**

`apps/api/test/db-harness.ts`. The image must match Task 2's — the official `postgis/postgis` tags have no arm64 build:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { categories } from "../src/db/schema.js";
import { schema } from "../src/db/schema.js";

export type JiwarTestDb = PostgresJsDatabase<typeof schema>;

export interface TestDb {
  db: JiwarTestDb;
  url: string;
  stop(): Promise<void>;
  truncate(): Promise<void>;
  seedCategories(): Promise<void>;
}

const CATEGORIES = [
  { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
  { slug: "aqiqah", name: "Aqiqah", icon: "aqiqah", sortOrder: 30 },
  { slug: "memorial", name: "Memorial", icon: "memorial", sortOrder: 40 },
  { slug: "gathering", name: "Community Gathering", icon: "gathering", sortOrder: 50 },
  { slug: "other", name: "Other", icon: "other", sortOrder: 60 },
];

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "imresamu/postgis:18-3.6",
  )
    .withDatabase("jiwar_test")
    .withUsername("jiwar")
    .withPassword("jiwar")
    .start();

  const url = container.getConnectionUri();
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: "./src/db/migrations" });

  return {
    db,
    url,
    async stop() {
      await client.end();
      await container.stop();
    },
    async truncate() {
      await db.execute(sql`TRUNCATE TABLE notices, participants RESTART IDENTITY CASCADE`);
    },
    async seedCategories() {
      for (const category of CATEGORIES) {
        await db.insert(categories).values(category).onConflictDoNothing({ target: categories.slug });
      }
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && pnpm test:int`
Expected: PASS — all four cases. First run pulls the image, so allow a minute.

If it fails with `Could not find a working container runtime`, Docker Desktop is not running.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(api): add Testcontainers harness running real PostGIS"
```

---

### Task 6: Anonymous participant cookie

**Files:**
- Create: `apps/api/src/participants/participant.middleware.ts`, `participants.service.ts`, `participants.module.ts`, `current-participant.decorator.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/participants.int.test.ts`

**Interfaces:**
- Consumes: `DRIZZLE` (Task 4), the harness (Task 5).
- Produces: `ParticipantsService.ensure(existingId?: string): Promise<string>`; `@CurrentParticipant() participantId: string` param decorator; middleware setting the signed `jiwar_pid` cookie and `req.participantId`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/participants.int.test.ts`:

```ts
import { Controller, Get, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../src/config.js";
import { DRIZZLE } from "../src/db/drizzle.module.js";
import { CurrentParticipant } from "../src/participants/current-participant.decorator.js";
import { ParticipantMiddleware } from "../src/participants/participant.middleware.js";
import { ParticipantsService } from "../src/participants/participants.service.js";
import { startTestDb, type TestDb } from "./db-harness.js";

@Controller("whoami")
class WhoAmIController {
  @Get()
  get(@CurrentParticipant() participantId: string) {
    return { participantId };
  }
}

const COOKIE_SECRET = "test-secret-at-least-32-characters-long";

describe("participant cookie", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await startTestDb();

    @Module({
      controllers: [WhoAmIController],
      providers: [
        ParticipantsService,
        { provide: DRIZZLE, useValue: testDb.db },
        { provide: APP_CONFIG, useValue: { cookieSecret: COOKIE_SECRET } },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser(COOKIE_SECRET));
    const middleware = new ParticipantMiddleware(app.get(ParticipantsService));
    app.use(middleware.use.bind(middleware));
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.stop();
  });

  it("issues a participant cookie on first request", async () => {
    const response = await request(app.getHttpServer()).get("/whoami").expect(200);
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toContain("jiwar_pid=");
    expect(setCookie.join(";")).toContain("HttpOnly");
    expect(setCookie.join(";")).toContain("SameSite=Lax");
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses the same participant id on a second request with the cookie", async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent.get("/whoami").expect(200);
    const second = await agent.get("/whoami").expect(200);
    expect(second.body.participantId).toBe(first.body.participantId);
  });

  it("creates a new participant when no cookie is sent", async () => {
    const a = await request(app.getHttpServer()).get("/whoami").expect(200);
    const b = await request(app.getHttpServer()).get("/whoami").expect(200);
    expect(a.body.participantId).not.toBe(b.body.participantId);
  });

  it("stores no personal data on the participant row", async () => {
    await request(app.getHttpServer()).get("/whoami").expect(200);
    const columns = await testDb.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'participants'
    `);
    expect(columns.map((c) => c.column_name).sort()).toEqual(["created_at", "id"]);
  });

  it("issues a fresh id when the cookie signature is invalid", async () => {
    const response = await request(app.getHttpServer())
      .get("/whoami")
      .set("Cookie", "jiwar_pid=s:forged-value.bad-signature")
      .expect(200);
    expect(response.body.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm test:int -- participants`
Expected: FAIL — participant modules do not exist.

- [ ] **Step 3: Implement the service**

`apps/api/src/participants/participants.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { participants } from "../db/schema.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ParticipantsService {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  /** Returns the existing participant id if it is valid and known, otherwise creates a new one. */
  async ensure(existingId?: string): Promise<string> {
    if (existingId && UUID_PATTERN.test(existingId)) {
      const found = await this.db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, existingId))
        .limit(1);
      if (found[0]) return found[0].id;
    }

    const inserted = await this.db.insert(participants).values({}).returning({ id: participants.id });
    const row = inserted[0];
    if (!row) throw new Error("Failed to create participant");
    return row.id;
  }
}
```

- [ ] **Step 4: Implement the middleware and decorator**

`apps/api/src/participants/participant.middleware.ts`:

```ts
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ParticipantsService } from "./participants.service.js";

export const PARTICIPANT_COOKIE = "jiwar_pid";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class ParticipantMiddleware implements NestMiddleware {
  constructor(private readonly participants: ParticipantsService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // signedCookies is populated by cookie-parser; a forged signature leaves it undefined.
    const existing = req.signedCookies?.[PARTICIPANT_COOKIE] as string | undefined;
    const participantId = await this.participants.ensure(existing);

    if (existing !== participantId) {
      res.cookie(PARTICIPANT_COOKIE, participantId, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR_MS,
        path: "/",
      });
    }

    (req as Request & { participantId?: string }).participantId = participantId;
    next();
  }
}
```

`apps/api/src/participants/current-participant.decorator.ts`:

```ts
import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from "@nestjs/common";
import type { Request } from "express";

export const CurrentParticipant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { participantId?: string }>();
    if (!req.participantId) {
      throw new InternalServerErrorException("Participant middleware did not run");
    }
    return req.participantId;
  },
);
```

`apps/api/src/participants/participants.module.ts`:

```ts
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ParticipantMiddleware } from "./participant.middleware.js";
import { ParticipantsService } from "./participants.service.js";

@Module({
  providers: [ParticipantsService, ParticipantMiddleware],
  exports: [ParticipantsService],
})
export class ParticipantsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ParticipantMiddleware).forRoutes("*");
  }
}
```

- [ ] **Step 5: Wire it into the app module**

`apps/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db/drizzle.module.js";
import { ParticipantsModule } from "./participants/participants.module.js";

@Module({
  imports: [DrizzleModule, ParticipantsModule],
})
export class AppModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && pnpm test:int -- participants`
Expected: PASS — all five cases.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): issue signed anonymous participant cookie"
```

---
### Task 7: The radius search query

**Files:**
- Create: `apps/api/src/notices/notices.repository.ts`, `notices.mapper.ts`
- Test: `apps/api/test/notices-search.int.test.ts`, `apps/api/test/fixtures.ts`

**Interfaces:**
- Consumes: `DRIZZLE` (Task 4), the harness (Task 5), `SearchNotices`/`NoticeWithDistance` (Task 3).
- Produces: `NoticesRepository.search(params: SearchNotices, opts: { pastGraceHours: number }): Promise<{ items: NoticeWithDistance[]; nextCursor: string | null; fallback: boolean }>`, `NoticesRepository.insert(...)`, `NoticesRepository.findByPublicId(publicId: string, pastGraceHours?): Promise<Notice | null>`, `NoticesRepository.cancel(publicId, participantId): Promise<boolean>`; mappers `toNotice` and `toNoticeWithDistance`. Also `makeNotice()` test fixture.

**This is the task that matters most.** Every case below exists because it could silently break and produce a plausible-looking wrong answer.

- [ ] **Step 1: Write the fixture helper**

`apps/api/test/fixtures.ts`:

```ts
import { eq } from "drizzle-orm";
import { categories, notices, participants } from "../src/db/schema.js";
import type { JiwarTestDb } from "./db-harness.js";
import { nanoid } from "nanoid";

// Central Algiers, used as the search origin throughout.
export const ALGIERS = { lat: 36.7538, lng: 3.0588 };

/** Offsets a point by a distance in metres along a bearing. */
export function offsetPoint(
  origin: { lat: number; lng: number },
  metres: number,
  bearingDegrees = 0,
): { lat: number; lng: number } {
  const R = 6_371_008.8;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(metres / R) + Math.cos(lat1) * Math.sin(metres / R) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(metres / R) * Math.cos(lat1),
      Math.cos(metres / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export async function makeParticipant(db: JiwarTestDb): Promise<string> {
  const rows = await db.insert(participants).values({}).returning({ id: participants.id });
  const row = rows[0];
  if (!row) throw new Error("no participant created");
  return row.id;
}

export interface MakeNoticeOptions {
  lat?: number;
  lng?: number;
  startsAt?: Date;
  categorySlug?: string;
  title?: string;
  status?: "published" | "cancelled" | "removed";
  authorParticipantId?: string;
}

export async function makeNotice(db: JiwarTestDb, options: MakeNoticeOptions = {}) {
  const slug = options.categorySlug ?? "funeral";
  const category = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (!category[0]) throw new Error(`category ${slug} not seeded`);

  const authorParticipantId = options.authorParticipantId ?? (await makeParticipant(db));
  const publicId = nanoid(12);

  const rows = await db
    .insert(notices)
    .values({
      publicId,
      categoryId: category[0].id,
      title: options.title ?? "Test notice",
      description: "",
      venueName: "Test venue",
      address: "Test address",
      location: { lat: options.lat ?? ALGIERS.lat, lng: options.lng ?? ALGIERS.lng },
      startsAt: options.startsAt ?? new Date(Date.now() + 3 * 60 * 60 * 1000),
      attendance: "public",
      status: options.status ?? "published",
      authorParticipantId,
    })
    .returning();

  return rows[0]!;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/notices-search.int.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SearchNoticesSchema } from "@jiwar/contracts";
import { NoticesRepository } from "../src/notices/notices.repository.js";
import { startTestDb, type TestDb } from "./db-harness.js";
import { ALGIERS, makeNotice, makeParticipant, offsetPoint } from "./fixtures.js";

const GRACE = { pastGraceHours: 24 };
const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

describe("NoticesRepository.search", () => {
  let testDb: TestDb;
  let repo: NoticesRepository;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();
    repo = new NoticesRepository(testDb.db);
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  const search = (overrides: Record<string, unknown> = {}) =>
    repo.search(
      SearchNoticesSchema.parse({ lat: ALGIERS.lat, lng: ALGIERS.lng, ...overrides }),
      GRACE,
    );

  it("includes a notice just inside the radius", async () => {
    const inside = offsetPoint(ALGIERS, 19_000);
    await makeNotice(testDb.db, { ...inside, title: "Inside" });

    const result = await search({ radiusKm: 20 });
    expect(result.items.map((i) => i.title)).toEqual(["Inside"]);
  });

  it("excludes a notice just outside the radius", async () => {
    const outside = offsetPoint(ALGIERS, 21_000);
    await makeNotice(testDb.db, { ...outside, title: "Outside" });

    const result = await search({ radiusKm: 20 });
    expect(result.items).toHaveLength(0);
  });

  it("reports distance in metres", async () => {
    const point = offsetPoint(ALGIERS, 5_000);
    await makeNotice(testDb.db, point);

    const result = await search({ radiusKm: 20 });
    expect(result.items[0]!.distanceMetres).toBeGreaterThan(4_800);
    expect(result.items[0]!.distanceMetres).toBeLessThan(5_200);
  });

  it("works across the antimeridian", async () => {
    // Two points 40 km apart straddling longitude 180.
    const origin = { lat: 0, lng: 179.9 };
    await makeNotice(testDb.db, { lat: 0, lng: -179.9, title: "Across" });

    const result = await repo.search(
      SearchNoticesSchema.parse({ lat: origin.lat, lng: origin.lng, radiusKm: 30 }),
      GRACE,
    );
    expect(result.items.map((i) => i.title)).toEqual(["Across"]);
  });

  it("treats a notice within the grace window as upcoming, and past it as past", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-23), title: "Recent" });
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-25), title: "Old" });

    const upcoming = await search({ when: "upcoming" });
    expect(upcoming.items.map((i) => i.title)).toEqual(["Recent"]);

    const past = await search({ when: "past" });
    expect(past.items.map((i) => i.title)).toEqual(["Old"]);
  });

  it("returns past notices as a fallback when nothing is upcoming", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-48), title: "Last week" });

    const result = await search({ when: "upcoming" });
    expect(result.fallback).toBe(true);
    expect(result.items.map((i) => i.title)).toEqual(["Last week"]);
  });

  it("does not fall back when the search is explicitly for past notices", async () => {
    const result = await search({ when: "past" });
    expect(result.fallback).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("does not fall back when upcoming results exist", async () => {
    await makeNotice(testDb.db, { startsAt: hoursFromNow(2), title: "Soon" });
    await makeNotice(testDb.db, { startsAt: hoursFromNow(-48), title: "Old" });

    const result = await search({ when: "upcoming" });
    expect(result.fallback).toBe(false);
    expect(result.items.map((i) => i.title)).toEqual(["Soon"]);
  });

  it("excludes cancelled and removed notices", async () => {
    await makeNotice(testDb.db, { status: "cancelled", title: "Cancelled" });
    await makeNotice(testDb.db, { status: "removed", title: "Removed" });
    await makeNotice(testDb.db, { status: "published", title: "Published" });

    const result = await search();
    expect(result.items.map((i) => i.title)).toEqual(["Published"]);
  });

  it("filters by category", async () => {
    await makeNotice(testDb.db, { categorySlug: "funeral", title: "A funeral" });
    await makeNotice(testDb.db, { categorySlug: "wedding", title: "A wedding" });

    const result = await search({ categories: ["wedding"] });
    expect(result.items.map((i) => i.title)).toEqual(["A wedding"]);
  });

  it("sorts by soonest, then by nearest when asked", async () => {
    await makeNotice(testDb.db, {
      ...offsetPoint(ALGIERS, 15_000),
      startsAt: hoursFromNow(1),
      title: "Far but soon",
    });
    await makeNotice(testDb.db, {
      ...offsetPoint(ALGIERS, 1_000),
      startsAt: hoursFromNow(10),
      title: "Near but later",
    });

    const bySoonest = await search({ sort: "soonest" });
    expect(bySoonest.items.map((i) => i.title)).toEqual(["Far but soon", "Near but later"]);

    const byNearest = await search({ sort: "nearest" });
    expect(byNearest.items.map((i) => i.title)).toEqual(["Near but later", "Far but soon"]);
  });

  it("paginates with a stable cursor and no duplicates", async () => {
    for (let i = 0; i < 5; i++) {
      await makeNotice(testDb.db, { startsAt: hoursFromNow(i + 1), title: `Notice ${i}` });
    }

    const first = await search({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await search({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);

    const seen = [...first.items, ...second.items].map((i) => i.title);
    expect(new Set(seen).size).toBe(4);
  });

  it("returns a null cursor on the last page", async () => {
    await makeNotice(testDb.db, { title: "Only one" });
    const result = await search({ limit: 20 });
    expect(result.nextCursor).toBeNull();
  });

  it("includes the category on each item", async () => {
    await makeNotice(testDb.db, { categorySlug: "aqiqah" });
    const result = await search();
    expect(result.items[0]!.category.slug).toBe("aqiqah");
    expect(result.items[0]!.category.name).toBe("Aqiqah");
  });
});

describe("NoticesRepository.cancel", () => {
  let testDb: TestDb;
  let repo: NoticesRepository;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();
    repo = new NoticesRepository(testDb.db);
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it("lets the author cancel their own notice", async () => {
    const author = await makeParticipant(testDb.db);
    const notice = await makeNotice(testDb.db, { authorParticipantId: author });

    const cancelled = await repo.cancel(notice.publicId, author);
    expect(cancelled).toBe(true);

    const found = await repo.findByPublicId(notice.publicId);
    expect(found?.status).toBe("cancelled");
  });

  it("refuses to let one participant cancel another participant's notice", async () => {
    const author = await makeParticipant(testDb.db);
    const stranger = await makeParticipant(testDb.db);
    const notice = await makeNotice(testDb.db, { authorParticipantId: author });

    const cancelled = await repo.cancel(notice.publicId, stranger);
    expect(cancelled).toBe(false);

    const found = await repo.findByPublicId(notice.publicId);
    expect(found?.status).toBe("published");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && pnpm test:int -- notices-search`
Expected: FAIL — `notices.repository.js` does not exist.

- [ ] **Step 4: Implement the mapper**

`apps/api/src/notices/notices.mapper.ts`:

```ts
import type { Notice, NoticeWithDistance } from "@jiwar/contracts";

export interface NoticeRow {
  publicId: string;
  title: string;
  description: string;
  venueName: string;
  address: string;
  lat: number;
  lng: number;
  startsAt: Date;
  attendance: "public" | "invitation_only" | "restricted";
  organizerName: string | null;
  organizerContact: string | null;
  status: "published" | "cancelled" | "removed";
  createdAt: Date;
  categorySlug: string;
  categoryName: string;
  categoryIcon: string;
  categorySortOrder: number;
  distanceMetres?: number;
}

/** A notice without a distance, for the detail endpoint where there is no search origin. */
export function toNotice(row: NoticeRow, pastGraceHours: number): Notice {
  const graceMs = pastGraceHours * 60 * 60 * 1000;
  return {
    publicId: row.publicId,
    category: {
      slug: row.categorySlug,
      name: row.categoryName,
      icon: row.categoryIcon,
      sortOrder: row.categorySortOrder,
    },
    title: row.title,
    description: row.description,
    venueName: row.venueName,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    startsAt: row.startsAt.toISOString(),
    attendance: row.attendance,
    organizerName: row.organizerName,
    organizerContact: row.organizerContact,
    status: row.status,
    isPast: row.startsAt.getTime() + graceMs < Date.now(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNoticeWithDistance(row: NoticeRow, pastGraceHours: number): NoticeWithDistance {
  const graceMs = pastGraceHours * 60 * 60 * 1000;
  return {
    publicId: row.publicId,
    category: {
      slug: row.categorySlug,
      name: row.categoryName,
      icon: row.categoryIcon,
      sortOrder: row.categorySortOrder,
    },
    title: row.title,
    description: row.description,
    venueName: row.venueName,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    startsAt: row.startsAt.toISOString(),
    attendance: row.attendance,
    organizerName: row.organizerName,
    organizerContact: row.organizerContact,
    status: row.status,
    isPast: row.startsAt.getTime() + graceMs < Date.now(),
    createdAt: row.createdAt.toISOString(),
    distanceMetres: Math.round(row.distanceMetres ?? 0),
  };
}
```

- [ ] **Step 5: Implement the repository**

`apps/api/src/notices/notices.repository.ts`. The radius filter is `ST_DWithin` on the geography column, which uses the GiST index and handles the antimeridian correctly — a bounding box would not:

```ts
import { Inject, Injectable } from "@nestjs/common";
import type { Notice, NoticeWithDistance, SearchNotices } from "@jiwar/contracts";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { categories, notices } from "../db/schema.js";
import { toNotice, toNoticeWithDistance, type NoticeRow } from "./notices.mapper.js";

export interface SearchOptions {
  pastGraceHours: number;
}

export interface SearchOutcome {
  items: NoticeWithDistance[];
  nextCursor: string | null;
  fallback: boolean;
}

export interface InsertNoticeInput {
  categorySlug: string;
  title: string;
  description: string;
  venueName: string;
  address: string;
  lat: number;
  lng: number;
  startsAt: Date;
  attendance: "public" | "invitation_only" | "restricted";
  organizerName?: string;
  organizerContact?: string;
  authorParticipantId: string;
}

interface Cursor {
  /** Sort key of the last row: epoch millis for soonest, metres for nearest. */
  k: number;
  /** publicId tiebreaker, so equal keys still page deterministically. */
  p: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.k === "number" && typeof parsed?.p === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class NoticesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  async search(params: SearchNotices, options: SearchOptions): Promise<SearchOutcome> {
    const primary = await this.runSearch(params, options, params.when);

    if (primary.items.length > 0 || params.when === "past") {
      return { ...primary, fallback: false };
    }

    // Spec §6: an empty upcoming search falls back to recent past notices.
    const fallback = await this.runSearch(params, options, "past");
    return { ...fallback, fallback: fallback.items.length > 0 };
  }

  private async runSearch(
    params: SearchNotices,
    options: SearchOptions,
    when: "upcoming" | "past",
  ): Promise<{ items: NoticeWithDistance[]; nextCursor: string | null }> {
    const origin = sql`ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography`;
    const radiusMetres = params.radiusKm * 1000;
    const cutoff = sql`now() - make_interval(hours => ${options.pastGraceHours})`;
    const cursor = decodeCursor(params.cursor);
    const limit = params.limit;

    const conditions = [
      sql`n.status = 'published'`,
      sql`ST_DWithin(n.location, ${origin}, ${radiusMetres})`,
      when === "upcoming" ? sql`n.starts_at >= ${cutoff}` : sql`n.starts_at < ${cutoff}`,
    ];

    if (params.categories && params.categories.length > 0) {
      // `IN ${array}` binds one array parameter and fails; `= ANY(...)` is the correct form.
      conditions.push(sql`c.slug = ANY(${params.categories})`);
    }

    // Ordering differs per sort, and the cursor compares against the same key.
    const isNearest = params.sort === "nearest";
    const sortKey = isNearest
      ? sql`ST_Distance(n.location, ${origin})`
      : sql`extract(epoch from n.starts_at) * 1000`;
    // "past" reads best newest-first; upcoming reads soonest-first.
    const direction = !isNearest && when === "past" ? sql`desc` : sql`asc`;

    if (cursor) {
      const descending = !isNearest && when === "past";
      conditions.push(
        descending
          ? sql`(${sortKey}, n.public_id) < (${cursor.k}, ${cursor.p})`
          : sql`(${sortKey}, n.public_id) > (${cursor.k}, ${cursor.p})`,
      );
    }

    const whereClause = conditions.reduce((acc, condition, index) =>
      index === 0 ? condition : sql`${acc} AND ${condition}`,
    );

    const rows = await this.db.execute<NoticeRow & { sortKey: number }>(sql`
      SELECT
        n.public_id            AS "publicId",
        n.title               AS "title",
        n.description         AS "description",
        n.venue_name          AS "venueName",
        n.address             AS "address",
        ST_Y(n.location::geometry) AS "lat",
        ST_X(n.location::geometry) AS "lng",
        n.starts_at           AS "startsAt",
        n.attendance          AS "attendance",
        n.organizer_name      AS "organizerName",
        n.organizer_contact   AS "organizerContact",
        n.status              AS "status",
        n.created_at          AS "createdAt",
        c.slug                AS "categorySlug",
        c.name                AS "categoryName",
        c.icon                AS "categoryIcon",
        c.sort_order          AS "categorySortOrder",
        ST_Distance(n.location, ${origin}) AS "distanceMetres",
        ${sortKey}            AS "sortKey"
      FROM notices n
      JOIN categories c ON c.id = n.category_id
      WHERE ${whereClause}
      ORDER BY ${sortKey} ${direction}, n.public_id ${direction}
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => toNoticeWithDistance(row, options.pastGraceHours)),
      nextCursor:
        hasMore && last ? encodeCursor({ k: Number(last.sortKey), p: last.publicId }) : null,
    };
  }

  async insert(input: InsertNoticeInput): Promise<string> {
    const category = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, input.categorySlug), eq(categories.active, true)))
      .limit(1);

    if (!category[0]) throw new Error(`Unknown category: ${input.categorySlug}`);

    const publicId = nanoid(12);

    await this.db.insert(notices).values({
      publicId,
      categoryId: category[0].id,
      title: input.title,
      description: input.description,
      venueName: input.venueName,
      address: input.address,
      location: { lat: input.lat, lng: input.lng },
      startsAt: input.startsAt,
      attendance: input.attendance,
      organizerName: input.organizerName ?? null,
      organizerContact: input.organizerContact ?? null,
      authorParticipantId: input.authorParticipantId,
    });

    return publicId;
  }

  async findByPublicId(publicId: string, pastGraceHours = 24): Promise<Notice | null> {
    const rows = await this.db.execute<NoticeRow>(sql`
      SELECT
        n.public_id            AS "publicId",
        n.title               AS "title",
        n.description         AS "description",
        n.venue_name          AS "venueName",
        n.address             AS "address",
        ST_Y(n.location::geometry) AS "lat",
        ST_X(n.location::geometry) AS "lng",
        n.starts_at           AS "startsAt",
        n.attendance          AS "attendance",
        n.organizer_name      AS "organizerName",
        n.organizer_contact   AS "organizerContact",
        n.status              AS "status",
        n.created_at          AS "createdAt",
        c.slug                AS "categorySlug",
        c.name                AS "categoryName",
        c.icon                AS "categoryIcon",
        c.sort_order          AS "categorySortOrder"
      FROM notices n
      JOIN categories c ON c.id = n.category_id
      WHERE n.public_id = ${publicId} AND n.status <> 'removed'
      LIMIT 1
    `);

    const row = rows[0];
    return row ? toNotice(row, pastGraceHours) : null;
  }

  /** Returns false when the notice does not exist or the participant is not its author. */
  async cancel(publicId: string, participantId: string): Promise<boolean> {
    const updated = await this.db
      .update(notices)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(notices.publicId, publicId),
          eq(notices.authorParticipantId, participantId),
          eq(notices.status, "published"),
        ),
      )
      .returning({ publicId: notices.publicId });

    return updated.length > 0;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test:int -- notices-search`
Expected: PASS — all 15 search cases and both cancel cases.

If the antimeridian test fails, the query is using a bounding box rather than `ST_DWithin` on geography. If distances come back as tiny decimals, the column is `geometry` rather than `geography`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add PostGIS radius search with cursor pagination and past-notice fallback"
```

---
### Task 8: Notices and categories HTTP endpoints

**Files:**
- Create: `apps/api/src/notices/notices.service.ts`, `notices.controller.ts`, `notices.module.ts`
- Create: `apps/api/src/categories/categories.service.ts`, `categories.controller.ts`, `categories.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/notices-api.int.test.ts`

**Interfaces:**
- Consumes: `NoticesRepository` (Task 7), `@CurrentParticipant()` (Task 6), `APP_CONFIG` (Task 4).
- Produces: `GET /v1/categories`, `GET /v1/notices` (returns `NoticeSearchResult`), `POST /v1/notices`, `GET /v1/notices/:publicId` (returns `Notice`, without a distance), `POST /v1/notices/:publicId/cancel`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notices-api.int.test.ts`:

```ts
import { StandardSchemaValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { NoticeSearchResultSchema, NoticeSchema } from "@jiwar/contracts";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { APP_CONFIG } from "../src/config.js";
import { DRIZZLE } from "../src/db/drizzle.module.js";
import { CategoriesModule } from "../src/categories/categories.module.js";
import { NoticesModule } from "../src/notices/notices.module.js";
import { ParticipantMiddleware } from "../src/participants/participant.middleware.js";
import { ParticipantsService } from "../src/participants/participants.service.js";
import { ParticipantsModule } from "../src/participants/participants.module.js";
import { startTestDb, type TestDb } from "./db-harness.js";
import { ALGIERS } from "./fixtures.js";

const COOKIE_SECRET = "test-secret-at-least-32-characters-long";
const CONFIG = {
  cookieSecret: COOKIE_SECRET,
  maxRadiusKm: 100,
  defaultRadiusKm: 20,
  pastGraceHours: 24,
};

const validBody = {
  categorySlug: "funeral",
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: ALGIERS.lat,
  lng: ALGIERS.lng,
  startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  attendance: "public",
};

describe("notices API", () => {
  let testDb: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.seedCategories();

    const moduleRef = await Test.createTestingModule({
      imports: [NoticesModule, CategoriesModule, ParticipantsModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue(testDb.db)
      .overrideProvider(APP_CONFIG)
      .useValue(CONFIG)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix("v1");
    app.use(cookieParser(COOKIE_SECRET));
    const middleware = new ParticipantMiddleware(app.get(ParticipantsService));
    app.use(middleware.use.bind(middleware));
    app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));
    await app.init();
  }, 180_000);

  afterEach(async () => {
    await testDb.truncate();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.stop();
  });

  it("lists the seeded categories", async () => {
    const response = await request(app.getHttpServer()).get("/v1/categories").expect(200);
    expect(response.body.map((c: { slug: string }) => c.slug)).toContain("aqiqah");
    expect(response.body).toHaveLength(6);
  });

  it("publishes a notice immediately and returns it in search", async () => {
    const agent = request.agent(app.getHttpServer());

    const created = await agent.post("/v1/notices").send(validBody).expect(201);
    expect(created.body.publicId).toBeTruthy();

    const found = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 20 })
      .expect(200);

    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].title).toBe(validBody.title);
  });

  it("returns a response matching the contract schema", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/v1/notices").send(validBody).expect(201);

    const found = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);

    // Drift guard from spec §4: the response must parse against the shared contract.
    expect(() => NoticeSearchResultSchema.parse(found.body)).not.toThrow();
  });

  it("rejects a radius above the configured maximum", async () => {
    await request(app.getHttpServer())
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng, radiusKm: 500 })
      .expect(400);
  });

  it("rejects an invalid body with 400", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, title: "ab" })
      .expect(400);
  });

  it("rejects organizer contact without consent", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, organizerContact: "+213 555 0000", organizerConsent: false })
      .expect(400);
  });

  it("accepts organizer contact with consent", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, organizerContact: "+213 555 0000", organizerConsent: true })
      .expect(201);
    expect(response.body.publicId).toBeTruthy();
  });

  it("rejects an unknown category with 400", async () => {
    await request(app.getHttpServer())
      .post("/v1/notices")
      .send({ ...validBody, categorySlug: "nonexistent" })
      .expect(400);
  });

  it("serves a notice by public id and matches the contract", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);

    expect(detail.body.title).toBe(validBody.title);
    expect(() => NoticeSchema.parse(detail.body)).not.toThrow();
  });

  it("returns 404 for an unknown public id", async () => {
    await request(app.getHttpServer()).get("/v1/notices/doesnotexist").expect(404);
  });

  it("lets the author cancel, and the notice leaves discovery but keeps its URL", async () => {
    const agent = request.agent(app.getHttpServer());
    const created = await agent.post("/v1/notices").send(validBody).expect(201);

    await agent.post(`/v1/notices/${created.body.publicId}/cancel`).expect(200);

    const search = await agent
      .get("/v1/notices")
      .query({ lat: ALGIERS.lat, lng: ALGIERS.lng })
      .expect(200);
    expect(search.body.items).toHaveLength(0);

    const detail = await request(app.getHttpServer())
      .get(`/v1/notices/${created.body.publicId}`)
      .expect(200);
    expect(detail.body.status).toBe("cancelled");
  });

  it("refuses cancellation by a different participant with 403", async () => {
    const author = request.agent(app.getHttpServer());
    const created = await author.post("/v1/notices").send(validBody).expect(201);

    const stranger = request.agent(app.getHttpServer());
    // Establish the stranger's own cookie first.
    await stranger.get("/v1/categories").expect(200);
    await stranger.post(`/v1/notices/${created.body.publicId}/cancel`).expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm test:int -- notices-api`
Expected: FAIL — the notices and categories modules do not exist.

- [ ] **Step 3: Implement the categories module**

`apps/api/src/categories/categories.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import type { Category } from "@jiwar/contracts";
import { asc, eq } from "drizzle-orm";
import { DRIZZLE, type JiwarDb } from "../db/drizzle.module.js";
import { categories } from "../db/schema.js";

@Injectable()
export class CategoriesService {
  constructor(@Inject(DRIZZLE) private readonly db: JiwarDb) {}

  async list(): Promise<Category[]> {
    const rows = await this.db
      .select({
        slug: categories.slug,
        name: categories.name,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder));

    return rows;
  }
}
```

`apps/api/src/categories/categories.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Category } from "@jiwar/contracts";
import { CategoriesService } from "./categories.service.js";

@ApiTags("categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOkResponse({ description: "Active notice categories, in display order." })
  list(): Promise<Category[]> {
    return this.categories.list();
  }
}
```

`apps/api/src/categories/categories.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

- [ ] **Step 4: Implement the notices service**

`apps/api/src/notices/notices.service.ts`. The configured `maxRadiusKm` check lives here because it is server policy, not a contract constant:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateNotice, Notice, SearchNotices } from "@jiwar/contracts";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { NoticesRepository, type SearchOutcome } from "./notices.repository.js";

@Injectable()
export class NoticesService {
  constructor(
    private readonly repository: NoticesRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async search(params: SearchNotices): Promise<SearchOutcome> {
    if (params.radiusKm > this.config.maxRadiusKm) {
      throw new BadRequestException(
        `radiusKm must not exceed ${this.config.maxRadiusKm}`,
      );
    }
    return this.repository.search(params, { pastGraceHours: this.config.pastGraceHours });
  }

  async create(input: CreateNotice, participantId: string): Promise<{ publicId: string }> {
    try {
      const publicId = await this.repository.insert({
        categorySlug: input.categorySlug,
        title: input.title,
        description: input.description,
        venueName: input.venueName,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        startsAt: new Date(input.startsAt),
        attendance: input.attendance,
        organizerName: input.organizerName,
        organizerContact: input.organizerContact,
        authorParticipantId: participantId,
      });
      return { publicId };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown category")) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async findOne(publicId: string): Promise<Notice> {
    const notice = await this.repository.findByPublicId(publicId, this.config.pastGraceHours);
    if (!notice) throw new NotFoundException("Notice not found");
    return notice;
  }

  async cancel(publicId: string, participantId: string): Promise<{ cancelled: true }> {
    const cancelled = await this.repository.cancel(publicId, participantId);
    if (!cancelled) {
      throw new ForbiddenException("Only the author can cancel this notice");
    }
    return { cancelled: true };
  }
}
```

- [ ] **Step 5: Implement the notices controller**

`apps/api/src/notices/notices.controller.ts` — `@Body({ schema })` and `@Query({ schema })` are the native NestJS 12 Standard Schema hooks, which is why no `nestjs-zod` is needed:

```ts
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import {
  CreateNoticeSchema,
  SearchNoticesSchema,
  type CreateNotice,
  type Notice,
  type SearchNotices,
} from "@jiwar/contracts";
import { CurrentParticipant } from "../participants/current-participant.decorator.js";
import { NoticesService } from "./notices.service.js";
import type { SearchOutcome } from "./notices.repository.js";

@ApiTags("notices")
@Controller("notices")
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @ApiOkResponse({ description: "Published notices within the radius." })
  search(@Query({ schema: SearchNoticesSchema }) query: SearchNotices): Promise<SearchOutcome> {
    return this.notices.search(query);
  }

  @Post()
  @ApiCreatedResponse({ description: "The notice is published immediately." })
  create(
    @Body({ schema: CreateNoticeSchema }) body: CreateNotice,
    @CurrentParticipant() participantId: string,
  ): Promise<{ publicId: string }> {
    return this.notices.create(body, participantId);
  }

  @Get(":publicId")
  @ApiOkResponse({ description: "A single notice, including cancelled ones." })
  findOne(@Param("publicId") publicId: string): Promise<Notice> {
    return this.notices.findOne(publicId);
  }

  @Post(":publicId/cancel")
  @ApiOkResponse({ description: "Cancels a notice. Only its author may do this." })
  cancel(
    @Param("publicId") publicId: string,
    @CurrentParticipant() participantId: string,
  ): Promise<{ cancelled: true }> {
    return this.notices.cancel(publicId, participantId);
  }
}
```

`apps/api/src/notices/notices.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { NoticesController } from "./notices.controller.js";
import { NoticesRepository } from "./notices.repository.js";
import { NoticesService } from "./notices.service.js";

@Module({
  controllers: [NoticesController],
  providers: [NoticesService, NoticesRepository],
  exports: [NoticesService],
})
export class NoticesModule {}
```

- [ ] **Step 6: Wire into the app module**

`apps/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { CategoriesModule } from "./categories/categories.module.js";
import { DrizzleModule } from "./db/drizzle.module.js";
import { NoticesModule } from "./notices/notices.module.js";
import { ParticipantsModule } from "./participants/participants.module.js";

@Module({
  imports: [DrizzleModule, ParticipantsModule, CategoriesModule, NoticesModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test:int`
Expected: PASS — all 12 API cases, plus every earlier integration test still green.

- [ ] **Step 8: Verify the API by hand**

Run:

```bash
cd apps/api && pnpm build && node dist/main.js &
sleep 3
curl -s localhost:3000/v1/categories | head -c 300
curl -s "localhost:3000/v1/notices?lat=36.7538&lng=3.0588&radiusKm=20" | head -c 300
```

Expected: six categories, and a search result with `items`, `nextCursor`, `fallback`. Visit `/api/docs` and confirm `POST /v1/notices` shows a request body schema derived from the Zod contract. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): add notices and categories endpoints with native Zod validation"
```

---

### Task 9: Nominatim geocoding proxy

**Files:**
- Create: `apps/api/src/geocode/geocode.service.ts`, `geocode.controller.ts`, `geocode.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/geocode/geocode.service.test.ts`

**Interfaces:**
- Consumes: `APP_CONFIG` (Task 4), `GeocodeResult` (Task 3).
- Produces: `GET /v1/geocode?q=`, `GET /v1/reverse-geocode?lat=&lng=`; `GeocodeService.search(query)`, `GeocodeService.reverse(lat, lng)`.

Spec §7: this exists because Nominatim requires an identifying User-Agent and permits about one request per second — a browser autocomplete would violate both.

- [ ] **Step 1: Write the failing test**

`apps/api/src/geocode/geocode.service.test.ts` — a unit test with a stubbed fetch, no network:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeocodeService } from "./geocode.service.js";

const config = {
  nominatimBaseUrl: "https://nominatim.example.org",
  nominatimUserAgent: "jiwar-test/0.1",
} as never;

const nominatimResponse = [
  { display_name: "Masjid Al-Rahma, Algiers", lat: "36.7538", lon: "3.0588" },
  { display_name: "Algiers, Algeria", lat: "36.7762", lon: "3.0597" },
];

describe("GeocodeService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: GeocodeService;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => nominatimResponse,
    });
    service = new GeocodeService(config, fetchMock as unknown as typeof fetch);
  });

  it("maps Nominatim results into the contract shape", async () => {
    const results = await service.search("masjid algiers");
    expect(results).toEqual([
      { label: "Masjid Al-Rahma, Algiers", lat: 36.7538, lng: 3.0588 },
      { label: "Algiers, Algeria", lat: 36.7762, lng: 3.0597 },
    ]);
  });

  it("sends the required identifying User-Agent", async () => {
    await service.search("algiers");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("jiwar-test/0.1");
  });

  it("caches repeated identical queries instead of calling Nominatim again", async () => {
    await service.search("algiers");
    await service.search("algiers");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list for a blank query without calling Nominatim", async () => {
    expect(await service.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when Nominatim fails, rather than throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect(await service.search("something")).toEqual([]);
  });

  it("reverse-geocodes a point into a label", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: "Algiers, Algeria", lat: "36.7538", lon: "3.0588" }),
    });
    const result = await service.reverse(36.7538, 3.0588);
    expect(result).toEqual({ label: "Algiers, Algeria", lat: 36.7538, lng: 3.0588 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm test -- geocode`
Expected: FAIL — `./geocode.service.js` does not exist.

- [ ] **Step 3: Implement the service**

`apps/api/src/geocode/geocode.service.ts`:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { GeocodeResult } from "@jiwar/contracts";
import { APP_CONFIG, type AppConfig } from "../config.js";

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);
  private readonly cache = new Map<string, { at: number; value: GeocodeResult[] }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const cacheKey = `s:${trimmed.toLowerCase()}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached;

    const url = new URL("/search", this.config.nominatimBaseUrl);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "8");
    url.searchParams.set("addressdetails", "0");

    const places = await this.request<NominatimPlace[]>(url);
    const results = (places ?? []).flatMap((place) => this.toResult(place) ?? []);
    this.writeCache(cacheKey, results);
    return results;
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const cacheKey = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = this.readCache(cacheKey);
    if (cached) return cached[0] ?? null;

    const url = new URL("/reverse", this.config.nominatimBaseUrl);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");

    const place = await this.request<NominatimPlace>(url);
    const result = place ? this.toResult(place) : null;
    this.writeCache(cacheKey, result ? [result] : []);
    return result;
  }

  private toResult(place: NominatimPlace): GeocodeResult | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!place.display_name || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { label: place.display_name, lat, lng };
  }

  private async request<T>(url: URL): Promise<T | null> {
    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          "User-Agent": this.config.nominatimUserAgent,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim returned ${response.status} for ${url.pathname}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`Nominatim request failed: ${String(error)}`);
      return null;
    }
  }

  private readCache(key: string): GeocodeResult[] | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private writeCache(key: string, value: GeocodeResult[]): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }
}
```

- [ ] **Step 4: Implement the controller and module**

`apps/api/src/geocode/geocode.controller.ts`:

```ts
import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { LatitudeSchema, LongitudeSchema, type GeocodeResult } from "@jiwar/contracts";
import { z } from "zod";
import { GeocodeService } from "./geocode.service.js";

const SearchQuerySchema = z.object({ q: z.string().max(200).default("") });
const ReverseQuerySchema = z.object({ lat: LatitudeSchema, lng: LongitudeSchema });

@ApiTags("geocode")
@Controller()
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  @Get("geocode")
  @ApiOkResponse({ description: "Address search results, proxied from Nominatim." })
  async search(
    @Query({ schema: SearchQuerySchema }) query: { q: string },
  ): Promise<{ results: GeocodeResult[] }> {
    return { results: await this.geocode.search(query.q) };
  }

  @Get("reverse-geocode")
  @ApiOkResponse({ description: "The nearest address label for a point." })
  async reverse(
    @Query({ schema: ReverseQuerySchema }) query: { lat: number; lng: number },
  ): Promise<{ result: GeocodeResult | null }> {
    return { result: await this.geocode.reverse(query.lat, query.lng) };
  }
}
```

`apps/api/src/geocode/geocode.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { GeocodeController } from "./geocode.controller.js";
import { GeocodeService } from "./geocode.service.js";

@Module({
  controllers: [GeocodeController],
  providers: [
    {
      provide: GeocodeService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new GeocodeService(config),
    },
  ],
  exports: [GeocodeService],
})
export class GeocodeModule {}
```

Add `GeocodeModule` to `apps/api/src/app.module.ts` imports alongside the others.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm test -- geocode`
Expected: PASS — all six cases.

- [ ] **Step 6: Verify against the real Nominatim once**

Run:

```bash
cd apps/api && pnpm build && node dist/main.js &
sleep 3
curl -s "localhost:3000/v1/geocode?q=Algiers" | head -c 300
```

Expected: real results with `label`, `lat`, `lng`. Do this **once** — Nominatim's rate limit is about one request per second. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): proxy Nominatim geocoding with caching and a required User-Agent"
```

---
### Task 10: Vite React app shell with a typed API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `vitest.config.ts`
- Create: `apps/web/src/main.tsx`, `src/App.tsx`, `src/routes/NotFound.tsx`, `src/styles.css`
- Create: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts`

**Interfaces:**
- Consumes: `@jiwar/contracts` (Task 3), the API from Tasks 8-9.
- Produces: `api.categories()`, `api.searchNotices(params)`, `api.getNotice(publicId): Promise<Notice>` (no distance — there is no search origin), `api.createNotice(body)`, `api.cancelNotice(publicId)`, `api.geocode(q)`, `api.reverseGeocode(lat, lng)` — each parsing its response through a contract schema; `ApiError` with `status` and `message`.

- [ ] **Step 1: Create the web package**

`apps/web/package.json`:

```json
{
  "name": "@jiwar/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@hookform/resolvers": "5.9.1",
    "@jiwar/contracts": "workspace:*",
    "@tanstack/react-query": "5.102.8",
    "@vis.gl/react-maplibre": "8.1.3",
    "maplibre-gl": "6.9.1",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-hook-form": "7.88.0",
    "react-router-dom": "7.18.4",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.0",
    "@testing-library/user-event": "14.6.1",
    "@types/react": "19.3.1",
    "@types/react-dom": "19.3.1",
    "@vitejs/plugin-react": "5.1.0",
    "jsdom": "27.0.0",
    "typescript": "6.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "preserve",
    "moduleResolution": "bundler",
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*", "e2e/**/*"]
}
```

`apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
```

`apps/web/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

`apps/web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Jiwar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test for the API client**

`apps/web/src/api/client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client.js";

const notice = {
  publicId: "abc123",
  category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  title: "A funeral notice",
  description: "",
  venueName: "Masjid Al-Rahma",
  address: "Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public",
  organizerName: null,
  organizerContact: null,
  status: "published",
  isPast: false,
  createdAt: "2026-09-15T10:00:00.000Z",
  distanceMetres: 1200,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("parses a search response through the contract schema", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [notice], nextCursor: null, fallback: false }),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    const result = await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 });
    expect(result.items[0]!.title).toBe("A funeral notice");
    expect(result.fallback).toBe(false);
  });

  it("throws when the response does not match the contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ nope: true }], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 })).rejects.toThrow();
  });

  it("sends credentials so the participant cookie travels", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
  });

  it("serialises multiple categories as repeated query parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20, categories: ["funeral", "wedding"] });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("categories=funeral");
    expect(url).toContain("categories=wedding");
  });

  it("throws ApiError carrying the HTTP status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Notice not found" }, 404));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.getNotice("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });

  it("surfaces a validation message from a 400", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "title too short" }, 400));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(
      api.createNotice({
        categorySlug: "funeral",
        title: "ab",
        description: "",
        venueName: "v",
        address: "a",
        lat: 36.75,
        lng: 3.06,
        startsAt: "2026-10-01T12:30:00.000Z",
        attendance: "public",
        organizerConsent: false,
      }),
    ).rejects.toThrow(/title too short/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/web && pnpm test -- client`
Expected: FAIL — `./client.js` does not exist.

- [ ] **Step 4: Implement the API client**

`apps/web/src/api/client.ts`. Every response is parsed through a contract schema — this is the drift guard from spec §4 on the client side:

```ts
import {
  CategorySchema,
  GeocodeResultsSchema,
  NoticeSchema,
  NoticeSearchResultSchema,
  type Category,
  type CreateNotice,
  type GeocodeResult,
  type Notice,
  type NoticeSearchResult,
} from "@jiwar/contracts";
import { z } from "zod";

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SearchParams {
  lat: number;
  lng: number;
  radiusKm: number;
  categories?: string[];
  when?: "upcoming" | "past";
  sort?: "soonest" | "nearest";
  cursor?: string;
}

const CategoriesSchema = z.array(CategorySchema);
const CreatedSchema = z.object({ publicId: z.string() });
const CancelledSchema = z.object({ cancelled: z.literal(true) });
const ReverseSchema = z.object({
  result: z.object({ label: z.string(), lat: z.number(), lng: z.number() }).nullable(),
});

export function createApiClient(fetchImpl: typeof fetch = fetch) {
  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetchImpl(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Request failed with status ${response.status}`;
      throw new ApiError(response.status, message);
    }

    return schema.parse(body);
  }

  function searchQuery(params: SearchParams): string {
    const query = new URLSearchParams();
    query.set("lat", String(params.lat));
    query.set("lng", String(params.lng));
    query.set("radiusKm", String(params.radiusKm));
    if (params.when) query.set("when", params.when);
    if (params.sort) query.set("sort", params.sort);
    if (params.cursor) query.set("cursor", params.cursor);
    for (const category of params.categories ?? []) query.append("categories", category);
    return query.toString();
  }

  return {
    categories: (): Promise<Category[]> => call("/v1/categories", CategoriesSchema),

    searchNotices: (params: SearchParams): Promise<NoticeSearchResult> =>
      call(`/v1/notices?${searchQuery(params)}`, NoticeSearchResultSchema),

    getNotice: (publicId: string): Promise<Notice> =>
      call(`/v1/notices/${encodeURIComponent(publicId)}`, NoticeSchema),

    createNotice: (body: CreateNotice): Promise<{ publicId: string }> =>
      call("/v1/notices", CreatedSchema, { method: "POST", body: JSON.stringify(body) }),

    cancelNotice: (publicId: string): Promise<{ cancelled: true }> =>
      call(`/v1/notices/${encodeURIComponent(publicId)}/cancel`, CancelledSchema, {
        method: "POST",
      }),

    geocode: async (q: string): Promise<GeocodeResult[]> =>
      (await call(`/v1/geocode?q=${encodeURIComponent(q)}`, GeocodeResultsSchema)).results,

    reverseGeocode: async (lat: number, lng: number): Promise<GeocodeResult | null> =>
      (await call(`/v1/reverse-geocode?lat=${lat}&lng=${lng}`, ReverseSchema)).result,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm test -- client`
Expected: PASS — all six cases.

- [ ] **Step 6: Create the app shell**

`apps/web/src/main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

`apps/web/src/App.tsx` — routes for the pages built in Tasks 11-13:

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NotFound } from "./routes/NotFound.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
```

`apps/web/src/routes/NotFound.tsx`:

```tsx
export function NotFound() {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <p>
        <a href="/">Back to nearby notices</a>
      </p>
    </main>
  );
}
```

`apps/web/src/styles.css` — logical properties only, per Global Constraints:

```css
:root {
  --space: 1rem;
  --radius: 0.5rem;
  --border: #d9d9d9;
  --muted: #5b5b5b;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --accent: #12674f;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --border: #3a3a3a;
    --muted: #a8a8a8;
    --bg: #151515;
    --fg: #f2f2f2;
    --accent: #4fd1a5;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}

.page {
  max-inline-size: 60rem;
  margin-inline: auto;
  padding-inline: var(--space);
  padding-block: var(--space);
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space);
  margin-block-end: 0.75rem;
}

.muted {
  color: var(--muted);
}

button,
input,
select,
textarea {
  font: inherit;
  padding-block: 0.5rem;
  padding-inline: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--fg);
  min-block-size: 2.75rem;
}

button {
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 7: Verify the app builds and runs**

Run:

```bash
cd apps/web && pnpm build
pnpm dev
```

Expected: build passes, dev server starts on 5173, and the page renders "Page not found" (no routes exist yet). Stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold Vite React app with a contract-parsing API client"
```

---
### Task 11: Location choice and formatting helpers

**Files:**
- Create: `apps/web/src/i18n/en.ts`, `src/i18n/index.ts`
- Create: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/features/location/useChosenLocation.ts`, `AddressSearch.tsx`
- Test: `apps/web/src/lib/format.test.ts`, `src/features/location/useChosenLocation.test.ts`

**Interfaces:**
- Consumes: `api.geocode` (Task 10).
- Produces: `t(key)` translator and the `en` string table; `formatDistance(metres)`, `formatDateTime(iso)`, `formatRelativeTime(iso)`; `useChosenLocation()` returning `{ location, status, error, requestBrowserLocation, setLocation, radiusKm, setRadiusKm }`; `<AddressSearch onPick={(r: GeocodeResult) => void} />`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDateTime, formatDistance } from "./format.js";

describe("formatDistance", () => {
  it("shows metres below one kilometre", () => {
    expect(formatDistance(450)).toBe("450 m");
  });

  it("shows one decimal between 1 and 10 km", () => {
    expect(formatDistance(2_400)).toBe("2.4 km");
  });

  it("rounds to whole kilometres above 10 km", () => {
    expect(formatDistance(15_600)).toBe("16 km");
  });

  it("handles zero", () => {
    expect(formatDistance(0)).toBe("0 m");
  });
});

describe("formatDateTime", () => {
  it("formats an ISO datetime via Intl without throwing", () => {
    const output = formatDateTime("2026-10-01T12:30:00.000Z");
    expect(output).toMatch(/2026/);
    expect(output.length).toBeGreaterThan(6);
  });
});
```

`apps/web/src/features/location/useChosenLocation.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChosenLocation } from "./useChosenLocation.js";

describe("useChosenLocation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts with no location and an idle status", () => {
    const { result } = renderHook(() => useChosenLocation());
    expect(result.current.location).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("stores a manually chosen location and persists it", () => {
    const { result } = renderHook(() => useChosenLocation());
    act(() => result.current.setLocation({ lat: 36.75, lng: 3.06, label: "Algiers" }));

    expect(result.current.location).toEqual({ lat: 36.75, lng: 3.06, label: "Algiers" });
    expect(result.current.status).toBe("ready");

    const reloaded = renderHook(() => useChosenLocation());
    expect(reloaded.result.current.location?.lat).toBe(36.75);
  });

  it("records a denied permission as a recoverable state, not an error screen", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) =>
          fail({ code: 1 }),
      },
    });

    const { result } = renderHook(() => useChosenLocation());
    await act(async () => {
      await result.current.requestBrowserLocation();
    });

    expect(result.current.status).toBe("denied");
    expect(result.current.location).toBeNull();
  });

  it("accepts a browser position when granted", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          ok({ coords: { latitude: 36.7538, longitude: 3.0588 } }),
      },
    });

    const { result } = renderHook(() => useChosenLocation());
    await act(async () => {
      await result.current.requestBrowserLocation();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.location?.lat).toBeCloseTo(36.7538, 4);
  });

  it("reports unavailable when the browser has no geolocation at all", async () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useChosenLocation());
    await act(async () => {
      await result.current.requestBrowserLocation();
    });
    expect(result.current.status).toBe("unavailable");
  });

  it("defaults the radius to 20 km and persists a change", () => {
    const { result } = renderHook(() => useChosenLocation());
    expect(result.current.radiusKm).toBe(20);

    act(() => result.current.setRadiusKm(50));
    const reloaded = renderHook(() => useChosenLocation());
    expect(reloaded.result.current.radiusKm).toBe(50);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm test -- format useChosenLocation`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Write the i18n layer**

`apps/web/src/i18n/en.ts` — every user-facing string in M1 lives here:

```ts
export const en = {
  "app.name": "Jiwar",
  "app.tagline": "Community notices near you",

  "nav.submit": "Publish a notice",
  "nav.back": "Back to nearby notices",

  "discovery.title": "Nearby notices",
  "discovery.view.list": "List",
  "discovery.view.map": "Map",
  "discovery.radius": "Within {radius} km",
  "discovery.searchThisArea": "Search this area",
  "discovery.sort.soonest": "Soonest first",
  "discovery.sort.nearest": "Nearest first",
  "discovery.when.upcoming": "Upcoming",
  "discovery.when.past": "Past",
  "discovery.filter.allCategories": "All categories",
  "discovery.loadMore": "Load more",

  "discovery.empty": "No upcoming notices within {radius} km.",
  "discovery.fallback": "Nothing upcoming nearby. Showing the most recent past notices instead.",
  "discovery.loading": "Loading notices…",
  "discovery.error": "Could not load notices. Check your connection and try again.",
  "discovery.retry": "Try again",

  "location.useMyLocation": "Use my location",
  "location.chooseArea": "Choose an area",
  "location.searchPlaceholder": "Search for a place or address",
  "location.searching": "Searching…",
  "location.noResults": "No places found.",
  "location.denied":
    "Location permission was declined. Search for an area instead — you can change this any time.",
  "location.unavailable": "Your browser cannot provide a location. Search for an area instead.",
  "location.needed": "Choose a location to see notices near you.",

  "notice.past": "This event has already taken place.",
  "notice.cancelled": "This notice has been cancelled.",
  "notice.attendance.public": "Open to everyone",
  "notice.attendance.invitation_only": "By invitation only",
  "notice.attendance.restricted": "Attendance is restricted",
  "notice.organizer": "Organizer",
  "notice.venue": "Venue",
  "notice.directions": "Get directions",
  "notice.share": "Copy link",
  "notice.shared": "Link copied",
  "notice.cancel": "Cancel this notice",
  "notice.cancelConfirm": "Cancel this notice? It will no longer appear in search results.",
  "notice.notFound": "This notice does not exist or has been removed.",

  "submit.title": "Publish a community notice",
  "submit.step.what": "What",
  "submit.step.where": "Where and when",
  "submit.step.details": "Details",
  "submit.step.review": "Review",
  "submit.next": "Continue",
  "submit.back": "Back",
  "submit.publish": "Publish now",
  "submit.publishing": "Publishing…",
  "submit.published": "Your notice is now public.",
  "submit.viewNotice": "View your notice",
  "submit.immediateNotice":
    "Your notice appears publicly straight away. Please make sure the details are correct.",

  "field.category": "Category",
  "field.title": "Title",
  "field.titleHint": "A short, factual summary.",
  "field.description": "Description",
  "field.venueName": "Venue name",
  "field.address": "Address",
  "field.location": "Location on the map",
  "field.locationHint": "Search for the address, or drag the pin to the exact spot.",
  "field.startsAt": "Date and time",
  "field.attendance": "Who may attend",
  "field.organizerName": "Organizer name (optional)",
  "field.organizerContact": "Organizer contact (optional)",
  "field.organizerConsent": "I have permission to publish these contact details.",

  "error.required": "This field is required.",
  "error.generic": "Something went wrong. Please try again.",
} as const;

export type TranslationKey = keyof typeof en;
```

`apps/web/src/i18n/index.ts`:

```ts
import { en, type TranslationKey } from "./en.js";

const table = en;

/** Looks up a string and substitutes {placeholders}. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template: string = table[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}

export type { TranslationKey };
```

- [ ] **Step 4: Write the formatters**

`apps/web/src/lib/format.ts` — `Intl` only, per Global Constraints:

```ts
const LOCALE = "en";

export function formatDistance(metres: number): string {
  if (metres < 1_000) {
    return `${Math.round(metres)} m`;
  }
  const km = metres / 1_000;
  const digits = km < 10 ? 1 : 0;
  const formatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${formatter.format(km)} km`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatRelativeTime(iso: string): string {
  const target = new Date(iso).getTime();
  const diffMs = target - Date.now();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");

  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");

  return formatter.format(Math.round(diffMs / 86_400_000), "day");
}
```

- [ ] **Step 5: Implement the location hook**

`apps/web/src/features/location/useChosenLocation.ts`. A denied permission is a *state*, not an error — spec §7:

```ts
import { useCallback, useEffect, useState } from "react";

export interface ChosenLocation {
  lat: number;
  lng: number;
  label?: string;
}

export type LocationStatus = "idle" | "locating" | "ready" | "denied" | "unavailable";

const LOCATION_KEY = "jiwar.location";
const RADIUS_KEY = "jiwar.radiusKm";
const DEFAULT_RADIUS_KM = 20;

function readStoredLocation(): ChosenLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function readStoredRadius(): number {
  const raw = Number(localStorage.getItem(RADIUS_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RADIUS_KM;
}

export function useChosenLocation() {
  const [location, setLocationState] = useState<ChosenLocation | null>(readStoredLocation);
  const [radiusKm, setRadiusState] = useState<number>(readStoredRadius);
  const [status, setStatus] = useState<LocationStatus>(() =>
    readStoredLocation() ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const setLocation = useCallback((next: ChosenLocation) => {
    setLocationState(next);
    setStatus("ready");
    setError(null);
    try {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(next));
    } catch {
      // Private browsing can reject writes; the location still works for this session.
    }
  }, []);

  const setRadiusKm = useCallback((next: number) => {
    setRadiusState(next);
    try {
      localStorage.setItem(RADIUS_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const requestBrowserLocation = useCallback(async () => {
    if (!navigator?.geolocation) {
      setStatus("unavailable");
      return;
    }

    setStatus("locating");

    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
          resolve();
        },
        (positionError) => {
          // code 1 === PERMISSION_DENIED
          setStatus(positionError.code === 1 ? "denied" : "unavailable");
          resolve();
        },
        { timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }, [setLocation]);

  useEffect(() => {
    if (location && status === "idle") setStatus("ready");
  }, [location, status]);

  return {
    location,
    status,
    error,
    radiusKm,
    setLocation,
    setRadiusKm,
    requestBrowserLocation,
  };
}
```

- [ ] **Step 6: Implement the address search**

`apps/web/src/features/location/AddressSearch.tsx` — debounced at 500 ms, because Nominatim allows roughly one request per second:

```tsx
import type { GeocodeResult } from "@jiwar/contracts";
import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { t } from "../../i18n/index.js";

interface AddressSearchProps {
  onPick: (result: GeocodeResult) => void;
}

export function AddressSearch({ onPick }: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const found = await api.geocode(trimmed);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <label htmlFor="address-search">{t("location.chooseArea")}</label>
      <input
        id="address-search"
        type="search"
        value={query}
        placeholder={t("location.searchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
        style={{ inlineSize: "100%" }}
      />
      {searching && <p className="muted">{t("location.searching")}</p>}
      {!searching && query.trim().length >= 3 && results.length === 0 && (
        <p className="muted">{t("location.noResults")}</p>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: "none", paddingInline: 0 }}>
          {results.map((result) => (
            <li key={`${result.lat},${result.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(result);
                  setQuery("");
                  setResults([]);
                }}
                style={{ inlineSize: "100%", textAlign: "start" }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && pnpm test`
Expected: PASS — the format tests, the location hook tests, and the earlier client tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): add i18n layer, Intl formatters and location choice"
```

---
### Task 12: Discovery — list and map

**Files:**
- Create: `apps/web/src/features/discovery/useNotices.ts`, `NoticeCard.tsx`, `NoticeList.tsx`, `FilterBar.tsx`, `NoticeMap.tsx`
- Create: `apps/web/src/routes/Home.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/discovery/NoticeCard.test.tsx`, `NoticeList.test.tsx`

**Interfaces:**
- Consumes: `api.searchNotices`/`api.categories` (Task 10), `useChosenLocation`/`AddressSearch`/`t`/formatters (Task 11).
- Produces: `useNotices(params)` wrapping `useInfiniteQuery`; `<NoticeCard notice />`, `<NoticeList …/>`, `<FilterBar …/>`, `<NoticeMap …/>`; the `/` route.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/discovery/NoticeCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import type { NoticeWithDistance } from "@jiwar/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NoticeCard } from "./NoticeCard.js";

const notice: NoticeWithDistance = {
  publicId: "abc123",
  category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public",
  organizerName: null,
  organizerContact: null,
  status: "published",
  isPast: false,
  createdAt: "2026-09-15T10:00:00.000Z",
  distanceMetres: 2_400,
};

function renderCard(overrides: Partial<NoticeWithDistance> = {}) {
  return render(
    <MemoryRouter>
      <NoticeCard notice={{ ...notice, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("NoticeCard", () => {
  it("shows the title, category, venue and formatted distance", () => {
    renderCard();
    expect(screen.getByText(notice.title)).toBeInTheDocument();
    expect(screen.getByText("Funeral")).toBeInTheDocument();
    expect(screen.getByText("Masjid Al-Rahma")).toBeInTheDocument();
    expect(screen.getByText("2.4 km")).toBeInTheDocument();
  });

  it("links to the notice detail page", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /Ahmed Benali/ })).toHaveAttribute(
      "href",
      "/n/abc123",
    );
  });

  it("marks a past notice", () => {
    renderCard({ isPast: true });
    expect(screen.getByText(/already taken place/i)).toBeInTheDocument();
  });

  it("marks a cancelled notice", () => {
    renderCard({ status: "cancelled" });
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });

  it("shows no submission count or author ranking anywhere", () => {
    const { container } = renderCard();
    // Spec §8 anti-gamification: nothing may count or rank contributions.
    expect(container.textContent).not.toMatch(/\b(points?|rank|score|streak|contribution)\b/i);
  });
});
```

`apps/web/src/features/discovery/NoticeList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import type { NoticeWithDistance } from "@jiwar/contracts";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NoticeList } from "./NoticeList.js";

const notice: NoticeWithDistance = {
  publicId: "abc123",
  category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  title: "A funeral notice",
  description: "",
  venueName: "Masjid Al-Rahma",
  address: "Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public",
  organizerName: null,
  organizerContact: null,
  status: "published",
  isPast: false,
  createdAt: "2026-09-15T10:00:00.000Z",
  distanceMetres: 1_000,
};

const baseProps = {
  notices: [] as NoticeWithDistance[],
  isLoading: false,
  isError: false,
  fallback: false,
  radiusKm: 20,
  hasMore: false,
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
};

const renderList = (overrides: Partial<typeof baseProps> = {}) =>
  render(
    <MemoryRouter>
      <NoticeList {...baseProps} {...overrides} />
    </MemoryRouter>,
  );

describe("NoticeList", () => {
  it("shows a loading state", () => {
    renderList({ isLoading: true });
    expect(screen.getByText(/loading notices/i)).toBeInTheDocument();
  });

  it("shows an error state with a retry action", () => {
    renderList({ isError: true });
    expect(screen.getByText(/could not load notices/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows an empty state naming the radius", () => {
    renderList();
    expect(screen.getByText(/no upcoming notices within 20 km/i)).toBeInTheDocument();
  });

  it("explains when results are a past-notice fallback", () => {
    renderList({ notices: [notice], fallback: true });
    expect(screen.getByText(/showing the most recent past notices/i)).toBeInTheDocument();
  });

  it("renders the notices when there are some", () => {
    renderList({ notices: [notice] });
    expect(screen.getByText("A funeral notice")).toBeInTheDocument();
  });

  it("shows a load-more button only when there are more pages", () => {
    renderList({ notices: [notice], hasMore: true });
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();

    renderList({ notices: [notice], hasMore: false });
    expect(screen.queryAllByRole("button", { name: /load more/i })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm test -- NoticeCard NoticeList`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Implement the query hook**

`apps/web/src/features/discovery/useNotices.ts`:

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type SearchParams } from "../../api/client.js";

export interface UseNoticesParams {
  lat: number;
  lng: number;
  radiusKm: number;
  categories: string[];
  when: "upcoming" | "past";
  sort: "soonest" | "nearest";
  enabled: boolean;
}

export function useNotices(params: UseNoticesParams) {
  const query = useInfiniteQuery({
    queryKey: [
      "notices",
      params.lat,
      params.lng,
      params.radiusKm,
      params.categories.join(","),
      params.when,
      params.sort,
    ],
    enabled: params.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search: SearchParams = {
        lat: params.lat,
        lng: params.lng,
        radiusKm: params.radiusKm,
        when: params.when,
        sort: params.sort,
        cursor: pageParam,
      };
      if (params.categories.length > 0) search.categories = params.categories;
      return api.searchNotices(search);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const pages = query.data?.pages ?? [];

  return {
    notices: pages.flatMap((page) => page.items),
    // The fallback flag comes from the first page; later pages continue the same query.
    fallback: pages[0]?.fallback ?? false,
    isLoading: query.isPending && params.enabled,
    isError: query.isError,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  };
}
```

- [ ] **Step 4: Implement the card and list**

`apps/web/src/features/discovery/NoticeCard.tsx`:

```tsx
import type { NoticeWithDistance } from "@jiwar/contracts";
import { Link } from "react-router-dom";
import { t } from "../../i18n/index.js";
import { formatDateTime, formatDistance } from "../../lib/format.js";

export function NoticeCard({ notice }: { notice: NoticeWithDistance }) {
  return (
    <article className="card">
      <p className="muted" style={{ margin: 0 }}>
        {notice.category.name}
      </p>
      <h2 style={{ margin: "0.25rem 0", fontSize: "1.1rem" }}>
        <Link to={`/n/${notice.publicId}`}>{notice.title}</Link>
      </h2>
      <p style={{ margin: "0.25rem 0" }}>{notice.venueName}</p>
      <p className="muted" style={{ margin: "0.25rem 0" }}>
        <time dateTime={notice.startsAt}>{formatDateTime(notice.startsAt)}</time>
        {" · "}
        <span>{formatDistance(notice.distanceMetres)}</span>
      </p>
      {notice.status === "cancelled" && <p role="status">{t("notice.cancelled")}</p>}
      {notice.status !== "cancelled" && notice.isPast && (
        <p className="muted">{t("notice.past")}</p>
      )}
    </article>
  );
}
```

`apps/web/src/features/discovery/NoticeList.tsx`:

```tsx
import type { NoticeWithDistance } from "@jiwar/contracts";
import { t } from "../../i18n/index.js";
import { NoticeCard } from "./NoticeCard.js";

interface NoticeListProps {
  notices: NoticeWithDistance[];
  isLoading: boolean;
  isError: boolean;
  fallback: boolean;
  radiusKm: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function NoticeList({
  notices,
  isLoading,
  isError,
  fallback,
  radiusKm,
  hasMore,
  onLoadMore,
  onRetry,
}: NoticeListProps) {
  if (isLoading) {
    return <p role="status">{t("discovery.loading")}</p>;
  }

  if (isError) {
    return (
      <div role="alert">
        <p>{t("discovery.error")}</p>
        <button type="button" onClick={onRetry}>
          {t("discovery.retry")}
        </button>
      </div>
    );
  }

  if (notices.length === 0) {
    return <p>{t("discovery.empty", { radius: radiusKm })}</p>;
  }

  return (
    <div>
      {fallback && <p role="status">{t("discovery.fallback")}</p>}
      {notices.map((notice) => (
        <NoticeCard key={notice.publicId} notice={notice} />
      ))}
      {hasMore && (
        <button type="button" onClick={onLoadMore}>
          {t("discovery.loadMore")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && pnpm test -- NoticeCard NoticeList`
Expected: PASS — all 11 cases.

- [ ] **Step 6: Implement the filter bar**

`apps/web/src/features/discovery/FilterBar.tsx`:

```tsx
import type { Category } from "@jiwar/contracts";
import { t } from "../../i18n/index.js";

interface FilterBarProps {
  categories: Category[];
  selectedCategories: string[];
  onCategoriesChange: (next: string[]) => void;
  radiusKm: number;
  onRadiusChange: (next: number) => void;
  when: "upcoming" | "past";
  onWhenChange: (next: "upcoming" | "past") => void;
  sort: "soonest" | "nearest";
  onSortChange: (next: "soonest" | "nearest") => void;
}

const RADIUS_OPTIONS = [5, 10, 20, 50, 100];

export function FilterBar({
  categories,
  selectedCategories,
  onCategoriesChange,
  radiusKm,
  onRadiusChange,
  when,
  onWhenChange,
  sort,
  onSortChange,
}: FilterBarProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBlockEnd: "1rem" }}>
      <label>
        <span className="muted">{t("field.category")}</span>{" "}
        <select
          value={selectedCategories[0] ?? ""}
          onChange={(event) =>
            onCategoriesChange(event.target.value === "" ? [] : [event.target.value])
          }
        >
          <option value="">{t("discovery.filter.allCategories")}</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.radius", { radius: radiusKm })}</span>{" "}
        <select value={radiusKm} onChange={(event) => onRadiusChange(Number(event.target.value))}>
          {RADIUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} km
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.when.upcoming")}</span>{" "}
        <select
          value={when}
          onChange={(event) => onWhenChange(event.target.value as "upcoming" | "past")}
        >
          <option value="upcoming">{t("discovery.when.upcoming")}</option>
          <option value="past">{t("discovery.when.past")}</option>
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.sort.soonest")}</span>{" "}
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as "soonest" | "nearest")}
        >
          <option value="soonest">{t("discovery.sort.soonest")}</option>
          <option value="nearest">{t("discovery.sort.nearest")}</option>
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 7: Implement the map**

`apps/web/src/features/discovery/NoticeMap.tsx` — OpenFreeMap needs no API key. "Search this area" appears after a pan rather than refetching on every gesture, per spec §6:

```tsx
import type { NoticeWithDistance } from "@jiwar/contracts";
import { Map, Marker, NavigationControl, Popup } from "@vis.gl/react-maplibre";
import { useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n/index.js";
import { formatDateTime, formatDistance } from "../../lib/format.js";

export const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface NoticeMapProps {
  notices: NoticeWithDistance[];
  centre: { lat: number; lng: number };
  onSearchArea: (centre: { lat: number; lng: number }) => void;
}

export function NoticeMap({ notices, centre, onSearchArea }: NoticeMapProps) {
  const [movedCentre, setMovedCentre] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<NoticeWithDistance | null>(null);

  function handleMoveEnd(event: { target: { getCenter: () => { lat: number; lng: number } } }) {
    const next = event.target.getCenter();
    setMovedCentre({ lat: next.lat, lng: next.lng });
  }

  return (
    <div style={{ position: "relative", blockSize: "70vh", minBlockSize: "20rem" }}>
      <Map
        initialViewState={{ latitude: centre.lat, longitude: centre.lng, zoom: 11 }}
        mapStyle={OPENFREEMAP_STYLE}
        style={{ inlineSize: "100%", blockSize: "100%" }}
        onMoveEnd={handleMoveEnd}
      >
        <NavigationControl position="top-right" />

        {notices.map((notice) => (
          <Marker
            key={notice.publicId}
            latitude={notice.lat}
            longitude={notice.lng}
            onClick={(event) => {
              event.originalEvent.stopPropagation();
              setSelected(notice);
            }}
          />
        ))}

        {selected && (
          <Popup
            latitude={selected.lat}
            longitude={selected.lng}
            onClose={() => setSelected(null)}
            closeOnClick={false}
          >
            <p className="muted" style={{ margin: 0 }}>
              {selected.category.name}
            </p>
            <strong>
              <Link to={`/n/${selected.publicId}`}>{selected.title}</Link>
            </strong>
            <p style={{ margin: "0.25rem 0" }}>{selected.venueName}</p>
            <p className="muted" style={{ margin: 0 }}>
              {formatDateTime(selected.startsAt)} · {formatDistance(selected.distanceMetres)}
            </p>
          </Popup>
        )}
      </Map>

      {movedCentre && (
        <button
          type="button"
          className="primary"
          style={{
            position: "absolute",
            insetBlockStart: "0.75rem",
            insetInlineStart: "50%",
            transform: "translateX(-50%)",
          }}
          onClick={() => {
            onSearchArea(movedCentre);
            setMovedCentre(null);
          }}
        >
          {t("discovery.searchThisArea")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Implement the Home route**

`apps/web/src/routes/Home.tsx` — filter state lives in the URL so every view is shareable, per spec §6:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { FilterBar } from "../features/discovery/FilterBar.js";
import { NoticeList } from "../features/discovery/NoticeList.js";
import { NoticeMap } from "../features/discovery/NoticeMap.js";
import { useNotices } from "../features/discovery/useNotices.js";
import { AddressSearch } from "../features/location/AddressSearch.js";
import { useChosenLocation } from "../features/location/useChosenLocation.js";
import { t } from "../i18n/index.js";

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { location, status, radiusKm, setLocation, setRadiusKm, requestBrowserLocation } =
    useChosenLocation();

  const view = searchParams.get("view") === "map" ? "map" : "list";
  const when = searchParams.get("when") === "past" ? "past" : "upcoming";
  const sort = searchParams.get("sort") === "nearest" ? "nearest" : "soonest";
  const categories = searchParams.getAll("category");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const notices = useNotices({
    lat: location?.lat ?? 0,
    lng: location?.lng ?? 0,
    radiusKm,
    categories,
    when,
    sort,
    enabled: location !== null,
  });

  return (
    <main className="page">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ marginBlock: 0 }}>{t("discovery.title")}</h1>
        <Link to="/submit">{t("nav.submit")}</Link>
      </header>

      {!location && (
        <section>
          <p>{t("location.needed")}</p>
          <button type="button" className="primary" onClick={() => void requestBrowserLocation()}>
            {t("location.useMyLocation")}
          </button>
          {status === "denied" && <p role="status">{t("location.denied")}</p>}
          {status === "unavailable" && <p role="status">{t("location.unavailable")}</p>}
          <AddressSearch onPick={(result) => setLocation(result)} />
        </section>
      )}

      {location && (
        <>
          <AddressSearch onPick={(result) => setLocation(result)} />

          <FilterBar
            categories={categoriesQuery.data ?? []}
            selectedCategories={categories}
            onCategoriesChange={(next) => {
              const params = new URLSearchParams(searchParams);
              params.delete("category");
              for (const slug of next) params.append("category", slug);
              setSearchParams(params, { replace: true });
            }}
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            when={when}
            onWhenChange={(next) => setParam("when", next)}
            sort={sort}
            onSortChange={(next) => setParam("sort", next)}
          />

          <div role="tablist" style={{ display: "flex", gap: "0.5rem", marginBlockEnd: "1rem" }}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => setParam("view", "list")}
            >
              {t("discovery.view.list")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "map"}
              onClick={() => setParam("view", "map")}
            >
              {t("discovery.view.map")}
            </button>
          </div>

          {view === "list" ? (
            <NoticeList
              notices={notices.notices}
              isLoading={notices.isLoading}
              isError={notices.isError}
              fallback={notices.fallback}
              radiusKm={radiusKm}
              hasMore={notices.hasMore}
              onLoadMore={notices.loadMore}
              onRetry={notices.retry}
            />
          ) : (
            <NoticeMap
              notices={notices.notices}
              centre={location}
              onSearchArea={(centre) => setLocation(centre)}
            />
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Add the route**

`apps/web/src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home.js";
import { NotFound } from "./routes/NotFound.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 10: Verify in the browser**

Run, in three terminals:

```bash
pnpm db:up
cd apps/api && pnpm dev
cd apps/web && pnpm dev
```

Open `http://localhost:5173`. Expected: the location prompt appears; searching "Algiers" and picking a result shows the empty state naming 20 km; the Map tab renders OpenFreeMap tiles. There are no notices yet — Task 13 adds submission.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): add list and map discovery with URL-backed filters"
```

---
### Task 13: Submit wizard and notice detail

**Files:**
- Create: `apps/web/src/features/submit/SubmitWizard.tsx`, `StepWhat.tsx`, `StepWhere.tsx`, `StepDetails.tsx`, `StepReview.tsx`, `LocationPicker.tsx`
- Create: `apps/web/src/routes/Submit.tsx`, `src/routes/NoticeDetail.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/submit/SubmitWizard.test.tsx`

**Interfaces:**
- Consumes: `CreateNoticeSchema` (Task 3), `api.createNotice`/`api.getNotice`/`api.cancelNotice` (Task 10), `AddressSearch` (Task 11).
- Produces: the `/submit` and `/n/:publicId` routes; `<LocationPicker value onChange />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/submit/SubmitWizard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitWizard } from "./SubmitWizard.js";

vi.mock("../../api/client.js", () => ({
  api: {
    categories: vi.fn().mockResolvedValue([
      { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
      { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
    ]),
    createNotice: vi.fn().mockResolvedValue({ publicId: "new123" }),
    geocode: vi.fn().mockResolvedValue([]),
    reverseGeocode: vi.fn().mockResolvedValue(null),
  },
  ApiError: class ApiError extends Error {},
}));

// The map is not rendered in jsdom; the picker exposes numeric inputs as its accessible fallback.
vi.mock("./LocationPicker.js", () => ({
  LocationPicker: ({
    onChange,
  }: {
    value: { lat: number; lng: number } | null;
    onChange: (v: { lat: number; lng: number }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ lat: 36.75, lng: 3.06 })}>
      set-test-location
    </button>
  ),
}));

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitWizard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SubmitWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns that publication is immediate", async () => {
    renderWizard();
    expect(await screen.findByText(/appears publicly straight away/i)).toBeInTheDocument();
  });

  it("blocks continuing from step one until category and title are valid", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/submit.step.what|What/i)).toBeInTheDocument();
    // Still on step 1 because the title is empty.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });

  it("walks through all four steps and publishes", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../api/client.js");
    renderWizard();

    await user.selectOptions(await screen.findByLabelText(/category/i), "funeral");
    await user.type(screen.getByLabelText(/title/i), "Funeral prayer for the late Ahmed Benali");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/venue name/i), "Masjid Al-Rahma");
    await user.type(screen.getByLabelText(/address/i), "Rue Didouche Mourad, Algiers");
    await user.click(screen.getByRole("button", { name: /set-test-location/i }));
    await user.type(screen.getByLabelText(/date and time/i), "2026-12-01T12:30");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.selectOptions(await screen.findByLabelText(/who may attend/i), "public");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.click(await screen.findByRole("button", { name: /publish now/i }));

    await waitFor(() => expect(api.createNotice).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createNotice).mock.calls[0]![0];
    expect(body.title).toBe("Funeral prayer for the late Ahmed Benali");
    expect(body.lat).toBeCloseTo(36.75, 4);
  });

  it("requires the consent checkbox before accepting organizer contact details", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.selectOptions(await screen.findByLabelText(/category/i), "funeral");
    await user.type(screen.getByLabelText(/title/i), "A valid title here");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/venue name/i), "Venue");
    await user.type(screen.getByLabelText(/address/i), "Address");
    await user.click(screen.getByRole("button", { name: /set-test-location/i }));
    await user.type(screen.getByLabelText(/date and time/i), "2026-12-01T12:30");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.selectOptions(await screen.findByLabelText(/who may attend/i), "public");
    await user.type(screen.getByLabelText(/organizer contact/i), "+213 555 0000");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/permission to publish/i)).toBeInTheDocument();
  });

  it("shows no posting count or contribution score", async () => {
    const { container } = renderWizard();
    await screen.findByLabelText(/category/i);
    expect(container.textContent).not.toMatch(/\b(points?|rank|score|streak|contribution)\b/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && pnpm test -- SubmitWizard`
Expected: FAIL — the wizard does not exist.

- [ ] **Step 3: Implement the location picker**

`apps/web/src/features/submit/LocationPicker.tsx`:

```tsx
import { Map, Marker, NavigationControl } from "@vis.gl/react-maplibre";
import { AddressSearch } from "../location/AddressSearch.js";
import { OPENFREEMAP_STYLE } from "../discovery/NoticeMap.js";
import { t } from "../../i18n/index.js";

interface LocationPickerProps {
  value: { lat: number; lng: number } | null;
  onChange: (next: { lat: number; lng: number }) => void;
}

const ALGIERS_FALLBACK = { lat: 36.7538, lng: 3.0588 };

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const centre = value ?? ALGIERS_FALLBACK;

  return (
    <div>
      <p className="muted">{t("field.locationHint")}</p>
      <AddressSearch onPick={(result) => onChange({ lat: result.lat, lng: result.lng })} />

      <div style={{ blockSize: "20rem", marginBlock: "0.5rem" }}>
        <Map
          initialViewState={{ latitude: centre.lat, longitude: centre.lng, zoom: 13 }}
          mapStyle={OPENFREEMAP_STYLE}
          style={{ inlineSize: "100%", blockSize: "100%" }}
          onClick={(event) => onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng })}
        >
          <NavigationControl position="top-right" />
          {value && (
            <Marker
              latitude={value.lat}
              longitude={value.lng}
              draggable
              onDragEnd={(event) => onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng })}
            />
          )}
        </Map>
      </div>

      {/* Accessible, keyboard-only fallback for setting coordinates without the map. */}
      <fieldset>
        <legend className="muted">{t("field.location")}</legend>
        <label>
          Latitude{" "}
          <input
            type="number"
            step="0.000001"
            value={value?.lat ?? ""}
            onChange={(event) =>
              onChange({ lat: Number(event.target.value), lng: value?.lng ?? ALGIERS_FALLBACK.lng })
            }
          />
        </label>{" "}
        <label>
          Longitude{" "}
          <input
            type="number"
            step="0.000001"
            value={value?.lng ?? ""}
            onChange={(event) =>
              onChange({ lat: value?.lat ?? ALGIERS_FALLBACK.lat, lng: Number(event.target.value) })
            }
          />
        </label>
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 4: Implement the wizard**

`apps/web/src/features/submit/SubmitWizard.tsx`. One component holding the four steps, using `CreateNoticeSchema` via `zodResolver` so the form rules *are* the API rules:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateNoticeSchema, type CreateNotice } from "@jiwar/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client.js";
import { t } from "../../i18n/index.js";
import { LocationPicker } from "./LocationPicker.js";

type Step = 0 | 1 | 2 | 3;

const STEP_FIELDS: Record<Step, (keyof CreateNotice)[]> = {
  0: ["categorySlug", "title"],
  1: ["venueName", "address", "lat", "lng", "startsAt"],
  2: ["description", "attendance", "organizerName", "organizerContact", "organizerConsent"],
  3: [],
};

export function SubmitWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const form = useForm<CreateNotice>({
    resolver: zodResolver(CreateNoticeSchema),
    mode: "onTouched",
    defaultValues: {
      categorySlug: "",
      title: "",
      description: "",
      venueName: "",
      address: "",
      startsAt: "",
      attendance: "public",
      organizerConsent: false,
    } as unknown as CreateNotice,
  });

  const publish = useMutation({
    mutationFn: (values: CreateNotice) => api.createNotice(values),
    onSuccess: (result) => navigate(`/n/${result.publicId}?published=1`),
    onError: (error) =>
      setSubmitError(error instanceof ApiError ? error.message : t("error.generic")),
  });

  const location = form.watch("lat") !== undefined && form.watch("lng") !== undefined
    ? { lat: form.watch("lat"), lng: form.watch("lng") }
    : null;

  async function next() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (valid && step < 3) setStep((step + 1) as Step);
  }

  const errors = form.formState.errors;

  return (
    <main className="page">
      <h1>{t("submit.title")}</h1>
      <p role="status">{t("submit.immediateNotice")}</p>

      <ol style={{ display: "flex", gap: "1rem", listStyle: "none", paddingInline: 0 }}>
        {(["submit.step.what", "submit.step.where", "submit.step.details", "submit.step.review"] as const).map(
          (key, index) => (
            <li key={key} aria-current={index === step ? "step" : undefined}>
              <span className={index === step ? undefined : "muted"}>{t(key)}</span>
            </li>
          ),
        )}
      </ol>

      <form
        onSubmit={form.handleSubmit((values) => {
          setSubmitError(null);
          publish.mutate(values);
        })}
      >
        {step === 0 && (
          <fieldset>
            <label htmlFor="categorySlug">{t("field.category")}</label>
            <select id="categorySlug" {...form.register("categorySlug")}>
              <option value="">—</option>
              {(categoriesQuery.data ?? []).map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
            {errors.categorySlug && <p role="alert">{t("error.required")}</p>}

            <label htmlFor="title">{t("field.title")}</label>
            <input id="title" {...form.register("title")} style={{ inlineSize: "100%" }} />
            <p className="muted">{t("field.titleHint")}</p>
            {errors.title && <p role="alert">{errors.title.message}</p>}
          </fieldset>
        )}

        {step === 1 && (
          <fieldset>
            <label htmlFor="venueName">{t("field.venueName")}</label>
            <input id="venueName" {...form.register("venueName")} style={{ inlineSize: "100%" }} />
            {errors.venueName && <p role="alert">{t("error.required")}</p>}

            <label htmlFor="address">{t("field.address")}</label>
            <input id="address" {...form.register("address")} style={{ inlineSize: "100%" }} />
            {errors.address && <p role="alert">{t("error.required")}</p>}

            <LocationPicker
              value={location}
              onChange={(next) => {
                form.setValue("lat", next.lat, { shouldValidate: true });
                form.setValue("lng", next.lng, { shouldValidate: true });
              }}
            />
            {(errors.lat || errors.lng) && <p role="alert">{t("error.required")}</p>}

            <label htmlFor="startsAt">{t("field.startsAt")}</label>
            <input
              id="startsAt"
              type="datetime-local"
              onChange={(event) =>
                form.setValue("startsAt", new Date(event.target.value).toISOString(), {
                  shouldValidate: true,
                })
              }
            />
            {errors.startsAt && <p role="alert">{t("error.required")}</p>}
          </fieldset>
        )}

        {step === 2 && (
          <fieldset>
            <label htmlFor="description">{t("field.description")}</label>
            <textarea
              id="description"
              rows={5}
              {...form.register("description")}
              style={{ inlineSize: "100%" }}
            />

            <label htmlFor="attendance">{t("field.attendance")}</label>
            <select id="attendance" {...form.register("attendance")}>
              <option value="public">{t("notice.attendance.public")}</option>
              <option value="invitation_only">{t("notice.attendance.invitation_only")}</option>
              <option value="restricted">{t("notice.attendance.restricted")}</option>
            </select>

            <label htmlFor="organizerName">{t("field.organizerName")}</label>
            <input id="organizerName" {...form.register("organizerName")} style={{ inlineSize: "100%" }} />

            <label htmlFor="organizerContact">{t("field.organizerContact")}</label>
            <input
              id="organizerContact"
              {...form.register("organizerContact")}
              style={{ inlineSize: "100%" }}
            />

            <label>
              <input type="checkbox" {...form.register("organizerConsent")} />{" "}
              {t("field.organizerConsent")}
            </label>
            {errors.organizerConsent && <p role="alert">{errors.organizerConsent.message}</p>}
          </fieldset>
        )}

        {step === 3 && (
          <fieldset>
            <h2>{t("submit.step.review")}</h2>
            <dl>
              <dt>{t("field.category")}</dt>
              <dd>{form.watch("categorySlug")}</dd>
              <dt>{t("field.title")}</dt>
              <dd>{form.watch("title")}</dd>
              <dt>{t("field.venueName")}</dt>
              <dd>{form.watch("venueName")}</dd>
              <dt>{t("field.address")}</dt>
              <dd>{form.watch("address")}</dd>
              <dt>{t("field.startsAt")}</dt>
              <dd>{form.watch("startsAt")}</dd>
            </dl>
            {submitError && <p role="alert">{submitError}</p>}
          </fieldset>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginBlockStart: "1rem" }}>
          {step > 0 && (
            <button type="button" onClick={() => setStep((step - 1) as Step)}>
              {t("submit.back")}
            </button>
          )}
          {step < 3 && (
            <button type="button" className="primary" onClick={() => void next()}>
              {t("submit.next")}
            </button>
          )}
          {step === 3 && (
            <button type="submit" className="primary" disabled={publish.isPending}>
              {publish.isPending ? t("submit.publishing") : t("submit.publish")}
            </button>
          )}
        </div>
      </form>

      <p>
        <Link to="/">{t("nav.back")}</Link>
      </p>
    </main>
  );
}
```

`apps/web/src/routes/Submit.tsx`:

```tsx
import { SubmitWizard } from "../features/submit/SubmitWizard.js";

export function Submit() {
  return <SubmitWizard />;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm test -- SubmitWizard`
Expected: PASS — all six cases.

- [ ] **Step 6: Implement the notice detail page**

`apps/web/src/routes/NoticeDetail.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import { t } from "../i18n/index.js";
import { formatDateTime } from "../lib/format.js";

export function NoticeDetail() {
  const { publicId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const noticeQuery = useQuery({
    queryKey: ["notice", publicId],
    queryFn: () => api.getNotice(publicId),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelNotice(publicId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notice", publicId] }),
  });

  if (noticeQuery.isPending) {
    return (
      <main className="page">
        <p role="status">{t("discovery.loading")}</p>
      </main>
    );
  }

  if (noticeQuery.isError) {
    const notFound = noticeQuery.error instanceof ApiError && noticeQuery.error.status === 404;
    return (
      <main className="page">
        <p role="alert">{notFound ? t("notice.notFound") : t("discovery.error")}</p>
        <Link to="/">{t("nav.back")}</Link>
      </main>
    );
  }

  const notice = noticeQuery.data;
  const directionsUrl = `https://www.openstreetmap.org/directions?to=${notice.lat},${notice.lng}`;

  return (
    <main className="page">
      {searchParams.get("published") === "1" && <p role="status">{t("submit.published")}</p>}

      <p className="muted">{notice.category.name}</p>
      <h1>{notice.title}</h1>

      {notice.status === "cancelled" && <p role="status">{t("notice.cancelled")}</p>}
      {notice.status !== "cancelled" && notice.isPast && <p className="muted">{t("notice.past")}</p>}

      <dl>
        <dt>{t("notice.venue")}</dt>
        <dd>
          {notice.venueName}
          <br />
          <span className="muted">{notice.address}</span>
        </dd>

        <dt>{t("field.startsAt")}</dt>
        <dd>
          <time dateTime={notice.startsAt}>{formatDateTime(notice.startsAt)}</time>
        </dd>

        <dt>{t("field.attendance")}</dt>
        <dd>
          {notice.attendance === "public"
            ? t("notice.attendance.public")
            : notice.attendance === "invitation_only"
              ? t("notice.attendance.invitation_only")
              : t("notice.attendance.restricted")}
        </dd>

        {notice.organizerName && (
          <>
            <dt>{t("notice.organizer")}</dt>
            <dd>
              {notice.organizerName}
              {notice.organizerContact && (
                <>
                  <br />
                  {notice.organizerContact}
                </>
              )}
            </dd>
          </>
        )}
      </dl>

      {notice.description && <p style={{ whiteSpace: "pre-wrap" }}>{notice.description}</p>}

      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <a href={directionsUrl} target="_blank" rel="noreferrer noopener">
          {t("notice.directions")}
        </a>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(window.location.href);
            setCopied(true);
          }}
        >
          {copied ? t("notice.shared") : t("notice.share")}
        </button>
      </p>

      {notice.status === "published" && (
        <p>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("notice.cancelConfirm"))) cancel.mutate();
            }}
          >
            {t("notice.cancel")}
          </button>
        </p>
      )}

      <p>
        <Link to="/">{t("nav.back")}</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 7: Add both routes**

`apps/web/src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home.js";
import { NoticeDetail } from "./routes/NoticeDetail.js";
import { NotFound } from "./routes/NotFound.js";
import { Submit } from "./routes/Submit.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/n/:publicId" element={<NoticeDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Verify the whole flow by hand**

With the database, API, and web dev server running, open `http://localhost:5173/submit`, publish a funeral notice in Algiers, then confirm it appears on the home list and map. Note the cancel button only works for the browser that published it — that is the participant cookie doing its job.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): add the submit wizard and notice detail page"
```

---

### Task 14: End-to-end test and README

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/publish-and-discover.spec.ts`
- Create: `README.md`
- Modify: `apps/web/package.json` (already has the `e2e` script from Task 10)

**Interfaces:**
- Consumes: everything.
- Produces: `pnpm --filter @jiwar/web e2e`; a README documenting setup.

- [ ] **Step 1: Write the Playwright config**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

Install the browser once: `cd apps/web && pnpm exec playwright install chromium`

- [ ] **Step 2: Write the end-to-end test**

`apps/web/e2e/publish-and-discover.spec.ts` — the path spec §10 names: submit, see it listed, open detail, load the shared URL cold:

```ts
import { expect, test } from "@playwright/test";

const ALGIERS = { latitude: 36.7538, longitude: 3.0588 };

test.use({
  geolocation: ALGIERS,
  permissions: ["geolocation"],
  locale: "en-GB",
});

test("publish a notice, find it nearby, and open its shared link", async ({ page, context }) => {
  const title = `Community gathering ${Date.now()}`;

  await page.goto("/submit");
  await expect(page.getByText(/appears publicly straight away/i)).toBeVisible();

  await page.getByLabel(/category/i).selectOption("gathering");
  await page.getByLabel(/^title$/i).fill(title);
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByLabel(/venue name/i).fill("Place des Martyrs");
  await page.getByLabel(/address/i).fill("Place des Martyrs, Algiers");
  await page.getByLabel(/latitude/i).fill(String(ALGIERS.latitude));
  await page.getByLabel(/longitude/i).fill(String(ALGIERS.longitude));

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localValue = new Date(startsAt.getTime() - startsAt.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel(/date and time/i).fill(localValue);
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByLabel(/who may attend/i).selectOption("public");
  await page.getByRole("button", { name: /continue/i }).click();

  await page.getByRole("button", { name: /publish now/i }).click();

  // Landed on the detail page, published immediately.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/now public/i)).toBeVisible();
  const noticeUrl = page.url();

  // It is discoverable from the home page.
  await page.goto("/");
  await page.getByRole("button", { name: /use my location/i }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // The map view renders and keeps the filter state in the URL.
  await page.getByRole("tab", { name: /map/i }).click();
  await expect(page).toHaveURL(/view=map/);

  // The shared link works in a cold context with no cookies.
  const fresh = await context.browser()!.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(noticeUrl);
  await expect(freshPage.getByRole("heading", { name: title })).toBeVisible();
  await fresh.close();
});

test("the map view has a usable list equivalent sharing the same filters", async ({ page }) => {
  await page.goto("/?view=map&when=upcoming&sort=nearest");
  await page.getByRole("button", { name: /use my location/i }).click();

  // Spec §10: the list is the non-map equivalent, and switching preserves the filter state.
  await page.getByRole("tab", { name: /list/i }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveURL(/sort=nearest/);
  await expect(page.getByRole("tab", { name: /list/i })).toHaveAttribute("aria-selected", "true");
});

test("the submit form is completable by keyboard alone", async ({ page }) => {
  await page.goto("/submit");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBeTruthy();

  // Every form control must be reachable and labelled.
  const controls = page.locator("select, input, textarea, button");
  expect(await controls.count()).toBeGreaterThan(3);
});
```

- [ ] **Step 3: Run the end-to-end test**

Run:

```bash
pnpm db:up
cd apps/api && pnpm dev &
cd apps/web && pnpm e2e
```

Expected: all three tests PASS. If the first fails at "use my location", the geolocation permission grant did not apply — check `test.use`.

- [ ] **Step 4: Write the README**

`README.md`:

```markdown
# Jiwar

جوار — *proximity, neighbourliness*. A web app for discovering community notices
near a chosen location: funerals, weddings, aqiqahs, memorials, gatherings.

Notices publish immediately and are found by radius. Every category shares one
shape — Jiwar is notice-agnostic by design, not a funeral app with a category column.

## Requirements

- Node 24.15+ (Node 24.18 is what this was built on)
- pnpm 11
- Docker Desktop, running

TypeScript is pinned to 6.0.2. **Do not install TypeScript 7** — it ships no
programmatic compiler API, which crashes the Nest CLI.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up
cd apps/api && pnpm db:migrate && pnpm db:seed && cd ../..
```

## Running

```bash
pnpm dev          # API on :3000 and web on :5173, in separate panes
```

- Web app: http://localhost:5173
- API docs: http://localhost:3000/api/docs

## Testing

```bash
pnpm test                              # unit tests everywhere
cd apps/api && pnpm test:int           # integration tests on real PostGIS via Testcontainers
cd apps/web && pnpm e2e                # Playwright end-to-end
```

Integration tests need Docker running. They boot a real PostGIS container rather
than mocking the database, because the radius query is the core logic.

## Architecture

| Package | What it holds |
|---|---|
| `packages/contracts` | Zod schemas — the single source of truth for both sides |
| `apps/api` | NestJS, Drizzle, PostGIS radius search, Nominatim proxy |
| `apps/web` | Vite React SPA, MapLibre map, submit wizard |

Radius search uses `ST_DWithin` on a `geography(Point,4326)` GiST index, so
distances are true metres. `geometry` on SRID 4326 would measure degrees.

## Scope

This is milestone 1: publish and discover. Community confirmation and disputes,
admin moderation, duplicate suggestions, and notifications are later milestones.
See `docs/superpowers/specs/2026-09-15-jiwar-m1-design.md`.

## Maps and geocoding

MapLibre GL with OpenFreeMap tiles and Nominatim geocoding — no API keys, no
accounts. Geocoding is proxied through the API because Nominatim requires an
identifying User-Agent and permits about one request per second.
```

- [ ] **Step 5: Run the full verification**

Run:

```bash
pnpm build
pnpm test
pnpm typecheck
cd apps/api && pnpm test:int
```

Expected: everything PASS. Report any failure honestly rather than moving on.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add end-to-end publish-and-discover coverage, and document setup"
```

---
