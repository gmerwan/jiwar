import type { NoticeWithDistance } from "@jiwar/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeMap, OPENFREEMAP_STYLE } from "./NoticeMap.js";

/**
 * jsdom has no WebGL, so MapLibre GL cannot initialise a real map: mounting `<Map>`
 * for real throws before any of this component's own logic runs. The whole module
 * is replaced with plain DOM stand-ins that record the props the component passed
 * and expose the one gesture under test.
 *
 * What is still genuinely covered: which notices become markers, the tile style,
 * the initial centre, and the pan -> "Search this area" -> onSearchArea path. What
 * is NOT covered here, and cannot be in jsdom, is that MapLibre actually paints
 * tiles or fires `moveend` itself; the real `onMoveEnd` contract is exercised by
 * hand in the browser (see the task report) and by Task 14's e2e test.
 *
 * `panButton` stands in for the user dragging the map: it invokes `onMoveEnd` with
 * the same `{ target: { getCenter() } }` shape MapLibre's own event carries, so the
 * component's handler is the real one.
 */
const PANNED_CENTRE = { lat: 36.8, lng: 3.2 };

interface MapProps {
  children?: ReactNode;
  mapStyle?: string;
  initialViewState?: { latitude: number; longitude: number; zoom: number };
  onMoveEnd?: (event: { target: { getCenter: () => { lat: number; lng: number } } }) => void;
}

vi.mock("@vis.gl/react-maplibre", () => ({
  Map: ({ children, mapStyle, initialViewState, onMoveEnd }: MapProps) => (
    <div
      data-testid="map"
      data-map-style={mapStyle}
      data-centre={`${initialViewState?.latitude},${initialViewState?.longitude}`}
      data-zoom={String(initialViewState?.zoom)}
    >
      <button
        type="button"
        data-testid="pan"
        onClick={() => onMoveEnd?.({ target: { getCenter: () => PANNED_CENTRE } })}
      >
        pan
      </button>
      {children}
    </div>
  ),
  Marker: ({
    latitude,
    longitude,
    onClick,
  }: {
    latitude: number;
    longitude: number;
    onClick?: (event: { originalEvent: { stopPropagation: () => void } }) => void;
  }) => (
    <button
      type="button"
      data-testid="marker"
      data-lat={String(latitude)}
      data-lng={String(longitude)}
      onClick={() => onClick?.({ originalEvent: { stopPropagation: () => {} } })}
    >
      marker
    </button>
  ),
  NavigationControl: () => <div data-testid="navigation-control" />,
  Popup: ({ children, latitude, longitude, onClose }: {
    children?: ReactNode;
    latitude: number;
    longitude: number;
    onClose?: () => void;
  }) => (
    <div data-testid="popup" data-lat={String(latitude)} data-lng={String(longitude)}>
      <button type="button" data-testid="popup-close" onClick={() => onClose?.()}>
        close
      </button>
      {children}
    </div>
  ),
}));

function notice(overrides: Partial<NoticeWithDistance> & { publicId: string }): NoticeWithDistance {
  return {
    category: { slug: "funeral", name: "Funeral", icon: "funeral", sortOrder: 10 },
    title: `Notice ${overrides.publicId}`,
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
    ...overrides,
  };
}

const centre = { lat: 36.75, lng: 3.06 };

function renderMap(
  notices: NoticeWithDistance[],
  { onSearchArea = vi.fn(), fallback = false }: { onSearchArea?: () => void; fallback?: boolean } = {},
) {
  const view = render(
    <MemoryRouter>
      <NoticeMap
        notices={notices}
        centre={centre}
        fallback={fallback}
        onSearchArea={onSearchArea}
      />
    </MemoryRouter>,
  );
  return { ...view, onSearchArea };
}

describe("NoticeMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("renders one marker per notice, at each notice's own coordinates", () => {
    renderMap([
      notice({ publicId: "a", lat: 36.75, lng: 3.06 }),
      notice({ publicId: "b", lat: 36.8, lng: 3.1 }),
      notice({ publicId: "c", lat: 36.7, lng: 2.9 }),
    ]);

    const markers = screen.getAllByTestId("marker");
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => [m.dataset.lat, m.dataset.lng])).toEqual([
      ["36.75", "3.06"],
      ["36.8", "3.1"],
      ["36.7", "2.9"],
    ]);
  });

  it("renders no markers when there are no notices, and still shows the map", () => {
    renderMap([]);
    expect(screen.queryAllByTestId("marker")).toHaveLength(0);
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("centres on the chosen location and uses the OpenFreeMap style", () => {
    renderMap([notice({ publicId: "a" })]);
    const map = screen.getByTestId("map");
    expect(map.dataset.centre).toBe("36.75,3.06");
    expect(map.dataset.mapStyle).toBe(OPENFREEMAP_STYLE);
    expect(OPENFREEMAP_STYLE).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("does not offer 'Search this area' before the map has moved", () => {
    renderMap([notice({ publicId: "a" })]);
    expect(screen.queryByRole("button", { name: /search this area/i })).not.toBeInTheDocument();
  });

  it("panning shows 'Search this area' but does NOT refetch on its own", async () => {
    // Spec §6 / PLAN.md §3: "A 'Search this area' action after moving the map" --
    // the gesture must not trigger a search by itself, or a single drag across the
    // city fires a request per frame.
    const user = userEvent.setup();
    const { onSearchArea } = renderMap([notice({ publicId: "a" })]);

    await user.click(screen.getByTestId("pan"));
    await user.click(screen.getByTestId("pan"));
    await user.click(screen.getByTestId("pan"));

    expect(onSearchArea).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /search this area/i })).toBeInTheDocument();
  });

  it("'Search this area' calls onSearchArea with the panned centre, then hides itself", async () => {
    const user = userEvent.setup();
    const { onSearchArea } = renderMap([notice({ publicId: "a" })]);

    await user.click(screen.getByTestId("pan"));
    await user.click(screen.getByRole("button", { name: /search this area/i }));

    expect(onSearchArea).toHaveBeenCalledTimes(1);
    // The map's own centre after the gesture, not the centre prop it started with.
    expect(onSearchArea).toHaveBeenCalledWith(PANNED_CENTRE);
    expect(screen.queryByRole("button", { name: /search this area/i })).not.toBeInTheDocument();
  });

  it("clicking a marker opens that notice's preview, linking to its detail page", async () => {
    const user = userEvent.setup();
    renderMap([
      notice({ publicId: "a", title: "Funeral of Ahmed", lat: 36.75, lng: 3.06 }),
      notice({ publicId: "b", title: "Wedding of Yasmine", lat: 36.8, lng: 3.1 }),
    ]);

    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();

    await user.click(screen.getAllByTestId("marker")[1]!);

    const popup = screen.getByTestId("popup");
    expect(popup.dataset.lat).toBe("36.8");
    expect(screen.getByText("Wedding of Yasmine")).toBeInTheDocument();
    expect(screen.queryByText("Funeral of Ahmed")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wedding of Yasmine" })).toHaveAttribute(
      "href",
      "/n/b",
    );

    await user.click(screen.getByTestId("popup-close"));
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
  });

  it("explains when the markers are a past-notice fallback", () => {
    // Spec §6 gives the `fallback` flag so the UI "can label them honestly". The list
    // said so; the map said nothing, and /?view=map is a shareable URL someone can
    // land on directly -- so a funeral from weeks ago appeared as an unlabelled pin.
    renderMap([notice({ publicId: "a", isPast: true })], { fallback: true });
    expect(screen.getByText(/showing the most recent past notices/i)).toBeInTheDocument();
  });

  it("says nothing about a fallback when the results are upcoming", () => {
    renderMap([notice({ publicId: "a" })], { fallback: false });
    expect(screen.queryByText(/showing the most recent past notices/i)).not.toBeInTheDocument();
  });

  it("marks a past notice in its popup, as the list card does", async () => {
    const user = userEvent.setup();
    renderMap([notice({ publicId: "a", title: "Funeral held last week", isPast: true })], {
      fallback: true,
    });

    // Not shown before the marker is clicked: this is the popup's own signal.
    expect(screen.queryByText(/already taken place/i)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("marker"));

    expect(screen.getByText("Funeral held last week")).toBeInTheDocument();
    expect(screen.getByText(/already taken place/i)).toBeInTheDocument();
  });

  it("marks a cancelled notice in its popup, and does not also call it past", async () => {
    const user = userEvent.setup();
    renderMap([notice({ publicId: "a", status: "cancelled", isPast: true })]);

    await user.click(screen.getByTestId("marker"));

    expect(screen.getByText(/has been cancelled/i)).toBeInTheDocument();
    // Cancelled takes precedence, matching NoticeCard: one status, not two.
    expect(screen.queryByText(/already taken place/i)).not.toBeInTheDocument();
  });

  it("does not mark an upcoming notice as past", async () => {
    const user = userEvent.setup();
    renderMap([notice({ publicId: "a", isPast: false })]);

    await user.click(screen.getByTestId("marker"));

    expect(screen.queryByText(/already taken place/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been cancelled/i)).not.toBeInTheDocument();
  });
});
