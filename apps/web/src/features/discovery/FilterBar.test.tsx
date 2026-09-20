import type { Category, NoticeSearchResult } from "@jiwar/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type SearchParams } from "../../api/client.js";
import { FilterBar } from "./FilterBar.js";
import { useNotices } from "./useNotices.js";

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

/** The six seeded categories, in the shape `api.categories()` returns. */
const categories: Category[] = [
  { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
  { slug: "aqiqah", name: "Aqiqah", icon: "aqiqah", sortOrder: 30 },
];

const emptyPage: NoticeSearchResult = { items: [], nextCursor: null, fallback: false };

const handlers = () => ({
  onCategoriesChange: vi.fn(),
  onRadiusChange: vi.fn(),
  onWhenChange: vi.fn(),
  onSortChange: vi.fn(),
});

/** [category, radius, when, sort] — the order FilterBar renders its selects in. */
const selects = () => screen.getAllByRole("combobox");

const callArg = (n: number): SearchParams => searchMock.mock.calls[n - 1]![0] as SearchParams;

/**
 * FilterBar wired to the real `useNotices`, so a filter change is observed as an
 * actual request rather than only as a callback.
 */
function Harness() {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [radiusKm, setRadiusKm] = useState(20);
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [sort, setSort] = useState<"soonest" | "nearest">("soonest");

  const notices = useNotices({
    lat: 36.75,
    lng: 3.06,
    radiusKm,
    categories: selectedCategories,
    when,
    sort,
    enabled: true,
  });

  return (
    <>
      <FilterBar
        categories={categories}
        selectedCategories={selectedCategories}
        onCategoriesChange={setSelectedCategories}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        when={when}
        onWhenChange={setWhen}
        sort={sort}
        onSortChange={setSort}
      />
      <output data-testid="notice-count">{notices.notices.length}</output>
    </>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("FilterBar", () => {
  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue(emptyPage);
  });

  afterEach(cleanup);

  it("offers every category plus an all-categories option", () => {
    render(<FilterBar categories={categories} selectedCategories={[]} radiusKm={20} when="upcoming" sort="soonest" {...handlers()} />);

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("All categories");
    expect(options).toContain("Funeral");
    expect(options).toContain("Wedding");
    expect(options).toContain("Aqiqah");
  });

  it("reports a picked category as a one-element slug array", async () => {
    const props = handlers();
    const user = userEvent.setup();
    render(<FilterBar categories={categories} selectedCategories={[]} radiusKm={20} when="upcoming" sort="soonest" {...props} />);

    await user.selectOptions(selects()[0]!, "wedding");
    expect(props.onCategoriesChange).toHaveBeenCalledWith(["wedding"]);
  });

  it("clears to an EMPTY array rather than one empty string", async () => {
    // [""] would serialise to `?categories=` -- an empty value the API rejects.
    const props = handlers();
    const user = userEvent.setup();
    render(<FilterBar categories={categories} selectedCategories={["wedding"]} radiusKm={20} when="upcoming" sort="soonest" {...props} />);

    await user.selectOptions(selects()[0]!, "");
    expect(props.onCategoriesChange).toHaveBeenCalledWith([]);
    expect(props.onCategoriesChange).not.toHaveBeenCalledWith([""]);
  });

  it("reports the radius as a number, not the select's string value", async () => {
    const props = handlers();
    const user = userEvent.setup();
    render(<FilterBar categories={categories} selectedCategories={[]} radiusKm={20} when="upcoming" sort="soonest" {...props} />);

    await user.selectOptions(selects()[1]!, "50");
    expect(props.onRadiusChange).toHaveBeenCalledWith(50);
    // `"50"` would reach the query string as-is and pass, but `Number` is what the
    // contract's radiusKm is typed as, and what useNotices keys its cache on.
    expect(props.onRadiusChange).not.toHaveBeenCalledWith("50");
  });

  it("reports when and sort as the contract's union members", async () => {
    const props = handlers();
    const user = userEvent.setup();
    render(<FilterBar categories={categories} selectedCategories={[]} radiusKm={20} when="upcoming" sort="soonest" {...props} />);

    await user.selectOptions(selects()[2]!, "past");
    expect(props.onWhenChange).toHaveBeenCalledWith("past");

    await user.selectOptions(selects()[3]!, "nearest");
    expect(props.onSortChange).toHaveBeenCalledWith("nearest");
  });

  it("changing a filter refetches with the new parameters", async () => {
    const user = userEvent.setup();
    renderHarness();

    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
    expect(callArg(1).radiusKm).toBe(20);
    expect(callArg(1).sort).toBe("soonest");

    await user.selectOptions(selects()[1]!, "50");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(callArg(2).radiusKm).toBe(50);

    await user.selectOptions(selects()[3]!, "nearest");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    expect(callArg(3).sort).toBe("nearest");
    // The earlier change is still in effect; a later filter does not reset it.
    expect(callArg(3).radiusKm).toBe(50);
  });

  it("never sends a blank lat, lng, radius or category to the API", async () => {
    // `?lat=&lng=` is a 400 (apps/api/src/notices/search-query.schema.ts guards it
    // because z.coerce.number() turns "" into 0 -- a valid latitude in the Gulf of
    // Guinea). An empty `categories` entry is the same class of bug.
    const user = userEvent.setup();
    renderHarness();

    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));

    await user.selectOptions(selects()[0]!, "funeral");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(callArg(2).categories).toEqual(["funeral"]);

    await user.selectOptions(selects()[0]!, "");
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(3));
    // Cleared means the parameter is absent, never present-and-empty.
    expect(callArg(3).categories).toBeUndefined();

    for (const [index, [params]] of searchMock.mock.calls.entries()) {
      const search = params as SearchParams;
      expect(Number.isFinite(search.lat), `call ${index + 1} lat`).toBe(true);
      expect(Number.isFinite(search.lng), `call ${index + 1} lng`).toBe(true);
      expect(Number.isFinite(search.radiusKm), `call ${index + 1} radiusKm`).toBe(true);
      expect(search.categories ?? []).not.toContain("");
      expect(search.cursor ?? undefined).not.toBe("");
    }
  });
});
