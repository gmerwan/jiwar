import { zodResolver } from "@hookform/resolvers/zod";
import { CreateNoticeSchema, type CreateNotice } from "@jiwar/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api/client.js";
import { t } from "../../i18n/index.js";
import { StepDetails } from "./StepDetails.js";
import { StepReview } from "./StepReview.js";
import { StepWhat } from "./StepWhat.js";
import { StepWhere } from "./StepWhere.js";
import type { WizardValues } from "./form.js";

type Step = 0 | 1 | 2 | 3;

const STEP_FIELDS: Record<Step, (keyof WizardValues)[]> = {
  0: ["categorySlug", "title"],
  1: ["venueName", "address", "lat", "lng", "startsAt"],
  2: ["description", "attendance", "organizerName", "organizerContact", "organizerConsent"],
  3: [],
};

const STEP_LABELS = [
  "submit.step.what",
  "submit.step.where",
  "submit.step.details",
  "submit.step.review",
] as const;

/**
 * Drops the optional organizer fields when the publisher left them blank.
 *
 * Both are `.optional()` in `CreateNoticeSchema` but are registered as ordinary text
 * inputs, so an untouched box submits `""` rather than nothing. The API stored that
 * `""`, and the detail page — asking only whether the field was non-null — drew an
 * "Organizer" heading with nothing under it. Omitting the key keeps "no organizer
 * given" distinguishable from "an organizer was given" for every reader downstream.
 * Found by publishing a real notice, not by the unit tests, which all supplied values.
 */
function withoutBlankOptionals(values: CreateNotice): CreateNotice {
  const next = { ...values };
  if (!next.organizerName?.trim()) delete next.organizerName;
  if (!next.organizerContact?.trim()) delete next.organizerContact;
  return next;
}

export function SubmitWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  /**
   * Three type arguments, not one: `CreateNoticeSchema`'s input and output types
   * are genuinely different, and `useForm<CreateNotice>` (the output alone) does
   * not typecheck against the resolver.
   *
   * `description` and `organizerConsent` carry `.default()`, so they are optional
   * going in and guaranteed coming out; `lat`/`lng` are `z.coerce.number()`, whose
   * input is `unknown`. So the values the form *holds* are `z.input`, the values
   * `handleSubmit` hands the mutation are `z.output` — which is exactly what RHF's
   * `<TFieldValues, TContext, TTransformedValues>` describes. The brief's single
   * `useForm<CreateNotice>` produced six errors headed by
   * `Type 'Resolver<{... lat: unknown ...}>' is not assignable to
   * 'Resolver<{... lat: number ...}>'`. Doing it this way keeps
   * `CreateNoticeSchema` as the one source of the rules rather than casting the
   * resolver to silence it.
   */
  const form = useForm<WizardValues, unknown, CreateNotice>({
    resolver: zodResolver(CreateNoticeSchema),
    mode: "onTouched",
    defaultValues: {
      categorySlug: "",
      title: "",
      description: "",
      venueName: "",
      address: "",
      startsAt: "",
      attendance: "public",
      organizerConsent: false,
    },
  });

  const publish = useMutation({
    mutationFn: (values: CreateNotice) => api.createNotice(withoutBlankOptionals(values)),
    onSuccess: (result) => navigate(`/n/${result.publicId}?published=1`),
    /**
     * Only an `ApiError` carries a message worth showing: it is the server's own
     * words, already a single human sentence (Task 8 answers a bad category slug
     * with "Unknown category: x"). Everything else that can escape Task 10's
     * client is machine-facing — a raw `TypeError: Failed to fetch` when the
     * network is down, or a `ZodError` when the response drifts from the contract
     * — and neither means anything to a publisher, so both land on the generic
     * string. `SubmitWizard.test.tsx` pins that fallback so the narrowing stays a
     * decision rather than an accident.
     */
    onError: (error) =>
      setSubmitError(error instanceof ApiError ? error.message : t("error.generic")),
  });

  // `lat`/`lng` are `unknown` on the input side (z.coerce.number accepts anything),
  // so the type guard is what proves a real coordinate was chosen. Nothing but the
  // picker ever writes them, and it only ever writes numbers.
  const lat = form.watch("lat");
  const lng = form.watch("lng");
  const location =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
      ? { lat, lng }
      : null;

  async function next() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (valid && step < 3) setStep((step + 1) as Step);
  }

  return (
    <main className="page">
      <h1>{t("submit.title")}</h1>
      {/*
        Shown on every step, including the first, and never only after the fact.
        There is no moderation queue in M1: a successful POST is instantly visible
        to everyone within the radius, so the warning has to be in front of the
        publisher while they are still deciding what to type — not on a
        confirmation screen once it is already public.
      */}
      <p role="status">{t("submit.immediateNotice")}</p>

      <ol style={{ display: "flex", gap: "1rem", listStyle: "none", paddingInline: 0 }}>
        {STEP_LABELS.map((key, index) => (
          <li key={key} aria-current={index === step ? "step" : undefined}>
            <span className={index === step ? undefined : "muted"}>{t(key)}</span>
          </li>
        ))}
      </ol>

      <form
        onSubmit={form.handleSubmit((values) => {
          setSubmitError(null);
          publish.mutate(values);
        })}
      >
        {step === 0 && <StepWhat form={form} categories={categoriesQuery.data ?? []} />}
        {step === 1 && <StepWhere form={form} location={location} />}
        {step === 2 && <StepDetails form={form} />}
        {step === 3 && <StepReview form={form} submitError={submitError} />}

        <div style={{ display: "flex", gap: "0.5rem", marginBlockStart: "1rem" }}>
          {step > 0 && (
            <button type="button" onClick={() => setStep((step - 1) as Step)}>
              {t("submit.back")}
            </button>
          )}
          {step < 3 && (
            <button type="button" className="primary" onClick={() => void next()}>
              {t("submit.next")}
            </button>
          )}
          {step === 3 && (
            <button type="submit" className="primary" disabled={publish.isPending}>
              {publish.isPending ? t("submit.publishing") : t("submit.publish")}
            </button>
          )}
        </div>
      </form>

      <p>
        <Link to="/">{t("nav.back")}</Link>
      </p>
    </main>
  );
}
