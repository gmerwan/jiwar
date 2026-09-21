import { Map, Marker, NavigationControl } from "@vis.gl/react-maplibre";
import { useEffect, useState } from "react";
import { AddressSearch } from "../location/AddressSearch.js";
import { OPENFREEMAP_STYLE } from "../discovery/NoticeMap.js";
import { t } from "../../i18n/index.js";

interface LocationPickerProps {
  value: { lat: number; lng: number } | null;
  onChange: (next: { lat: number; lng: number }) => void;
}

const ALGIERS_FALLBACK = { lat: 36.7538, lng: 3.0588 };

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const centre = value ?? ALGIERS_FALLBACK;

  /**
   * The two boxes keep their own text, rather than being driven straight off
   * `value`, so that a half-typed or cleared coordinate never reaches the form.
   *
   * `Number("")` is `0`, and `CreateNoticeSchema`'s `z.coerce.number()` accepts
   * that happily: clearing the latitude box and pressing Continue would have
   * published the notice at 0°N — the Gulf of Guinea — with no validation error,
   * because 0 is a perfectly legal latitude. Holding the raw string here lets an
   * empty box stay empty and simply not propagate.
   */
  const [latText, setLatText] = useState(value ? String(value.lat) : "");
  const [lngText, setLngText] = useState(value ? String(value.lng) : "");

  // Coordinates chosen on the map or through address search have to appear in the
  // boxes too, but without clobbering digits the user is part-way through typing:
  // the numeric comparison means a value this component itself just propagated is
  // recognised as already shown.
  useEffect(() => {
    if (value === null) return;
    setLatText((current) => (Number(current) === value.lat ? current : String(value.lat)));
    setLngText((current) => (Number(current) === value.lng ? current : String(value.lng)));
  }, [value?.lat, value?.lng, value]);

  function commit(nextLat: string, nextLng: string) {
    if (nextLat.trim() === "" || nextLng.trim() === "") return;
    const lat = Number(nextLat);
    const lng = Number(nextLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    onChange({ lat, lng });
  }

  return (
    <div>
      <p className="muted">{t("field.locationHint")}</p>
      <AddressSearch onPick={(result) => onChange({ lat: result.lat, lng: result.lng })} />

      <div style={{ blockSize: "20rem", marginBlock: "0.5rem" }}>
        <Map
          initialViewState={{ latitude: centre.lat, longitude: centre.lng, zoom: 13 }}
          mapStyle={OPENFREEMAP_STYLE}
          style={{ inlineSize: "100%", blockSize: "100%" }}
          onClick={(event) => onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng })}
        >
          <NavigationControl position="top-right" />
          {value && (
            <Marker
              latitude={value.lat}
              longitude={value.lng}
              draggable
              onDragEnd={(event) => onChange({ lat: event.lngLat.lat, lng: event.lngLat.lng })}
            />
          )}
        </Map>
      </div>

      {/* Accessible, keyboard-only fallback for setting coordinates without the map. */}
      <fieldset>
        <legend className="muted">{t("field.location")}</legend>
        <label>
          Latitude{" "}
          <input
            type="number"
            step="0.000001"
            value={latText}
            onChange={(event) => {
              setLatText(event.target.value);
              commit(event.target.value, lngText);
            }}
          />
        </label>{" "}
        <label>
          Longitude{" "}
          <input
            type="number"
            step="0.000001"
            value={lngText}
            onChange={(event) => {
              setLngText(event.target.value);
              commit(latText, event.target.value);
            }}
          />
        </label>
      </fieldset>
    </div>
  );
}
