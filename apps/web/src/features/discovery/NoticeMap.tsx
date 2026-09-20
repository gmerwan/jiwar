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
  onSearchArea: (centre: { lat: number; lng: number }) => void;
}

export function NoticeMap({ notices, centre, onSearchArea }: NoticeMapProps) {
  const [movedCentre, setMovedCentre] = useState<{ lat: number; lng: number } | null>(null);
  const [selected, setSelected] = useState<NoticeWithDistance | null>(null);

  function handleMoveEnd(event: { target: { getCenter: () => { lat: number; lng: number } } }) {
    const next = event.target.getCenter();
    setMovedCentre({ lat: next.lat, lng: next.lng });
  }

  return (
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
  );
}
