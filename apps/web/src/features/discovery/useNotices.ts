import { useInfiniteQuery } from "@tanstack/react-query";
import { api, type SearchParams } from "../../api/client.js";

export interface UseNoticesParams {
  lat: number;
  lng: number;
  radiusKm: number;
  categories: string[];
  when: "upcoming" | "past";
  sort: "soonest" | "nearest";
  enabled: boolean;
}

export function useNotices(params: UseNoticesParams) {
  const query = useInfiniteQuery({
    queryKey: [
      "notices",
      params.lat,
      params.lng,
      params.radiusKm,
      params.categories.join(","),
      params.when,
      params.sort,
    ],
    enabled: params.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search: SearchParams = {
        lat: params.lat,
        lng: params.lng,
        radiusKm: params.radiusKm,
        when: params.when,
        sort: params.sort,
        cursor: pageParam,
      };
      if (params.categories.length > 0) search.categories = params.categories;
      return api.searchNotices(search);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const pages = query.data?.pages ?? [];

  return {
    notices: pages.flatMap((page) => page.items),
    // The fallback flag comes from the first page; later pages continue the same query.
    fallback: pages[0]?.fallback ?? false,
    isLoading: query.isPending && params.enabled,
    isError: query.isError,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  };
}
