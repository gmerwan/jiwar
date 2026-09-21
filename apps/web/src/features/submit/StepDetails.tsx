import { t } from "../../i18n/index.js";
import { FieldError } from "./FieldError.js";
import type { WizardForm } from "./form.js";

export function StepDetails({ form }: { form: WizardForm }) {
  const errors = form.formState.errors;

  return (
    <fieldset>
      <label htmlFor="description">{t("field.description")}</label>
      <textarea
        id="description"
        rows={5}
        {...form.register("description")}
        style={{ inlineSize: "100%" }}
      />
      <FieldError field="description" error={errors.description} fallback={t("error.required")} />

      <label htmlFor="attendance">{t("field.attendance")}</label>
      <select id="attendance" {...form.register("attendance")}>
        <option value="public">{t("notice.attendance.public")}</option>
        <option value="invitation_only">{t("notice.attendance.invitation_only")}</option>
        <option value="restricted">{t("notice.attendance.restricted")}</option>
      </select>

      <label htmlFor="organizerName">{t("field.organizerName")}</label>
      <input id="organizerName" {...form.register("organizerName")} style={{ inlineSize: "100%" }} />
      <FieldError field="organizerName" error={errors.organizerName} fallback={t("error.required")} />

      <label htmlFor="organizerContact">{t("field.organizerContact")}</label>
      <input
        id="organizerContact"
        {...form.register("organizerContact")}
        style={{ inlineSize: "100%" }}
      />
      <FieldError
        field="organizerContact"
        error={errors.organizerContact}
        fallback={t("error.required")}
      />

      <label>
        <input type="checkbox" {...form.register("organizerConsent")} />{" "}
        {t("field.organizerConsent")}
      </label>
      <FieldError
        field="organizerConsent"
        error={errors.organizerConsent}
        fallback={t("error.required")}
      />
    </fieldset>
  );
}
