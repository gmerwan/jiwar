import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChosenLocation } from "./useChosenLocation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routerAt(url: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };
}

/** The hook reads `useSearchParams`, so every render needs a router around it. */
function renderAt(url = "/") {
  return renderHook(() => useChosenLocation(), { wrapper: routerAt(url) });
}

/**
 * Renders the hook next to the router's own view of the query string.
 *
 * `MemoryRouter` never touches `window.location`, so asserting on
 * `window.location.search` would read jsdom's untouched `about:blank` and pass or
 * fail for reasons unrelated to the hook. The router's location is the only place
 * a write is actually observable.
 */
function renderWithSearch(url: string) {
  return renderHook(
    () => ({ chosen: useChosenLocation(), search: new URLSearchParams(useLocation().search) }),
    { wrapper: routerAt(url) },
  );
}

const ALGIERS = { lat: 36.7538, lng: 3.0588 };
const ORAN = { lat: 35.6976, lng: -0.6337 };

describe("useChosenLocation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts with no location and an idle status", () => {
    const { result } = renderAt();
    expect(result.current.location).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("stores a manually chosen location and persists it", () => {
    const { result } = renderAt();
    act(() => result.current.setLocation({ lat: 36.75, lng: 3.06, label: "Algiers" }));

    expect(result.current.location).toEqual({ lat: 36.75, lng: 3.06, label: "Algiers" });
    expect(result.current.status).toBe("ready");

    const reloaded = renderAt();
    expect(reloaded.result.current.location?.lat).toBe(36.75);
  });

  it("records a denied permission as a recoverable state, not an error screen", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) =>
          fail({ code: 1 }),
      },
    });

    const { result } = renderAt();
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

    const { result } = renderAt();
    await act(async () => {
      await result.current.requestBrowserLocation();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.location?.lat).toBeCloseTo(36.7538, 4);
  });

  it("reports unavailable when the browser has no geolocation at all", async () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderAt();
    await act(async () => {
      await result.current.requestBrowserLocation();
    });
    expect(result.current.status).toBe("unavailable");
  });

  it("defaults the radius to 20 km and persists a change", () => {
    const { result } = renderAt();
    expect(result.current.radiusKm).toBe(20);

    act(() => result.current.setRadiusKm(50));
    const reloaded = renderAt();
    expect(reloaded.result.current.radiusKm).toBe(50);
  });
});

describe("useChosenLocation URL state", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the location and radius from the URL", () => {
    const { result } = renderAt("/?lat=36.7538&lng=3.0588&radiusKm=5");
    expect(result.current.location).toEqual(ALGIERS);
    expect(result.current.radiusKm).toBe(5);
    expect(result.current.status).toBe("ready");
  });

  it("prefers the URL over a stored location and radius", () => {
    localStorage.setItem("jiwar.location", JSON.stringify(ORAN));
    localStorage.setItem("jiwar.radiusKm", "50");
    const { result } = renderAt("/?lat=36.7538&lng=3.0588&radiusKm=5");
    expect(result.current.location).toEqual(ALGIERS);
    expect(result.current.radiusKm).toBe(5);
  });

  it("falls back to a stored location and radius when the URL has none", () => {
    localStorage.setItem("jiwar.location", JSON.stringify(ORAN));
    localStorage.setItem("jiwar.radiusKm", "50");
    const { result } = renderAt("/?view=map");
    expect(result.current.location).toEqual(ORAN);
    expect(result.current.radiusKm).toBe(50);
  });

  it("does not overwrite the visitor's stored location when they open a shared link", () => {
    localStorage.setItem("jiwar.location", JSON.stringify(ORAN));
    localStorage.setItem("jiwar.radiusKm", "50");
    renderAt("/?lat=36.7538&lng=3.0588&radiusKm=5");

    // A link someone sent you must not silently replace your own home area: opening
    // a bare `/` afterwards shows the visitor's area again.
    expect(JSON.parse(localStorage.getItem("jiwar.location") ?? "null")).toEqual(ORAN);
    expect(localStorage.getItem("jiwar.radiusKm")).toBe("50");
    expect(renderAt("/").result.current.location).toEqual(ORAN);
  });

  it("ignores a blank, missing or non-numeric coordinate in the URL", () => {
    // `Number("")` and `Number(null)` are both 0 — a valid latitude — so each of
    // these would land on (0, 3.06) without an explicit blank check.
    expect(renderAt("/?lat=&lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lat=%20%20&lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lat=abc&lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lat=36.75&lng=Infinity").result.current.location).toBeNull();
  });

  it("ignores an out-of-range coordinate in the URL", () => {
    // A hand-edited link with lat=91 otherwise reaches MapLibre, which rejects it and
    // paints an empty map, while the API answers the search with a 400.
    expect(renderAt("/?lat=91&lng=3.06").result.current.location).toBeNull();
    expect(renderAt("/?lat=36.75&lng=-181").result.current.location).toBeNull();
    expect(renderAt("/?lat=-90&lng=180").result.current.location).toEqual({ lat: -90, lng: 180 });
  });

  it("accepts a genuine zero coordinate from the URL", () => {
    const { result } = renderAt("/?lat=0&lng=0");
    expect(result.current.location).toEqual({ lat: 0, lng: 0 });
  });

  it("ignores a blank, zero or negative radius in the URL", () => {
    expect(renderAt("/?radiusKm=").result.current.radiusKm).toBe(20);
    expect(renderAt("/?radiusKm=0").result.current.radiusKm).toBe(20);
    expect(renderAt("/?radiusKm=-5").result.current.radiusKm).toBe(20);
    expect(renderAt("/?radiusKm=abc").result.current.radiusKm).toBe(20);
  });

  it("keeps the URL-derived location's identity when an unrelated param changes", () => {
    // Home passes `location` to useNotices and to <NoticeMap centre>, so a fresh
    // object on every render — every view or sort switch — would look like a new
    // location each time.
    const { result } = renderHook(
      () => ({ chosen: useChosenLocation(), setSearchParams: useSearchParams()[1] }),
      { wrapper: routerAt("/?lat=36.7538&lng=3.0588&view=list") },
    );
    const first = result.current.chosen.location;
    expect(first).toEqual(ALGIERS);

    act(() => result.current.setSearchParams((prev) => (prev.set("view", "map"), prev)));

    expect(result.current.chosen.location).toBe(first);
  });

  it("writes the location into the URL, keeping the params already there", () => {
    const { result } = renderWithSearch("/?view=map&sort=nearest");
    act(() => result.current.chosen.setLocation({ lat: 36.75, lng: 3.06 }));

    expect(result.current.search.get("lat")).toBe("36.75");
    expect(result.current.search.get("lng")).toBe("3.06");
    expect(result.current.search.get("view")).toBe("map");
    expect(result.current.search.get("sort")).toBe("nearest");
    expect(result.current.chosen.location).toEqual({ lat: 36.75, lng: 3.06 });
  });

  it("writes the radius into the URL", () => {
    const { result } = renderWithSearch("/?lat=36.75&lng=3.06");
    act(() => result.current.chosen.setRadiusKm(5));

    expect(result.current.search.get("radiusKm")).toBe("5");
    expect(result.current.search.get("lat")).toBe("36.75");
    expect(result.current.chosen.radiusKm).toBe(5);
  });

  it("keeps both writes when the location and radius change in the same tick", () => {
    const { result } = renderWithSearch("/?view=map");
    act(() => {
      result.current.chosen.setLocation({ lat: 36.75, lng: 3.06 });
      result.current.chosen.setRadiusKm(5);
    });

    expect(result.current.search.get("lat")).toBe("36.75");
    expect(result.current.search.get("lng")).toBe("3.06");
    expect(result.current.search.get("radiusKm")).toBe("5");
    expect(result.current.search.get("view")).toBe("map");
  });

  it("keeps its setters' identity after writing to the URL", () => {
    const { result } = renderWithSearch("/?view=list");
    const before = result.current.chosen;

    act(() => result.current.chosen.setLocation({ lat: 36.75, lng: 3.06 }));
    act(() => result.current.chosen.setRadiusKm(5));

    // The writes landed, so the router did re-render with a new query string.
    expect(result.current.search.get("lat")).toBe("36.75");
    expect(result.current.search.get("radiusKm")).toBe("5");
    expect(result.current.chosen.setLocation).toBe(before.setLocation);
    expect(result.current.chosen.setRadiusKm).toBe(before.setRadiusKm);
    expect(result.current.chosen.requestBrowserLocation).toBe(before.requestBrowserLocation);
  });

  it("builds on a param someone else wrote since its own last write", () => {
    // Home writes `view`, `sort` and `category` through its own setSearchParams. The
    // hook's next write must start from those, not from what it last wrote itself.
    const { result } = renderHook(
      () => ({
        chosen: useChosenLocation(),
        search: new URLSearchParams(useLocation().search),
        setSearchParams: useSearchParams()[1],
      }),
      { wrapper: routerAt("/?view=list") },
    );

    act(() => result.current.chosen.setLocation({ lat: 36.75, lng: 3.06 }));
    act(() => result.current.setSearchParams((prev) => (prev.set("view", "map"), prev)));
    act(() => result.current.chosen.setRadiusKm(5));

    expect(result.current.search.get("view")).toBe("map");
    expect(result.current.search.get("lat")).toBe("36.75");
    expect(result.current.search.get("radiusKm")).toBe("5");
  });
});
