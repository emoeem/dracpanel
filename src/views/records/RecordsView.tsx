import { useMemo, useState, type ReactNode } from "react";

import { formatBytes, formatDurationMs } from "../../api/format";
import type { ConnectionRow } from "../../api/daemon";
import { useStream } from "../../api/stream";
import { useApi, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useI18n, type MessageKey } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import {
  FcAvatar,
  FcButton,
  FcCard,
  FcIconButton,
  FcRecordTable,
  FcSearchField,
  FcSegmented,
  FcSheet,
  type FcColumn,
} from "../../components/flclash";
import {
  connectionChain,
  connectionHost,
  connectionProcessName,
  connectionRowsToCSV,
  connectionRowsToJSON,
  defaultConnectionSortDirection,
  downloadTextFile,
  filterConnectionRows,
  groupConnectionRows,
  sortConnectionRows,
  type ConnectionGroupKey,
  type ConnectionNetworkFilter,
  type ConnectionSortDirection,
  type ConnectionSortKey,
} from "../../lib/connectionTools";
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
  type ConnectionStateFilter,
} from "../../app/connectionPreferences";
import { formatRate } from "../../lib/flclash/format";
import { buildRequestLedger } from "../../lib/requestLedger";
import { ConnectionsTraffic } from "./ConnectionsTraffic";
import { cx } from "../../lib/cx";
import styles from "./RecordsView.module.css";

function Toolbar(props: {
  title: string;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.toolbar}>
      <h1 className={styles.pageTitle}>{props.title}</h1>
      <div className={styles.actions}>
        <FcSearchField
          value={props.search}
          onChange={props.onSearch}
          placeholder={props.searchPlaceholder}
          narrow
        />
        {props.actions}
      </div>
    </div>
  );
}

/* ── connections ──────────────────────────────────────────── */

/** Column keys that map directly onto a connection sort key. */
const COLUMN_SORT_KEY: Record<string, ConnectionSortKey> = {
  target: "host",
  process: "process",
  rule: "rule",
  outbound: "outbound",
  downloadTotal: "download",
  uploadTotal: "upload",
  downloadRate: "rate",
  uploadRate: "rate",
};

const GROUP_LABELS: { value: ConnectionGroupKey; label: MessageKey }[] = [
  { value: "none", label: "No grouping" },
  { value: "host", label: "By host" },
  { value: "process", label: "By process" },
  { value: "outbound", label: "By outbound" },
  { value: "rule", label: "By rule" },
  { value: "source", label: "By device" },
];

const SORT_LABELS: { value: ConnectionSortKey; label: MessageKey }[] = [
  { value: "date", label: "Start time" },
  { value: "host", label: "Host" },
  { value: "process", label: "Process" },
  { value: "outbound", label: "Outbound" },
  { value: "rule", label: "Rule" },
  { value: "download", label: "Downloaded" },
  { value: "upload", label: "Uploaded" },
  { value: "total", label: "Total traffic" },
  { value: "rate", label: "Current rate" },
];

export function ConnectionsView() {
  const api = useApi();
  const { t } = useI18n();
  const now = useNow(1000);
  const connections = useStream(api.connections);
  const groups = useStream(api.groups);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ConnectionRow | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  // List-tab controls, persisted across sessions via connectionPreferences.
  const [stateFilter, setStateFilter] = useState<ConnectionStateFilter>(loadConnectionStateFilter);
  const [network, setNetwork] = useState<ConnectionNetworkFilter>(loadConnectionNetworkFilter);
  const [groupBy, setGroupBy] = useState<ConnectionGroupKey>(loadConnectionGroupBy);
  const [sortKey, setSortKey] = useState<ConnectionSortKey>(loadConnectionSortKey);
  const [sortDirection, setSortDirection] = useState<ConnectionSortDirection>(
    loadConnectionSortDirection,
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  // URL carries the view and optional deep-link filters (#/connections?tab=traffic&out=proxy)
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [tab, setTab] = useState<"traffic" | "list">(
    params.get("tab") === "list" ? "list" : "traffic",
  );
  const deepOut = params.get("out") ?? "";
  const deepSource = params.get("src") ?? "";

  const allRows = useMemo(() => [...connections.data.rows.values()], [connections.data.rows]);

  // Traffic tab always shows live connections only.
  const rows = useMemo(
    () =>
      sortConnectionRows(
        filterConnectionRows(allRows, {
          state: "active",
          search,
          source: deepSource,
          network: "all",
          hideChain: "",
        }),
        "date",
        "desc",
      ).filter((row) => {
        const outbound =
          row.connection.chainList.length > 1
            ? row.connection.chainList[row.connection.chainList.length - 1]
            : row.connection.outbound;
        return deepOut === "" || outbound === deepOut;
      }),
    [allRows, deepOut, deepSource, search],
  );

  // List tab honours every control.
  const listRows = useMemo(
    () =>
      sortConnectionRows(
        filterConnectionRows(allRows, {
          state: stateFilter,
          search,
          source: deepSource,
          network,
          hideChain: "",
        }),
        sortKey,
        sortDirection,
      ).filter((row) => {
        const outbound =
          row.connection.chainList.length > 1
            ? row.connection.chainList[row.connection.chainList.length - 1]
            : row.connection.outbound;
        return deepOut === "" || outbound === deepOut;
      }),
    [allRows, deepOut, deepSource, network, search, sortDirection, sortKey, stateFilter],
  );

  const listGroups = useMemo(() => groupConnectionRows(listRows, groupBy), [listRows, groupBy]);

  const handleSort = (columnKey: string) => {
    const mapped = COLUMN_SORT_KEY[columnKey];
    if (mapped === undefined) {
      return;
    }
    if (sortKey === mapped) {
      const next = sortDirection === "asc" ? "desc" : "asc";
      setSortDirection(next);
      saveConnectionSortDirection(next);
      return;
    }
    setSortKey(mapped);
    saveConnectionSortKey(mapped);
    setSortDirection(defaultConnectionSortDirection(mapped));
    saveConnectionSortDirection(defaultConnectionSortDirection(mapped));
  };

  const changeStateFilter = (value: ConnectionStateFilter) => {
    setStateFilter(value);
    saveConnectionStateFilter(value);
  };
  const changeNetwork = (value: ConnectionNetworkFilter) => {
    setNetwork(value);
    saveConnectionNetworkFilter(value);
  };
  const changeGroupBy = (value: string) => {
    setGroupBy(value as ConnectionGroupKey);
    saveConnectionGroupBy(value as ConnectionGroupKey);
  };
  const changeSortKey = (value: string) => {
    setSortKey(value as ConnectionSortKey);
    saveConnectionSortKey(value as ConnectionSortKey);
  };
  const changeSortDirection = () => {
    const next = sortDirection === "asc" ? "desc" : "asc";
    setSortDirection(next);
    saveConnectionSortDirection(next);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const exportRows = (format: "csv" | "json") => {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    if (format === "csv") {
      downloadTextFile(`connections-${stamp}.csv`, connectionRowsToCSV(listRows), "text/csv");
    } else {
      downloadTextFile(`connections-${stamp}.json`, connectionRowsToJSON(listRows), "application/json");
    }
  };

  const columns: FcColumn<ConnectionRow>[] = useMemo(
    () => [
      {
        key: "process",
        label: t("Process"),
        width: 150,
        sortable: true,
        render: (row) => {
          const name = connectionProcessName(row) || row.connection.inbound || "—";
          return (
            <span className={styles.sourceCell}>
              <FcAvatar name={name} />
              <span className={styles.truncate}>{name}</span>
            </span>
          );
        },
      },
      {
        key: "target",
        label: t("Target"),
        flex: 1.4,
        sortable: true,
        render: (row) => (
          <span title={connectionHost(row)}>
            {connectionHost(row) || row.connection.destination || "—"}
          </span>
        ),
      },
      {
        key: "protocol",
        label: t("Protocol"),
        width: 60,
        render: (row) => row.connection.network.toUpperCase() || "—",
      },
      {
        key: "rule",
        label: t("Rule"),
        flex: 0.9,
        hideBelow: 1000,
        sortable: true,
        render: (row) => <span className={styles.muted}>{row.connection.rule || "—"}</span>,
      },
      {
        key: "outbound",
        label: t("Outbound"),
        width: 120,
        sortable: true,
        render: (row) => (
          <span className={styles.truncate} title={connectionChain(row)}>
            {row.connection.outbound || "—"}
          </span>
        ),
      },
      {
        key: "downloadRate",
        label: t("Download rate"),
        width: 88,
        align: "end",
        sortable: true,
        render: (row) => formatRate(row.downlinkRate),
      },
      {
        key: "uploadRate",
        label: t("Upload rate"),
        width: 88,
        align: "end",
        sortable: true,
        render: (row) => formatRate(row.uplinkRate),
      },
      {
        key: "downloadTotal",
        label: t("Downloaded"),
        width: 84,
        align: "end",
        hideBelow: 1200,
        sortable: true,
        render: (row) => formatBytes(row.downlinkTotal),
      },
      {
        key: "uploadTotal",
        label: t("Uploaded"),
        width: 84,
        align: "end",
        hideBelow: 1200,
        sortable: true,
        render: (row) => formatBytes(row.uplinkTotal),
      },
      {
        key: "duration",
        label: t("Duration"),
        width: 72,
        align: "end",
        render: (row) => formatDurationMs(Math.max(0, now - Number(row.connection.createdAt))),
      },
    ],
    [now, t],
  );

  const closeAll = async () => {
    setClosingAll(true);
    try {
      await api.closeAllConnections();
    } catch (error) {
      showError(error);
    } finally {
      setClosingAll(false);
    }
  };

  return (
    <div className="fc-page">
      <Toolbar
        title={t("Connections")}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t("Search connections")}
        actions={
          <>
            <FcSegmented
              ariaLabel={t("Connection view")}
              value={tab}
              onChange={(value: string) => setTab(value as "traffic" | "list")}
              options={[
                { value: "traffic", label: t("Traffic") },
                { value: "list", label: t("List") },
              ]}
            />
            <FcIconButton label={t("Close all connections")} disabled={closingAll || rows.length === 0} onClick={() => void closeAll()}>
              {closingAll ? <span className={styles.spinner} /> : <Icon name="delete_sweep" size={18} />}
            </FcIconButton>
          </>
        }
      />
      {tab === "traffic" ? (
        <ConnectionsTraffic rows={rows} groups={groups.data} onOpen={setDetail} />
      ) : (
        <>
          <div className={styles.filterBar}>
            <FcSegmented
              ariaLabel={t("Connection state")}
              value={stateFilter}
              onChange={(value: string) => changeStateFilter(value as ConnectionStateFilter)}
              options={[
                { value: "active", label: t("Active") },
                { value: "closed", label: t("Closed") },
                { value: "all", label: t("All") },
              ]}
            />
            <FcSegmented
              ariaLabel={t("Network type")}
              value={network}
              onChange={(value: string) => changeNetwork(value as ConnectionNetworkFilter)}
              options={[
                { value: "all", label: t("All") },
                { value: "tcp", label: "TCP" },
                { value: "udp", label: "UDP" },
              ]}
            />
            <label className={styles.filterField}>
              <span>{t("Group")}</span>
              <select value={groupBy} onChange={(event) => changeGroupBy(event.target.value)}>
                {GROUP_LABELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>{t("Sort")}</span>
              <select value={sortKey} onChange={(event) => changeSortKey(event.target.value)}>
                {SORT_LABELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <FcIconButton
              label={sortDirection === "asc" ? t("Ascending") : t("Descending")}
              onClick={changeSortDirection}
            >
              <span className={cx(styles.sortDirIcon, sortDirection === "asc" && styles.sortDirAsc)}>
                <Icon name="arrow_downward" size={16} />
              </span>
            </FcIconButton>
            <span className={styles.filterSpacer} />
            <FcButton size="small" onClick={() => exportRows("csv")}>
              {t("Export CSV")}
            </FcButton>
            <FcButton size="small" onClick={() => exportRows("json")}>
              {t("Export JSON")}
            </FcButton>
          </div>
          {groupBy === "none" ? (
            <FcCard className={styles.tableCard}>
              <FcRecordTable
                columns={columns}
                rows={listRows}
                getKey={(row) => row.connection.id}
                onRowClick={setDetail}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
                emptyLabel={connections.data.loaded ? t("No data") : t("Loading…")}
                maxRows={300}
              />
            </FcCard>
          ) : (
            <FcCard className={styles.tableCard}>
              {listGroups.length === 0 ? (
                <div className={styles.empty}>
                  {connections.data.loaded ? t("No data") : t("Loading…")}
                </div>
              ) : (
                listGroups.map((group) => (
                  <section key={group.key} className={styles.groupSection}>
                    <button
                      type="button"
                      className={styles.groupHeader}
                      aria-expanded={expandedGroups.has(group.key)}
                      onClick={() => toggleGroup(group.key)}
                    >
                      <span className={cx(styles.groupChevron, expandedGroups.has(group.key) && styles.groupChevronOpen)}>
                        <Icon name="expand_more" size={16} />
                      </span>
                      <span className={styles.groupName} title={group.key}>
                        {group.key}
                      </span>
                      <span className={styles.groupMeta}>
                        {t("{count} rows · ↓{down} ↑{up}", {
                          count: group.rows.length,
                          down: formatBytes(group.downlink),
                          up: formatBytes(group.uplink),
                        })}
                      </span>
                    </button>
                    {expandedGroups.has(group.key) && (
                      <FcRecordTable
                        columns={columns}
                        rows={group.rows}
                        getKey={(row) => row.connection.id}
                        onRowClick={setDetail}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                        dense
                        maxRows={200}
                      />
                    )}
                  </section>
                ))
              )}
            </FcCard>
          )}
        </>
      )}
      {detail && (
        <ConnectionDetail
          row={detail}
          now={now}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function ConnectionDetail(props: { row: ConnectionRow; now: number; onClose: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const row = props.row;
  const connection = row.connection;
  const [closing, setClosing] = useState(false);
  const lines: [string, string][] = [
    [t("Process"), connectionProcessName(row) || connection.processInfo?.processPath || "—"],
    [t("Target"), connection.destination || "—"],
    [t("Domain"), connection.domain || "—"],
    [t("Source"), connection.source || "—"],
    [t("Inbound"), `${connection.inbound} (${connection.inboundType})`],
    [t("Network"), connection.network.toUpperCase()],
    [t("Protocol"), connection.protocol || "—"],
    [t("Rule"), connection.rule || "—"],
    [t("Outbound chain"), connectionChain(row) || "—"],
    [t("Start time"), new Date(Number(connection.createdAt)).toLocaleString()],
    [t("Duration"), formatDurationMs(Math.max(0, props.now - Number(connection.createdAt)))],
    [t("Downloaded"), formatBytes(row.downlinkTotal)],
    [t("Uploaded"), formatBytes(row.uplinkTotal)],
  ];
  return (
    <FcSheet
      title={t("Connection details")}
      subtitle={connectionHost(row)}
      onClose={props.onClose}
      footer={
        <FcButton
          variant="danger"
          disabled={closing}
          onClick={() => {
            setClosing(true);
            api
              .closeConnection(connection.id)
              .then(() => props.onClose())
              .catch((error: unknown) => {
                showError(error);
                setClosing(false);
              });
          }}
        >
          {closing ? t("Closing…") : t("Close connection")}
        </FcButton>
      }
    >
      <div className={styles.detailList}>
        {lines.map(([label, value]) => (
          <div key={label} className={styles.detailRow}>
            <span className={styles.detailLabel}>{label}</span>
            <span className={styles.detailValue}>{value}</span>
          </div>
        ))}
      </div>
    </FcSheet>
  );
}

/* ── requests ─────────────────────────────────────────────── */

export function RequestsView() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const now = useNow(1000);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const entries = useMemo(() => {
    const ledger = buildRequestLedger(connections.data.rows.values(), now);
    if (query === "") {
      return ledger;
    }
    return ledger.filter((entry) =>
      entry.host.toLowerCase().includes(query) ||
      entry.chain.toLowerCase().includes(query) ||
      entry.rule.toLowerCase().includes(query) ||
      entry.inbound.toLowerCase().includes(query),
    );
  }, [connections.data.rows, now, query]);

  const columns: FcColumn<(typeof entries)[number]>[] = [
    {
      key: "time",
      label: t("Time"),
      width: 80,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "source",
      label: t("Source"),
      width: 140,
      hideBelow: 1000,
      render: (entry) => <span className={styles.muted}>{entry.inbound || "—"}</span>,
    },
    {
      key: "target",
      label: t("Target"),
      flex: 1.3,
      render: (entry) => <span title={entry.host}>{entry.host || "—"}</span>,
    },
    {
      key: "rule",
      label: t("Rule"),
      flex: 1,
      render: (entry) => <span className={styles.muted}>{entry.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: t("Outbound"),
      width: 110,
      render: (entry) => (
        <span className={styles.truncate} title={entry.chain}>
          {entry.chain || "—"}
        </span>
      ),
    },
    {
      key: "traffic",
      label: t("Traffic"),
      width: 88,
      align: "end",
      render: (entry) => formatBytes(entry.downloadTotal + entry.uploadTotal),
    },
  ];

  return (
    <div className="fc-page">
      <Toolbar
        title={t("Recent requests")}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t("Search requests")}
      />
      <div className={styles.banner}>
        {t(
          "Requests are derived from live connection events; the core keeps no request history, so entries disappear after a restart.",
        )}
      </div>
      <FcCard className={styles.tableCard}>
        <FcRecordTable
          columns={columns}
          rows={entries}
          getKey={(entry) => entry.id}
          emptyLabel={connections.data.loaded ? t("No data") : t("Loading…")}
          maxRows={400}
        />
      </FcCard>
    </div>
  );
}
