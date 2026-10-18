import type { ConnectionRow } from "../api/daemon";

export type ConnectionStateFilter = "all" | "active" | "closed";
export type ConnectionSortKey =
  | "date"
  | "host"
  | "process"
  | "outbound"
  | "rule"
  | "upload"
  | "download"
  | "total"
  | "rate";
export type ConnectionSortDirection = "asc" | "desc";
export type ConnectionGroupKey = "none" | "host" | "process" | "outbound" | "rule" | "source";
export type ConnectionNetworkFilter = "all" | "tcp" | "udp";

export interface ConnectionFilterOptions {
  state: ConnectionStateFilter;
  search: string;
  source: string;
  network: ConnectionNetworkFilter;
  hideChain: string;
}

export interface ConnectionGroup {
  key: string;
  rows: ConnectionRow[];
  uplink: bigint;
  downlink: bigint;
}

export type ConnectionListItem =
  | { kind: "group"; key: string; rows: ConnectionRow[]; uplink: bigint; downlink: bigint }
  | { kind: "row"; row: ConnectionRow };

export function connectionHost(row: ConnectionRow): string {
  return row.connection.domain || row.connection.destination;
}

/** Removes closed rows while keeping active connections untouched. */
export function withoutClosedConnectionRows(
  rows: ReadonlyMap<string, ConnectionRow>,
): Map<string, ConnectionRow> {
  const result = new Map<string, ConnectionRow>();
  for (const [id, row] of rows) {
    if (row.closedAt === null) {
      result.set(id, row);
    }
  }
  return result;
}

export function activeConnectionRows(rows: readonly ConnectionRow[]): ConnectionRow[] {
  return rows.filter((row) => row.closedAt === null);
}

export function connectionProcessPath(row: ConnectionRow): string {
  return row.connection.processInfo?.processPath ?? "";
}

export function connectionProcessName(row: ConnectionRow): string {
  const path = connectionProcessPath(row);
  if (path === "") {
    return "";
  }
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

export function connectionChain(row: ConnectionRow): string {
  return row.connection.chainList.join(" / ");
}

export function connectionGroupValue(row: ConnectionRow, key: ConnectionGroupKey): string {
  switch (key) {
    case "host":
      return connectionHost(row);
    case "process":
      return connectionProcessName(row) || connectionProcessPath(row);
    case "outbound":
      return row.connection.outbound;
    case "rule":
      return row.connection.rule;
    case "source":
      return row.connection.source;
    default:
      return "";
  }
}

function includesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

export function matchesConnectionSearch(row: ConnectionRow, search: string): boolean {
  const query = search.trim();
  if (query === "") {
    return true;
  }
  const connection = row.connection;
  for (const token of query.split(/\s+/)) {
    const lower = token.toLowerCase();
    const separator = lower.indexOf(":");
    let matched: boolean;
    if (separator > 0) {
      const key = lower.slice(0, separator);
      const value = lower.slice(separator + 1);
      switch (key) {
        case "network":
          matched = connection.network.toLowerCase() === value;
          break;
        case "inbound":
          matched = includesQuery(connection.inbound, value);
          break;
        case "inbound.type":
          matched = includesQuery(connection.inboundType, value);
          break;
        case "source":
          matched = includesQuery(connection.source, value);
          break;
        case "destination":
          matched = includesQuery(connection.destination, value);
          break;
        case "host":
          matched = includesQuery(connectionHost(row), value);
          break;
        case "process":
          matched = includesQuery(connectionProcessPath(row), value);
          break;
        case "outbound":
          matched = includesQuery(connection.outbound, value);
          break;
        case "rule":
          matched = includesQuery(connection.rule, value);
          break;
        default:
          matched = plainConnectionMatch(row, lower);
          break;
      }
    } else {
      matched = plainConnectionMatch(row, lower);
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function plainConnectionMatch(row: ConnectionRow, query: string): boolean {
  const connection = row.connection;
  return (
    includesQuery(connection.destination, query) ||
    includesQuery(connection.domain, query) ||
    includesQuery(connection.source, query) ||
    includesQuery(connection.outbound, query) ||
    includesQuery(connection.rule, query) ||
    includesQuery(connectionProcessPath(row), query)
  );
}

function compileHideChain(pattern: string): RegExp | null {
  if (pattern.trim() === "") {
    return null;
  }
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function filterConnectionRows(
  rows: Iterable<ConnectionRow>,
  options: ConnectionFilterOptions,
): ConnectionRow[] {
  const hideChain = compileHideChain(options.hideChain);
  const source = options.source.trim().toLowerCase();
  const result: ConnectionRow[] = [];
  for (const row of rows) {
    if (options.state === "active" && row.closedAt !== null) {
      continue;
    }
    if (options.state === "closed" && row.closedAt === null) {
      continue;
    }
    if (options.network !== "all" && row.connection.network.toLowerCase() !== options.network) {
      continue;
    }
    if (source !== "" && !row.connection.source.toLowerCase().includes(source)) {
      continue;
    }
    if (hideChain !== null && hideChain.test(connectionChain(row))) {
      continue;
    }
    if (!matchesConnectionSearch(row, options.search)) {
      continue;
    }
    result.push(row);
  }
  return result;
}

export function defaultConnectionSortDirection(key: ConnectionSortKey): ConnectionSortDirection {
  switch (key) {
    case "date":
    case "upload":
    case "download":
    case "total":
    case "rate":
      return "desc";
    default:
      return "asc";
  }
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function sortConnectionRows(
  rows: readonly ConnectionRow[],
  key: ConnectionSortKey,
  direction: ConnectionSortDirection,
): ConnectionRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    let comparison = 0;
    switch (key) {
      case "date":
        comparison = compareNumber(Number(left.connection.createdAt), Number(right.connection.createdAt));
        break;
      case "host":
        comparison = compareText(connectionHost(left), connectionHost(right));
        break;
      case "process":
        comparison = compareText(connectionProcessPath(left), connectionProcessPath(right));
        break;
      case "outbound":
        comparison = compareText(left.connection.outbound, right.connection.outbound);
        break;
      case "rule":
        comparison = compareText(left.connection.rule, right.connection.rule);
        break;
      case "upload":
        comparison = compareNumber(Number(left.uplinkTotal), Number(right.uplinkTotal));
        break;
      case "download":
        comparison = compareNumber(Number(left.downlinkTotal), Number(right.downlinkTotal));
        break;
      case "total":
        comparison = compareNumber(
          Number(left.uplinkTotal + left.downlinkTotal),
          Number(right.uplinkTotal + right.downlinkTotal),
        );
        break;
      case "rate":
        comparison = compareNumber(
          left.uplinkRate + left.downlinkRate,
          right.uplinkRate + right.downlinkRate,
        );
        break;
    }
    if (comparison !== 0) {
      return comparison * sign;
    }
    return Number(right.connection.createdAt) - Number(left.connection.createdAt);
  });
}

export function groupConnectionRows(
  rows: readonly ConnectionRow[],
  key: ConnectionGroupKey,
): ConnectionGroup[] {
  if (key === "none") {
    return [];
  }
  const groups = new Map<string, ConnectionGroup>();
  for (const row of rows) {
    const value = connectionGroupValue(row, key);
    const label = value === "" ? "—" : value;
    const group = groups.get(label);
    if (group) {
      group.rows.push(row);
      group.uplink += row.uplinkTotal;
      group.downlink += row.downlinkTotal;
    } else {
      groups.set(label, {
        key: label,
        rows: [row],
        uplink: row.uplinkTotal,
        downlink: row.downlinkTotal,
      });
    }
  }
  return [...groups.values()].sort((left, right) => compareText(left.key, right.key));
}

export function flattenConnectionGroups(
  groups: readonly ConnectionGroup[],
  expanded: ReadonlySet<string>,
): ConnectionListItem[] {
  const result: ConnectionListItem[] = [];
  for (const group of groups) {
    result.push({
      kind: "group",
      key: group.key,
      rows: group.rows,
      uplink: group.uplink,
      downlink: group.downlink,
    });
    if (expanded.has(group.key)) {
      for (const row of group.rows) {
        result.push({ kind: "row", row });
      }
    }
  }
  return result;
}

const CSV_COLUMNS: { header: string; value: (row: ConnectionRow) => string | number }[] = [
  { header: "id", value: (row) => row.connection.id },
  { header: "network", value: (row) => row.connection.network },
  { header: "host", value: (row) => connectionHost(row) },
  { header: "destination", value: (row) => row.connection.destination },
  { header: "domain", value: (row) => row.connection.domain },
  { header: "source", value: (row) => row.connection.source },
  { header: "process", value: (row) => connectionProcessPath(row) },
  { header: "outbound", value: (row) => row.connection.outbound },
  { header: "rule", value: (row) => row.connection.rule },
  { header: "chain", value: (row) => connectionChain(row) },
  { header: "upload", value: (row) => String(row.uplinkTotal) },
  { header: "download", value: (row) => String(row.downlinkTotal) },
  { header: "createdAt", value: (row) => String(row.connection.createdAt) },
  { header: "closedAt", value: (row) => (row.closedAt === null ? "" : String(row.closedAt)) },
];

function escapeCsvField(value: string | number): string {
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function connectionRowsToCSV(rows: readonly ConnectionRow[]): string {
  const header = CSV_COLUMNS.map((column) => column.header).join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((column) => escapeCsvField(column.value(row))).join(","),
  );
  return [header, ...lines].join("\n");
}

function serializeConnectionRow(row: ConnectionRow): Record<string, unknown> {
  const connection = row.connection;
  return {
    id: connection.id,
    inbound: connection.inbound,
    inboundType: connection.inboundType,
    ipVersion: connection.ipVersion,
    network: connection.network,
    source: connection.source,
    destination: connection.destination,
    domain: connection.domain,
    protocol: connection.protocol,
    user: connection.user,
    fromOutbound: connection.fromOutbound,
    createdAt: Number(connection.createdAt),
    closedAt: row.closedAt,
    uplink: Number(connection.uplink),
    downlink: Number(connection.downlink),
    uplinkTotal: Number(row.uplinkTotal),
    downlinkTotal: Number(row.downlinkTotal),
    uplinkRate: row.uplinkRate,
    downlinkRate: row.downlinkRate,
    rule: connection.rule,
    outbound: connection.outbound,
    outboundType: connection.outboundType,
    chainList: connection.chainList,
    processInfo: connection.processInfo
      ? {
          processId: connection.processInfo.processId,
          userId: connection.processInfo.userId,
          userName: connection.processInfo.userName,
          processPath: connection.processInfo.processPath,
          packageNames: connection.processInfo.packageNames,
        }
      : null,
  };
}

export function connectionRowsToJSON(rows: readonly ConnectionRow[]): string {
  return JSON.stringify(rows.map(serializeConnectionRow), null, 2);
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Strips the port from a connection endpoint, including bracketed IPv6. */
export function endpointIp(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 0 ? trimmed.slice(1, end) : "";
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && trimmed.indexOf(":") === lastColon) {
    return trimmed.slice(0, lastColon);
  }
  return trimmed;
}
