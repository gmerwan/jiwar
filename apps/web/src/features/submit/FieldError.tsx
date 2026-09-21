interface FieldErrorProps {
  /** The form field this complaint belongs to; becomes `data-testid="error-<field>"`. */
  field: string;
  /**
   * A structural shape rather than RHF's `FieldError`, because the two are not
   * interchangeable here. `lat`/`lng` are `unknown` on the form's input side (see
   * `form.ts`), so RHF types their errors as `Merge<FieldError, FieldErrorsImpl<{}>>`,
   * which is not assignable to `FieldError` — its `type` is optional. All this
   * component ever reads is `message`, so that is all it asks for.
   */
  error: { message?: string | undefined } | undefined;
  /** Used when the resolver gave no message of its own. */
  fallback: string;
}

/**
 * One field's validation message, tied to that field by `data-testid`.
 *
 * Every complaint has to be attributable to a single field *here*, on the client,
 * because the server cannot help: Task 8's API answers a failed schema parse with
 * `message` as a `string[]`, and Task 10's client comma-joins it into one opaque
 * sentence — by the time a server-side field error reaches the browser, which
 * field it was about is unrecoverable. So `zodResolver` is the only thing that can
 * tell a user *which* box to fix, and this component is where it says so.
 */
export function FieldError({ field, error, fallback }: FieldErrorProps) {
  if (!error) return null;
  return (
    <p role="alert" data-testid={`error-${field}`}>
      {error.message ?? fallback}
    </p>
  );
}
