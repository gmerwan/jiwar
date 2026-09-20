import type { GeocodeResult } from "@jiwar/contracts";
import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { t } from "../../i18n/index.js";

interface AddressSearchProps {
  onPick: (result: GeocodeResult) => void;
}

export function AddressSearch({ onPick }: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const found = await api.geocode(trimmed);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <label htmlFor="address-search">{t("location.chooseArea")}</label>
      <input
        id="address-search"
        type="search"
        value={query}
        placeholder={t("location.searchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
        style={{ inlineSize: "100%" }}
      />
      {searching && <p className="muted">{t("location.searching")}</p>}
      {!searching && query.trim().length >= 3 && results.length === 0 && (
        <p className="muted">{t("location.noResults")}</p>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: "none", paddingInline: 0 }}>
          {results.map((result) => (
            <li key={`${result.lat},${result.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(result);
                  setQuery("");
                  setResults([]);
                }}
                style={{ inlineSize: "100%", textAlign: "start" }}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
