import type { Notice } from "@jiwar/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeDetail } from "./NoticeDetail.js";

vi.mock("../api/client.js", () => ({
  api: {
    getNotice: vi.fn(),
    cancelNotice: vi.fn(),
  },
  // Mirrors the real client's `(status, message)` signature: the component
  // branches on `error.status`, so a bare `extends Error` would make every
  // error look like an unknown failure and the 404/403 cases would pass for
  // the wrong reason.
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const notice: Notice = {
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
  organizerName: "Yacine Benali",
  organizerContact: "+213 555 0000",
  status: "published",
  isPast: false,
  createdAt: "2026-09-15T10:00:00.000Z",
};

function renderDetail(path = "/n/abc123") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/n/:publicId" element={<NoticeDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NoticeDetail", () => {
  // `globals: false` in vitest.config.ts means Testing Library's auto-cleanup is
  // never registered; without this, trees accumulate and `getBy*` throws
  // "Found multiple elements".
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  it("renders the notice", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue(notice);
    renderDetail();

    expect(await screen.findByRole("heading", { name: notice.title })).toBeInTheDocument();
    expect(screen.getByText("Masjid Al-Rahma")).toBeInTheDocument();
    expect(screen.getByText("Rue Didouche Mourad, Algiers")).toBeInTheDocument();
    expect(screen.getByText("Funeral")).toBeInTheDocument();
    expect(screen.getByText("Open to everyone")).toBeInTheDocument();
    // Name and contact share one <dd> separated by a <br>, so no single element's
    // text is either one alone; the whole value is asserted instead.
    const organizer = screen.getByText("Organizer").nextElementSibling;
    expect(organizer?.textContent).toBe("Yacine Benali+213 555 0000");
    expect(screen.getByText("Prayer after Dhuhr.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get directions/i })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/directions?to=36.75,3.06",
    );
  });

  /**
   * `organizerName` and `organizerContact` come back present-but-`null` from the
   * API, never omitted — the contract types them `z.string().nullable()`. Rendering
   * `{notice.organizerName}` unguarded is harmless in React (null renders as
   * nothing), but an "Organizer" heading over an empty value is not: it looks like
   * the page failed to load a detail that was never there.
   */
  it("omits the organizer block entirely when both fields are null", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue({
      ...notice,
      organizerName: null,
      organizerContact: null,
    });
    renderDetail();

    await screen.findByRole("heading", { name: notice.title });
    expect(screen.queryByText("Organizer")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null/i);
  });

  /**
   * Blank strings have to count as absent too, not just `null`.
   *
   * Found in the real browser walkthrough: the wizard registers the two optional
   * organizer inputs as ordinary text fields, so leaving them untouched POSTs `""`
   * rather than omitting them, and the API stores and returns `""`. A `!== null`
   * check passes for `""`, which put an "Organizer" heading on the page with
   * nothing under it — the same empty labelled block the null case exists to
   * prevent. The wizard no longer sends `""`, but rows created before that fix
   * still hold it, so the page must not depend on the wizard being correct.
   */
  it("omits the organizer block for blank strings, not just nulls", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue({
      ...notice,
      organizerName: "",
      organizerContact: "   ",
    });
    renderDetail();

    await screen.findByRole("heading", { name: notice.title });
    expect(screen.queryByText("Organizer")).not.toBeInTheDocument();
  });

  it("shows a contact given without a name", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue({
      ...notice,
      organizerName: null,
      organizerContact: "+213 555 0000",
    });
    renderDetail();

    await screen.findByRole("heading", { name: notice.title });
    expect(screen.getByText("Organizer")).toBeInTheDocument();
    expect(screen.getByText("+213 555 0000")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null/i);
  });

  /**
   * Spec §6/§10: a cancelled notice stays reachable at its own URL so that someone
   * who was sent the link before the cancellation finds out about it, instead of a
   * "not found" that reads as a broken link. The page must say so, and must not
   * offer to cancel it again — Task 6 answers a second cancel with 403.
   */
  it("keeps a cancelled notice reachable and marks it cancelled", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue({ ...notice, status: "cancelled" });
    renderDetail();

    expect(await screen.findByRole("heading", { name: notice.title })).toBeInTheDocument();
    expect(screen.getByText(/this notice has been cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel this notice/i })).not.toBeInTheDocument();
  });

  it("labels a past notice", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue({ ...notice, isPast: true });
    renderDetail();

    expect(await screen.findByText(/already taken place/i)).toBeInTheDocument();
  });

  it("reports an unknown publicId as not found", async () => {
    const { api, ApiError } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockRejectedValue(new ApiError(404, "Notice not found"));
    renderDetail("/n/missing1");

    expect(await screen.findByText(/does not exist or has been removed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to nearby notices/i })).toBeInTheDocument();
  });

  it("distinguishes a server failure from a missing notice", async () => {
    const { api, ApiError } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockRejectedValue(new ApiError(500, "boom"));
    renderDetail();

    expect(await screen.findByText(/could not load notices/i)).toBeInTheDocument();
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
  });

  it("shows the published banner only when arriving from the wizard", async () => {
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue(notice);
    renderDetail("/n/abc123?published=1");

    expect(await screen.findByText(/your notice is now public/i)).toBeInTheDocument();

    cleanup();
    renderDetail("/n/abc123");
    await screen.findByRole("heading", { name: notice.title });
    expect(screen.queryByText(/your notice is now public/i)).not.toBeInTheDocument();
  });

  it("cancels for the author and reflects it on the page", async () => {
    const user = userEvent.setup();
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice)
      .mockResolvedValueOnce(notice)
      .mockResolvedValue({ ...notice, status: "cancelled" });
    vi.mocked(api.cancelNotice).mockResolvedValue({ cancelled: true });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /cancel this notice/i }));

    await waitFor(() => expect(api.cancelNotice).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/this notice has been cancelled/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /cancel this notice/i })).not.toBeInTheDocument(),
    );
  });

  it("does not cancel when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const { api } = await import("../api/client.js");
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    vi.mocked(api.getNotice).mockResolvedValue(notice);
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /cancel this notice/i }));

    expect(api.cancelNotice).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /cancel this notice/i })).toBeInTheDocument();
  });

  /**
   * Task 6 returns 403 for a stranger, a forged cookie, and a second cancel alike.
   * A publisher reaches this simply by opening their own notice in another browser,
   * so the page has to explain *why* rather than leave the click looking broken.
   */
  it("explains a refused cancel instead of failing silently", async () => {
    const user = userEvent.setup();
    const { api, ApiError } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue(notice);
    vi.mocked(api.cancelNotice).mockRejectedValue(
      new ApiError(403, "Only the author can cancel this notice"),
    );
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /cancel this notice/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/only the browser that published this notice/i);
    // The notice is untouched, so it must still read as published.
    expect(screen.queryByText(/this notice has been cancelled/i)).not.toBeInTheDocument();
  });

  it("falls back to the generic message when cancel fails for another reason", async () => {
    const user = userEvent.setup();
    const { api } = await import("../api/client.js");
    vi.mocked(api.getNotice).mockResolvedValue(notice);
    vi.mocked(api.cancelNotice).mockRejectedValue(new TypeError("Failed to fetch"));
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /cancel this notice/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);
    expect(alert.textContent).not.toMatch(/failed to fetch/i);
  });
});
