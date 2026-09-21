import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitWizard } from "./SubmitWizard.js";

vi.mock("../../api/client.js", () => ({
  api: {
    categories: vi.fn().mockResolvedValue([
      { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
      { slug: "wedding", name: "Wedding", icon: "wedding", sortOrder: 20 },
    ]),
    createNotice: vi.fn().mockResolvedValue({ publicId: "new123" }),
    geocode: vi.fn().mockResolvedValue([]),
    reverseGeocode: vi.fn().mockResolvedValue(null),
  },
  /**
   * Faithful to the real `ApiError`'s `(status, message)` signature rather than a
   * bare `extends Error`, so the error-branch cases below can construct one whose
   * `message` actually lands where the component reads it.
   */
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

// The map is not rendered in jsdom; the picker exposes numeric inputs as its accessible fallback.
vi.mock("./LocationPicker.js", () => ({
  LocationPicker: ({
    onChange,
  }: {
    value: { lat: number; lng: number } | null;
    onChange: (v: { lat: number; lng: number }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ lat: 36.75, lng: 3.06 })}>
      set-test-location
    </button>
  ),
}));

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitWizard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Chooses the "Funeral" category, waiting for the option to exist first.
 *
 * `findByLabelText(/category/i)` resolves on the very first paint — the label is
 * static — while the `<option>` list is filled from the categories query one tick
 * later. Selecting straight after the label therefore raced the query and failed
 * with `Value "funeral" not found in options`, the select still holding only its
 * placeholder. Awaiting the option is what makes the wait actually about the data.
 */
async function pickFunerals(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "Funeral" });
  await user.selectOptions(screen.getByLabelText(/category/i), "funeral");
}

/** Fills every required field and lands on the review step, ready to publish. */
async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await pickFunerals(user);
  await user.type(screen.getByLabelText(/title/i), "Funeral prayer for the late Ahmed Benali");
  await user.click(screen.getByRole("button", { name: /continue/i }));

  await user.type(await screen.findByLabelText(/venue name/i), "Masjid Al-Rahma");
  await user.type(screen.getByLabelText(/address/i), "Rue Didouche Mourad, Algiers");
  await user.click(screen.getByRole("button", { name: /set-test-location/i }));
  await user.type(screen.getByLabelText(/date and time/i), "2026-12-01T12:30");
  await user.click(screen.getByRole("button", { name: /continue/i }));

  await user.selectOptions(await screen.findByLabelText(/who may attend/i), "public");
  await user.click(screen.getByRole("button", { name: /continue/i }));

  return screen.findByRole("button", { name: /publish now/i });
}

describe("SubmitWizard", () => {
  // `vitest.config.ts` sets `globals: false`, so Testing Library's automatic
  // cleanup never registers itself. Without this, mounted trees pile up across
  // cases and every `getBy*` throws "Found multiple elements".
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns that publication is immediate", async () => {
    renderWizard();
    expect(await screen.findByText(/appears publicly straight away/i)).toBeInTheDocument();
  });

  it("blocks continuing from step one until category and title are valid", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/submit.step.what|What/i)).toBeInTheDocument();
    // Still on step 1 because the title is empty.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });

  it("walks through all four steps and publishes", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../api/client.js");
    renderWizard();

    await pickFunerals(user);
    await user.type(screen.getByLabelText(/title/i), "Funeral prayer for the late Ahmed Benali");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/venue name/i), "Masjid Al-Rahma");
    await user.type(screen.getByLabelText(/address/i), "Rue Didouche Mourad, Algiers");
    await user.click(screen.getByRole("button", { name: /set-test-location/i }));
    await user.type(screen.getByLabelText(/date and time/i), "2026-12-01T12:30");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.selectOptions(await screen.findByLabelText(/who may attend/i), "public");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.click(await screen.findByRole("button", { name: /publish now/i }));

    await waitFor(() => expect(api.createNotice).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createNotice).mock.calls[0]![0];
    expect(body.title).toBe("Funeral prayer for the late Ahmed Benali");
    expect(body.lat).toBeCloseTo(36.75, 4);
  });

  /**
   * Untouched optional fields must be omitted, not sent as empty strings.
   *
   * `organizerName`/`organizerContact` are `.optional()` in the schema but are
   * registered as ordinary text inputs, so an untouched one submits `""`. The API
   * then stores `""`, and the detail page received a present-but-empty organizer
   * and rendered a heading with nothing under it (seen in the real walkthrough).
   * Sending `undefined` keeps "the publisher gave no organizer" distinguishable
   * from "the publisher gave one" all the way down to the column.
   */
  it("omits untouched optional fields instead of posting empty strings", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../api/client.js");
    renderWizard();

    await user.click(await walkToReview(user));
    await waitFor(() => expect(api.createNotice).toHaveBeenCalledTimes(1));

    const body = vi.mocked(api.createNotice).mock.calls[0]![0];
    expect(body.organizerName).toBeUndefined();
    expect(body.organizerContact).toBeUndefined();
  });

  it("requires the consent checkbox before accepting organizer contact details", async () => {
    const user = userEvent.setup();
    renderWizard();

    await pickFunerals(user);
    await user.type(screen.getByLabelText(/title/i), "A valid title here");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.type(await screen.findByLabelText(/venue name/i), "Venue");
    await user.type(screen.getByLabelText(/address/i), "Address");
    await user.click(screen.getByRole("button", { name: /set-test-location/i }));
    await user.type(screen.getByLabelText(/date and time/i), "2026-12-01T12:30");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await user.selectOptions(await screen.findByLabelText(/who may attend/i), "public");
    await user.type(screen.getByLabelText(/organizer contact/i), "+213 555 0000");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/permission to publish/i)).toBeInTheDocument();
  });

  it("shows no posting count or contribution score", async () => {
    const { container } = renderWizard();
    await screen.findByRole("option", { name: "Funeral" });
    expect(container.textContent).not.toMatch(/\b(points?|rank|score|streak|contribution)\b/i);
  });

  /**
   * Client-side validation has to carry per-field feedback on its own. Task 8's API
   * answers a failed schema parse with `message` as a `string[]`, which the client
   * comma-joins into one opaque string — the field each complaint belongs to is
   * unrecoverable by the time it reaches here. So a user who mistypes must be told
   * *which* field from the resolver, before anything is POSTed.
   */
  it("names the offending field rather than posting an invalid notice", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../api/client.js");
    renderWizard();

    await pickFunerals(user);
    await user.type(screen.getByLabelText(/title/i), "ab"); // min is 3
    await user.click(screen.getByRole("button", { name: /continue/i }));

    const titleError = await screen.findByTestId("error-title");
    expect(titleError).toBeInTheDocument();
    expect(titleError.textContent).not.toBe("");
    // The complaint is attached to the title field, not to the category one.
    expect(screen.queryByTestId("error-categorySlug")).not.toBeInTheDocument();
    // Still on step 1, and nothing was sent.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(api.createNotice).not.toHaveBeenCalled();
  });

  it("surfaces the API's own message when publishing fails with an ApiError", async () => {
    const user = userEvent.setup();
    const { api, ApiError } = await import("../../api/client.js");
    vi.mocked(api.createNotice).mockRejectedValueOnce(
      new ApiError(400, "Unknown category: funerall"),
    );
    renderWizard();

    await user.click(await walkToReview(user));

    expect(await screen.findByText(/unknown category: funerall/i)).toBeInTheDocument();
  });

  /**
   * Pins the deliberate narrowing at the mutation's `onError`. Task 10's client
   * throws a raw `TypeError` when `fetch` itself rejects (offline, DNS failure,
   * CORS) and a raw `ZodError` on contract drift — neither is an `ApiError`, so
   * both land on the generic string. That is the intended behaviour, not an
   * oversight: see the task report for why a dedicated "you appear to be offline"
   * branch was considered and rejected.
   */
  it("falls back to the generic message for a non-ApiError throwable", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../api/client.js");
    vi.mocked(api.createNotice).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWizard();

    await user.click(await walkToReview(user));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });
});
