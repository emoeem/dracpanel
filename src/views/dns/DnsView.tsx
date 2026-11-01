import { useCallback, useEffect, useMemo, useState } from "react";

import { flushDnsCache, flushFakeIpCache, queryDns } from "../../api/clash";
import { formatBytes } from "../../api/format";
import {
  applyPanelConfig,
  getDnsConfig,
  getDnsProbe,
  getDnsQueries,
  getPanelConfig,
  hasPanelToken,
  validatePanelConfig,
  type PanelDnsConfig,
  type PanelDnsProbeResult,
  type PanelDnsQueryEntry,
} from "../../api/panel";
import { afterConfigChange } from "../../app/configResync";
import { navigate, useApi } from "../../app/context";
import { showError } from "../../app/errorStore";
import { Icon } from "../../components/Icon";
import {
  FcButton,
  FcCard,
  FcCardHeader,
  FcField,
  FcSegmented,
  FcSwitch,
  FcTabs,
} from "../../components/flclash";
import { patchConfigText } from "../../lib/configPatch";
import { cx } from "../../lib/cx";
import {
  breakdownStatus,
  failureRate,
  groupByUpstream,
  rankQueries,
  summarizeLatency,
  type DnsQueryRecord,
} from "../../lib/dnsStats";
import { recordDnsQuery } from "../../lib/flclash/dnsLedger";
import styles from "./DnsView.module.css";

type DnsTab = "stats" | "queries" | "cache" | "lookup";

const TABS = [
  { value: "stats", label: "统计" },
  { value: "queries", label: "解析记录" },
  { value: "cache", label: "缓存" },
  { value: "lookup", label: "查询" },
] as const;

function toRecord(entry: PanelDnsQueryEntry): DnsQueryRecord {
  return {
    at: entry.at,
    domain: entry.domain,
    type: entry.type,
    client: entry.client,
    upstream: entry.upstream,
    status: entry.status,
    elapsedMs: entry.elapsed_ms,
  };
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

const STATUS_LABEL: Record<string, string> = {
  ok: "上游应答",
  nxdomain: "查无此名",
  failed: "失败",
};

/* ── stats tab ────────────────────────────────────────────── */

/** One horizontal latency strip per upstream, log axis shared across rows. */
function LatencyStrips(props: { rows: ReturnType<typeof groupByUpstream> }) {
  const maxValue = useMemo(() => {
    let max = 100;
    for (const row of props.rows) {
      for (const point of row.points) {
        max = Math.max(max, point.elapsedMs);
      }
    }
    return Math.max(1000, Math.ceil(max / 100) * 100);
  }, [props.rows]);
  const left = (value: number) => `${(Math.log10(Math.max(1, value)) / Math.log10(maxValue)) * 100}%`;
  const ticks = [1, 10, 100, 1000].filter((tick) => tick <= maxValue);

  return (
    <div className={styles.strips}>
      <div className={styles.stripTicks}>
        {ticks.map((tick) => (
          <span key={tick} style={{ left: left(tick) }}>
            {tick} ms
          </span>
        ))}
      </div>
      {props.rows.map((row) => (
        <div key={row.upstream} className={styles.stripRow}>
          <div className={styles.stripHead}>
            <span className={styles.stripName} title={row.upstream}>
              {row.upstream}
            </span>
            <span className={styles.stripMeta}>
              {row.count} 条{row.median !== null ? ` · 中位数 ${Math.round(row.median)} ms` : ""}
            </span>
          </div>
          <div className={styles.stripTrack}>
            {ticks.map((tick) => (
              <span key={tick} className={styles.stripGrid} style={{ left: left(tick) }} />
            ))}
            {row.points.map((point, index) => (
              <span
                key={`${point.at}-${index}`}
                className={cx(
                  styles.stripDot,
                  point.status === "nxdomain" && styles.dotNx,
                  point.status === "failed" && styles.dotFailed,
                )}
                style={{ left: left(point.elapsedMs) }}
                title={`${point.elapsedMs} ms · ${STATUS_LABEL[point.status] ?? point.status}`}
              />
            ))}
          </div>
        </div>
      ))}
      {props.rows.length === 0 && (
        <div className={styles.empty}>没有带上游信息的记录；上游延迟需要 debug 级 DNS 日志</div>
      )}
    </div>
  );
}

function StatsTab(props: {
  records: readonly DnsQueryRecord[];
  probes: readonly PanelDnsProbeResult[];
  probing: boolean;
  onProbe: () => void;
  note: string;
  debugLogging: boolean;
}) {
  const latency = useMemo(() => summarizeLatency(props.records), [props.records]);
  const breakdown = useMemo(() => breakdownStatus(props.records), [props.records]);
  const [rankKey, setRankKey] = useState<"domain" | "client">("domain");
  const ranking = useMemo(() => rankQueries(props.records, rankKey, 8), [props.records, rankKey]);
  const upstreams = useMemo(() => groupByUpstream(props.records), [props.records]);
  const hasClient = props.records.some((record) => (record.client ?? "").trim() !== "");

  const cards = [
    { label: "中位数", value: ms(latency.median), hint: `${latency.count} 条带耗时记录` },
    { label: "P95", value: ms(latency.p95), hint: "慢查询上限" },
    {
      label: "缓存命中率（估算）",
      value: pct(breakdown.cacheRate),
      hint: "无上游归属的应答，仅供估算",
    },
    {
      label: "失败率",
      value: pct(failureRate(breakdown)),
      hint: `${breakdown.failed} / ${breakdown.total} 条`,
    },
  ];

  const mix = [
    { key: "cache", label: "缓存命中（估算）", count: breakdown.cacheHit, tone: styles.swCache },
    { key: "answered", label: "上游应答", count: breakdown.answered, tone: styles.swAnswered },
    { key: "nxdomain", label: "查无此名", count: breakdown.nxdomain, tone: styles.swNx },
    { key: "failed", label: "失败", count: breakdown.failed, tone: styles.swFailed },
  ];
  const totalCells = Math.max(1, Math.min(240, breakdown.total));
  const cells: string[] = [];
  for (const entry of mix) {
    const share = breakdown.total === 0 ? 0 : entry.count / breakdown.total;
    const count = Math.round(share * totalCells);
    for (let index = 0; index < count; index += 1) {
      cells.push(entry.tone);
    }
  }

  return (
    <div className={styles.tabBody}>
      {props.note !== "" && <div className={styles.banner}>{props.note}</div>}
      <div className={styles.statGrid}>
        {cards.map((card) => (
          <FcCard key={card.label} className={styles.statCard}>
            <span className={styles.statLabel}>{card.label}</span>
            <span className={styles.statValue}>{card.value}</span>
            <span className={styles.statHint}>{card.hint}</span>
          </FcCard>
        ))}
      </div>

      <FcCard>
        <FcCardHeader
          title="上游查询延迟"
          subtitle={`${breakdown.total} 条记录 · 纵轴为日志时间顺序，横轴为对数耗时`}
          actions={
            <FcButton size="small" disabled={props.probing} onClick={props.onProbe}>
              {props.probing ? "探测中…" : "探测上游"}
            </FcButton>
          }
        />
        <div className={styles.cardBody}>
          <LatencyStrips rows={upstreams} />
          {props.probes.length > 0 && (
            <div className={styles.probeList}>
              {props.probes.map((probe) => (
                <span
                  key={`${probe.tag}-${probe.server}`}
                  className={cx(styles.probeChip, !probe.ok && styles.probeChipFail)}
                  title={probe.error !== undefined && probe.error !== "" ? probe.error : probe.server}
                >
                  {probe.tag} · {probe.ok ? `${probe.elapsed_ms} ms` : "失败"}
                </span>
              ))}
            </div>
          )}
        </div>
      </FcCard>

      <div className={styles.twoUp}>
        <FcCard>
          <FcCardHeader title="响应结果" subtitle="按条数统计；缓存命中为估算值" />
          <div className={styles.cardBody}>
            <div className={styles.waffle} aria-hidden="true">
              {cells.map((tone, index) => (
                <span key={index} className={cx(styles.waffleCell, tone)} />
              ))}
            </div>
            <div className={styles.legend}>
              {mix.map((entry) => (
                <span key={entry.key} className={styles.legendItem}>
                  <span className={cx(styles.legendDot, entry.tone)} />
                  {entry.label}
                  <span className={styles.legendCount}>
                    {entry.count}
                    {breakdown.total > 0 ? ` (${Math.round((entry.count / breakdown.total) * 100)}%)` : ""}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader
            title="查询排行"
            actions={
              <FcSegmented
                ariaLabel="排行维度"
                value={rankKey}
                onChange={(value: string) => setRankKey(value as "domain" | "client")}
                options={[
                  { value: "domain", label: "域名" },
                  { value: "client", label: "设备", disabled: !hasClient },
                ]}
              />
            }
          />
          <div className={styles.cardBody}>
            {ranking.length === 0 ? (
              <div className={styles.empty}>暂无数据</div>
            ) : (
              <div className={styles.rankList}>
                {ranking.map((row) => (
                  <div key={row.key} className={styles.rankRow}>
                    <span className={styles.rankName} title={row.key}>
                      {row.key}
                    </span>
                    <span
                      className={styles.rankBar}
                      style={{ width: `${(row.count / (ranking[0]?.count ?? 1)) * 100}%` }}
                    />
                    <span className={styles.rankCount}>{row.count} 条</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FcCard>
      </div>

      {!props.debugLogging && (
        <p className={styles.hint}>
          统计依赖 debug 级 DNS 日志。到「解析记录」标签开启采集，或使用「探测上游」直接测量上游延迟。
        </p>
      )}
    </div>
  );
}

/* ── queries tab ──────────────────────────────────────────── */

function QueriesTab(props: {
  config: PanelDnsConfig | null;
  records: readonly DnsQueryRecord[];
  note: string;
  busy: boolean;
  onToggleCollection: (enabled: boolean) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const debug = props.config?.debug_logging === true;
  const level = props.config?.log_level ?? "";

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === "") {
      return props.records;
    }
    return props.records.filter(
      (record) =>
        record.domain.toLowerCase().includes(query) ||
        (record.type ?? "").toLowerCase().includes(query) ||
        (record.client ?? "").toLowerCase().includes(query) ||
        (record.upstream ?? "").toLowerCase().includes(query),
    );
  }, [props.records, search]);

  return (
    <div className={styles.tabBody}>
      <FcCard>
        <FcCardHeader
          title="DNS 记录采集"
          subtitle={
            debug
              ? `已开启（log.level=${level}）：核心会为每条查询写一行日志`
              : `未开启（log.level=${level === "" ? "未设置" : level}）：仅 debug 级别输出每条查询`
          }
          actions={
            <FcSwitch
              checked={debug}
              disabled={props.busy}
              label="开启 DNS 记录采集"
              onChange={props.onToggleCollection}
            />
          }
        />
        <div className={styles.cardBody}>
          <p className={styles.hint}>
            开启会把 log.level 改为 debug，日志量与磁盘占用明显增加；排查完建议切回 info。
            记录来自面板读取系统日志，核心本身不保留历史。
          </p>
        </div>
      </FcCard>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input
            value={search}
            placeholder="搜索域名 / 类型 / 设备 / 上游"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <FcButton size="small" disabled={props.loading} onClick={props.onRefresh}>
          {props.loading ? "刷新中…" : "刷新"}
        </FcButton>
      </div>

      {props.note !== "" && <div className={styles.banner}>{props.note}</div>}

      <FcCard className={styles.tableCard}>
        <div className={styles.recordTable} role="table">
          <div className={cx(styles.recordRow, styles.recordHead)} role="row">
            <span role="columnheader">时间</span>
            <span role="columnheader">域名</span>
            <span role="columnheader">类型</span>
            <span role="columnheader">设备</span>
            <span role="columnheader">上游</span>
            <span role="columnheader">结果</span>
            <span role="columnheader">耗时</span>
          </div>
          {shown.slice(0, 300).map((record, index) => (
            <div
              key={`${record.at}-${record.domain}-${index}`}
              className={styles.recordRow}
              role="row"
            >
              <span className={styles.recordTime} role="cell">
                {record.at > 0 ? new Date(record.at).toLocaleTimeString() : "—"}
              </span>
              <span className={styles.recordHost} title={record.domain} role="cell">
                {record.domain}
              </span>
              <span role="cell">{record.type ?? "—"}</span>
              <span className={styles.muted} role="cell">
                {record.client !== undefined && record.client !== "" ? record.client : "—"}
              </span>
              <span className={styles.muted} role="cell">
                {record.upstream !== undefined && record.upstream !== "" ? record.upstream : "—"}
              </span>
              <span
                className={cx(
                  record.status === "failed" && styles.badText,
                  record.status === "nxdomain" && styles.warnText,
                )}
                role="cell"
              >
                {STATUS_LABEL[record.status] ?? record.status}
              </span>
              <span className={styles.recordBytes} role="cell">
                {record.elapsedMs !== undefined && record.elapsedMs > 0 ? `${record.elapsedMs} ms` : "—"}
              </span>
            </div>
          ))}
          {shown.length === 0 && (
            <div className={styles.empty}>{props.loading ? "加载中…" : "暂无记录"}</div>
          )}
        </div>
      </FcCard>
    </div>
  );
}

/* ── cache tab ────────────────────────────────────────────── */

function CacheTab(props: { config: PanelDnsConfig | null; onFlush: (kind: "dns" | "fakeip") => void; flushing: string }) {
  const file = props.config?.cache_file;
  const cache = props.config?.cache ?? {};
  const rows: [string, string][] = [
    ["DNS 缓存开关", props.config?.cache_enabled === true ? "已开启（dns.cache_enabled）" : "未开启"],
    [
      "缓存文件",
      file?.enabled === true
        ? `${file.path ?? "—"}${file.size !== undefined ? ` · ${formatBytes(file.size)}` : ""}`
        : "未启用 experimental.cache_file",
    ],
    [
      "缓存文件更新",
      file?.mtime !== undefined && file.mtime > 0
        ? new Date(file.mtime * 1000).toLocaleString()
        : "—",
    ],
    ["缓存配置项", Object.keys(cache).length > 0 ? Object.keys(cache).join("、") : "—"],
  ];

  return (
    <div className={styles.tabBody}>
      <div className={styles.twoUp}>
        <FcCard>
          <FcCardHeader title="缓存状态" subtitle="来自当前配置与缓存文件" />
          <div className={styles.cardBody}>
            <div className={styles.detailList}>
              {rows.map(([label, value]) => (
                <div key={label} className={styles.detailRow}>
                  <span className={styles.detailLabel}>{label}</span>
                  <span className={styles.detailValue}>{value}</span>
                </div>
              ))}
            </div>
            <div className={styles.buttonRow}>
              <FcButton
                variant="danger"
                size="small"
                disabled={props.flushing !== ""}
                onClick={() => props.onFlush("dns")}
              >
                {props.flushing === "dns" ? "清除中…" : "清除 DNS 缓存"}
              </FcButton>
              <FcButton
                size="small"
                disabled={props.flushing !== ""}
                onClick={() => props.onFlush("fakeip")}
              >
                {props.flushing === "fakeip" ? "清除中…" : "清除 FakeIP 缓存"}
              </FcButton>
            </div>
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader title="缓存条目" subtitle="sing-box 不提供缓存内容接口" />
          <div className={styles.cardBody}>
            <div className={styles.empty}>
              核心只暴露「清空」，无法列出缓存条目或其 TTL；此处如实标注而不伪造数据。
              需要条目级排查时请开启 debug 日志，在「解析记录」中查看实际查询。
            </div>
          </div>
        </FcCard>
      </div>
    </div>
  );
}

/* ── lookup tab ───────────────────────────────────────────── */

function LookupTab() {
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
    <div className={styles.tabBody}>
      <FcCard>
        <FcCardHeader title="DNS 查询" subtitle="经核心的 Clash API 发起，使用当前 DNS 配置" />
        <div className={styles.cardBody}>
          <FcField label="域名">
            <input
              className="input"
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
          </FcField>
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
          <div className={styles.buttonRow}>
            <FcButton variant="primary" disabled={busy || name.trim() === ""} onClick={() => void run()}>
              {busy ? "查询中…" : "查询"}
            </FcButton>
          </div>
          {answer !== null && <pre className={styles.answer}>{answer}</pre>}
        </div>
      </FcCard>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────── */

export function DnsView() {
  const api = useApi();
  const [tab, setTab] = useState<DnsTab>("stats");
  const [config, setConfig] = useState<PanelDnsConfig | null>(null);
  const [records, setRecords] = useState<DnsQueryRecord[]>([]);
  const [note, setNote] = useState("");
  const [probes, setProbes] = useState<PanelDnsProbeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flushing, setFlushing] = useState("");

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [dnsConfig, queries] = await Promise.all([getDnsConfig(), getDnsQueries(60, 500)]);
      setConfig(dnsConfig);
      setRecords(queries.entries.map(toRecord));
      setNote(queries.note ?? "");
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await getDnsProbe(true);
      setProbes(result.servers);
      if (!result.ok && result.message !== undefined) {
        throw new Error(result.message);
      }
    } catch (error) {
      showError(error);
    } finally {
      setProbing(false);
    }
  }, []);

  /** Writes log.level through the standard config transaction. */
  const toggleCollection = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        const current = await getPanelConfig();
        if (!current.ok) {
          throw new Error("读取配置失败");
        }
        const text = patchConfigText(current.text, ["log", "level"], enabled ? "debug" : "info");
        const validation = await validatePanelConfig(text);
        if (!validation.ok) {
          throw new Error(validation.message || "配置校验失败，未应用");
        }
        const result = await applyPanelConfig(text, current.mtime);
        if (!result.ok) {
          throw new Error(result.message || "写入失败");
        }
        await afterConfigChange(api);
        await load();
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    },
    [api, load],
  );

  const flush = useCallback(async (kind: "dns" | "fakeip") => {
    setFlushing(kind);
    try {
      if (kind === "dns") {
        await flushDnsCache();
      } else {
        await flushFakeIpCache();
      }
    } catch (error) {
      showError(error);
    } finally {
      setFlushing("");
    }
  }, []);

  const openConfig = () => {
    try {
      localStorage.setItem("panel_manage_tab", "config");
    } catch {
      // Private mode: the tab falls back to its default.
    }
    navigate("tools/config");
  };

  if (!hasPanelToken()) {
    return (
      <div className="fc-page">
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>DNS</h1>
        </div>
        <div className={styles.empty}>DNS 统计需要面板后端；直接模式下不可用。</div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <div className={styles.pageHeader}>
        <div className={styles.pageTitles}>
          <h1 className={styles.pageTitle}>DNS</h1>
          <span className={styles.pageSubtitle}>域名解析与缓存内容</span>
        </div>
        <FcButton size="small" onClick={openConfig}>
          打开 DNS 配置
        </FcButton>
      </div>
      <div className="fc-page-body">
        <FcTabs
          className={styles.tabs}
          ariaLabel="DNS 视图"
          value={tab}
          onChange={setTab}
          tabs={[...TABS]}
        />
        {loading && records.length === 0 ? (
          <div className={styles.empty}>加载中…</div>
        ) : (
          <>
            {tab === "stats" && (
              <StatsTab
                records={records}
                probes={probes}
                probing={probing}
                onProbe={() => void probe()}
                note={note}
                debugLogging={config?.debug_logging === true}
              />
            )}
            {tab === "queries" && (
              <QueriesTab
                config={config}
                records={records}
                note={note}
                busy={busy}
                loading={loading}
                onToggleCollection={(enabled) => void toggleCollection(enabled)}
                onRefresh={() => void load()}
              />
            )}
            {tab === "cache" && (
              <CacheTab config={config} flushing={flushing} onFlush={(kind) => void flush(kind)} />
            )}
            {tab === "lookup" && <LookupTab />}
          </>
        )}
      </div>
    </div>
  );
}
