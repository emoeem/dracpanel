/**
 * In-memory rule hit accounting.
 *
 * The daemon reports, per connection, which rule matched it. There is no
 * persistent counter, so this derives the numbers by diffing consecutive
 * connection snapshots: a row id seen for the first time counts as a hit, and
 * a row that disappears or gains a `closedAt` settles its traffic.
 *
 * Nothing here is persisted — the counters live as long as the tab does.
 */

export const UNKNOWN_RULE = "(unknown)";

export interface RuleHitStats {
  rule: string;
  /** Connections that matched this rule since the page loaded. */
  hits: number;
  /** Connections matching this rule right now. */
  active: number;
  /** Traffic settled from connections that have since closed. */
  bytesUp: bigint;
  bytesDown: bigint;
  /** Traffic of the still-open connections. */
  liveBytesUp: bigint;
  liveBytesDown: bigint;
  /** Epoch millis of the most recent observation. */
  lastSeen: number;
}

interface ConnectionSample {
  rule: string;
  uplinkTotal: bigint;
  downlinkTotal: bigint;
  closed: boolean;
}

/** The slice of a connection row the accumulator needs. */
export interface HitRow {
  rule: string;
  uplinkTotal: bigint;
  downlinkTotal: bigint;
  closedAt: number | null;
}

function emptyStats(rule: string): RuleHitStats {
  return {
    rule,
    hits: 0,
    active: 0,
    bytesUp: 0n,
    bytesDown: 0n,
    liveBytesUp: 0n,
    liveBytesDown: 0n,
    lastSeen: 0,
  };
}

export interface ParsedRuleKey {
  section: "route" | "dns";
  index: number;
}

const RULE_SECTION = /\b(route|dns)\b/;
const RULE_INDEX = /(\d+)/g;

/**
 * Maps the daemon's `rule` string back onto a rule position in the config.
 *
 * The wire format is not documented and has changed between builds
 * (`route.rules[3]`, `route/rules/3`, …), so this picks the section name and
 * the last number out of the string and returns `null` when either is missing —
 * a descriptive rule string such as `domain_suffix:example.com` simply does not
 * map, and callers fall back to showing the raw label.
 */
export function parseRuleKey(key: string): ParsedRuleKey | null {
  const section = RULE_SECTION.exec(key)?.[1];
  if (section === undefined) {
    return null;
  }
  let index: number | null = null;
  for (const match of key.matchAll(RULE_INDEX)) {
    index = Number(match[1]);
  }
  if (index === null) {
    return null;
  }
  return { section: section as ParsedRuleKey["section"], index };
}

/** Settled traffic plus whatever the still-open connections have moved. */
export function totalHitBytes(stats: RuleHitStats): bigint {
  return stats.bytesUp + stats.bytesDown + stats.liveBytesUp + stats.liveBytesDown;
}

export class RuleHitAccumulator {
  private previous = new Map<string, ConnectionSample>();
  private stats = new Map<string, RuleHitStats>();
  private started = false;

  /** Feeds the next connection snapshot; returns true when anything changed. */
  ingest(rows: Iterable<readonly [string, HitRow]>, now: number): boolean {
    const next = new Map<string, ConnectionSample>();
    let changed = this.started === false;

    // Live counters are rebuilt from the snapshot on every ingest, so rules that
    // lost their last open connection must fall back to zero right away.
    for (const stats of this.stats.values()) {
      stats.liveBytesUp = 0n;
      stats.liveBytesDown = 0n;
    }

    for (const [id, row] of rows) {
      const rule = row.rule.trim() === "" ? UNKNOWN_RULE : row.rule.trim();
      const closed = row.closedAt !== null;
      next.set(id, {
        rule,
        uplinkTotal: row.uplinkTotal,
        downlinkTotal: row.downlinkTotal,
        closed,
      });
      if (closed) {
        continue;
      }
      const stats = this.bucket(rule, now);
      stats.liveBytesUp += row.uplinkTotal;
      stats.liveBytesDown += row.downlinkTotal;
      if (!this.previous.has(id)) {
        stats.hits += 1;
        stats.active += 1;
        changed = true;
      }
    }

    // Rows that vanished from the snapshot were pruned, i.e. they closed.
    for (const [id, sample] of this.previous) {
      if (next.has(id) || sample.closed) {
        continue;
      }
      const stats = this.bucket(sample.rule, now);
      stats.active = Math.max(stats.active - 1, 0);
      stats.bytesUp += sample.uplinkTotal;
      stats.bytesDown += sample.downlinkTotal;
      changed = true;
    }

    this.previous = next;
    this.started = true;
    return changed;
  }

  private bucket(rule: string, now: number): RuleHitStats {
    const existing = this.stats.get(rule);
    if (existing !== undefined) {
      existing.lastSeen = now;
      return existing;
    }
    const created = emptyStats(rule);
    created.lastSeen = now;
    this.stats.set(rule, created);
    return created;
  }

  /** Current numbers, busiest rule first. */
  snapshot(): RuleHitStats[] {
    return [...this.stats.values()].sort(
      (left, right) => right.hits - left.hits || right.active - left.active || left.rule.localeCompare(right.rule),
    );
  }

  /** Looks up one rule's counters; missing rules read as all-zero. */
  get(rule: string): RuleHitStats {
    return this.stats.get(rule) ?? emptyStats(rule);
  }

  get totalHits(): number {
    let total = 0;
    for (const stats of this.stats.values()) {
      total += stats.hits;
    }
    return total;
  }

  reset() {
    this.previous.clear();
    this.stats.clear();
    this.started = false;
  }
}
