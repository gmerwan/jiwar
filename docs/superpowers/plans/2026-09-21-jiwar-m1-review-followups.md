# Jiwar M1 Review Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five should-fix items from the M1 final whole-branch review, so M1 matches the promises its own spec makes before M2's trust and moderation layer is built on top of it.

**Architecture:** Four small, independent frontend changes plus one API change. Task 15 moves the search origin and radius out of `localStorage` and into the URL, which is the only item that changes an interface other tasks read (`useChosenLocation`). Tasks 16–18 are self-contained component fixes. Task 19 adds a rate limit to the two write endpoints. Nothing here changes the database schema, the contracts package, or any response shape, so `@jiwar/contracts` and the API's public contract stay frozen — Task 14's e2e suite must keep passing unchanged throughout.

**Tech Stack:** React 19 + React Router 7 (`useSearchParams`), TanStack Query 5, Vitest 5 + Testing Library, NestJS 12, `@nestjs/throttler` 6.7.0, TypeScript 6.0.2.

**Spec:** `docs/superpowers/specs/2026-09-15-jiwar-m1-design.md` — §6 (discovery and shareable links) is the binding authority for Tasks 15–18. The execution history that produced these items is `docs/superpowers/2026-09-21-jiwar-m1-execution-ledger.md`.

## Global Constraints

- **TypeScript stays pinned at `6.0.2`.** `npm view typescript version` returns 7.x. TS 7 is the native Go port and ships no programmatic compiler API, which crashes `nest build`. Never run `pnpm add typescript` or `pnpm add -D typescript` without an exact version. Verify with `pnpm ls typescript -r` if anything compiler-related misbehaves.
- **`apps/web/vitest.config.ts` sets `globals: false`**, so `@testing-library/react`'s automatic cleanup never registers. Every component test file needs an explicit `afterEach(cleanup)` or DOM nodes leak between tests and you get `TestingLibraryElementError: Found multiple elements`.
- **Do not change any response shape, contract schema, or route path.** Task 14's Playwright suite (`apps/web/e2e/publish-and-discover.spec.ts`) drives the real DOM, and `packages/contracts` is consumed by six call sites. Every task below ends with the e2e suite still passing 4/4.
- **`pnpm typecheck` is not covered by `pnpm test`.** Vitest's esbuild transform strips types without checking them; this has hidden real errors three times in this project. Run both.
- **jsdom cannot render MapLibre** (it needs WebGL). Tests that would mount `<Map>` must mock `@vis.gl/react-maplibre`, as `NoticeMap.test.tsx` already does.
- **Do not add a state-management library.** TanStack Query and React state are what this project uses.
- Commit messages are Conventional Commits. Do not add an AI attribution trailer unless your own system reminder specifies one.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/src/features/location/useChosenLocation.ts` | Owns the chosen location and radius. Changes from `localStorage`-only to URL-first with `localStorage` as a fallback seed. | 15 |
| `apps/web/src/features/location/useChosenLocation.test.ts` | Existing 6 cases stay; new cases for URL seeding, URL writing, and precedence. | 15 |
| `apps/web/src/routes/Home.tsx` | Passes the URL's search params into the hook; gains a `key` on `<NoticeMap>`. | 15, 17 |
| `apps/web/src/features/discovery/NoticeList.tsx` | Reorders the error branch so a failed load-more keeps loaded cards; takes a `when` prop for the empty string. | 16, 18 |
| `apps/web/src/features/discovery/NoticeList.test.tsx` | New cases for error-with-cards and the past empty state. | 16, 18 |
| `apps/web/src/i18n/en.ts` | Adds `discovery.emptyPast` and `discovery.loadMoreError`. | 16, 18 |
| `apps/api/src/app.module.ts` | Registers `ThrottlerModule`. | 19 |
| `apps/api/src/notices/notices.controller.ts` | `@Throttle` on create and cancel. | 19 |
| `apps/api/test/throttle.int.test.ts` | New: proves the limit fires and that reads are unaffected. | 19 |

---

### Task 15: Put the search origin and radius in the URL

**Why:** Spec §6 line 217 promises "every view — including a filtered map at a chosen radius — is a shareable link." Today the URL carries only `view`, `when`, `sort` and `category`; `lat`, `lng` and `radiusKm` live in `localStorage` (`jiwar.location`, `jiwar.radiusKm`). A recipient opening a shared `/?view=map&sort=nearest` link lands on "Choose a location to see notices near you" with no map, no radius and no origin — the two most load-bearing parts of the promise are the two that are missing. This is a spec-compliance defect, not polish.

**Files:**
- Modify: `apps/web/src/features/location/useChosenLocation.ts`
- Modify: `apps/web/src/features/location/useChosenLocation.test.ts`
- Modify: `apps/web/src/routes/Home.tsx:13-16`

**Interfaces:**
- Consumes: `useSearchParams` from `react-router-dom` (already used in `Home.tsx`).
- Produces: `useChosenLocation()` keeps its exact return shape — `{ location, status, error, radiusKm, setLocation, setRadiusKm, requestBrowserLocation }` — so `Home.tsx` and `SubmitWizard` need no signature change. The hook now reads `lat`/`lng`/`radiusKm` from the URL when present and writes them on every `setLocation`/`setRadiusKm`. Precedence is **URL wins over `localStorage`**.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/features/location/useChosenLocation.test.ts`. The existing file already imports `renderHook` and stubs `navigator`; keep those. Wrap with a router, because the hook now uses `useSearchParams`:

```ts
import { MemoryRouter } from "react-router-dom";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { useChosenLocation } from "./useChosenLocation.js";

afterEach(cleanup);

function renderAt(url: string) {
  return renderHook(() => useChosenLocation(), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
  });
}

describe("useChosenLocation URL state", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the location and radius from the URL", () => {
    const { result } = renderAt("/?lat=36.7538&lng=3.0588&radiusKm=5");
    expect(result.current.location).toEqual({ lat: 36.7538, lng: 3.0588 });
    expect(result.current.radiusKm).toBe(5);
    expect(result.current.status).toBe("ready");
  });

  it("prefers the URL over a stored location", () => {
    localStorage.setItem("jiwar.location", JSON.stringify({ lat: 35.6976, lng: -0.6337 }));
    const { result } = renderAt("/?lat=36.7538&lng=3.0588");
    expect(result.current.location).toEqual({ lat: 36.7538, lng: 3.0588 });
  });

  it("falls back to a stored location when the URL has none", () => {
    localStorage.setItem("jiwar.location", JSON.stringify({ lat: 35.6976, lng: -0.6337 }));
    const { result } = renderAt("/");
    expect(result.current.location).toEqual({ lat: 35.6976, lng: -0.6337 });
  });

  it("ignores a blank or non-numeric coordinate in the URL", () => {
    expect(renderAt("/?lat=&lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lat=abc&lng=3.06").result.current.location).toBeNull();
  });

  it("accepts a genuine zero coordinate from the URL", () => {
    const { result } = renderAt("/?lat=0&lng=0");
    expect(result.current.location).toEqual({ lat: 0, lng: 0 });
  });

  it("writes the location into the URL when it changes", () => {
    const { result } = renderAt("/?view=map");
    act(() => result.current.setLocation({ lat: 36.75, lng: 3.06 }));
    expect(window.location.search).toContain("lat=36.75");
  });
});
```

Note the last case reads `window.location.search`, which `MemoryRouter` does not update. Use `useSearchParams`'s own value instead by rendering a probe component:

```tsx
it("writes the location into the URL when it changes", () => {
  let search = "";
  function Probe() {
    const [params] = useSearchParams();
    search = params.toString();
    const chosen = useChosenLocation();
    return <button onClick={() => chosen.setLocation({ lat: 36.75, lng: 3.06 })}>set</button>;
  }
  render(
    <MemoryRouter initialEntries={["/?view=map"]}>
      <Probe />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "set" }));
  expect(search).toContain("lat=36.75");
  expect(search).toContain("view=map"); // existing params survive
});
```

Import `render`, `screen`, `fireEvent` from `@testing-library/react` and `useSearchParams` from `react-router-dom` for that case.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/location/useChosenLocation.test.ts`
Expected: FAIL. The URL-seeding cases fail because the hook reads only `localStorage`; the write case fails because nothing touches the URL.

- [ ] **Step 3: Rewrite the hook to be URL-first**

Replace `apps/web/src/features/location/useChosenLocation.ts` with:

```ts
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface ChosenLocation {
  lat: number;
  lng: number;
  label?: string;
}

export type LocationStatus = "idle" | "locating" | "ready" | "denied" | "unavailable";

const LOCATION_KEY = "jiwar.location";
const RADIUS_KEY = "jiwar.radiusKm";
const DEFAULT_RADIUS_KM = 20;

/**
 * Spec §6 promises that "every view — including a filtered map at a chosen radius —
 * is a shareable link". That only holds if the search origin and radius travel in the
 * URL, so they are read from there first and written back on every change.
 * `localStorage` stays as the seed for a visitor arriving with a bare `/`, and as the
 * memory across sessions that a URL cannot provide.
 */
function parseCoordinate(raw: string | null): number | null {
  // `Number("")` is 0 and `Number(null)` is 0, both of which are valid latitudes —
  // the same coercion trap this project hit three times. Reject blanks explicitly.
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

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
  const [searchParams, setSearchParams] = useSearchParams();

  const urlLat = parseCoordinate(searchParams.get("lat"));
  const urlLng = parseCoordinate(searchParams.get("lng"));
  const urlLocation = urlLat !== null && urlLng !== null ? { lat: urlLat, lng: urlLng } : null;

  const urlRadius = parseCoordinate(searchParams.get("radiusKm"));
  const radiusKm = urlRadius !== null && urlRadius > 0 ? urlRadius : readStoredRadius();

  const [storedLocation, setStoredLocation] = useState<ChosenLocation | null>(readStoredLocation);
  const location = urlLocation ?? storedLocation;

  const [status, setStatus] = useState<LocationStatus>(() => (location ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);

  const writeParams = useCallback(
    (entries: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(entries)) next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setLocation = useCallback(
    (next: ChosenLocation) => {
      setStoredLocation(next);
      setStatus("ready");
      setError(null);
      writeParams({ lat: String(next.lat), lng: String(next.lng) });
      try {
        localStorage.setItem(LOCATION_KEY, JSON.stringify(next));
      } catch {
        // Private browsing can reject writes; the location still works for this session.
      }
    },
    [writeParams],
  );

  const setRadiusKm = useCallback(
    (next: number) => {
      writeParams({ radiusKm: String(next) });
      try {
        localStorage.setItem(RADIUS_KEY, String(next));
      } catch {
        // Ignore storage failures.
      }
    },
    [writeParams],
  );

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/location/useChosenLocation.test.ts`
Expected: PASS, including the 6 pre-existing cases.

- [ ] **Step 5: Check `Home.tsx` still compiles and the radius control still works**

The hook's return shape is unchanged, so `Home.tsx` needs no edit. Verify:

Run: `pnpm --filter @jiwar/web exec tsc -p tsconfig.json --noEmit`
Expected: exit 0.

Run: `pnpm --filter @jiwar/web test`
Expected: PASS. If `FilterBar.test.tsx` or `Home`-level tests fail because they render `useChosenLocation` without a router, wrap those renders in `<MemoryRouter>` — do not change the hook to tolerate a missing router.

- [ ] **Step 6: Verify the shared link works for real**

Start the API on port 3000 and the dev server, then in a browser:
1. Open `/`, choose a location, set the radius to 5 km, switch to the map view.
2. Copy the URL. Confirm it contains `lat`, `lng` and `radiusKm`.
3. Open that URL in a **fresh** private window (no `localStorage`).

Expected: the map renders at the shared location with the shared radius, not the "choose a location" prompt.

Record the actual URL and what the fresh window showed.

- [ ] **Step 7: Run the full gates and the e2e suite**

```bash
pnpm test && pnpm typecheck && pnpm build
pnpm --filter @jiwar/web e2e
```
Expected: all green, e2e 4/4. The e2e suite clicks "Use my location", which only renders while no location is chosen — if a test now finds a location seeded from the URL, that is a real regression in this task, not a test problem.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/location/useChosenLocation.ts \
        apps/web/src/features/location/useChosenLocation.test.ts
git commit -m "fix(web): carry the search origin and radius in the URL

Spec §6 promises every view is a shareable link, but lat/lng/radiusKm lived
only in localStorage, so a shared link dropped the recipient on the
choose-a-location prompt. The URL now wins over storage, which stays as the
seed for a bare / and as memory across sessions."
```

---

### Task 16: Keep loaded notices on screen when load-more fails

**Why:** `NoticeList` checks `isError` before `notices.length`, so a failure on page 2 replaces the cards a reader is already looking at with an error panel. Measured on the merged code: page 1 shows 2 cards, a 502 on load-more leaves 0 cards and an error panel. `retry()` recovers, but the reader has lost their place. The brief's own comment describes load-more as additive, so this contradicts its stated intent.

**Files:**
- Modify: `apps/web/src/features/discovery/NoticeList.tsx:26-43`
- Modify: `apps/web/src/features/discovery/NoticeList.test.tsx`
- Modify: `apps/web/src/i18n/en.ts`

**Interfaces:**
- Consumes: `NoticeListProps` as it already exists — `{ notices, isLoading, isError, fallback, radiusKm, hasMore, onLoadMore, onRetry }`. No prop changes.
- Produces: no new exports. Adds the i18n key `discovery.loadMoreError`, which Task 18 must not collide with.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/discovery/NoticeList.test.tsx` (the file already has `afterEach(cleanup)` — keep it):

```tsx
it("keeps already-loaded notices on screen when loading more fails", () => {
  render(
    <NoticeList
      notices={[noticeFixture({ publicId: "aaa", title: "First notice" }),
                noticeFixture({ publicId: "bbb", title: "Second notice" })]}
      isLoading={false}
      isError={true}
      fallback={false}
      radiusKm={20}
      hasMore={true}
      onLoadMore={() => {}}
      onRetry={() => {}}
    />,
  );

  // The cards the reader was looking at are still there.
  expect(screen.getByText("First notice")).toBeInTheDocument();
  expect(screen.getByText("Second notice")).toBeInTheDocument();

  // And the failure is reported inline rather than replacing them.
  expect(screen.getByRole("alert")).toHaveTextContent(/could not load more/i);
  expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
});

it("shows the full-page error only when nothing has loaded yet", () => {
  render(
    <NoticeList
      notices={[]}
      isLoading={false}
      isError={true}
      fallback={false}
      radiusKm={20}
      hasMore={false}
      onLoadMore={() => {}}
      onRetry={() => {}}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(/could not load notices/i);
});
```

Use the same `noticeFixture` helper the existing tests in this file use. If it does not exist, the file's existing cases build notice objects inline — copy that shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/discovery/NoticeList.test.tsx`
Expected: FAIL on the first case with "Unable to find an element with the text: First notice" — the error branch returns early and renders no cards.

- [ ] **Step 3: Add the inline error string**

In `apps/web/src/i18n/en.ts`, beside `"discovery.error"`:

```ts
  "discovery.loadMoreError": "Could not load more notices. Check your connection and try again.",
```

- [ ] **Step 4: Reorder the branches**

In `apps/web/src/features/discovery/NoticeList.tsx`, replace the `isError` block and what follows with:

```tsx
  // The full-page error is only right when there is nothing to lose. Once a page has
  // loaded, a failed load-more must not take the reader's cards away — the brief
  // describes load-more as additive, and replacing the list contradicts that.
  if (isError && notices.length === 0) {
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

      {isError && (
        <div role="alert">
          <p>{t("discovery.loadMoreError")}</p>
          <button type="button" onClick={onRetry}>
            {t("discovery.retry")}
          </button>
        </div>
      )}

      {/* keep whatever load-more button the file already renders here, unchanged */}
    </div>
  );
```

Leave the existing `isLoading` branch and the load-more button exactly as they are.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/discovery/NoticeList.test.tsx`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Verify the counterfactual**

Revert the branch order (put `isError` back before the length check), re-run the file, and confirm the first new case fails. Then restore.

Expected with the mutation: 1 failed. Confirm `git diff` is empty afterwards.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/discovery/NoticeList.tsx \
        apps/web/src/features/discovery/NoticeList.test.tsx \
        apps/web/src/i18n/en.ts
git commit -m "fix(web): keep loaded notices visible when load-more fails

The error branch ran before the length check, so a failure on page 2 replaced
the cards the reader was looking at. The full-page error is now reserved for
an empty list; a failed load-more reports inline and keeps the list."
```

---

### Task 17: Recentre the map when the chosen location changes

**Why:** `NoticeMap` passes `centre` to MapLibre's `initialViewState`, which is read once on mount. Picking Oran while the map view is open moves the query and the marker but not the viewport — measured: the sole pin lands at `x ≈ -10,105 px`, off-screen over blank tiles, and the reader sees Algiers with no results. Switching tabs remounts the map and fixes it, so the state is recoverable only by accident. Task 12's fallback banner made this worse: the banner now updates while the viewport does not, so a reader can see a correct "showing past notices" banner over the wrong area.

**Files:**
- Modify: `apps/web/src/routes/Home.tsx:120-125`
- Modify: `apps/web/src/features/discovery/NoticeMap.test.tsx`

**Interfaces:**
- Consumes: `NoticeMapProps` unchanged — `{ notices, centre, fallback, onSearchArea }`.
- Produces: no interface change. `<NoticeMap>` gains a `key` derived from the centre, so React remounts it when the location changes.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/discovery/NoticeMap.test.tsx`. The file already mocks `@vis.gl/react-maplibre`; extend that mock to record the `initialViewState` it receives:

```tsx
it("re-reads the centre when the chosen location changes", () => {
  const { rerender } = render(
    <NoticeMap notices={[]} centre={{ lat: 36.7538, lng: 3.0588 }} fallback={false} onSearchArea={() => {}} />,
  );
  expect(lastInitialViewState).toMatchObject({ latitude: 36.7538, longitude: 3.0588 });

  // Same element type, different centre: without a key React keeps the mounted map
  // and initialViewState is never read again.
  rerender(
    <NoticeMap notices={[]} centre={{ lat: 35.6976, lng: -0.6337 }} fallback={false} onSearchArea={() => {}} />,
  );
  expect(lastInitialViewState).toMatchObject({ latitude: 35.6976, longitude: -0.6337 });
});
```

`lastInitialViewState` is a module-level `let` the mock assigns on each render. If the existing mock does not expose it, add it:

```tsx
let lastInitialViewState: { latitude: number; longitude: number } | null = null;

vi.mock("@vis.gl/react-maplibre", () => ({
  Map: ({ initialViewState, children }: any) => {
    lastInitialViewState = initialViewState;
    return <div data-testid="map">{children}</div>;
  },
  Marker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  NavigationControl: () => null,
}));
```

Keep whatever the existing mock already exports so the file's other cases still pass.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/discovery/NoticeMap.test.tsx`
Expected: FAIL on the second assertion — `latitude` is still `36.7538`, because the component never remounted.

- [ ] **Step 3: Fix it at the call site, not in the component**

In `apps/web/src/routes/Home.tsx`, add a `key` to the `<NoticeMap>` element:

```tsx
            <NoticeMap
              // Remount when the origin changes: MapLibre reads `initialViewState`
              // once, so without this the viewport stays where it first mounted while
              // the markers and the query move — a pin ~10,000px off-screen.
              key={`${location.lat},${location.lng}`}
              notices={notices.notices}
              centre={location}
              fallback={notices.fallback}
              onSearchArea={(centre) => setLocation(centre)}
            />
```

The test in Step 1 tests `NoticeMap` directly, so it also needs the key applied where the test renders it — pass `key` in the test's `rerender` calls, or assert against a small wrapper that mirrors `Home`'s usage. Prefer the wrapper, so the test exercises the same composition `Home` uses:

```tsx
function MapAt({ centre }: { centre: { lat: number; lng: number } }) {
  return (
    <NoticeMap key={`${centre.lat},${centre.lng}`} notices={[]} centre={centre} fallback={false} onSearchArea={() => {}} />
  );
}
```

Then `rerender(<MapAt centre={{ lat: 35.6976, lng: -0.6337 }} />)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/discovery/NoticeMap.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify in a real browser, because jsdom cannot show this**

jsdom has no WebGL, so no unit test observes actual tiles — this is the same blind spot that hid a broken map worker in Task 12. Start the API and dev server, then:
1. Open `/`, choose Algiers, switch to the map view.
2. Use the address search to pick Oran **without leaving the map view**.

Expected: the map recentres on Oran with its marker visible on screen. Record what you saw, including whether the "Search this area" button behaved normally afterwards.

- [ ] **Step 6: Confirm panning still does not refetch**

Spec §6 requires that panning shows "Search this area" rather than refetching continuously. The remount could plausibly interact with that, so re-check: drag the map, wait 2 seconds, and confirm no `/v1/notices` request fires until you click the button.

Expected: 0 requests during the idle, exactly 1 on the click.

- [ ] **Step 7: Run the gates and commit**

```bash
pnpm test && pnpm typecheck && pnpm build
pnpm --filter @jiwar/web e2e
git add apps/web/src/routes/Home.tsx apps/web/src/features/discovery/NoticeMap.test.tsx
git commit -m "fix(web): recentre the map when the chosen location changes

MapLibre reads initialViewState once on mount, so changing location while the
map view was open left the viewport behind with its marker off-screen. Keying
the element on the centre remounts it."
```

---

### Task 18: Tell the truth in the empty state for a past search

**Why:** `discovery.empty` is hardcoded to "No upcoming notices within {radius} km." and `NoticeList` never receives `when`. Measured against the live API: an explicit past search with no results returns `{"items":[],"nextCursor":null,"fallback":false}` — correctly, since spec §6 says an explicit past search does not fall back — and the UI then renders "No upcoming notices within 20 km." while the Past filter is visibly selected. Factually wrong, and confusing precisely when a reader is trying to work out whether to widen their search.

**Files:**
- Modify: `apps/web/src/features/discovery/NoticeList.tsx`
- Modify: `apps/web/src/features/discovery/NoticeList.test.tsx`
- Modify: `apps/web/src/i18n/en.ts`
- Modify: `apps/web/src/routes/Home.tsx` (pass `when` through)

**Interfaces:**
- Consumes: the `when` value `Home.tsx` already derives from the URL (`"upcoming" | "past"`).
- Produces: `NoticeListProps` gains `when: "upcoming" | "past"` as a **required** prop, so omitting it is a compile error rather than a silently wrong string. Adds the i18n key `discovery.emptyPast`.

- [ ] **Step 1: Write the failing test**

```tsx
it("says 'past' in the empty state when the past filter is selected", () => {
  render(
    <NoticeList
      notices={[]} isLoading={false} isError={false} fallback={false}
      radiusKm={20} when="past" hasMore={false} onLoadMore={() => {}} onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/no past notices within 20 km/i)).toBeInTheDocument();
  expect(screen.queryByText(/upcoming/i)).not.toBeInTheDocument();
});

it("still says 'upcoming' for an upcoming search", () => {
  render(
    <NoticeList
      notices={[]} isLoading={false} isError={false} fallback={false}
      radiusKm={20} when="upcoming" hasMore={false} onLoadMore={() => {}} onRetry={() => {}}
    />,
  );
  expect(screen.getByText(/no upcoming notices within 20 km/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jiwar/web exec vitest run src/features/discovery/NoticeList.test.tsx`
Expected: FAIL — first with a TypeScript error on the unknown `when` prop if you run typecheck, and at runtime with "Unable to find an element with the text: /no past notices within 20 km/i".

- [ ] **Step 3: Add the string**

In `apps/web/src/i18n/en.ts`, beside `"discovery.empty"`:

```ts
  "discovery.emptyPast": "No past notices within {radius} km.",
```

- [ ] **Step 4: Take the prop and use it**

In `apps/web/src/features/discovery/NoticeList.tsx`, add to the props interface:

```ts
  when: "upcoming" | "past";
```

and change the empty branch:

```tsx
  if (notices.length === 0) {
    // The API correctly does not fall back for an explicit past search (spec §6), so
    // this branch is reachable with the Past filter selected — saying "upcoming"
    // there is simply wrong.
    return (
      <p>{t(when === "past" ? "discovery.emptyPast" : "discovery.empty", { radius: radiusKm })}</p>
    );
  }
```

- [ ] **Step 5: Pass it from `Home.tsx`**

`Home.tsx` already computes `when`. Add `when={when}` to the `<NoticeList>` element. Because the prop is required, `pnpm typecheck` fails if you forget — that is the intended guard.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter @jiwar/web test && pnpm --filter @jiwar/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS and exit 0.

- [ ] **Step 7: Verify the compile-time guard**

Remove `when={when}` from `Home.tsx`, run `tsc -p tsconfig.json --noEmit`, and confirm it errors. Restore it.

Expected: a `TS2741`-style "Property 'when' is missing" error naming `Home.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/discovery/NoticeList.tsx \
        apps/web/src/features/discovery/NoticeList.test.tsx \
        apps/web/src/i18n/en.ts apps/web/src/routes/Home.tsx
git commit -m "fix(web): say 'past' in the empty state for a past search

An explicit past search does not fall back (spec §6), so the empty branch is
reachable with the Past filter selected, where 'No upcoming notices' is wrong.
The prop is required so a caller cannot omit it and get the wrong string."
```

---

### Task 19: Rate-limit the two write endpoints

**Why:** `participants` rows are minted for **failed** requests, not just successful ones. Measured against the live API on merged `main`: 10 invalid `POST /v1/notices` (each a 400) added **10** rows, and 10 cancels of a malformed id (each a 403) added **10** more. The table is a foreign-key target for `notices`, so the rows cannot be cheaply pruned, and there is no rate limit on any endpoint — a public write-amplification surface. Task 8's lazy-minting fix narrowed *which routes* mint, but a request that fails validation still consumes an identity.

**Files:**
- Modify: `apps/api/package.json` (add `@nestjs/throttler`)
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/notices/notices.controller.ts`
- Create: `apps/api/test/throttle.int.test.ts`

**Interfaces:**
- Consumes: `NoticesController`'s existing `create` and `cancel` handlers.
- Produces: no change to any response shape on the success path. A throttled request returns **429** with Nest's default body. Reads (`GET /v1/notices`, `/v1/notices/:publicId`, `/v1/categories`, the geocode routes) are **not** throttled.

- [ ] **Step 1: Install the dependency at an exact version**

```bash
cd apps/api && pnpm add @nestjs/throttler@6.7.0
```

`6.7.0` peers on `@nestjs/core` `^12.0.0`, which matches this project's `12.0.3` — verified. Do not use `@latest`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/throttle.int.test.ts`. Follow the existing `notices-api.int.test.ts` for how it builds a testing module with a `@Global` provider module (note: `.overrideProvider(DRIZZLE)` is a silent no-op in this project — use the `@Global` module pattern the other int tests use).

```ts
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./db-harness.js";
import { buildTestApp } from "./notices-app.js"; // reuse whatever helper notices-api.int.test.ts uses

let testDb: TestDb;
let app: INestApplication;

beforeAll(async () => {
  testDb = await startTestDb();
  await testDb.seedCategories();
  app = await buildTestApp(testDb.url);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

describe("write-endpoint rate limiting", () => {
  it("returns 429 once the create limit is exceeded", async () => {
    const statuses: number[] = [];
    // The limit is 10 per minute; 12 attempts must include at least one 429.
    for (let i = 0; i < 12; i++) {
      const response = await request(app.getHttpServer())
        .post("/v1/notices")
        .send({ title: "too short" }); // invalid on purpose: a 400 must still count
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("does not throttle reads", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const response = await request(app.getHttpServer()).get("/v1/categories");
      statuses.push(response.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run --config vitest.int.config.ts test/throttle.int.test.ts`
Expected: FAIL on the first case — `statuses` contains only 400s, never a 429, because nothing is throttled yet.

- [ ] **Step 4: Register the throttler**

In `apps/api/src/app.module.ts`, add to the imports array:

```ts
import { ThrottlerModule } from "@nestjs/throttler";

// ...
  imports: [
    // Failed writes mint a participants row too, and that table is an FK target for
    // notices so the rows cannot be cheaply pruned. A limit on the write endpoints
    // bounds that growth; reads are deliberately not throttled.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    DrizzleModule,
    ParticipantsModule,
    CategoriesModule,
    NoticesModule,
    GeocodeModule,
  ],
```

Do **not** register `ThrottlerGuard` globally — that would throttle reads, including the discovery screen's own pagination.

- [ ] **Step 5: Guard only the write handlers**

In `apps/api/src/notices/notices.controller.ts`:

```ts
import { ThrottlerGuard } from "@nestjs/throttler";
import { UseGuards } from "@nestjs/common";
```

and add `@UseGuards(ThrottlerGuard)` to the `create` and `cancel` handlers only. Leave every `@Get` handler untouched.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && pnpm exec vitest run --config vitest.int.config.ts test/throttle.int.test.ts`
Expected: PASS on both cases.

- [ ] **Step 7: Verify the whole int suite still passes**

The other integration tests make many writes in a row — 125 tests including several that create notices in a loop. A 10-per-minute limit may throttle them.

Run: `cd apps/api && pnpm test:int`
Expected: 125+ passing. **If existing tests now fail with 429**, do not raise the limit to make them pass — that would defeat the task. Instead give the test app a higher limit via the testing module's own `ThrottlerModule.forRoot`, and say so in your report. The production limit is the thing being tested; the test harness is allowed a different one.

- [ ] **Step 8: Confirm it bounds real row growth**

Start the API against the dev database and count rows before and after:

```bash
docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "SELECT count(*) FROM participants;"
for i in $(seq 1 30); do curl -s -o /dev/null -X POST http://localhost:3000/v1/notices \
  -H 'Content-Type: application/json' -d '{"title":"x"}'; done
docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "SELECT count(*) FROM participants;"
```

Expected: fewer than 30 new rows — the limit cuts the run off. Record the actual before and after counts; before this task, 30 requests produced 30 rows.

- [ ] **Step 9: Run the gates and commit**

```bash
pnpm test && pnpm typecheck && pnpm build
pnpm --filter @jiwar/api test:int
pnpm --filter @jiwar/web e2e
git add apps/api/package.json apps/api/src/app.module.ts \
        apps/api/src/notices/notices.controller.ts apps/api/test/throttle.int.test.ts \
        pnpm-lock.yaml
git commit -m "feat(api): rate-limit the notice write endpoints

Failed writes mint a participants row too — 10 invalid creates added 10 rows —
and that table is an FK target so the rows cannot be cheaply pruned. Ten writes
per minute per IP bounds it. Reads are not throttled, so discovery pagination is
unaffected."
```

---

## Not in this plan, and why

These came out of the same review and are deliberately excluded:

- **`SameSite=Lax` topology.** Fine on one registrable domain (`jiwar.dz` + `api.jiwar.dz`), silently fatal across two (`jiwar.dz` + `jiwar-api.fly.dev`), where Lax drops the cookie on every XHR and identity breaks entirely. This is a **deployment decision**, not code — it needs the hosting choice first. Record the decision when hosting is picked; if the answer is two domains, the change is `SameSite=None; Secure` plus a config flag.
- **The 10-minute negative geocode cache.** A failed Nominatim lookup is cached as empty for the full TTL, so a transient outage hides that query for up to 10 minutes after recovery. It was inherited verbatim from the M1 plan rather than chosen. The suggested alternative is a separate 30–60 s negative TTL, which needs the cache to carry a per-entry TTL. Worth doing, but it is a judgment call about a third-party service's behaviour that the owner should make.
- **`NetworkError extends ApiError` with `status: 0`.** Task 10's client throws a raw `TypeError` on a network failure and a raw `ZodError` on contract drift, so `catch (e) { if (e instanceof ApiError) }` misses both. Neither resolves to wrong data — both reject — so there is no incorrect-data path, only a generic-message one. The clean fix belongs in the client and pairs naturally with M3's per-field error work.
- **`message` as `string[]` vs `string`.** Validation failures return an array that the client comma-joins, making per-field detail unrecoverable. Decide the shape when something actually needs per-field errors (M3), not before.
- **The redundant half of `SearchNoticesQuerySchema`.** After the contract-level coordinate fix, the local query guard overlaps it. It still earns its place — its `.meta()` is what keeps `lat`/`lng` rendering as bounded numbers in `/api/docs` through the `z.unknown()` pipe, and its messages are field-specific. Dropping only the redundant half is a safe cleanup, but it is cosmetic.
- **eslint.** The dead `lint` task is removed and the README says there is no linter. Choosing and configuring one is a scoping decision, not a fix.

## Self-Review

**Spec coverage.** §6's shareable-link promise is Task 15; its empty-result and fallback honesty is Task 18; its "panning must not refetch" guarantee is re-verified in Task 17 Step 6 rather than assumed. §5's privacy stance on `participants` is what makes Task 19 worth doing. No other §5–§12 requirement is touched by these five tasks — they are corrections, not new surface.

**Placeholder scan.** Every code step carries real code. The two places that say "keep what the file already renders" (Task 16 Step 4's load-more button, Task 17 Step 1's existing mock exports) refer to code the implementer has open in front of them and would otherwise be told to retype from a possibly-stale copy — the surrounding context makes the target unambiguous. Task 19 Step 2 points at `notices-api.int.test.ts` for the test-app helper rather than duplicating 40 lines of module setup, and names the specific trap (`.overrideProvider(DRIZZLE)` being a no-op) so the implementer does not rediscover it.

**Type consistency.** `useChosenLocation`'s return shape is unchanged across Task 15, so `Home.tsx` and `SubmitWizard` compile untouched. `NoticeListProps` gains exactly one required prop (`when`) in Task 18 and none in Task 16; both tasks modify the same file and the same test file, so they must run in order — 16 before 18, as numbered. Task 17 changes no interface. Task 19 changes no response shape. `discovery.loadMoreError` (Task 16) and `discovery.emptyPast` (Task 18) are distinct keys.

**One ordering constraint:** Tasks 16 and 18 both edit `NoticeList.tsx`, `NoticeList.test.tsx` and `en.ts`. Run them in numerical order. Tasks 15, 17 and 19 are independent of each other and of 16/18.
