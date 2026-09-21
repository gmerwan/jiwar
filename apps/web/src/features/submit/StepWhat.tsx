import type { Category } from "@jiwar/contracts";
import { t } from "../../i18n/index.js";
import { FieldError } from "./FieldError.js";
import type { WizardForm } from "./form.js";

interface StepWhatProps {
  form: WizardForm;
  categories: Category[];
}

export function StepWhat({ form, categories }: StepWhatProps) {
  const errors = form.formState.errors;

  return (
    <fieldset>
      <label htmlFor="categorySlug">{t("field.category")}</label>
      <select id="categorySlug" {...form.register("categorySlug")}>
        <option value="">—</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.name}
          </option>
        ))}
      </select>
      <FieldError field="categorySlug" error={errors.categorySlug} fallback={t("error.required")} />

      <label htmlFor="title">{t("field.title")}</label>
      <input id="title" {...form.register("title")} style={{ inlineSize: "100%" }} />
      <p className="muted">{t("field.titleHint")}</p>
      <FieldError field="title" error={errors.title} fallback={t("error.required")} />
    </fieldset>
  );
}
