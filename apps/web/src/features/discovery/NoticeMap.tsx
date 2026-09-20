import type { NoticeWithDistance } from "@jiwar/contracts";
import { Map, Marker, NavigationControl, Popup } from "@vis.gl/react-maplibre";
import { useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../../i18n/index.js";
import { formatDateTime, formatDistance } from "../../lib/format.js";

export const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface NoticeMapProps {
  notices: NoticeWithDistance[];
  centre: { lat: number; lng: number };
  /**
   * True when the API had no upcoming notices and answered with past ones instead.
   *
   * The map must say so for the same reason the list does. Spec §6 gives the flag so
   * "the UI can label them honestly", and `/?view=map` is a shareable URL someone can
   * land on directly — without this they would see a marker for a funeral that
   * happened weeks ago with nothing marking it as past. The popup's date alone reads
   * as a detail, not a warning.
   */
  fallback: boolean;
  onSearchArea: (centre: { lat: number; lng: number }) => void;
}

export function NoticeMap({ notices, centre, fallback, onSearchArea }: NoticeMapProps) {
  const [movedCentre, setMovedCentre] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<NoticeWithDistance | null>(null);

  function handleMoveEnd(event: { target: { getCenter: () => { lat: number; lng: number } } }) {
    const next = event.target.getCenter();
    setMovedCentre({ lat: next.lat, lng: next.lng });
  }

  return (
    <>
      {/* Above the map rather than overlaid on it: the map fills its container, and
          an absolutely-positioned banner would sit on top of the tiles and compete
          with the "Search this area" button for the same spot. */}
      {fallback && <p role="status">{t("discovery.fallback")}</p>}

      <div style={{ position: "relative", blockSize: "70vh", minBlockSize: "20rem" }}>
        <Map
          initialViewState={{ latitude: centre.lat, longitude: centre.lng, zoom: 11 }}
          mapStyle={OPENFREEMAP_STYLE}
          style={{ inlineSize: "100%", blockSize: "100%" }}
          onMoveEnd={handleMoveEnd}
        >
          <NavigationControl position="top-right" />

          {notices.map((notice) => (
            <Marker
              key={notice.publicId}
              latitude={notice.lat}
              longitude={notice.lng}
              onClick={(event) => {
                event.originalEvent.stopPropagation();
                setSelected(notice);
              }}
            />
          ))}

          {selected && (
            <Popup
              latitude={selected.lat}
              longitude={selected.lng}
              onClose={() => setSelected(null)}
              closeOnClick={false}
            >
              <p className="muted" style={{ margin: 0 }}>
                {selected.category.name}
              </p>
              <strong>
                <Link to={`/n/${selected.publicId}`}>{selected.title}</Link>
              </strong>
              <p style={{ margin: "0.25rem 0" }}>{selected.venueName}</p>
              <p className="muted" style={{ margin: 0 }}>
                {formatDateTime(selected.startsAt)} · {formatDistance(selected.distanceMetres)}
              </p>
              {/* The same second signal the list card carries, so a past notice is
                  labelled whether the reader is looking at the list or the map. */}
              {selected.status === "cancelled" && <p role="status">{t("notice.cancelled")}</p>}
              {selected.status !== "cancelled" && selected.isPast && (
                <p className="muted">{t("notice.past")}</p>
              )}
            </Popup>
          )}
        </Map>

        {movedCentre && (
          <button
            type="button"
            className="primary"
            style={{
              position: "absolute",
              insetBlockStart: "0.75rem",
              insetInlineStart: "50%",
              transform: "translateX(-50%)",
            }}
            onClick={() => {
              onSearchArea(movedCentre);
              setMovedCentre(null);
            }}
          >
            {t("discovery.searchThisArea")}
          </button>
        )}
      </div>
    </>
  );
}
