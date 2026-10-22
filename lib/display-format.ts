export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  return count === 1 ? singular : plural;
}

export function formatDateTime(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${day} · ${time}`;
}

export function formatDate(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatRelativeTime(
  input: string | Date,
  now: Date = new Date()
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (absMs < minute) return "just now";
  if (absMs < hour) {
    return formatter.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return formatter.format(Math.round(diffMs / hour), "hour");
  }
  if (absMs < week) {
    return formatter.format(Math.round(diffMs / day), "day");
  }
  if (absMs < month) {
    return formatter.format(Math.round(diffMs / week), "week");
  }
  if (absMs < year) {
    return formatter.format(Math.round(diffMs / month), "month");
  }
  return formatter.format(Math.round(diffMs / year), "year");
}

export function formatFingerprint(value: string): string {
  const normalized = String(value).replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!normalized) return String(value);
  return normalized.match(/.{1,4}/g)?.join(" ") ?? normalized;
}

export function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}
