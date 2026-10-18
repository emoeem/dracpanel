import type {
  ConnectionGroupKey,
  ConnectionNetworkFilter,
  ConnectionSortDirection,
  ConnectionSortKey,
} from "../lib/connectionTools";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

const STATE_FILTER_KEY = "connection-state-filter";
const SORT_MODE_KEY = "connection-sort";
const SORT_KEY = "connection-sort-key";
const SORT_DIRECTION_KEY = "connection-sort-direction";
const GROUP_BY_KEY = "connection-group-by";
const NETWORK_FILTER_KEY = "connection-network-filter";

export type { ConnectionNetworkFilter, ConnectionSortDirection, ConnectionSortKey };
export type ConnectionStateFilter = "all" | "active" | "closed";
export type ConnectionSortMode = "date" | "traffic" | "trafficTotal";
export type ConnectionGroupBy = ConnectionGroupKey;

const STATE_FILTERS: ConnectionStateFilter[] = ["all", "active", "closed"];
const SORT_MODES: ConnectionSortMode[] = ["date", "traffic", "trafficTotal"];
const SORT_KEYS: ConnectionSortKey[] = [
  "date",
  "host",
  "process",
  "outbound",
  "rule",
  "upload",
  "download",
  "total",
  "rate",
];
const SORT_DIRECTIONS: ConnectionSortDirection[] = ["asc", "desc"];
const GROUP_KEYS: ConnectionGroupBy[] = ["none", "host", "process", "outbound", "rule", "source"];
const NETWORK_FILTERS: ConnectionNetworkFilter[] = ["all", "tcp", "udp"];

export function loadConnectionStateFilter(): ConnectionStateFilter {
  const value = loadStoredJson(STATE_FILTER_KEY);
  return STATE_FILTERS.find((filter) => filter === value) ?? "active";
}

export function saveConnectionStateFilter(value: ConnectionStateFilter): void {
  saveStoredJson(STATE_FILTER_KEY, value);
}

export function loadConnectionSortMode(): ConnectionSortMode {
  const value = loadStoredJson(SORT_MODE_KEY);
  return SORT_MODES.find((mode) => mode === value) ?? "date";
}

export function saveConnectionSortMode(value: ConnectionSortMode): void {
  saveStoredJson(SORT_MODE_KEY, value);
}

export function loadConnectionSortKey(): ConnectionSortKey {
  const value = loadStoredJson(SORT_KEY);
  return SORT_KEYS.find((key) => key === value) ?? "date";
}

export function saveConnectionSortKey(value: ConnectionSortKey): void {
  saveStoredJson(SORT_KEY, value);
}

export function loadConnectionSortDirection(): ConnectionSortDirection {
  const value = loadStoredJson(SORT_DIRECTION_KEY);
  return SORT_DIRECTIONS.find((direction) => direction === value) ?? "desc";
}

export function saveConnectionSortDirection(value: ConnectionSortDirection): void {
  saveStoredJson(SORT_DIRECTION_KEY, value);
}

export function loadConnectionGroupBy(): ConnectionGroupBy {
  const value = loadStoredJson(GROUP_BY_KEY);
  return GROUP_KEYS.find((key) => key === value) ?? "none";
}

export function saveConnectionGroupBy(value: ConnectionGroupBy): void {
  saveStoredJson(GROUP_BY_KEY, value);
}

export function loadConnectionNetworkFilter(): ConnectionNetworkFilter {
  const value = loadStoredJson(NETWORK_FILTER_KEY);
  return NETWORK_FILTERS.find((filter) => filter === value) ?? "all";
}

export function saveConnectionNetworkFilter(value: ConnectionNetworkFilter): void {
  saveStoredJson(NETWORK_FILTER_KEY, value);
}
