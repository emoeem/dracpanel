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
import { useI18n, type MessageKey } from "../../app/i18n";
import {
  FcButton,
  FcCard,
  FcCardHeader,
  FcField,
  FcPageToolbar,
  FcSearchField,
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
  { value: "stats", label: "Stats" },
  { value: "queries", label: "Queries" },
  { value: "cache", label: "Cache" },
  { value: "lookup", label: "Query" },
] as const satisfies readonly { value: DnsTab; label: MessageKey }[];

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

const STATUS_KEYS: Record<string, MessageKey> = {
  ok: "Answered by upstream",
  nxdomain: "Name not found",
  failed: "Failed",
};

/** Status labels come from the message catalog; unknown statuses pass through. */
function statusLabel(status: string, t: (key: MessageKey) => string): string {
  const key = STATUS_KEYS[status];
  return key === undefined ? status : t(key);
}

/* ── stats tab ────────────────────────────────────────────── */

/** One horizontal latency strip per upstream, log axis shared across rows. */
function LatencyStrips(props: { rows: ReturnType<typeof groupByUpstream> }) {
  const { t } = useI18n();
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
              {row.median !== null
                ? t("{count} rows · median {median} ms", {
                    count: row.count,
                    median: Math.round(row.median),
                  })
                : t("{count} rows", { count: row.count })}
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
                title={`${point.elapsedMs} ms · ${statusLabel(point.status, t)}`}
              />
            ))}
          </div>
        </div>
      ))}
      {props.rows.length === 0 && (
        <div className={styles.empty}>
          {t("No records carry upstream information; upstream latency needs debug-level DNS logs")}
        </div>
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
  const { t } = useI18n();
  const latency = useMemo(() => summarizeLatency(props.records), [props.records]);
  const breakdown = useMemo(() => breakdownStatus(props.records), [props.records]);
  const [rankKey, setRankKey] = useState<"domain" | "client">("domain");
  const ranking = useMemo(() => rankQueries(props.records, rankKey, 8), [props.records, rankKey]);
  const upstreams = useMemo(() => groupByUpstream(props.records), [props.records]);
  const hasClient = props.records.some((record) => (record.client ?? "").trim() !== "");

  const cards = [
    {
      label: t("Median"),
      value: ms(latency.median),
      hint: t("{count} timed records", { count: latency.count }),
    },
    { label: "P95", value: ms(latency.p95), hint: t("Slow-query ceiling") },
    {
      label: t("Cache hit rate (estimated)"),
      value: pct(breakdown.cacheRate),
      hint: t("Answers without upstream attribution; estimate only"),
    },
    {
      label: t("Failure rate"),
      value: pct(failureRate(breakdown)),
      hint: t("{failed} / {total} rows", { failed: breakdown.failed, total: breakdown.total }),
    },
  ];

  const mix = [
    {
      key: "cache",
      label: t("Cache hit (estimated)"),
      count: breakdown.cacheHit,
      tone: styles.swCache,
    },
    {
      key: "answered",
      label: t("Answered by upstream"),
      count: breakdown.answered,
      tone: styles.swAnswered,
    },
    { key: "nxdomain", label: t("Name not found"), count: breakdown.nxdomain, tone: styles.swNx },
    { key: "failed", label: t("Failed"), count: breakdown.failed, tone: styles.swFailed },
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
          title={t("Upstream query latency")}
          subtitle={t(
            "{total} records · vertical axis is log order, horizontal axis is logarithmic latency",
            { total: breakdown.total },
          )}
          actions={
            <FcButton size="small" disabled={props.probing} onClick={props.onProbe}>
              {props.probing ? t("Probing…") : t("Probe upstream")}
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
                  {probe.tag} · {probe.ok ? `${probe.elapsed_ms} ms` : t("Failed")}
                </span>
              ))}
            </div>
          )}
        </div>
      </FcCard>

      <div className={styles.twoUp}>
        <FcCard>
          <FcCardHeader
            title={t("Response outcomes")}
            subtitle={t("Counted by rows; cache hits are an estimate")}
          />
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
            title={t("Query ranking")}
            actions={
              <FcSegmented
                ariaLabel={t("Ranking dimension")}
                value={rankKey}
                onChange={(value: string) => setRankKey(value as "domain" | "client")}
                options={[
                  { value: "domain", label: t("Domain") },
                  { value: "client", label: t("Device"), disabled: !hasClient },
                ]}
              />
            }
          />
          <div className={styles.cardBody}>
            {ranking.length === 0 ? (
              <div className={styles.empty}>{t("No data")}</div>
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
                    <span className={styles.rankCount}>
                      {t("{count} rows", { count: row.count })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FcCard>
      </div>

      {!props.debugLogging && (
        <p className={styles.hint}>
          {t(
            "Statistics rely on debug-level DNS logs. Enable collection on the “Queries” tab, or measure upstream latency directly with “Probe upstream”.",
          )}
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
  const { t } = useI18n();
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
          title={t("DNS record collection")}
          subtitle={
            debug
              ? t("Enabled (log.level={level}): the core writes one log line per query", { level })
              : t("Disabled (log.level={level}): only the debug level emits one line per query", {
                  level: level === "" ? t("Not set") : level,
                })
          }
          actions={
            <FcSwitch
              checked={debug}
              disabled={props.busy}
              label={t("Enable DNS record collection")}
              onChange={props.onToggleCollection}
            />
          }
        />
        <div className={styles.cardBody}>
          <p className={styles.hint}>
            {t(
              "Enabling switches log.level to debug, which noticeably increases log volume and disk usage; switch back to info after troubleshooting. Records come from the panel reading system logs; the core keeps no history.",
            )}
          </p>
        </div>
      </FcCard>

      <div className={styles.toolbar}>
        <FcSearchField
          value={search}
          onChange={setSearch}
          placeholder={t("Search domain / type / device / upstream")}
        />
        <FcButton size="small" disabled={props.loading} onClick={props.onRefresh}>
          {props.loading ? t("Refreshing…") : t("Refresh")}
        </FcButton>
      </div>

      {props.note !== "" && <div className={styles.banner}>{props.note}</div>}

      <FcCard className={styles.tableCard}>
        <div className={styles.recordTable} role="table">
          <div className={cx(styles.recordRow, styles.recordHead)} role="row">
            <span role="columnheader">{t("Time")}</span>
            <span role="columnheader">{t("Domain")}</span>
            <span role="columnheader">{t("Type")}</span>
            <span role="columnheader">{t("Device")}</span>
            <span role="columnheader">{t("Upstream")}</span>
            <span role="columnheader">{t("Result")}</span>
            <span role="columnheader">{t("Duration")}</span>
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
                {statusLabel(record.status, t)}
              </span>
              <span className={styles.recordBytes} role="cell">
                {record.elapsedMs !== undefined && record.elapsedMs > 0 ? `${record.elapsedMs} ms` : "—"}
              </span>
            </div>
          ))}
          {shown.length === 0 && (
            <div className={styles.empty}>{props.loading ? t("Loading…") : t("No records")}</div>
          )}
        </div>
      </FcCard>
    </div>
  );
}

/* ── cache tab ────────────────────────────────────────────── */

function CacheTab(props: { config: PanelDnsConfig | null; onFlush: (kind: "dns" | "fakeip") => void; flushing: string }) {
  const { t } = useI18n();
  const file = props.config?.cache_file;
  const cache = props.config?.cache ?? {};
  const rows: [string, string][] = [
    [
      t("DNS cache toggle"),
      props.config?.cache_enabled === true ? t("Enabled (dns.cache_enabled)") : t("Disabled"),
    ],
    [
      t("Cache file"),
      file?.enabled === true
        ? `${file.path ?? "—"}${file.size !== undefined ? ` · ${formatBytes(file.size)}` : ""}`
        : t("experimental.cache_file is not enabled"),
    ],
    [
      t("Cache file updated"),
      file?.mtime !== undefined && file.mtime > 0
        ? new Date(file.mtime * 1000).toLocaleString()
        : "—",
    ],
    [
      t("Cache options"),
      Object.keys(cache).length > 0 ? Object.keys(cache).join("、") : "—",
    ],
  ];

  return (
    <div className={styles.tabBody}>
      <div className={styles.twoUp}>
        <FcCard>
          <FcCardHeader title={t("Cache status")} subtitle={t("From the current config and cache file")} />
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
                {props.flushing === "dns" ? t("Clearing…") : t("Clear DNS cache")}
              </FcButton>
              <FcButton
                size="small"
                disabled={props.flushing !== ""}
                onClick={() => props.onFlush("fakeip")}
              >
                {props.flushing === "fakeip" ? t("Clearing…") : t("Clear FakeIP cache")}
              </FcButton>
            </div>
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader
            title={t("Cache entries")}
            subtitle={t("sing-box exposes no cache-content API")}
          />
          <div className={styles.cardBody}>
            <div className={styles.empty}>
              {t(
                "The core only exposes “flush”; entries and their TTL cannot be listed, so this is stated honestly instead of faking data. For entry-level troubleshooting, enable debug logs and check the actual queries under “Queries”.",
              )}
            </div>
          </div>
        </FcCard>
      </div>
    </div>
  );
}

/* ── lookup tab ───────────────────────────────────────────── */

function LookupTab() {
  const { t } = useI18n();
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
        source: t("Panel"),
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
        source: t("Panel"),
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
        <FcCardHeader
          title={t("DNS query")}
          subtitle={t("Issued through the core's Clash API using the current DNS config")}
        />
        <div className={styles.cardBody}>
          <FcField label={t("Domain")}>
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
              {busy ? t("Querying…") : t("Query")}
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
  const { t } = useI18n();
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
          throw new Error(t("Failed to read config"));
        }
        const text = patchConfigText(current.text, ["log", "level"], enabled ? "debug" : "info");
        const validation = await validatePanelConfig(text);
        if (!validation.ok) {
          throw new Error(validation.message || t("Config validation failed; nothing was applied"));
        }
        const result = await applyPanelConfig(text, current.mtime);
        if (!result.ok) {
          throw new Error(result.message || t("Write failed"));
        }
        await afterConfigChange(api);
        await load();
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    },
    [api, load, t],
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
        <FcPageToolbar title="DNS" />
        <div className="fc-page-body">
          <div className={styles.empty}>
            {t("DNS statistics require the panel backend; unavailable in direct mode.")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <FcPageToolbar
        title="DNS"
        subtitle={t("Domain resolution and cache contents")}
        actions={
          <FcButton size="small" variant="tonal" onClick={openConfig}>
            {t("Open DNS config")}
          </FcButton>
        }
      />
      <div className="fc-page-body">
        <FcTabs
          className={styles.tabs}
          ariaLabel={t("DNS view")}
          value={tab}
          onChange={setTab}
          tabs={TABS.map((tab) => ({ value: tab.value, label: t(tab.label) }))}
        />
        {loading && records.length === 0 ? (
          <div className={styles.empty}>{t("Loading…")}</div>
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
