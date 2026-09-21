import { t } from "../../i18n/index.js";
import { formatDateTime } from "../../lib/format.js";
import type { WizardForm } from "./form.js";

interface StepReviewProps {
  form: WizardForm;
  submitError: string | null;
}

export function StepReview({ form, submitError }: StepReviewProps) {
  const startsAt = form.watch("startsAt");

  return (
    <fieldset>
      <h2>{t("submit.step.review")}</h2>
      <dl>
        <dt>{t("field.category")}</dt>
        <dd>{form.watch("categorySlug")}</dd>
        <dt>{t("field.title")}</dt>
        <dd>{form.watch("title")}</dd>
        <dt>{t("field.venueName")}</dt>
        <dd>{form.watch("venueName")}</dd>
        <dt>{t("field.address")}</dt>
        <dd>{form.watch("address")}</dd>
        <dt>{t("field.startsAt")}</dt>
        {/*
          Formatted rather than the raw ISO string the form holds. The value stored
          is UTC, so a user in Algiers (UTC+1) who typed 12:30 would read
          "2026-12-01T11:30:00.000Z" back on the one screen whose entire job is
          "make sure the details are correct" — and reasonably conclude the wizard
          had lost an hour. `formatDateTime` renders it in their own locale and zone.
        */}
        <dd>
          {startsAt ? <time dateTime={startsAt}>{formatDateTime(startsAt)}</time> : "—"}
        </dd>
      </dl>
      {submitError && <p role="alert">{submitError}</p>}
    </fieldset>
  );
}
