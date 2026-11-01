/** Pure helpers behind the Activity and Events pages. */

export interface JournalEntryLike {
  t: number;
  kind: string;
  severity: string;
  category: string;
  source?: string;
  title: string;
  detail?: string;
  ok: boolean;
}

export interface JournalDayGroup<T extends { t: number }> {
  key: string;
  label: string;
  items: T[];
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Groups newest-first entries into 今天 / 昨天 / YYYY-MM-DD buckets. */
export function groupJournalByDay<T extends { t: number }>(
  entries: readonly T[],
  now: number = Date.now(),
): JournalDayGroup<T>[] {
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups: JournalDayGroup<T>[] = [];
  const index = new Map<string, JournalDayGroup<T>>();

  for (const entry of entries) {
    const at = entry.t * 1000;
    const dayStart = startOfDay(at);
    let key: string;
    let label: string;
    if (dayStart >= today) {
      key = "today";
      label = "今天";
    } else if (dayStart >= yesterday) {
      key = "yesterday";
      label = "昨天";
    } else {
      key = String(dayStart);
      label = new Date(dayStart).toLocaleDateString();
    }
    let group = index.get(key);
    if (!group) {
      group = { key, label, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(entry);
  }
  return groups;
}

/** Events page membership: health/system events or anything not OK. */
export function isEventEntry(entry: JournalEntryLike): boolean {
  return entry.category === "event" || entry.severity === "warn" || entry.severity === "error" || !entry.ok;
}

export function severityRank(severity: string): number {
  switch (severity) {
    case "error":
      return 2;
    case "warn":
      return 1;
    default:
      return 0;
  }
}

export function filterBySeverity<T extends { severity: string }>(
  entries: readonly T[],
  severity: "" | "warn" | "error",
): T[] {
  if (severity === "") {
    return [...entries];
  }
  return entries.filter((entry) => entry.severity === severity);
}
