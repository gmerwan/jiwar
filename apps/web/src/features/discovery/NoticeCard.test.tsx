import { cleanup, render, screen } from "@testing-library/react";
import type { NoticeWithDistance } from "@jiwar/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { NoticeCard } from "./NoticeCard.js";

const notice: NoticeWithDistance = {
  publicId: "abc123",
  category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
  title: "Funeral prayer for the late Ahmed Benali",
  description: "Prayer after Dhuhr.",
  venueName: "Masjid Al-Rahma",
  address: "Rue Didouche Mourad, Algiers",
  lat: 36.75,
  lng: 3.06,
  startsAt: "2026-10-01T12:30:00.000Z",
  attendance: "public",
  organizerName: null,
  organizerContact: null,
  status: "published",
  isPast: false,
  createdAt: "2026-09-15T10:00:00.000Z",
  distanceMetres: 2_400,
};

function renderCard(overrides: Partial<NoticeWithDistance> = {}) {
  return render(
    <MemoryRouter>
      <NoticeCard notice={{ ...notice, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("NoticeCard", () => {
  // vitest.config.ts sets `globals: false`, so @testing-library/react never
  // registers its automatic afterEach cleanup. Without this the previous test's
  // DOM stays mounted and `getByText` throws "found multiple elements".
  afterEach(cleanup);

  it("shows the title, category, venue and formatted distance", () => {
    renderCard();
    expect(screen.getByText(notice.title)).toBeInTheDocument();
    expect(screen.getByText("Funeral")).toBeInTheDocument();
    expect(screen.getByText("Masjid Al-Rahma")).toBeInTheDocument();
    expect(screen.getByText("2.4 km")).toBeInTheDocument();
  });

  it("links to the notice detail page", () => {
    renderCard();
    expect(screen.getByRole("link", { name: /Ahmed Benali/ })).toHaveAttribute(
      "href",
      "/n/abc123",
    );
  });

  it("marks a past notice", () => {
    renderCard({ isPast: true });
    expect(screen.getByText(/already taken place/i)).toBeInTheDocument();
  });

  it("marks a cancelled notice", () => {
    renderCard({ status: "cancelled" });
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });

  it("shows no submission count or author ranking anywhere", () => {
    const { container } = renderCard();
    // Spec §8 anti-gamification: nothing may count or rank contributions.
    expect(container.textContent).not.toMatch(/\b(points?|rank|score|streak|contribution)\b/i);
  });
});
