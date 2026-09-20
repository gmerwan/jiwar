import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client.js";

const notice = {
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
  distanceMetres: 1200,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("parses a search response through the contract schema", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [notice], nextCursor: null, fallback: false }),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    const result = await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 });
    expect(result.items[0]!.title).toBe("A funeral notice");
    expect(result.fallback).toBe(false);
  });

  it("throws when the response does not match the contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ nope: true }], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 })).rejects.toThrow();
  });

  it("sends credentials so the participant cookie travels", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
  });

  it("serialises multiple categories as repeated query parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null, fallback: false }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await api.searchNotices({ lat: 36.75, lng: 3.06, radiusKm: 20, categories: ["funeral", "wedding"] });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("categories=funeral");
    expect(url).toContain("categories=wedding");
  });

  it("throws ApiError carrying the HTTP status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Notice not found" }, 404));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.getNotice("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });

  it("surfaces a validation message from a 400", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "title too short" }, 400));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(
      api.createNotice({
        categorySlug: "funeral",
        title: "ab",
        description: "",
        venueName: "v",
        address: "a",
        lat: 36.75,
        lng: 3.06,
        startsAt: "2026-10-01T12:30:00.000Z",
        attendance: "public",
        organizerConsent: false,
      }),
    ).rejects.toThrow(/title too short/);
  });

  // --- Gap 1: api.geocode / api.reverseGeocode go through GeocodeResultsSchema
  // in production but the brief's six tests above never call either. This is the
  // client half of the geocode gap Task 9 closed on the server; close it here too.

  it("parses a geocode response through GeocodeResultsSchema", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ label: "Algiers, Algeria", lat: 36.75, lng: 3.06 }] }),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    const results = await api.geocode("Algiers");
    expect(results).toEqual([{ label: "Algiers, Algeria", lat: 36.75, lng: 3.06 }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/geocode?q=Algiers");
    expect(init.credentials).toBe("include");
  });

  it("throws when a geocode response drifts from the contract", async () => {
    // Counterfactual for the test above: break `lat` (string instead of number,
    // and reusing a key the real API would never send). If this assertion did
    // not fail, the geocode test above would not be exercising the parse path.
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ label: "Algiers, Algeria", lat: "36.75", lng: 3.06 }] }),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.geocode("Algiers")).rejects.toThrow();
  });

  it("parses a reverse-geocode response through the reverse schema", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ result: { label: "Algiers, Algeria", lat: 36.75, lng: 3.06 } }),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    const result = await api.reverseGeocode(36.75, 3.06);
    expect(result).toEqual({ label: "Algiers, Algeria", lat: 36.75, lng: 3.06 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/reverse-geocode?lat=36.75&lng=3.06");
    expect(init.credentials).toBe("include");
  });

  it("returns null from reverseGeocode when nothing is nearby", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: null }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.reverseGeocode(0, 0)).resolves.toBeNull();
  });

  it("throws when a reverse-geocode response drifts from the contract", async () => {
    // Counterfactual: drop `result` entirely so the envelope no longer matches
    // ReverseSchema. Confirms api.reverseGeocode would fail loudly on drift
    // rather than silently returning undefined/null-ish data.
    fetchMock.mockResolvedValue(jsonResponse({ notResult: null }));
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    await expect(api.reverseGeocode(0, 0)).rejects.toThrow();
  });

  // --- Gap 2: Task 8's API returns `message` as a string[] for a failed
  // schema parse (Nest's default from StandardSchemaValidationPipe / a
  // BadRequestException given an array of issue strings), not just a plain
  // string. The brief's ApiError does `String(body.message)`, which
  // Array.prototype.toString()-joins the array with ", ". Pin that behaviour
  // here so Task 13 starts from a documented fact instead of discovering it.

  it("pins how ApiError renders a string[] validation message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: ["title: must be at least 3 characters", "lat: is required and must be a number"], error: "Bad Request", statusCode: 400 }, 400),
    );
    const api = createApiClient(fetchMock as unknown as typeof fetch);

    let caught: unknown;
    try {
      await api.getNotice("missing");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(400);
    // String(["a", "b"]) === "a,b" — Array.prototype.toString has no space
    // after the comma. This is comma-joined, not comma-space-joined, and it
    // is unstructured: per-field information (which field, which rule) is
    // flattened into prose that Task 13 cannot easily split back apart.
    expect(apiError.message).toBe(
      "title: must be at least 3 characters,lat: is required and must be a number",
    );
  });
});
