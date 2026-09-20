import type { GeocodeResult } from "@jiwar/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client.js";
import { AddressSearch } from "./AddressSearch.js";

vi.mock("../../api/client.js", () => ({
  api: { geocode: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const geocodeMock = api.geocode as unknown as ReturnType<typeof vi.fn>;

function result(label: string, lat: number, lng: number): GeocodeResult {
  return { label, lat, lng };
}

describe("AddressSearch", () => {
  beforeEach(() => {
    geocodeMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("debounces: several fast keystrokes trigger exactly one api.geocode call", async () => {
    geocodeMock.mockResolvedValue([result("Algiers", 36.75, 3.06)]);
    const user = userEvent.setup({ delay: null });
    render(<AddressSearch onPick={vi.fn()} />);

    const input = screen.getByPlaceholderText("Search for a place or address");

    // Type "Algiers" one keystroke at a time, each well inside the 500ms window.
    await user.type(input, "Alg");
    await vi.advanceTimersByTimeAsync(100);
    await user.type(input, "iers");

    // Still short of 500ms since the LAST keystroke: no call yet.
    await vi.advanceTimersByTimeAsync(400);
    expect(geocodeMock).not.toHaveBeenCalled();

    // Cross the 500ms threshold from the last keystroke.
    await vi.advanceTimersByTimeAsync(150);

    expect(geocodeMock).toHaveBeenCalledTimes(1);
    expect(geocodeMock).toHaveBeenCalledWith("Algiers");
  });

  it("a stale response cannot overwrite a newer query's results", async () => {
    let resolveA: ((r: GeocodeResult[]) => void) | undefined;
    let resolveB: ((r: GeocodeResult[]) => void) | undefined;

    geocodeMock.mockImplementation((q: string) => {
      if (q === "AAA") {
        return new Promise<GeocodeResult[]>((resolve) => {
          resolveA = resolve;
        });
      }
      if (q === "BBBB") {
        return new Promise<GeocodeResult[]>((resolve) => {
          resolveB = resolve;
        });
      }
      return Promise.resolve([]);
    });

    const user = userEvent.setup({ delay: null });
    render(<AddressSearch onPick={vi.fn()} />);
    const input = screen.getByPlaceholderText("Search for a place or address");

    // Query A: types "AAA", debounce fires, request A is in flight.
    await user.type(input, "AAA");
    await vi.advanceTimersByTimeAsync(500);
    expect(geocodeMock).toHaveBeenCalledWith("AAA");

    // Query B: clear and type "BBBB" before A resolves; its debounce fires too.
    await user.clear(input);
    await user.type(input, "BBBB");
    await vi.advanceTimersByTimeAsync(500);
    expect(geocodeMock).toHaveBeenCalledWith("BBBB");

    // Resolve B (the newer query) first, then let the stale A response arrive
    // late -- this is the actual race: an in-flight older request completing
    // after a newer one must not be allowed to clobber its results.
    resolveB?.([result("Fresh B result", 2, 2)]);
    await vi.runAllTimersAsync();

    resolveA?.([result("Stale A result", 1, 1)]);
    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByText("Fresh B result")).toBeInTheDocument();
    });
    expect(screen.queryByText("Stale A result")).not.toBeInTheDocument();
  });

  it("onPick hands back the exact GeocodeResult the user selected", async () => {
    const picked = result("Algiers, Algeria", 36.7538, 3.0588);
    geocodeMock.mockResolvedValue([picked]);
    const onPick = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<AddressSearch onPick={onPick} />);

    const input = screen.getByPlaceholderText("Search for a place or address");
    await user.type(input, "Algiers");
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const button = await waitFor(() => screen.getByText("Algiers, Algeria"));
    await user.click(button);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(picked);
  });

  it("a failed lookup degrades visibly instead of leaving the searching state stuck", async () => {
    geocodeMock.mockRejectedValue(new ApiError(502, "Nominatim is unreachable"));
    const user = userEvent.setup({ delay: null });
    render(<AddressSearch onPick={vi.fn()} />);

    const input = screen.getByPlaceholderText("Search for a place or address");
    await user.type(input, "Algiers");
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    await waitFor(() => {
      expect(screen.getByText("No places found.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });
});
