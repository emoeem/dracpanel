import { useMemo, useState, type ReactNode } from "react";

import { formatBytes, formatDurationMs } from "../../api/format";
import { flushDnsCache, queryDns } from "../../api/clash";
import type { ConnectionRow } from "../../api/daemon";
import { useStream } from "../../api/stream";
import { useApi, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { Icon } from "../../components/Icon";
import {
  FcAvatar,
  FcButton,
  FcCard,
  FcIconButton,
  FcRecordTable,
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
import { recordDnsQuery, useDnsLedger } from "../../lib/flclash/dnsLedger";
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
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input
            value={props.search}
            placeholder={props.searchPlaceholder}
            onChange={(event) => props.onSearch(event.target.value)}
          />
        </label>
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

const GROUP_LABELS: { value: ConnectionGroupKey; label: string }[] = [
  { value: "none", label: "不分组" },
  { value: "host", label: "按主机" },
  { value: "process", label: "按进程" },
  { value: "outbound", label: "按出口" },
  { value: "rule", label: "按规则" },
  { value: "source", label: "按设备" },
];

const SORT_LABELS: { value: ConnectionSortKey; label: string }[] = [
  { value: "date", label: "开始时间" },
  { value: "host", label: "主机" },
  { value: "process", label: "进程" },
  { value: "outbound", label: "出口" },
  { value: "rule", label: "规则" },
  { value: "download", label: "下载量" },
  { value: "upload", label: "上传量" },
  { value: "total", label: "总流量" },
  { value: "rate", label: "当前速率" },
];

export function ConnectionsView() {
  const api = useApi();
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
        label: "进程",
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
        label: "目标",
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
        label: "协议",
        width: 60,
        render: (row) => row.connection.network.toUpperCase() || "—",
      },
      {
        key: "rule",
        label: "规则",
        flex: 0.9,
        hideBelow: 1000,
        sortable: true,
        render: (row) => <span className={styles.muted}>{row.connection.rule || "—"}</span>,
      },
      {
        key: "outbound",
        label: "出口",
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
        label: "下载速度",
        width: 88,
        align: "end",
        sortable: true,
        render: (row) => formatRate(row.downlinkRate),
      },
      {
        key: "uploadRate",
        label: "上传速度",
        width: 88,
        align: "end",
        sortable: true,
        render: (row) => formatRate(row.uplinkRate),
      },
      {
        key: "downloadTotal",
        label: "下载总量",
        width: 84,
        align: "end",
        hideBelow: 1200,
        sortable: true,
        render: (row) => formatBytes(row.downlinkTotal),
      },
      {
        key: "uploadTotal",
        label: "上传总量",
        width: 84,
        align: "end",
        hideBelow: 1200,
        sortable: true,
        render: (row) => formatBytes(row.uplinkTotal),
      },
      {
        key: "duration",
        label: "时长",
        width: 72,
        align: "end",
        render: (row) => formatDurationMs(Math.max(0, now - Number(row.connection.createdAt))),
      },
    ],
    [now],
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
        title="连接"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="搜索连接"
        actions={
          <>
            <FcSegmented
              ariaLabel="连接视图"
              value={tab}
              onChange={(value: string) => setTab(value as "traffic" | "list")}
              options={[
                { value: "traffic", label: "流量" },
                { value: "list", label: "列表" },
              ]}
            />
            <FcIconButton label="关闭全部连接" disabled={closingAll || rows.length === 0} onClick={() => void closeAll()}>
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
              ariaLabel="连接状态"
              value={stateFilter}
              onChange={(value: string) => changeStateFilter(value as ConnectionStateFilter)}
              options={[
                { value: "active", label: "活动" },
                { value: "closed", label: "已关闭" },
                { value: "all", label: "全部" },
              ]}
            />
            <FcSegmented
              ariaLabel="网络类型"
              value={network}
              onChange={(value: string) => changeNetwork(value as ConnectionNetworkFilter)}
              options={[
                { value: "all", label: "全部" },
                { value: "tcp", label: "TCP" },
                { value: "udp", label: "UDP" },
              ]}
            />
            <label className={styles.filterField}>
              <span>分组</span>
              <select value={groupBy} onChange={(event) => changeGroupBy(event.target.value)}>
                {GROUP_LABELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>排序</span>
              <select value={sortKey} onChange={(event) => changeSortKey(event.target.value)}>
                {SORT_LABELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <FcIconButton
              label={sortDirection === "asc" ? "升序" : "降序"}
              onClick={changeSortDirection}
            >
              <span className={cx(styles.sortDirIcon, sortDirection === "asc" && styles.sortDirAsc)}>
                <Icon name="arrow_downward" size={16} />
              </span>
            </FcIconButton>
            <span className={styles.filterSpacer} />
            <FcButton size="small" onClick={() => exportRows("csv")}>
              导出 CSV
            </FcButton>
            <FcButton size="small" onClick={() => exportRows("json")}>
              导出 JSON
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
                emptyLabel={connections.data.loaded ? "暂无数据" : "加载中…"}
                maxRows={300}
              />
            </FcCard>
          ) : (
            <FcCard className={styles.tableCard}>
              {listGroups.length === 0 ? (
                <div className={styles.empty}>
                  {connections.data.loaded ? "暂无数据" : "加载中…"}
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
                        {group.rows.length} 条 · ↓{formatBytes(group.downlink)} ↑
                        {formatBytes(group.uplink)}
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
  const row = props.row;
  const connection = row.connection;
  const [closing, setClosing] = useState(false);
  const lines: [string, string][] = [
    ["进程", connectionProcessName(row) || connection.processInfo?.processPath || "—"],
    ["目标", connection.destination || "—"],
    ["域名", connection.domain || "—"],
    ["来源", connection.source || "—"],
    ["入站", `${connection.inbound} (${connection.inboundType})`],
    ["网络", connection.network.toUpperCase()],
    ["协议", connection.protocol || "—"],
    ["规则", connection.rule || "—"],
    ["出口链", connectionChain(row) || "—"],
    ["开始时间", new Date(Number(connection.createdAt)).toLocaleString()],
    ["时长", formatDurationMs(Math.max(0, props.now - Number(connection.createdAt)))],
    ["下载总量", formatBytes(row.downlinkTotal)],
    ["上传总量", formatBytes(row.uplinkTotal)],
  ];
  return (
    <FcSheet
      title="连接详情"
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
          {closing ? "关闭中…" : "关闭连接"}
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
      label: "时间",
      width: 80,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "source",
      label: "来源",
      width: 140,
      hideBelow: 1000,
      render: (entry) => <span className={styles.muted}>{entry.inbound || "—"}</span>,
    },
    {
      key: "target",
      label: "目标",
      flex: 1.3,
      render: (entry) => <span title={entry.host}>{entry.host || "—"}</span>,
    },
    {
      key: "rule",
      label: "规则",
      flex: 1,
      render: (entry) => <span className={styles.muted}>{entry.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: "出口",
      width: 110,
      render: (entry) => (
        <span className={styles.truncate} title={entry.chain}>
          {entry.chain || "—"}
        </span>
      ),
    },
    {
      key: "traffic",
      label: "流量",
      width: 88,
      align: "end",
      render: (entry) => formatBytes(entry.downloadTotal + entry.uploadTotal),
    },
  ];

  return (
    <div className="fc-page">
      <Toolbar
        title="最近请求"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="搜索请求"
      />
      <div className={styles.banner}>
        请求列表由实时连接事件派生，核心不保留历史请求日志；重启后条目会消失。
      </div>
      <FcCard className={styles.tableCard}>
        <FcRecordTable
          columns={columns}
          rows={entries}
          getKey={(entry) => entry.id}
          emptyLabel={connections.data.loaded ? "暂无数据" : "加载中…"}
          maxRows={400}
        />
      </FcCard>
    </div>
  );
}

/* ── dns ──────────────────────────────────────────────────── */

export function DnsView() {
  const ledger = useDnsLedger();
  const [search, setSearch] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const query = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      query === ""
        ? ledger
        : ledger.filter(
            (entry) =>
              entry.name.toLowerCase().includes(query) ||
              entry.type.toLowerCase().includes(query) ||
              entry.result.toLowerCase().includes(query),
          ),
    [ledger, query],
  );

  const columns: FcColumn<(typeof rows)[number]>[] = [
    {
      key: "time",
      label: "时间",
      width: 80,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "name",
      label: "域名",
      flex: 1.3,
      render: (entry) => <span title={entry.name}>{entry.name}</span>,
    },
    {
      key: "type",
      label: "类型",
      width: 72,
      render: (entry) => entry.type,
    },
    {
      key: "source",
      label: "发起",
      width: 90,
      hideBelow: 1000,
      render: (entry) => <span className={styles.muted}>{entry.source || "面板"}</span>,
    },
    {
      key: "result",
      label: "结果",
      flex: 1,
      render: (entry) => (
        <span className={entry.ok ? styles.goodText : styles.badText}>{entry.result || "—"}</span>
      ),
    },
    {
      key: "elapsed",
      label: "耗时",
      width: 72,
      align: "end",
      render: (entry) => `${entry.elapsedMs} ms`,
    },
  ];

  return (
    <div className="fc-page">
      <Toolbar
        title="DNS查询"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="搜索查询"
        actions={
          <>
            <FcIconButton label="DNS 查询" onClick={() => setQueryOpen(true)}>
              <Icon name="dns" size={18} />
            </FcIconButton>
            <FcIconButton
              label="清除 DNS 缓存"
              disabled={flushing}
              onClick={() => {
                setFlushing(true);
                flushDnsCache()
                  .then(() => undefined)
                  .catch(showError)
                  .finally(() => setFlushing(false));
              }}
            >
              {flushing ? <span className={styles.spinner} /> : <Icon name="delete_sweep" size={18} />}
            </FcIconButton>
          </>
        }
      />
      <div className={styles.banner}>
        核心不提供 DNS 日志接口；此页记录本会话内通过面板发起的 DNS 查询。
      </div>
      <FcCard className={styles.tableCard}>
        <FcRecordTable
          columns={columns}
          rows={rows}
          getKey={(entry) => entry.id}
          emptyLabel="暂无数据"
          maxRows={200}
        />
      </FcCard>
      {queryOpen && <DnsQuerySheet onClose={() => setQueryOpen(false)} />}
    </div>
  );
}

function DnsQuerySheet(props: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("A");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const types = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "HTTPS", "SVCB"];

  const run = async () => {
    const host = name.trim();
    if (host === "") {
      return;
    }
    setBusy(true);
    setAnswer(null);
    const started = performance.now();
    try {
      const response = await queryDns(host, type);
      const elapsed = Math.round(performance.now() - started);
      const status = response.Status === 0 ? "NOERROR" : `STATUS ${response.Status ?? "?"}`;
      const records = (response.Answer ?? []).map((record) => record.data ?? "").filter(Boolean);
      recordDnsQuery({
        name: host,
        type,
        result: records.length > 0 ? records.slice(0, 2).join(", ") : status,
        elapsedMs: elapsed,
        source: "面板",
        ok: response.Status === 0,
      });
      setAnswer(records.length > 0 ? records.join("\n") : status);
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      recordDnsQuery({
        name: host,
        type,
        result: message,
        elapsedMs: elapsed,
        source: "面板",
        ok: false,
      });
      setAnswer(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FcSheet title="DNS 查询" onClose={props.onClose}>
      <label className={styles.field}>
        <span>域名</span>
        <input
          value={name}
          placeholder="example.com"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) {
              void run();
            }
          }}
        />
      </label>
      <div className={styles.typeRow}>
        {types.map((value) => (
          <button
            key={value}
            type="button"
            className={cx(styles.typeChip, type === value && styles.typeChipActive)}
            onClick={() => setType(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <FcButton variant="primary" disabled={busy || name.trim() === ""} onClick={() => void run()}>
        {busy ? "查询中…" : "查询"}
      </FcButton>
      {answer !== null && <pre className={styles.answer}>{answer}</pre>}
    </FcSheet>
  );
}
