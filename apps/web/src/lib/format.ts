// Small display formatters shared by every page. Keep them pure and total —
// a formatter must never throw on API data.

/** "70cc8ff2…" — long hashes and ids are always shortened for display. */
export function shortHash(hash: string, chars = 8): string {
  if (hash.length <= chars) return hash;
  return hash.slice(0, chars);
}

/** Truncate a long identifier for table cells; full value stays copyable. */
export function truncateMiddle(value: string, max = 22): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** "1.2 s", "340 ms" — run durations. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unit: string = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

/** "2.4 m" for movement distances; null-safe for the diff tables. */
export function formatDistance(metres: number | null): string {
  if (metres === null) return "—";
  if (metres < 0.001) return "<1 mm";
  if (metres < 1) return `${(metres * 1000).toFixed(0)} mm`;
  return `${metres.toFixed(2)} m`;
}

export function formatCount(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}
