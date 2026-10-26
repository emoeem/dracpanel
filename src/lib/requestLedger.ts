import type { ConnectionRow } from "../api/daemon";
import { connectionChain, connectionHost } from "./connectionTools";

/**
 * The sing-box API has no historical request log; FlClash builds its Requests
 * page from core events. The web panel's equivalent source is the connections
 * stream, so a "request" here is one connection, derived live. The ledger is
 * UI state only — never persisted, and clearly labelled in the view.
 */

export interface RequestLedgerEntry {
  id: string;
  /** Connection start time in epoch ms. */
  at: number;
  host: string;
  network: string;
  rule: string;
  chain: string;
  inbound: string;
  uploadTotal: number;
  downloadTotal: number;
  closed: boolean;
  /** Duration in ms; open connections measure up to `now`. */
  durationMs: number;
}

export type RequestLedgerFilter = "all" | "active" | "closed";

const DEFAULT_LEDGER_LIMIT = 400;

export function buildRequestLedger(
  rows: Iterable<ConnectionRow>,
  now: number,
  limit: number = DEFAULT_LEDGER_LIMIT,
): RequestLedgerEntry[] {
  const entries: RequestLedgerEntry[] = [];
  for (const row of rows) {
    const connection = row.connection;
    const closedAt = row.closedAt ?? null;
    const createdAt = Number(connection.createdAt);
    entries.push({
      id: connection.id,
      at: createdAt,
      host: connectionHost(row),
      network: connection.network.toUpperCase(),
      rule: connection.rule,
      chain: connectionChain(row),
      inbound: connection.inbound,
      uploadTotal: Number(row.uplinkTotal),
      downloadTotal: Number(row.downlinkTotal),
      closed: closedAt !== null,
      durationMs: Math.max(0, (closedAt ?? now) - createdAt),
    });
  }
  entries.sort((left, right) => right.at - left.at);
  return entries.slice(0, limit);
}

export function filterLedgerEntries(
  entries: readonly RequestLedgerEntry[],
  filter: RequestLedgerFilter,
  search: string,
): RequestLedgerEntry[] {
  const needle = search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter === "active" && entry.closed) {
      return false;
    }
    if (filter === "closed" && !entry.closed) {
      return false;
    }
    if (needle === "") {
      return true;
    }
    return (
      entry.host.toLowerCase().includes(needle) ||
      entry.chain.toLowerCase().includes(needle) ||
      entry.rule.toLowerCase().includes(needle) ||
      entry.inbound.toLowerCase().includes(needle) ||
      entry.network.toLowerCase().includes(needle)
    );
  });
}
