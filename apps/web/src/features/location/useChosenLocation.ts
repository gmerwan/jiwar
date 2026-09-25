import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * The radii a visitor can pick, and so the only ones a link may carry.
 *
 * `FilterBar` renders exactly these, so a `radiusKm` outside the list would leave its
 * `<select>` showing no option. Anything above the API's `MAX_RADIUS_KM` (100 by
 * default) is also refused with a 400, and `NoticeMap` has no error state, so the map
 * view would go blank with no message. A link can be edited by anyone, so only these
 * values are read from it.
 */
export const RADIUS_OPTIONS: readonly number[] = [5, 10, 20, 50, 100];

/**
 * Parses one query-string value as a finite number, or `null` when it carries none.
 *
 * `Number("")` and `Number(null)` are both `0`, which is a valid latitude — the
 * blank-as-zero coercion trap this project has now hit four times. Blanks are rejected
 * explicitly; a genuine `"0"` still parses, because the equator is a place.
 */
function parseFiniteParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Drops a coordinate outside ±`limit` degrees.
 *
 * Before this hook read the URL, every coordinate came from the geolocation API, the
 * geocoder or the map, all of which stay in range. A link can be edited by anyone.
 * Measured with `?lat=91&lng=3.06&view=map` and no guard: MapLibre logged "Invalid
 * LngLat latitude value: must be between -90 and 90" and painted nothing where the map
 * should be, and both searches came back 400 — a blank rectangle with no message.
 * Dropping the coordinate shows the "choose a location" prompt instead.
 */
function withinDegrees(value: number | null, limit: number): number | null {
  return value !== null && value >= -limit && value <= limit ? value : null;
}

function validRadius(value: number | null): number | null {
  return value !== null && RADIUS_OPTIONS.includes(value) ? value : null;
}

function readStoredLocation(): ChosenLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Held to the same bounds as a URL coordinate: a stored location is shown on the
    // map and copied into the URL, so it can break the page the same way a bad link can.
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lng === "number" &&
      withinDegrees(parsed.lat, 90) !== null &&
      withinDegrees(parsed.lng, 180) !== null
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function readStoredRadius(): number {
  try {
    return validRadius(parseFiniteParam(localStorage.getItem(RADIUS_KEY))) ?? DEFAULT_RADIUS_KM;
  } catch {
    return DEFAULT_RADIUS_KM;
  }
}

/**
 * The search origin and radius, URL first.
 *
 * Spec §6 promises that "every view — including a filtered map at a chosen radius — is
 * a shareable link". That only holds if the origin and radius travel in the URL, so
 * they are read from there first and written back on every change.
 *
 * `localStorage` stays as the seed for a visitor arriving at a bare `/`, and as the
 * memory across sessions that a URL cannot give. It is written only when the visitor
 * actively chooses — opening a link someone sent you does not replace your own area.
 * Whatever is shown from storage is copied into the URL, so a returning visitor's link
 * is as shareable as one built during the session.
 */
export function useChosenLocation() {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The query string as this hook last wrote it, or as the router last rendered it.
   *
   * React Router's `setSearchParams` does not queue the way React's `setState` does —
   * not even with a functional updater. In 7.18.4 the updater's `prev` is a copy of the
   * params from the last render, and its own docs warn that "multiple calls to
   * `setSearchParams` in the same tick will not build on the prior value". So
   * `setLocation` then `setRadiusKm` in one tick would start the second write from the
   * pre-first-write params and erase `lat`/`lng`. Each write therefore starts from this
   * ref and advances it synchronously. The layout effect hands authority back to the
   * router as soon as it renders a new query string, whoever wrote it.
   *
   * This only coordinates the hook's own writes: `Home`'s `setParam` still starts from
   * its render-time params, so a `setParam` and a hook setter in the same tick lose
   * one change (nothing does both today), and when another writer produces an
   * identical query string the router does not re-render, so the ref can briefly
   * disagree with it until the next URL change — harmless, because it is re-synced
   * then.
   */
  const latestParams = useRef(searchParams);
  const renderedParams = useRef(searchParams);
  useLayoutEffect(() => {
    // Strict Mode re-runs this with nothing new from the router. Re-syncing then would
    // roll the ref back past a write the hook has made but the router has not rendered.
    if (renderedParams.current === searchParams) return;
    renderedParams.current = searchParams;
    latestParams.current = searchParams;
  }, [searchParams]);

  /**
   * `setSearchParams` is itself rebuilt whenever the query string changes (its
   * `useCallback` depends on `searchParams`), so depending on it directly would give
   * `setLocation` a new identity after every write. Reading it through a ref keeps
   * the setters as stable as they were before the URL was involved, so an effect
   * that depends on `setLocation` cannot loop on its own write.
   */
  const latestSetSearchParams = useRef(setSearchParams);
  useLayoutEffect(() => {
    latestSetSearchParams.current = setSearchParams;
  }, [setSearchParams]);

  /**
   * Whether the component using this hook is still on screen.
   *
   * A geolocation fix can arrive up to 10 s after "Use my location" is pressed, by which
   * time the visitor may have moved to `/submit`. The unmounted page's `setSearchParams`
   * still navigates — React Router's own active-guard is never reset on unmount — and
   * with `replace` it would overwrite `/submit`'s history entry with `/?lat=…`, dragging
   * the visitor back and discarding what they had typed into the wizard. So URL writes
   * stop at unmount; the storage write for a location the visitor did ask for still
   * happens.
   */
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const urlLat = withinDegrees(parseFiniteParam(searchParams.get("lat")), 90);
  const urlLng = withinDegrees(parseFiniteParam(searchParams.get("lng")), 180);
  const urlRadius = validRadius(parseFiniteParam(searchParams.get("radiusKm")));

  const [storedLocation, setStoredLocation] = useState<ChosenLocation | null>(readStoredLocation);
  const [storedRadius, setStoredRadius] = useState<number>(readStoredRadius);

  /**
   * Memoised on the two parsed numbers, not rebuilt each render: `Home` hands the
   * location to `useNotices` and to `<NoticeMap centre>`, and a fresh object every
   * render — including every `view` or `sort` change — would look like a new location.
   */
  const urlLocation = useMemo<ChosenLocation | null>(
    () => (urlLat !== null && urlLng !== null ? { lat: urlLat, lng: urlLng } : null),
    [urlLat, urlLng],
  );

  // The URL carries no label. When it points where this visitor last chose, that choice
  // — label and all — is the location, rather than a bare copy of its coordinates.
  const location =
    urlLocation === null ||
    (storedLocation?.lat === urlLocation.lat && storedLocation.lng === urlLocation.lng)
      ? storedLocation
      : urlLocation;

  const radiusKm = urlRadius ?? storedRadius;

  const [status, setStatus] = useState<LocationStatus>(() => (location ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);

  const writeParams = useCallback((entries: Record<string, string>) => {
    if (!mounted.current) return;
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(entries)) next.set(key, value);
    latestParams.current = next;
    latestSetSearchParams.current(next, { replace: true });
  }, []);

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
      setStoredRadius(next);
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

  /**
   * Copies the location and radius being shown into the URL when it does not carry
   * them, so the link a visitor copies always reproduces what they see.
   *
   * Without this, a returning visitor whose area came from storage — the common case —
   * sat on `/?view=map&sort=nearest` with no `lat`, `lng` or `radiusKm`, and anyone
   * they sent it to was asked to choose a location. The same happened after
   * `<Link to="/">` from a notice or the wizard, and to a stored radius beside a
   * location chosen this session, which reached the recipient as the 20 km default.
   *
   * - Only what is missing or invalid is written; a valid value in the URL is left
   *   alone, because the URL wins.
   * - Storage is never written here: a shared link must not replace the recipient's
   *   own area.
   * - The default radius is written too, so a recipient never silently gets their own.
   * - `replace`, as every write here, so Back does not gain a step.
   * - Nothing is written while no location is shown: the page is a prompt then, and a
   *   bare radius in the URL would only override the recipient's stored one.
   * - A write the hook has already made, and the router has not yet rendered, is not
   *   repeated — including on Strict Mode's second effect run.
   */
  useEffect(() => {
    if (location === null) return;
    const missing: Record<string, string> = {};
    if (urlLocation === null) {
      missing.lat = String(location.lat);
      missing.lng = String(location.lng);
    }
    if (urlRadius === null) missing.radiusKm = String(radiusKm);

    const entries = Object.entries(missing);
    if (entries.length === 0) return;
    if (entries.every(([key, value]) => latestParams.current.get(key) === value)) return;
    writeParams(missing);
  }, [location, urlLocation, urlRadius, radiusKm, writeParams]);

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
