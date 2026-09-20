import { cleanup, render, screen } from "@testing-library/react";
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
});
