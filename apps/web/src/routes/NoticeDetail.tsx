import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import { t } from "../i18n/index.js";
import { formatDateTime } from "../lib/format.js";

export function NoticeDetail() {
  const { publicId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const noticeQuery = useQuery({
    queryKey: ["notice", publicId],
    queryFn: () => api.getNotice(publicId),
    retry: false,
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelNotice(publicId),
    onSuccess: () => {
      setCancelError(null);
      // The refetch is what makes the page reflect the cancellation: the button
      // disappears and the cancelled banner appears because `status` came back
      // changed, not because local state was optimistically flipped.
      void queryClient.invalidateQueries({ queryKey: ["notice", publicId] });
    },
    /**
     * Without this branch a refused cancel was silent — the click did nothing
     * visible and the button stayed put, which reads as a broken button.
     *
     * 403 is the interesting case and it is not rare: Task 6 answers 403 both for
     * "this is not your notice" and for "you already cancelled it", and a publisher
     * hits the first one simply by opening their own notice in a different browser,
     * on their phone, or after clearing cookies — the authorship lives in a signed
     * cookie, not an account. So 403 gets a message that explains that, rather than
     * the server's "Only the author can cancel this notice", which invites the
     * reply "but I *am* the author".
     */
    onError: (error) => {
      const forbidden = error instanceof ApiError && error.status === 403;
      setCancelError(forbidden ? t("notice.cancelForbidden") : t("error.generic"));
    },
  });

  if (noticeQuery.isPending) {
    return (
      <main className="page">
        <p role="status">{t("discovery.loading")}</p>
      </main>
    );
  }

  if (noticeQuery.isError) {
    const notFound = noticeQuery.error instanceof ApiError && noticeQuery.error.status === 404;
    return (
      <main className="page">
        <p role="alert">{notFound ? t("notice.notFound") : t("discovery.error")}</p>
        <Link to="/">{t("nav.back")}</Link>
      </main>
    );
  }

  const notice = noticeQuery.data;
  const directionsUrl = `https://www.openstreetmap.org/directions?to=${notice.lat},${notice.lng}`;
  /**
   * Either half is enough to be worth showing, and a blank string counts as absent.
   *
   * Gating on the name alone dropped a contact number entered without one -- and the
   * wizard permits exactly that, since its consent rule is about the contact details,
   * not the name. The blank check is the other half: notices published before the
   * wizard stopped sending `""` for untouched optional fields come back with
   * `organizerName: ""`, which a `!== null` test accepts, and the page then drew an
   * "Organizer" heading with nothing under it. Trimming also covers whitespace.
   */
  const organizerName = notice.organizerName?.trim() ?? "";
  const organizerContact = notice.organizerContact?.trim() ?? "";
  const hasOrganizer = organizerName !== "" || organizerContact !== "";

  return (
    <main className="page">
      {searchParams.get("published") === "1" && <p role="status">{t("submit.published")}</p>}

      <p className="muted">{notice.category.name}</p>
      <h1>{notice.title}</h1>

      {notice.status === "cancelled" && <p role="status">{t("notice.cancelled")}</p>}
      {notice.status !== "cancelled" && notice.isPast && <p className="muted">{t("notice.past")}</p>}

      <dl>
        <dt>{t("notice.venue")}</dt>
        <dd>
          {notice.venueName}
          <br />
          <span className="muted">{notice.address}</span>
        </dd>

        <dt>{t("field.startsAt")}</dt>
        <dd>
          <time dateTime={notice.startsAt}>{formatDateTime(notice.startsAt)}</time>
        </dd>

        <dt>{t("field.attendance")}</dt>
        <dd>
          {notice.attendance === "public"
            ? t("notice.attendance.public")
            : notice.attendance === "invitation_only"
              ? t("notice.attendance.invitation_only")
              : t("notice.attendance.restricted")}
        </dd>

        {hasOrganizer && (
          <>
            <dt>{t("notice.organizer")}</dt>
            <dd>
              {organizerName}
              {organizerName && organizerContact && <br />}
              {organizerContact}
            </dd>
          </>
        )}
      </dl>

      {notice.description && <p style={{ whiteSpace: "pre-wrap" }}>{notice.description}</p>}

      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <a href={directionsUrl} target="_blank" rel="noreferrer noopener">
          {t("notice.directions")}
        </a>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(window.location.href);
            setCopied(true);
          }}
        >
          {copied ? t("notice.shared") : t("notice.share")}
        </button>
      </p>

      {notice.status === "published" && (
        <p>
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm(t("notice.cancelConfirm"))) cancel.mutate();
            }}
          >
            {t("notice.cancel")}
          </button>
        </p>
      )}
      {cancelError && <p role="alert">{cancelError}</p>}

      <p>
        <Link to="/">{t("nav.back")}</Link>
      </p>
    </main>
  );
}
