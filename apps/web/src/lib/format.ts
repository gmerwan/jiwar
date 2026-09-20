const LOCALE = "en";

export function formatDistance(metres: number): string {
  if (metres < 1_000) {
    return `${Math.round(metres)} m`;
  }
  const km = metres / 1_000;
  const digits = km < 10 ? 1 : 0;
  const formatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${formatter.format(km)} km`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatRelativeTime(iso: string): string {
  const target = new Date(iso).getTime();
  const diffMs = target - Date.now();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");

  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");

  return formatter.format(Math.round(diffMs / 86_400_000), "day");
}
