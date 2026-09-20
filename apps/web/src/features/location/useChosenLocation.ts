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
