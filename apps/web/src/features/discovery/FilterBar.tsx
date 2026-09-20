import type { Category } from "@jiwar/contracts";
import { t } from "../../i18n/index.js";

interface FilterBarProps {
  categories: Category[];
  selectedCategories: string[];
  onCategoriesChange: (next: string[]) => void;
  radiusKm: number;
  onRadiusChange: (next: number) => void;
  when: "upcoming" | "past";
  onWhenChange: (next: "upcoming" | "past") => void;
  sort: "soonest" | "nearest";
  onSortChange: (next: "soonest" | "nearest") => void;
}

const RADIUS_OPTIONS = [5, 10, 20, 50, 100];

export function FilterBar({
  categories,
  selectedCategories,
  onCategoriesChange,
  radiusKm,
  onRadiusChange,
  when,
  onWhenChange,
  sort,
  onSortChange,
}: FilterBarProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBlockEnd: "1rem" }}>
      <label>
        <span className="muted">{t("field.category")}</span>{" "}
        <select
          value={selectedCategories[0] ?? ""}
          onChange={(event) =>
            onCategoriesChange(event.target.value === "" ? [] : [event.target.value])
          }
        >
          <option value="">{t("discovery.filter.allCategories")}</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.radius", { radius: radiusKm })}</span>{" "}
        <select value={radiusKm} onChange={(event) => onRadiusChange(Number(event.target.value))}>
          {RADIUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} km
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.when.upcoming")}</span>{" "}
        <select
          value={when}
          onChange={(event) => onWhenChange(event.target.value as "upcoming" | "past")}
        >
          <option value="upcoming">{t("discovery.when.upcoming")}</option>
          <option value="past">{t("discovery.when.past")}</option>
        </select>
      </label>

      <label>
        <span className="muted">{t("discovery.sort.soonest")}</span>{" "}
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as "soonest" | "nearest")}
        >
          <option value="soonest">{t("discovery.sort.soonest")}</option>
          <option value="nearest">{t("discovery.sort.nearest")}</option>
        </select>
      </label>
    </div>
  );
}
