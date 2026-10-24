import { Code } from "@connectrpc/connect";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { ConnectionRow } from "../api/daemon";
import { formatBytes, formatClockTime, formatDateTime, formatDurationMs } from "../api/format";
import { getGeoIp, type GeoIpInfo } from "../api/panel";
import { useStream } from "../api/stream";
import {
  loadConnectionGroupBy,
  loadConnectionNetworkFilter,
  loadConnectionSortDirection,
  loadConnectionSortKey,
  loadConnectionStateFilter,
  saveConnectionGroupBy,
  saveConnectionNetworkFilter,
  saveConnectionSortDirection,
  saveConnectionSortKey,
  saveConnectionStateFilter,
  type ConnectionGroupBy,
  type ConnectionNetworkFilter,
  type ConnectionSortDirection,
  type ConnectionSortKey,
  type ConnectionStateFilter,
} from "../app/connectionPreferences";
import { useApi, useIsMobile } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamStates } from "../components/StreamBanner";
import {
  Badge,
  Button,
  DataLine,
  DetailSection,
  DetailShell,
  Dialog,
  Field,
  IconButton,
  MenuItem,
  MenuLabel,
  OthersMenu,
  SearchInput,
  Select,
  SubMenu,
} from "../components/ui";
import {
  activeConnectionRows,
  connectionRowsToCSV,
  connectionRowsToJSON,
  downloadTextFile,
  endpointIp,
  filterConnectionRows,
  flattenConnectionGroups,
  groupConnectionRows,
  sortConnectionRows,
  type ConnectionListItem,
} from "../lib/connectionTools";
import styles from "./ConnectionsView.module.css";

const CONNECTION_ROW_HEIGHT = 84;
/** Mobile rows wrap the chain column below the traffic columns. */
const CONNECTION_MOBILE_ROW_HEIGHT = 140;
const CONNECTION_GROUP_HEIGHT = 38;
const CONNECTION_OVERSCAN = 6;
const CLOSE_CONCURRENCY = 8;

const STATE_OPTIONS: { value: ConnectionStateFilter; label: MessageKey }[] = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const EMPTY_MESSAGES: Record<ConnectionStateFilter, MessageKey> = {
  active: "No active connections",
  closed: "No closed connections",
  all: "No connections",
};

const SORT_OPTIONS: { value: ConnectionSortKey; label: MessageKey }[] = [
  { value: "date", label: "By date" },
  { value: "host", label: "Destination" },
  { value: "process", label: "Process" },
  { value: "outbound", label: "Outbound" },
  { value: "rule", label: "Rule" },
  { value: "upload", label: "Uplink" },
  { value: "download", label: "Downlink" },
  { value: "total", label: "Total" },
  { value: "rate", label: "Rate" },
];

const GROUP_OPTIONS: { value: ConnectionGroupBy; label: MessageKey }[] = [
  { value: "none", label: "None" },
  { value: "host", label: "Destination" },
  { value: "process", label: "Process" },
  { value: "outbound", label: "Outbound" },
  { value: "rule", label: "Rule" },
  { value: "source", label: "Source" },
];

export function ConnectionsView() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const isMobile = useIsMobile();
  const rowHeight = isMobile ? CONNECTION_MOBILE_ROW_HEIGHT : CONNECTION_ROW_HEIGHT;
  const [stateFilter, setStateFilter] = useState<ConnectionStateFilter>(loadConnectionStateFilter);
  const [sortKey, setSortKey] = useState<ConnectionSortKey>(loadConnectionSortKey);
  const [sortDirection, setSortDirection] =
    useState<ConnectionSortDirection>(loadConnectionSortDirection);
  const [groupBy, setGroupBy] = useState<ConnectionGroupBy>(loadConnectionGroupBy);
  const [networkFilter, setNetworkFilter] =
    useState<ConnectionNetworkFilter>(loadConnectionNetworkFilter);
  const [sourceFilter, setSourceFilter] = useState("");
  const [hideChain, setHideChain] = useState("");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozenRows, setFrozenRows] = useState<Map<string, ConnectionRow> | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [closeFilteredOpen, setCloseFilteredOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const lastGroupByRef = useRef<ConnectionGroupBy | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const sourceRows = paused && frozenRows !== null ? frozenRows : connections.data.rows;

  const filteredRows = useMemo(
    () =>
      sortConnectionRows(
        filterConnectionRows(sourceRows.values(), {
          state: stateFilter,
          search,
          source: sourceFilter,
          network: networkFilter,
          hideChain,
        }),
        sortKey,
        sortDirection,
      ),
    [sourceRows, stateFilter, search, sourceFilter, networkFilter, hideChain, sortKey, sortDirection],
  );

  const groups = useMemo(
    () => groupConnectionRows(filteredRows, groupBy),
    [filteredRows, groupBy],
  );

  useEffect(() => {
    if (groupBy === "none") {
      lastGroupByRef.current = groupBy;
      return;
    }
    if (lastGroupByRef.current !== groupBy) {
      lastGroupByRef.current = groupBy;
      setExpandedGroups(new Set(groups.map((group) => group.key)));
    }
  }, [groupBy, groups]);

  const items = useMemo<ConnectionListItem[]>(() => {
    if (groupBy === "none") {
      return filteredRows.map((row) => ({ kind: "row", row }));
    }
    return flattenConnectionGroups(groups, expandedGroups);
  }, [filteredRows, groupBy, groups, expandedGroups]);

  const layout = useMemo(() => buildConnectionLayout(items, rowHeight), [items, rowHeight]);
  const totalHeight = layout.reduce((total, entry) => total + entry.height, 0);

  useEffect(() => {
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    if (scrollTop > maxScroll) {
      if (listRef.current !== null) {
        listRef.current.scrollTop = maxScroll;
      }
      setScrollTop(maxScroll);
    }
  }, [totalHeight, viewportHeight, scrollTop]);

  useEffect(() => {
    const element = listRef.current;
    if (element === null) {
      return;
    }
    const measure = () => setViewportHeight(element.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (listRef.current !== null) {
      listRef.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [stateFilter, sortKey, sortDirection, groupBy, networkFilter, sourceFilter, hideChain, search]);

  const visibleLayout = useMemo(() => {
    if (layout.length === 0) {
      return [];
    }
    const start = findFirstLayoutIndex(layout, scrollTop);
    const end = findFirstLayoutIndex(layout, scrollTop + viewportHeight);
    return layout.slice(
      Math.max(0, start - CONNECTION_OVERSCAN),
      Math.min(layout.length, end + CONNECTION_OVERSCAN),
    );
  }, [layout, scrollTop, viewportHeight]);

  const detailRow = detailId !== null ? (sourceRows.get(detailId) ?? null) : null;
  const detailActive = detailRow?.closedAt === null;
  const detail = detailRow && (
    <DetailShell
      backLabel={t("Connections")}
      title={t("Connection")}
      accessory={
        <Badge tone={detailActive ? "good" : "danger"}>
          {detailActive ? t("Active") : t("Closed")}
        </Badge>
      }
      onClose={() => setDetailId(null)}
    >
      <ConnectionDetailBody row={detailRow} onClose={() => setDetailId(null)} />
    </DetailShell>
  );

  const activeFiltered = activeConnectionRows(filteredRows);
  const filtersActive =
    sourceFilter.trim() !== "" ||
    hideChain.trim() !== "" ||
    networkFilter !== "all" ||
    groupBy !== "none";

  const persistSort = (next: ConnectionSortKey) => {
    setSortKey(next);
    saveConnectionSortKey(next);
  };

  const persistDirection = (next: ConnectionSortDirection) => {
    setSortDirection(next);
    saveConnectionSortDirection(next);
  };

  const persistGroup = (next: ConnectionGroupBy) => {
    setGroupBy(next);
    saveConnectionGroupBy(next);
    setExpandedGroups(new Set());
  };

  const closeFiltered = async () => {
    setClosing(true);
    try {
      const results: PromiseSettledResult<void>[] = [];
      for (let index = 0; index < activeFiltered.length; index += CLOSE_CONCURRENCY) {
        const batch = activeFiltered.slice(index, index + CLOSE_CONCURRENCY);
        results.push(
          ...(await Promise.allSettled(
            batch.map((row) => api.closeConnection(row.connection.id)),
          )),
        );
      }
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failures.length > 0) {
        const reason =
          failures[0].reason instanceof Error
            ? failures[0].reason.message
            : String(failures[0].reason);
        showError(
          new Error(
            `${t("Failed to close {failed} of {total} connections", {
              failed: failures.length,
              total: results.length,
            })}: ${reason}`,
          ),
        );
      }
    } finally {
      setClosing(false);
      setCloseFilteredOpen(false);
    }
  };

  const exportCsv = () => {
    downloadTextFile(
      `connections-${new Date().toISOString().replaceAll(":", "-")}.csv`,
      connectionRowsToCSV(filteredRows),
      "text/csv",
    );
  };

  const exportJson = () => {
    downloadTextFile(
      `connections-${new Date().toISOString().replaceAll(":", "-")}.json`,
      connectionRowsToJSON(filteredRows),
      "application/json",
    );
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (isMobile && detail) {
    return detail;
  }

  return (
    <div className="page">
      <PageHeader
        title={t("Connections")}
        actions={
          <>
            <IconButton
              active={paused}
              title={paused ? t("Resume") : t("Pause")}
              onClick={() => {
                if (paused) {
                  setPaused(false);
                  setFrozenRows(null);
                } else {
                  setFrozenRows(new Map(sourceRows));
                  setPaused(true);
                }
              }}
            >
              <Icon name={paused ? "play_arrow" : "pause"} />
            </IconButton>
            <OthersMenu>
              <MenuLabel>{t("State")}</MenuLabel>
              {STATE_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  checked={stateFilter === option.value}
                  onSelect={() => {
                    setStateFilter(option.value);
                    saveConnectionStateFilter(option.value);
                  }}
                >
                  {t(option.label)}
                </MenuItem>
              ))}
              <div className="menu-divider" />
              <SubMenu label={t("Sort By")} icon="filter_list">
                {SORT_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.value}
                    checked={sortKey === option.value}
                    onSelect={() => persistSort(option.value)}
                  >
                    {t(option.label)}
                  </MenuItem>
                ))}
              </SubMenu>
              <SubMenu label={t("Group by")} icon="folder">
                {GROUP_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.value}
                    checked={groupBy === option.value}
                    onSelect={() => persistGroup(option.value)}
                  >
                    {t(option.label)}
                  </MenuItem>
                ))}
              </SubMenu>
              <SubMenu label={t("Network type")} icon="hub">
                <MenuItem
                  checked={networkFilter === "all"}
                  onSelect={() => {
                    setNetworkFilter("all");
                    saveConnectionNetworkFilter("all");
                  }}
                >
                  {t("All")}
                </MenuItem>
                <MenuItem
                  checked={networkFilter === "tcp"}
                  onSelect={() => {
                    setNetworkFilter("tcp");
                    saveConnectionNetworkFilter("tcp");
                  }}
                >
                  TCP
                </MenuItem>
                <MenuItem
                  checked={networkFilter === "udp"}
                  onSelect={() => {
                    setNetworkFilter("udp");
                    saveConnectionNetworkFilter("udp");
                  }}
                >
                  UDP
                </MenuItem>
              </SubMenu>
              <MenuLabel>{t("Sort By")}</MenuLabel>
              <MenuItem
                checked={sortDirection === "asc"}
                onSelect={() => persistDirection("asc")}
              >
                {t("Ascending")}
              </MenuItem>
              <MenuItem
                checked={sortDirection === "desc"}
                onSelect={() => persistDirection("desc")}
              >
                {t("Descending")}
              </MenuItem>
              <MenuItem icon="tune" onSelect={() => setFiltersOpen(true)}>
                {t("Filter and group")}
              </MenuItem>
              {groupBy !== "none" && (
                <>
                  <MenuItem
                    icon="unfold_more"
                    onSelect={() => setExpandedGroups(new Set(groups.map((group) => group.key)))}
                  >
                    {t("Expand all")}
                  </MenuItem>
                  <MenuItem icon="expand_less" onSelect={() => setExpandedGroups(new Set())}>
                    {t("Collapse all")}
                  </MenuItem>
                </>
              )}
              <div className="menu-divider" />
              <MenuItem icon="content_copy" onSelect={exportCsv}>
                {t("Export CSV")}
              </MenuItem>
              <MenuItem icon="save" onSelect={exportJson}>
                {t("Export JSON")}
              </MenuItem>
              <div className="menu-divider" />
              <MenuItem
                danger
                icon="close"
                onSelect={() => setCloseFilteredOpen(true)}
              >
                {t("Close Filtered Connections")}
              </MenuItem>
              <MenuItem
                danger
                icon="close"
                onSelect={() => {
                  void api.closeAllConnections().catch(showError);
                }}
              >
                {t("Close All Connections")}
              </MenuItem>
            </OthersMenu>
          </>
        }
      />
      <div className="field">
        <SearchInput value={search} onChange={setSearch} />
      </div>
      {filtersActive && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t("Filters")}: {sourceFilter !== "" ? `${t("Source")} ~ ${sourceFilter}` : ""}
          {hideChain !== "" ? ` · ${t("Hide chains")}: ${hideChain}` : ""}
          {networkFilter !== "all" ? ` · ${networkFilter.toUpperCase()}` : ""}
        </div>
      )}
      <StreamStates
        snapshot={connections}
        loaded={connections.data.loaded}
        empty={filteredRows.length === 0}
        emptyIcon="swap_vert"
        emptyMessage={t(
          search.trim() !== "" || filtersActive
            ? "No matching connections"
            : EMPTY_MESSAGES[stateFilter],
        )}
      />
      {connections.errorCode === Code.Unimplemented && connections.phase === "error" && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t("Connection tracking requires the Clash API to be configured in the running instance.")}
        </div>
      )}
      {filteredRows.length > 0 && (
        <div
          ref={listRef}
          className={styles.connectionList}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className={styles.connectionCanvas} style={{ height: totalHeight }}>
            {visibleLayout.map(({ item, top, height }) =>
              item.kind === "group" ? (
                <button
                  type="button"
                  key={`group-${item.key}`}
                  className={styles.groupHeader}
                  style={{ height, transform: `translateY(${top}px)` }}
                  onClick={() => toggleGroup(item.key)}
                >
                  <Icon name={expandedGroups.has(item.key) ? "expand_less" : "expand_more"} size={14} />
                  <span className={styles.groupKey}>{item.key}</span>
                  <Badge>{item.rows.length}</Badge>
                  <span className={styles.spacer} />
                  <span>
                    ↑ {formatBytes(item.uplink)} · ↓ {formatBytes(item.downlink)}
                  </span>
                </button>
              ) : (
                <div
                  key={item.row.connection.id}
                  className={styles.virtualRow}
                  style={{ height, transform: `translateY(${top}px)` }}
                >
                  <ConnectionRowView row={item.row} onOpen={setDetailId} />
                </div>
              ),
            )}
          </div>
        </div>
      )}
      {filteredRows.length > 0 && (
        <div className="hint" style={{ textAlign: "center", padding: 8 }}>
          {t("Showing {count} connections", { count: filteredRows.length })}
        </div>
      )}
      {detail}
      {filtersOpen && (
        <Dialog onClose={() => setFiltersOpen(false)}>
          <h3>{t("Filter and group")}</h3>
          <Field label={t("Source")}>
            <input
              className="input"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
            />
          </Field>
          <Field label={t("Hide chains")}>
            <input
              className="input"
              value={hideChain}
              onChange={(event) => setHideChain(event.target.value)}
            />
          </Field>
          <Field label={t("Group by")}>
            <Select
              options={GROUP_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={groupBy}
              onChange={persistGroup}
            />
          </Field>
          <div className="row-actions dialog-actions">
            <Button
              onClick={() => {
                setSourceFilter("");
                setHideChain("");
                setNetworkFilter("all");
                saveConnectionNetworkFilter("all");
              }}
            >
              {t("Clear filters")}
            </Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              {t("Done")}
            </Button>
          </div>
        </Dialog>
      )}
      {closeFilteredOpen && (
        <Dialog onClose={() => setCloseFilteredOpen(false)}>
          <h3>{t("Close {count} connections?", { count: activeFiltered.length })}</h3>
          <p className="dialog-message">
            {t("This closes every connection matching the current filters.")}
          </p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setCloseFilteredOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="danger" disabled={closing} onClick={() => void closeFiltered()}>
              {closing ? t("Closing...") : t("Close")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function buildConnectionLayout(
  items: readonly ConnectionListItem[],
  rowHeight: number,
): { item: ConnectionListItem; top: number; height: number }[] {
  const layout: { item: ConnectionListItem; top: number; height: number }[] = [];
  let top = 0;
  for (const item of items) {
    const height = item.kind === "group" ? CONNECTION_GROUP_HEIGHT : rowHeight;
    layout.push({ item, top, height });
    top += height;
  }
  return layout;
}

function findFirstLayoutIndex(
  layout: { top: number; height: number }[],
  y: number,
): number {
  let low = 0;
  let high = layout.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const entry = layout[mid];
    if (entry.top + entry.height <= y) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

const ConnectionRowView = memo(function ConnectionRowView(props: {
  row: ConnectionRow;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  return (
    <button type="button" className={styles.connectionRow} onClick={() => props.onOpen(connection.id)}>
      <div className={styles.head}>
        <Badge>{connection.network.toUpperCase()}</Badge>
        <span className={styles.destination}>{connection.domain || connection.destination}</span>
        <span className={styles.spacer} />
        <Badge tone={active ? "good" : "danger"}>{active ? t("Active") : t("Closed")}</Badge>
      </div>
      <div className={styles.columns}>
        {active ? (
          <>
            <div>
              <span>↑ {formatBytes(row.uplinkRate)}/s</span>
              <span>↓ {formatBytes(row.downlinkRate)}/s</span>
            </div>
            <div>
              <span>↑ {formatBytes(row.uplinkTotal)}</span>
              <span>↓ {formatBytes(row.downlinkTotal)}</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>↑ {formatBytes(row.uplinkTotal)}</span>
              <span>↓ {formatBytes(row.downlinkTotal)}</span>
            </div>
            <div>
              <span>{formatClockTime(Number(connection.createdAt))}</span>
              <span>{formatDurationMs(row.closedAt! - Number(connection.createdAt))}</span>
            </div>
          </>
        )}
        <div className={styles.right}>
          <span>
            {connection.inboundType}/{connection.inbound}
          </span>
          <span>{active ? (chain[0] ?? connection.outbound) : chain.join(" / ")}</span>
        </div>
      </div>
    </button>
  );
});

function ConnectionDetailBody(props: { row: ConnectionRow; onClose: () => void }) {
  const api = useApi();
  const { t, language } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const active = row.closedAt === null;
  const chain = [...connection.chainList].reverse();
  return (
    <>
      <div className="hint" style={{ fontFamily: "var(--font-mono)" }}>
        {connection.id}
      </div>
      <DetailSection title={t("Traffic")}>
        <Line label={t("Created at")} value={formatDateTime(Number(connection.createdAt), language)} />
        {row.closedAt !== null && (
          <Line label={t("Closed at")} value={formatDateTime(row.closedAt, language)} />
        )}
        <Line label={t("Uplink")} value={formatBytes(row.uplinkTotal)} />
        <Line label={t("Downlink")} value={formatBytes(row.downlinkTotal)} />
      </DetailSection>
      <DetailSection title={t("Metadata")}>
        <Line label={t("Inbound")} value={connection.inbound} />
        <Line label={t("Inbound type")} value={connection.inboundType} />
        <Line label={t("IP version")} value={connection.ipVersion > 0 ? `IPv${connection.ipVersion}` : ""} />
        <Line label={t("Network")} value={connection.network.toUpperCase()} />
        <Line label={t("Source")} value={connection.source} />
        <Line label={t("Destination")} value={connection.destination} />
        <Line label={t("Domain")} value={connection.domain} />
        <Line label={t("Protocol")} value={connection.protocol} />
        <Line label={t("User")} value={connection.user} />
        <Line label={t("From outbound")} value={connection.fromOutbound} />
        <Line label={t("Match rule")} value={connection.rule} />
        <Line label={t("Outbound")} value={connection.outbound} />
        <Line label={t("Outbound type")} value={connection.outboundType} />
        {chain.length > 1 && <Line label={t("Chain")} value={chain.join(" / ")} />}
      </DetailSection>
      <ConnectionGeo destination={connection.destination} />
      {connection.processInfo && (
        <DetailSection title={t("Process")}>
          <Line
            label={t("Process")}
            value={`${connection.processInfo.processPath} (${connection.processInfo.processId})`}
          />
          <Line label={t("User")} value={connection.processInfo.userName} />
        </DetailSection>
      )}
      {active && (
        <>
          <hr className={styles.divider} />
          <div className="row-actions">
            <Button
              variant="danger"
              onClick={() => {
                void api.closeConnection(connection.id).catch(showError);
                props.onClose();
              }}
            >
              <Icon name="close" size={13} />
              {t("Close connection")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function ConnectionGeo(props: { destination: string }) {
  const { t } = useI18n();
  const [geo, setGeo] = useState<GeoIpInfo | null>(null);

  useEffect(() => {
    const ip = endpointIp(props.destination);
    if (ip === "") {
      setGeo(null);
      return;
    }
    let stale = false;
    getGeoIp(ip).then(
      (info) => {
        if (!stale) {
          setGeo(info);
        }
      },
      () => {
        if (!stale) {
          setGeo(null);
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [props.destination]);

  if (geo === null) {
    return null;
  }
  const asn = geo.asn !== undefined ? `AS${geo.asn}` : "";
  const organization = geo.organization ?? geo.org ?? "";
  return (
    <DetailSection title={t("GeoIP")}>
      <Line label={t("Country")} value={geo.country ?? ""} />
      <Line label={t("City")} value={geo.city ?? ""} />
      <Line label={t("ASN")} value={asn} />
      <Line label={t("Organization")} value={organization} />
    </DetailSection>
  );
}

function Line(props: { label: string; value: string }) {
  if (props.value === "") {
    return null;
  }
  return <DataLine label={props.label} value={props.value} mono />;
}
