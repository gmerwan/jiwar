import type { NoticeSearchResult, NoticeWithDistance } from "@jiwar/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type SearchParams } from "../../api/client.js";
import { useNotices, type UseNoticesParams } from "./useNotices.js";

vi.mock("../../api/client.js", () => ({
  api: { searchNotices: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const searchMock = api.searchNotices as unknown as ReturnType<typeof vi.fn>;

function notice(publicId: string): NoticeWithDistance {
  return {
    publicId,
    category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
    title: `Notice ${publicId}`,
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
}

function page(
  ids: string[],
  nextCursor: string | null,
  fallback = false,
): NoticeSearchResult {
  return { items: ids.map(notice), nextCursor, fallback };
}

const baseParams: UseNoticesParams = {
  lat: 36.75,
  lng: 3.06,
  radiusKm: 20,
  categories: [],
  when: "upcoming",
  sort: "soonest",
  enabled: true,
};

/**
 * `retry: false` so an intentionally failing query reaches `isError` at once
 * rather than after React Query's default backoff.
 */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const renderNotices = (overrides: Partial<UseNoticesParams> = {}) =>
  renderHook(() => useNotices({ ...baseParams, ...overrides }), { wrapper: wrapper() });

/** The SearchParams the mock was called with on call number `n` (1-based). */
const callArg = (n: number): SearchParams => searchMock.mock.calls[n - 1]![0] as SearchParams;

describe("useNotices", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  afterEach(cleanup);

  it("sends the first page with no cursor and exposes its items", async () => {
    searchMock.mockResolvedValue(page(["a", "b"], null));
    const { result } = renderNotices();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(callArg(1).cursor).toBeUndefined();
    expect(result.current.notices.map((n) => n.publicId)).toEqual(["a", "b"]);
  });

  it("feeds nextCursor back as the cursor for the following page, and concatenates without duplicating or skipping", async () => {
    searchMock
      .mockResolvedValueOnce(page(["a", "b"], "CURSOR_1"))
      .mockResolvedValueOnce(page(["c", "d"], "CURSOR_2"))
      .mockResolvedValueOnce(page(["e"], null));

    const { result } = renderNotices();
    await waitFor(() => expect(result.current.notices).toHaveLength(2));

    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.notices).toHaveLength(4));

    // The exact cursor the first page minted must be what page two asks for.
    expect(callArg(2).cursor).toBe("CURSOR_1");

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.notices).toHaveLength(5));
    expect(callArg(3).cursor).toBe("CURSOR_2");

    // No duplicates, nothing skipped, and pages stay in the order the API sent them.
    expect(result.current.notices.map((n) => n.publicId)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("stops offering more pages once the cursor is null", async () => {
    searchMock
      .mockResolvedValueOnce(page(["a"], "CURSOR_1"))
      .mockResolvedValueOnce(page(["b"], null));

    const { result } = renderNotices();
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.notices).toHaveLength(2));

    expect(result.current.hasMore).toBe(false);

    // A loadMore() after the end must not invent another request.
    act(() => result.current.loadMore());
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the first page's fallback flag when a later page reports false", async () => {
    // Task 7 pins the past branch for the rest of the scroll, so page two carries
    // fallback: true too -- but the hook must not depend on that to stay honest.
    searchMock
      .mockResolvedValueOnce(page(["old1"], "CURSOR_1", true))
      .mockResolvedValueOnce(page(["old2"], null, false));

    const { result } = renderNotices();
    await waitFor(() => expect(result.current.fallback).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.notices).toHaveLength(2));

    expect(result.current.fallback).toBe(true);
  });

  it("does not request anything while the location is unknown", async () => {
    searchMock.mockResolvedValue(page([], null));
    const { result } = renderNotices({ enabled: false, lat: 0, lng: 0 });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(searchMock).not.toHaveBeenCalled();
    expect(result.current.notices).toEqual([]);
  });

  it("omits categories entirely when none are selected, and sends them when they are", async () => {
    searchMock.mockResolvedValue(page(["a"], null));

    const { result } = renderNotices();
    await waitFor(() => expect(result.current.notices).toHaveLength(1));
    expect("categories" in callArg(1)).toBe(false);

    cleanup();
    searchMock.mockReset();
    searchMock.mockResolvedValue(page(["a"], null));

    const second = renderNotices({ categories: ["funeral", "wedding"] });
    await waitFor(() => expect(second.result.current.notices).toHaveLength(1));
    expect(callArg(1).categories).toEqual(["funeral", "wedding"]);
  });

  it("refetches with the new parameters when a filter changes, and keeps pages of different filters apart", async () => {
    searchMock.mockResolvedValue(page(["a"], null));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { result, rerender } = renderHook(
      (params: UseNoticesParams) => useNotices(params),
      {
        initialProps: baseParams,
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );

    await waitFor(() => expect(result.current.notices).toHaveLength(1));
    expect(callArg(1).radiusKm).toBe(20);

    searchMock.mockResolvedValue(page(["z"], null));
    rerender({ ...baseParams, radiusKm: 50, sort: "nearest" });

    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(callArg(2).radiusKm).toBe(50);
    expect(callArg(2).sort).toBe("nearest");
    // A new filter starts a new query, so the old filter's rows are not blended in.
    await waitFor(() => expect(result.current.notices.map((n) => n.publicId)).toEqual(["z"]));
  });

  it("surfaces a raw network TypeError as isError, not just an ApiError", async () => {
    // Task 10's client throws a bare TypeError from fetch and a bare ZodError on
    // contract drift; neither is an ApiError, so the error path must not narrow.
    searchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = renderNotices();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.notices).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("retry() re-issues the request after a failure", async () => {
    searchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderNotices();
    await waitFor(() => expect(result.current.isError).toBe(true));

    searchMock.mockResolvedValue(page(["a"], null));
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.notices).toHaveLength(1));
    expect(result.current.isError).toBe(false);
  });
});
