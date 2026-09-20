import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { FilterBar } from "../features/discovery/FilterBar.js";
import { NoticeList } from "../features/discovery/NoticeList.js";
import { NoticeMap } from "../features/discovery/NoticeMap.js";
import { useNotices } from "../features/discovery/useNotices.js";
import { AddressSearch } from "../features/location/AddressSearch.js";
import { useChosenLocation } from "../features/location/useChosenLocation.js";
import { t } from "../i18n/index.js";

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { location, status, radiusKm, setLocation, setRadiusKm, requestBrowserLocation } =
    useChosenLocation();

  const view = searchParams.get("view") === "map" ? "map" : "list";
  const when = searchParams.get("when") === "past" ? "past" : "upcoming";
  const sort = searchParams.get("sort") === "nearest" ? "nearest" : "soonest";
  const categories = searchParams.getAll("category");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const notices = useNotices({
    lat: location?.lat ?? 0,
    lng: location?.lng ?? 0,
    radiusKm,
    categories,
    when,
    sort,
    enabled: location !== null,
  });

  return (
    <main className="page">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ marginBlock: 0 }}>{t("discovery.title")}</h1>
        <Link to="/submit">{t("nav.submit")}</Link>
      </header>

      {!location && (
        <section>
          <p>{t("location.needed")}</p>
          <button type="button" className="primary" onClick={() => void requestBrowserLocation()}>
            {t("location.useMyLocation")}
          </button>
          {status === "denied" && <p role="status">{t("location.denied")}</p>}
          {status === "unavailable" && <p role="status">{t("location.unavailable")}</p>}
          <AddressSearch onPick={(result) => setLocation(result)} />
        </section>
      )}

      {location && (
        <>
          <AddressSearch onPick={(result) => setLocation(result)} />

          <FilterBar
            categories={categoriesQuery.data ?? []}
            selectedCategories={categories}
            onCategoriesChange={(next) => {
              const params = new URLSearchParams(searchParams);
              params.delete("category");
              for (const slug of next) params.append("category", slug);
              setSearchParams(params, { replace: true });
            }}
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
            when={when}
            onWhenChange={(next) => setParam("when", next)}
            sort={sort}
            onSortChange={(next) => setParam("sort", next)}
          />

          <div role="tablist" style={{ display: "flex", gap: "0.5rem", marginBlockEnd: "1rem" }}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => setParam("view", "list")}
            >
              {t("discovery.view.list")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "map"}
              onClick={() => setParam("view", "map")}
            >
              {t("discovery.view.map")}
            </button>
          </div>

          {view === "list" ? (
            <NoticeList
              notices={notices.notices}
              isLoading={notices.isLoading}
              isError={notices.isError}
              fallback={notices.fallback}
              radiusKm={radiusKm}
              hasMore={notices.hasMore}
              onLoadMore={notices.loadMore}
              onRetry={notices.retry}
            />
          ) : (
            <NoticeMap
              notices={notices.notices}
              centre={location}
              fallback={notices.fallback}
              onSearchArea={(centre) => setLocation(centre)}
            />
          )}
        </>
      )}
    </main>
  );
}
