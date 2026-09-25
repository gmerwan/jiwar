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
