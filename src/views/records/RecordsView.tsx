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
  FcSheet,
  type FcColumn,
} from "../../components/flclash";
import {
  connectionChain,
  connectionHost,
  connectionProcessName,
} from "../../lib/connectionTools";
import { recordDnsQuery, useDnsLedger } from "../../lib/flclash/dnsLedger";
import { formatRate } from "../../lib/flclash/format";
import { buildRequestLedger } from "../../lib/requestLedger";
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

export function ConnectionsView() {
  const api = useApi();
  const now = useNow(1000);
  const connections = useStream(api.connections);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ConnectionRow | null>(null);
  const [closingAll, setClosingAll] = useState(false);

  const query = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = [...connections.data.rows.values()].filter((row) => row.closedAt === null);
    const filtered =
      query === ""
        ? all
        : all.filter((row) => {
            const connection = row.connection;
            return (
              connectionHost(row).toLowerCase().includes(query) ||
              connection.destination.toLowerCase().includes(query) ||
              connection.source.toLowerCase().includes(query) ||
              connection.outbound.toLowerCase().includes(query) ||
              connection.rule.toLowerCase().includes(query) ||
              connectionProcessName(row).toLowerCase().includes(query)
            );
          });
    return filtered.sort(
      (left, right) => Number(right.connection.createdAt) - Number(left.connection.createdAt),
    );
  }, [connections.data.rows, query]);

  const columns: FcColumn<ConnectionRow>[] = useMemo(
    () => [
      {
        key: "process",
        label: "进程",
        width: 150,
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
        render: (row) => <span className={styles.muted}>{row.connection.rule || "—"}</span>,
      },
      {
        key: "outbound",
        label: "出口",
        width: 120,
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
        render: (row) => formatRate(row.downlinkRate),
      },
      {
        key: "uploadRate",
        label: "上传速度",
        width: 88,
        align: "end",
        render: (row) => formatRate(row.uplinkRate),
      },
      {
        key: "downloadTotal",
        label: "下载总量",
        width: 84,
        align: "end",
        hideBelow: 1200,
        render: (row) => formatBytes(row.downlinkTotal),
      },
      {
        key: "uploadTotal",
        label: "上传总量",
        width: 84,
        align: "end",
        hideBelow: 1200,
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
        title="实时连接"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="搜索连接"
        actions={
          <FcIconButton label="关闭全部连接" disabled={closingAll || rows.length === 0} onClick={() => void closeAll()}>
            {closingAll ? <span className={styles.spinner} /> : <Icon name="delete_sweep" size={18} />}
          </FcIconButton>
        }
      />
      <FcCard className={styles.tableCard}>
        <FcRecordTable
          columns={columns}
          rows={rows}
          getKey={(row) => row.connection.id}
          onRowClick={setDetail}
          emptyLabel={connections.data.loaded ? "暂无数据" : "加载中…"}
          maxRows={300}
        />
      </FcCard>
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
