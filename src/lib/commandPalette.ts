/**
 * Ranking used by the ⌘K command palette. Kept free of React so the matching
 * rules can be unit tested on their own.
 */

export interface CommandEntry {
  id: string;
  label: string;
  group?: string;
  /** Extra terms the user might type that do not appear in the label. */
  keywords?: string;
}

export type CommandScore = "exact" | "prefix" | "word" | "substring" | "none";

function scoreOne(haystack: string, needle: string): CommandScore {
  if (haystack === needle) {
    return "exact";
  }
  if (haystack.startsWith(needle)) {
    return "prefix";
  }
  if (haystack.split(/\s+/).some((word) => word.startsWith(needle))) {
    return "word";
  }
  return haystack.includes(needle) ? "substring" : "none";
}

const RANK: Record<CommandScore, number> = {
  none: 4,
  substring: 3,
  word: 2,
  prefix: 1,
  exact: 0,
};

export function scoreCommand(entry: CommandEntry, rawQuery: string): CommandScore {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") {
    return "prefix";
  }
  const label = entry.label.toLowerCase();
  const fromLabel = scoreOne(label, query);
  const fromGroup = entry.group === undefined ? "none" : scoreOne(entry.group.toLowerCase(), query);
  const fromKeywords =
    entry.keywords === undefined
      ? "none"
      : entry.keywords
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(query))
        ? "word"
        : "none";

  return RANK[fromLabel] <= RANK[fromGroup] && RANK[fromLabel] <= RANK[fromKeywords]
    ? fromLabel
    : RANK[fromGroup] <= RANK[fromKeywords]
      ? fromGroup
      : fromKeywords;
}

/** Returns the matching entries, best match first and stable within a tier. */
export function filterCommands<T extends CommandEntry>(entries: readonly T[], rawQuery: string): T[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") {
    return [...entries];
  }
  const scored: { entry: T; rank: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const score = scoreCommand(entry, query);
    if (score !== "none") {
      scored.push({ entry, rank: RANK[score], index });
    }
  });
  scored.sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank));
  return scored.map((item) => item.entry);
}

/** Moves the highlight by `delta`, clamping to the ends of the list. */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(current + delta, 0), length - 1);
}
