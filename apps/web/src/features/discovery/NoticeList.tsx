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

  // The full-page error is only right when there is nothing to lose. TanStack Query
  // keeps loaded pages through a failed fetchNextPage, so notices here means a page
  // loaded, and a failed load-more must not take the reader's cards away.
  if (isError && notices.length === 0) {
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
      {/* A failed load-more takes the button's place, so there is one action here.
          Its retry is onLoadMore (fetchNextPage), not onRetry: refetch() re-downloads
          the pages already loaded and never asks for the one that failed. */}
      {isError ? (
        <div role="alert">
          <p>{t("discovery.loadMoreError")}</p>
          <button type="button" onClick={onLoadMore}>
            {t("discovery.retry")}
          </button>
        </div>
      ) : (
        hasMore && (
          <button type="button" onClick={onLoadMore}>
            {t("discovery.loadMore")}
          </button>
        )
      )}
    </div>
  );
}
