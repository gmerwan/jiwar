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
   */
  const latestParams = useRef(searchParams);
  useLayoutEffect(() => {
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

  const urlLat = withinDegrees(parseFiniteParam(searchParams.get("lat")), 90);
  const urlLng = withinDegrees(parseFiniteParam(searchParams.get("lng")), 180);
  const urlRadius = parseFiniteParam(searchParams.get("radiusKm"));

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

  const radiusKm = urlRadius !== null && urlRadius > 0 ? urlRadius : storedRadius;

  const [status, setStatus] = useState<LocationStatus>(() => (location ? "ready" : "idle"));
  const [error, setError] = useState<string | null>(null);

  const writeParams = useCallback((entries: Record<string, string>) => {
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
