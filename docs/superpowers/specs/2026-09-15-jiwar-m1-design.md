# Jiwar — Milestone 1 Design: Publish & Discover

Date: 2026-09-15
Status: Approved design. Supersedes `PLAN.md` where the two conflict.

## 1. What Jiwar is

Jiwar (جوار, "proximity" / "neighbourliness", from جار, neighbour) is a responsive web app for
discovering community notices near a chosen location. A notice announces a real event with a place
and a time: a funeral, a wedding, an aqiqah, a memorial, a community gathering.

Anyone can browse without an account. Anyone can publish without an account, and the notice appears
immediately. Trust accrues afterwards, from community confirmation.

The project's primary purpose is hands-on depth in React, NestJS, and TypeScript, built to real
quality. It is not being launched to a live community in this milestone. Algeria is the eventual
target region, which shapes the internationalisation strategy but not Milestone 1's scope.

### Relationship to PLAN.md

`PLAN.md` (2026-09-14) is the pre-brainstorm baseline and remains useful historical context. Three
decisions here deliberately invert it, and this document wins:

| PLAN.md said | Jiwar does | Section |
|---|---|---|
| Notices require approval before publication (§2, §5) | Notices publish immediately; trust is earned afterwards | §3 |
| Duplicate detection uses category-specific fields such as a deceased person's name (§4) | No per-category fields exist at all; matching uses generic signals only | §5, §11 |
| A notice may describe multiple scheduled activities (§3) | One notice = one venue + one time | §5 |

Two of PLAN.md's concerns dissolve as a consequence, and are recorded here so nobody re-solves them:

- PLAN.md §4 worried that duplicate suggestions must not leak private pending submissions. With
  immediate publication there are no hidden pending notices, so suggestions can search the whole
  corpus freely.
- PLAN.md §7 called for protected moderator routes and an identity module. Since submitting is
  anonymous, the admin is the *only* authenticated account in the entire system.

## 2. Scope: this milestone and the ones after it

Milestone 1 is the subject of this document. Later milestones are sketched only to show what M1 must
not foreclose; each gets its own design document before it is built.

**M1 — Publish & Discover (this document).** Monorepo and tooling; Postgres + PostGIS; the notice
model; a submit form with map location picker and address search; list *and* map discovery with
radius, category, and date filters; notice detail pages; shareable URLs; the anonymous participant
cookie.

**M2 — Trust & moderation.** Confirm and dispute actions, trust states and badges, dispute-driven
auto-hide, admin authentication, and the admin queue.

**M3 — Duplicates & authorship.** Duplicate suggestions during submission, "my submissions", and
author-initiated edits as revisions.

**M4 — Reach.** Link previews and search indexing, notifications, and an optional PWA phase.

M1 includes the map view rather than deferring it, because the submit form needs a map for its
location picker regardless. Once MapLibre is integrated for the picker, the discovery map view is
close to free, and deferring it would mean rebuilding the location step later.

### Explicitly out of scope for M1

Confirm/dispute and trust badges; admin auth and moderation; duplicate suggestions; "my
submissions"; author edits; notifications; PWA and offline support; link previews and SSR; Arabic and
RTL rendering; public comments; payments; any per-author posting count or ranking.

## 3. The trust model

This is the decision that most distinguishes Jiwar from `PLAN.md` and from the reference app that
inspired it, so it is stated up front even though it is implemented in M2.

**Notices publish immediately.** There is no pre-moderation gate. A submission is public the moment
it is made. Community confirmations then raise a notice's standing, and an admin decision raises it
further.

**Trust badges, not trust ranking.** Four visible states — Unverified, Community-confirmed,
Admin-verified, and Disputed — drive the badge, the map pin styling, and an opt-in "confirmed only"
filter. They do **not** reorder the list. Discovery stays ordered by event time or distance, so a
nearby notice is never buried beneath a distant popular one, and "the top result is the nearest" (or
soonest) remains a mental model people can rely on.

**Disputes demote, then auto-hide.** A dispute immediately badges a notice as contested and drops it
down the list. Crossing a threshold auto-hides it from public view and queues it for the admin. This
matters because there is exactly one admin and no on-call rota: the system has to be able to contain
a harmful notice without a human present.

### The risk this accepts, stated plainly

Anonymous submission plus immediate publication means a false notice — "X has died" — reaches the
public before any check. Unlike a false traffic report, that harm lands at the moment of
publication, and expiry does not undo it. The mitigation is that the *negative* path is designed as
carefully as the positive one: disputes act fast, auto-hide needs no human, and an admin can restore
a notice that was brigaded.

Two consequences for M2's design. The auto-hide threshold is the one value in this system that
cannot be reasoned to a correct number without real usage, so it must be configuration rather than a
constant. And because this milestone is not launched to a live community, the trust model gets to
mature before anyone can be harmed by it — which is the honest reason deferring stronger safeguards
is acceptable here and would not be acceptable at launch.

## 4. Repository and contracts

```
jiwar/
  apps/
    web/                 Vite + React + TypeScript, React Router
    api/                 NestJS + TypeScript
  packages/
    contracts/           Zod schemas and inferred types
  docker-compose.yml     postgis/postgis:16
  turbo.json
  pnpm-workspace.yaml
```

**Turborepo over pnpm workspaces, not instead of them.** pnpm workspaces still does the linking;
Turborepo orchestrates tasks on top. At three packages the concrete wins are dependency-aware
ordering (`contracts` always builds before `web` and `api` without anyone remembering to),
content-hash caching so unchanged packages skip lint and test entirely, and one command to run
everything in parallel. Remote caching is skipped — it needs a Vercel account, and the local cache is
sufficient. Development uses `turbo dev --ui=tui` so web and API logs occupy separate panes instead
of interleaving.

### The contracts package is the single source of truth

`packages/contracts` exports Zod schemas — `NoticeSchema`, `CreateNoticeSchema`,
`SearchNoticesSchema`, `CategorySchema` — and the types inferred from them via `z.infer`. Types are
never hand-written alongside a schema.

NestJS validates inbound bodies and query strings through a Zod pipe, **and** parses outbound
responses through the same schemas in tests. That second half is the part that earns its keep: a
response that drifts from the contract fails a test loudly rather than failing silently in a
browser. `nestjs-zod` additionally derives Swagger UI at `/api/docs` from these schemas, so
interactive API documentation needs no second set of decorators.

The web app passes the same schemas to react-hook-form through `zodResolver`, so the submit form's
validation rules *are* the API's validation rules rather than a copy of them.

The honest trade-off: the contract is hand-maintained rather than derived from the database schema,
so renaming a database column will not by itself break the build. The outbound response-parsing
tests are what catch that, which is why they are not optional.

Alternatives rejected: class-validator DTOs plus a generated client (class-validator cannot validate
in the browser, so the submit form would need its own separate schema — precisely the drift Zod
eliminates); tRPC (excellent type safety, but it works against Nest's controller grain and leaves no
reusable HTTP API, which is wrong for a product whose notices are meant to be linkable resources).

## 5. Data model

Every notice has an identical shape regardless of category. There are no per-category fields, no
category-specific tables, and no conditional branches on category in the schema. Category is a label
that drives filtering and presentation copy.

**`categories`** — `id`, `slug`, `name`, `icon`, `sort_order`, `active`.

Seeded with: Funeral, Wedding, Aqiqah, Memorial, Community Gathering, Other. Adding a category later
inserts a row; it does not require a migration or a code change.

**`notices`** — `id`, `public_id` (short nanoid, used in URLs), `category_id`, `title`,
`description`, `venue_name`, `address`, `location geography(Point,4326)`, `starts_at timestamptz`,
`attendance` (`public` | `invitation_only` | `restricted`), `organizer_name` (nullable),
`organizer_contact` (nullable), `status` (`published` | `cancelled` | `removed`),
`author_participant_id`, `created_at`, `updated_at`.

Indexes: GiST on `location` (this is what makes radius search fast), btree on `starts_at`, btree on
`category_id`.

**`participants`** — `id`, `created_at`. Deliberately nothing else: no email, no IP address, no
fingerprint. Its only purpose is to assert "the same browser as before."

### Two things kept out of the schema on purpose

**Archived is derived, never stored.** A notice is past when `starts_at < now() - interval '24
hours'`. No cron job, no scheduled worker, and no stored flag that can fall out of sync with reality.

**Trust columns arrive in M2's migration, not M1's.** M1's schema carries no unused confirmation or
dispute fields. This keeps M1 honest and means M2's design can choose their shape freely.

### One venue, one time

A notice has exactly one location and one `starts_at`. A funeral's burial site, or a wedding's second
day, lives in the free-text description — with no pin, no distance, and no directions of its own.

This was chosen over a 1..n activities model. The cost is real and should be understood: adding
activities later means migrating the discovery queries (radius search becomes "nearest activity"),
the map (multiple pins per notice), and the submit form (a repeatable section). The benefit is a flat
schema, a trivial distance sort, and a short form in M1.

## 6. Discovery

```
GET /v1/notices?lat&lng&radiusKm&categories[]&when=upcoming|past&sort=soonest|nearest&cursor
```

Radius filtering uses `ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_m)` — true
geodesic distance evaluated against the spatial index, not a bounding-box approximation. Each result
carries its distance from `ST_Distance`.

Radius defaults to 20 km and is adjustable in the UI. `MAX_RADIUS_KM` caps it server-side, since the
query parameter is user-controlled.

Default sort is **soonest first**, with a **nearest first** toggle. Per §3, confirmations never
influence this ordering.

Only `status = 'published'` notices appear. Cancelled notices are excluded from discovery but remain
reachable by URL, marked as cancelled.

**Empty-result fallback.** When a search matches nothing, a second query returns the most recent
*past* notices within the same radius, flagged `fallback: true` in the response so the UI can label
them honestly. It applies to `when=upcoming` only: an explicit search for past notices that
matches nothing returns an empty result rather than a fallback. This is borrowed from the reference
app, and it is a better answer than an empty
screen — someone who opens the app in a quiet week still learns something.

**Pagination** is cursor-based, keyed on the active sort, so a notice published mid-scroll cannot
cause a duplicate or a skipped row.

List and map views issue the same query and share one filter state, toggled through a URL parameter
so that every view — including a filtered map at a chosen radius — is a shareable link. Panning the
map surfaces a "Search this area" button rather than refetching on every gesture; the user decides
when to re-run the search.

## 7. Location, without dead ends

Three independent ways to set a location, because any one of them can be unavailable:

1. **Browser geolocation**, requested only on an explicit tap — never on page load.
2. **Address search**, typed.
3. **Dropping a pin** on the map.

A denied geolocation permission is not an error state. It means the person picks an area instead, and
that choice persists in `localStorage` so they are not asked again on the next visit. The same
applies when geolocation is simply unavailable, which includes any non-HTTPS origin.

**Geocoding is proxied through NestJS** (`/v1/geocode`, `/v1/reverse-geocode`) rather than called
from the browser. This is not incidental tidiness: Nominatim requires an identifying User-Agent
header, permits roughly one request per second, and prohibits the per-keystroke traffic an
autocomplete naturally generates. Proxying gives one place to debounce, cache, set the User-Agent,
and — if the limits ever bite — swap the provider without touching the web app.

Map rendering uses MapLibre GL with OpenFreeMap vector tiles: no API key, no account, no card on
file, no billing surprise. MapLibre's API descends from Mapbox GL, so the knowledge transfers if a
paid provider is ever needed.

## 8. Submitting a notice

Anonymous, and published immediately. Four steps:

1. **What** — category and title.
2. **Where and when** — map picker, address search, and time.
3. **Details** — description, attendance guidance, optional organizer information.
4. **Review** — a read-only summary, then submit.

`PLAN.md`'s third wizard step, checking for possible matches, is intentionally absent. Duplicate
suggestions are M3.

### Safeguards treated as requirements, not polish

These come from `PLAN.md` §6 and survive into M1 as hard requirements:

- Publishing organizer contact details requires ticking an explicit "I have permission to publish
  this" confirmation. It is unticked by default.
- Attendance guidance is stated explicitly — public, invitation-only, or restricted — rather than
  left for a reader to infer.
- **Nothing anywhere counts or ranks submissions per author.** No leaderboards, no "you have
  published 12 notices", no streaks, no badges for volume. This is a deliberate anti-gamification
  rule: funeral notices must never become something anyone is rewarded for producing.

An author can **cancel** their own notice, authorised by the participant cookie. Editing waits for
M3, where revisions get designed properly rather than bolted on.

### The anonymous participant cookie

Middleware mints an opaque UUID into a signed, httpOnly, `SameSite=Lax` cookie on a visitor's first
request. It holds no personal data, performs no fingerprinting, and the user can clear it.

It is introduced in M1 rather than M2 because it costs roughly twenty lines and gives every notice an
author reference immediately. That reference is what authorises author cancellation now, what M3's
"my submissions" reads, and what M2's confirm/dispute deduplication reuses. Introducing it later
would mean backfilling authorship onto existing notices.

Its limit is known and accepted: a private window produces a new participant. The threshold logic in
M2 assumes noisy signals regardless, so per-browser deduplication is proportionate. Hashing IP
addresses was rejected — carrier NAT collapses a whole city into one voter while a phone changing
networks becomes several.

## 9. Internationalisation

M1 ships English only, region-neutral: LTR layout, Gregorian dates.

All user-facing strings live behind an i18n layer from the first commit, and no date, time, number,
or distance is ever formatted by hand — `Intl` only. Algeria is the eventual target, which means
Arabic, Darja, Tamazight, and French are all live audiences there. RTL is cheap to design for and
expensive to retrofit, so layouts use logical CSS properties (`margin-inline-start`, not
`margin-left`) even while only LTR is exercised.

No Arabic translation, no RTL stylesheet, and no Hijri calendar in M1. The seams exist; only one
locale is populated.

## 10. Testing

Test-driven throughout: a failing test before the implementation, at every layer.

**Integration tests run against real PostGIS in Testcontainers.** This is non-negotiable, because the
radius query *is* the core logic of the product. A mocked repository would assert that a hand-written
fake returns what the test author expected — it would test nothing that could actually break.

Cases that must exist:

- A notice just inside the radius is returned; one just outside is not.
- Radius search behaves correctly across the antimeridian.
- The upcoming/past boundary at `starts_at + 24h`, tested on both sides.
- The empty-result fallback returns past notices flagged `fallback: true`.
- Cancelled notices are absent from discovery but reachable by URL.
- One participant cannot cancel another participant's notice.
- `radiusKm` above `MAX_RADIUS_KM` is rejected rather than silently clamped.
- Every response parses against its contract schema — the drift guard from §4.

Unit tests use Vitest on both sides. One Playwright end-to-end test covers the path that matters
most: submit a notice, see it in the list, open its detail page, and load its shared URL cold in a
fresh context.

Accessibility is verified rather than assumed: the submit form is completable by keyboard alone, and
the map view has a usable non-map equivalent (the list, sharing the same filter state).

## 11. Known gaps and open questions

Recorded so they are decided deliberately in the milestone that owns them, rather than improvised.

- **Duplicate detection without category-specific fields (M3).** Since no per-category identifying
  detail exists, matching must work from category, proximity, time window, and title similarity
  alone. Whether that is precise enough to be worth showing to a submitter is genuinely unknown and
  is M3's first question. `PLAN.md` §4's approach depended on fields that no longer exist.
- **The auto-hide threshold (M2).** Cannot be reasoned to a correct value without real usage.
  Must be configuration, not a constant.
- **Cancellation, withdrawal, appeal, retention, and deletion rules (M2).** M1 supports author
  cancellation only. `removed` exists in the status enum but is not settable in M1, since no admin
  account exists until M2 — nothing in M1 can move a notice into it. The full policy — including whether removed content is
  purged and after how long — belongs with moderation.
- **Link previews and indexing (M4).** Deferred deliberately. NestJS can serve `index.html` with
  per-notice OG tags injected in roughly thirty lines, which is why an SPA does not foreclose this
  and Next.js was not needed.
- **If Jiwar is ever launched to a live community**, the trust model and the anonymous-submit path
  need revisiting before real users arrive. The learning-first framing is what makes deferring
  consent verification and privacy hardening honest in M1; a launch would withdraw that permission.

## 12. Naming and identity

**Jiwar** — جوار, proximity or neighbourliness, from جار (neighbour). It names the mechanic: distance
is the product. It also carries the Islamic ethic of حق الجار, the rights of the neighbour, without
being bound to any single kind of event.

The reference app that inspired this project is قيراط الأردن, whose name invokes the hadith that
whoever prays over the dead earns one qirat of reward and whoever stays for the burial earns two. It
is a fine name for a funeral app and precisely why it could not be adopted here: a name built on
funeral merit becomes wrong the moment someone publishes an aqiqah. Jiwar was chosen to be agnostic
across event types, and — given Algeria's Arabic, Tamazight, and French-speaking audiences — to
carry no regional or ethnic marking.

Identifiers derived from the name: packages `@jiwar/web`, `@jiwar/api`, `@jiwar/contracts`; database
`jiwar_dev`; participant cookie `jiwar_pid`.
