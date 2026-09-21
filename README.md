# Jiwar

جوار — *proximity, neighbourliness*. A web app for discovering community notices
near a chosen location: funerals, weddings, aqiqahs, memorials, gatherings.

Notices publish immediately and are found by radius. Every category shares one
shape — Jiwar is notice-agnostic by design, not a funeral app with a category column.

## Requirements

- Node 24.15+ (Node 24.18 is what this was built on; see `.nvmrc`)
- pnpm 11 (`corepack enable` picks up the pinned `packageManager` version)
- Docker Desktop, running

Two pins in this repo are load-bearing. Both are easy to undo by accident:

- **TypeScript is pinned to 6.0.2. Do not install TypeScript 7.** `npm view
  typescript version` now returns 7.x, so a plain `pnpm add -D typescript`
  upgrades you into it. TS 7 ships no programmatic compiler API, which is what
  the Nest CLI drives, so `nest build` and `nest start` both fail — and the error
  does not mention TypeScript.
- **`drizzle-kit` is patched** (`patches/drizzle-kit@0.31.10.patch`). Unpatched, it
  double-quotes the `geography(Point,4326)` column type, which Postgres rejects,
  so `pnpm db:generate` writes a migration that cannot be applied. `pnpm install`
  applies the patch automatically and fails loudly if `patches/` is missing, so
  do not delete that directory.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm db:up
cd apps/api && pnpm db:migrate && pnpm db:seed && cd ../..
```

`pnpm build` before the first `pnpm dev` is not optional. `apps/api` and `apps/web`
import `@jiwar/contracts` as a built package, so on a fresh clone — where
`packages/contracts/dist` does not exist yet — the API fails to compile with
`TS2307: Cannot find module '@jiwar/contracts'` and only the web server comes up.
`turbo` rebuilds the package on demand after that, so this is a first-run step.

`pnpm db:up` starts PostGIS in Docker as container `jiwar_db`, published on host
port **55432** (not 5432, so it cannot collide with a local Postgres). `db:seed`
inserts the six categories and is idempotent — re-running it is safe.

The API reads its configuration from the repo-root `.env`, which is why the copy
step is not optional: it exits at startup with `Missing required environment
variable: DATABASE_URL` rather than falling back to a default. `.env.example`
documents every variable; these are the ones without a usable default:

| Variable | Example value | Why |
|---|---|---|
| `DATABASE_URL` | `postgresql://jiwar:jiwar@localhost:55432/jiwar_dev` | Matches `docker-compose.yml`. No default; the API refuses to boot without it. |
| `COOKIE_SECRET` | `a-development-cookie-secret-that-is-at-least-32-chars` | Signs the anonymous participant cookie, which is what authorship is. No default. Must be 32+ chars. |
| `WEB_ORIGIN` | `http://localhost:5173` | The CORS allow-list entry for the dev server. |
| `COOKIE_SECURE` | `false` | Keeps the cookie working over plain HTTP locally. Set `true` in any HTTPS deployment — with an `https://` `WEB_ORIGIN` the API refuses to boot unless you do. |

## Running

```bash
pnpm dev          # API on :3000 and web on :5173, in separate panes
```

- Web app: http://localhost:5173
- API docs: http://localhost:3000/api/docs

Every API route is under the `/v1` prefix. The Vite dev server proxies `/v1` to
port 3000, so the browser makes same-origin requests and there is nothing else to
start — but the API must be on 3000 for that proxy to find it.

## Testing

```bash
pnpm test                              # unit tests everywhere
cd apps/api && pnpm test:int           # integration tests on real PostGIS via Testcontainers
cd apps/web && pnpm e2e                # Playwright end-to-end
```

Integration tests need Docker running. They boot a real PostGIS container rather
than mocking the database, because the radius query is the core logic.

The end-to-end tests drive a real browser, so install it once:

```bash
cd apps/web && pnpm exec playwright install chromium
```

They need the whole stack up. Playwright starts the Vite dev server itself (and
reuses one already running), but **not** the API — start that first with `pnpm dev`,
or the tests will fail at the first step with an empty category list. They write
real notices to `jiwar_dev`, which is expected; nothing cleans up after them.

## Architecture

| Package | What it holds |
|---|---|
| `packages/contracts` | Zod schemas — the single source of truth for both sides |
| `apps/api` | NestJS, Drizzle, PostGIS radius search, Nominatim proxy |
| `apps/web` | Vite React SPA, MapLibre map, submit wizard |

Radius search uses `ST_DWithin` on a `geography(Point,4326)` GiST index, so
distances are true metres. `geometry` on SRID 4326 would measure degrees.

There are no user accounts. Authorship is a signed cookie, so the browser that
published a notice is the only one that can cancel it — which is also why
cancelling from a different browser or after clearing cookies is refused.

## Scope

This is milestone 1: publish and discover. Community confirmation and disputes,
admin moderation, duplicate suggestions, and notifications are later milestones.
See `docs/superpowers/specs/2026-09-15-jiwar-m1-design.md`.

## Maps and geocoding

MapLibre GL with OpenFreeMap tiles and Nominatim geocoding — no API keys, no
accounts. Geocoding is proxied through the API because Nominatim requires an
identifying User-Agent and permits about one request per second.
