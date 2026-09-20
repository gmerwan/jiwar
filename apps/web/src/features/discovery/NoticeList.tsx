import type { NoticeWithDistance } from "@jiwar/contracts";
import { t } from "../../i18n/index.js";
import { NoticeCard } from "./NoticeCard.js";

interface NoticeListProps {
  notices: NoticeWithDistance[];
  isLoading: boolean;
  isError: boolean;
  fallback: boolean;
  radiusKm: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function NoticeList({
  notices,
  isLoading,
  isError,
  fallback,
  radiusKm,
  hasMore,
  onLoadMore,
  onRetry,
}: NoticeListProps) {
  if (isLoading) {
    return <p role="status">{t("discovery.loading")}</p>;
  }

  if (isError) {
    return (
      <div role="alert">
        <p>{t("discovery.error")}</p>
        <button type="button" onClick={onRetry}>
          {t("discovery.retry")}
        </button>
      </div>
    );
  }

  if (notices.length === 0) {
    return <p>{t("discovery.empty", { radius: radiusKm })}</p>;
  }

  return (
    <div>
      {fallback && <p role="status">{t("discovery.fallback")}</p>}
      {notices.map((notice) => (
        <NoticeCard key={notice.publicId} notice={notice} />
      ))}
      {hasMore && (
        <button type="button" onClick={onLoadMore}>
          {t("discovery.loadMore")}
        </button>
      )}
    </div>
  );
}
