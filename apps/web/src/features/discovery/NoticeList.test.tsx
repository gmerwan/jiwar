import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NoticeWithDistance } from "@jiwar/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeList } from "./NoticeList.js";

const notice: NoticeWithDistance = {
  publicId: "abc123",
  category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  title: "A funeral notice",
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

const baseProps = {
  notices: [] as NoticeWithDistance[],
  isLoading: false,
  isError: false,
  fallback: false,
  radiusKm: 20,
  hasMore: false,
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
};

const renderList = (overrides: Partial<typeof baseProps> = {}) =>
  render(
    <MemoryRouter>
      <NoticeList {...baseProps} {...overrides} />
    </MemoryRouter>,
  );

describe("NoticeList", () => {
  // Required because vitest.config.ts sets `globals: false`; see NoticeCard.test.tsx.
  // Note: the load-more case below deliberately renders twice WITHIN one test and
  // counts one button across both trees, so cleanup must stay between tests only.
  afterEach(cleanup);

  it("shows a loading state", () => {
    renderList({ isLoading: true });
    expect(screen.getByText(/loading notices/i)).toBeInTheDocument();
  });

  it("shows an error state with a retry action", () => {
    renderList({ isError: true });
    expect(screen.getByText(/could not load notices/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows an empty state naming the radius", () => {
    renderList();
    expect(screen.getByText(/no upcoming notices within 20 km/i)).toBeInTheDocument();
  });

  it("explains when results are a past-notice fallback", () => {
    renderList({ notices: [notice], fallback: true });
    expect(screen.getByText(/showing the most recent past notices/i)).toBeInTheDocument();
  });

  it("renders the notices when there are some", () => {
    renderList({ notices: [notice] });
    expect(screen.getByText("A funeral notice")).toBeInTheDocument();
  });

  it("shows a load-more button only when there are more pages", () => {
    renderList({ notices: [notice], hasMore: true });
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();

    renderList({ notices: [notice], hasMore: false });
    expect(screen.queryAllByRole("button", { name: /load more/i })).toHaveLength(1);
  });

  // A load-more that fails leaves TanStack Query's loaded pages in place and sets
  // isError, so "notices on screen + isError" is what a failed page 2 looks like.
  const secondNotice: NoticeWithDistance = {
    ...notice,
    publicId: "def456",
    title: "A wedding notice",
  };

  // Both values of hasMore. A failed load-more cannot give hasMore: false: TanStack
  // keeps `data` through an error, so hasNextPage stays true. The false case is a
  // background refetch (e.g. on window focus) failing after every page has loaded.
  // Without it, `isError && !hasMore` for the full-page error (wiping the cards) and an
  // inline alert gated on `hasMore` (dropping the error, no retry) each passed 9/9.
  for (const hasMore of [true, false]) {
    it(`keeps already-loaded notices on screen when loading more fails (hasMore: ${hasMore})`, () => {
      renderList({ notices: [notice, secondNotice], isError: true, hasMore });

      // The cards the reader was looking at are still there.
      expect(screen.getByText("A funeral notice")).toBeInTheDocument();
      expect(screen.getByText("A wedding notice")).toBeInTheDocument();

      // And the failure is reported inline rather than replacing them.
      expect(screen.getByRole("alert")).toHaveTextContent(/could not load more/i);
      expect(screen.queryByText(/could not load notices/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    }, 5_000);
  }

  it("keeps keyboard focus on the load-more button through a failure and the recovery", () => {
    // Swapping "Load more" for a different "Try again" element removes the focused
    // node, and focus falls back to <body>: a keyboard user who pressed Enter is sent
    // to the top of the page. One button whose label changes keeps their place.
    const props = { notices: [notice, secondNotice], hasMore: true };
    const { rerender } = renderList({ ...props, isError: false });

    const loadMore = screen.getByRole("button", { name: /load more/i });
    loadMore.focus();
    expect(loadMore).toHaveFocus();

    // The load-more request fails.
    rerender(
      <MemoryRouter>
        <NoticeList {...baseProps} {...props} isError={true} />
      </MemoryRouter>,
    );
    const tryAgain = screen.getByRole("button", { name: /try again/i });
    expect(tryAgain).toHaveFocus();
    expect(tryAgain).toBe(loadMore);

    // The retry succeeds: page 2's card arrives, a further page is offered, and focus
    // is still on the same control.
    const thirdNotice = { ...notice, publicId: "ghi789", title: "An aqiqah notice" };
    rerender(
      <MemoryRouter>
        <NoticeList {...baseProps} {...props} notices={[notice, secondNotice, thirdNotice]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("An aqiqah notice")).toBeInTheDocument();
    const loadMoreAgain = screen.getByRole("button", { name: /load more/i });
    expect(loadMoreAgain).toHaveFocus();
    expect(document.activeElement).toBe(loadMore);
  }, 5_000);

  it("retries a failed load-more by fetching the next page, not by refetching", async () => {
    // onRetry is `refetch()`, which re-downloads the pages already loaded and never
    // asks for the one that failed; only onLoadMore (`fetchNextPage`) requests it.
    const onLoadMore = vi.fn();
    const onRetry = vi.fn();
    renderList({
      notices: [notice, secondNotice],
      isError: true,
      hasMore: true,
      onLoadMore,
      onRetry,
    });

    // The load-more button is relabelled "Try again", not replaced: one action, not two.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  }, 5_000);

  it("shows the full-page error only when nothing has loaded yet, and retries it with a refetch", async () => {
    const onLoadMore = vi.fn();
    const onRetry = vi.fn();
    renderList({ notices: [], isError: true, onLoadMore, onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load notices/i);
    expect(screen.queryByText(/could not load more/i)).not.toBeInTheDocument();

    // With no pages loaded there is no next page to fetch; a refetch is the recovery.
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onLoadMore).not.toHaveBeenCalled();
  }, 5_000);
});
