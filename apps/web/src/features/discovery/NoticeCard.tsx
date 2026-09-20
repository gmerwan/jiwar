import type { NoticeWithDistance } from "@jiwar/contracts";
import { Link } from "react-router-dom";
import { t } from "../../i18n/index.js";
import { formatDateTime, formatDistance } from "../../lib/format.js";

export function NoticeCard({ notice }: { notice: NoticeWithDistance }) {
  return (
    <article className="card">
      <p className="muted" style={{ margin: 0 }}>
        {notice.category.name}
      </p>
      <h2 style={{ margin: "0.25rem 0", fontSize: "1.1rem" }}>
        <Link to={`/n/${notice.publicId}`}>{notice.title}</Link>
      </h2>
      <p style={{ margin: "0.25rem 0" }}>{notice.venueName}</p>
      <p className="muted" style={{ margin: "0.25rem 0" }}>
        <time dateTime={notice.startsAt}>{formatDateTime(notice.startsAt)}</time>
        {" · "}
        <span>{formatDistance(notice.distanceMetres)}</span>
      </p>
      {notice.status === "cancelled" && <p role="status">{t("notice.cancelled")}</p>}
      {notice.status !== "cancelled" && notice.isPast && (
        <p className="muted">{t("notice.past")}</p>
      )}
    </article>
  );
}
