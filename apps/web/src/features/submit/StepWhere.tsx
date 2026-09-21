import { t } from "../../i18n/index.js";
import { FieldError } from "./FieldError.js";
import { LocationPicker } from "./LocationPicker.js";
import type { WizardForm } from "./form.js";

interface StepWhereProps {
  form: WizardForm;
  location: { lat: number; lng: number } | null;
}

export function StepWhere({ form, location }: StepWhereProps) {
  const errors = form.formState.errors;

  return (
    <fieldset>
      <label htmlFor="venueName">{t("field.venueName")}</label>
      <input id="venueName" {...form.register("venueName")} style={{ inlineSize: "100%" }} />
      <FieldError field="venueName" error={errors.venueName} fallback={t("error.required")} />

      <label htmlFor="address">{t("field.address")}</label>
      <input id="address" {...form.register("address")} style={{ inlineSize: "100%" }} />
      <FieldError field="address" error={errors.address} fallback={t("error.required")} />

      <LocationPicker
        value={location}
        onChange={(next) => {
          form.setValue("lat", next.lat, { shouldValidate: true });
          form.setValue("lng", next.lng, { shouldValidate: true });
        }}
      />
      <FieldError
        field="lat"
        error={errors.lat ?? errors.lng}
        fallback={t("error.required")}
      />

      <label htmlFor="startsAt">{t("field.startsAt")}</label>
      <input
        id="startsAt"
        type="datetime-local"
        onChange={(event) => {
          /**
           * The raw value is checked before `toISOString()` rather than after.
           * `new Date("")` is an Invalid Date and `.toISOString()` on it throws
           * `RangeError: Invalid time value`, so a user who clears the field — or
           * whose browser reports a partial value mid-edit — would have crashed
           * the handler. Writing "" instead lets the resolver report a missing
           * date through the normal field error.
           */
          const parsed = new Date(event.target.value);
          const iso = Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
          form.setValue("startsAt", iso, { shouldValidate: true });
        }}
      />
      <FieldError field="startsAt" error={errors.startsAt} fallback={t("error.required")} />
    </fieldset>
  );
}
