import type { CreateNotice, CreateNoticeSchema } from "@jiwar/contracts";
import type { UseFormReturn } from "react-hook-form";
import type { z } from "zod";

/**
 * The values the wizard's form actually holds, which are the schema's *input*
 * type rather than its output.
 *
 * `CreateNoticeSchema` transforms: `description` and `organizerConsent` have
 * defaults (optional in, guaranteed out) and `lat`/`lng` are `z.coerce.number()`
 * (`unknown` in, `number` out). A form is populated before it is valid, so it is
 * the input side it holds; the output side is what `handleSubmit` finally hands
 * to `api.createNotice`.
 */
export type WizardValues = z.input<typeof CreateNoticeSchema>;

/** The form instance every step component receives. */
export type WizardForm = UseFormReturn<WizardValues, unknown, CreateNotice>;
