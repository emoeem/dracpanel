import { useEffect, useState } from "react";

import { formatBytes } from "../../api/format";
import { hasPanelToken } from "../../api/panel";
import type { ConnectionRow } from "../../api/daemon";
import { useNow } from "../../app/context";
import type { PanelStateResult } from "../../app/usePanelState";
import { Icon } from "../../components/Icon";
import {
  FcCard,
  FcCardHeader,
  FcDonut,
  FcSkeleton,
  FcTimeChart,
} from "../../components/flclash";
import {
  fetchHistory,
  mergeOutboundTotals,
  useNotifications,
  useHistoryRangeData,
  useSessionOutboundTotals,
  useSessionRanking,
  type HistoryRange,
  type HistoryResult,
} from "./useObservability";
import { cx } from "../../lib/cx";
import styles from "./ObservabilityCards.module.css";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "10m", label: "10 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
];

const DONUT_COLORS = [
  "var(--fc-primary)",
  "var(--fc-series-2)",
  "var(--fc-info)",
  "var(--fc-warning)",
  "var(--fc-success)",
  "var(--fc-on-surface-faint)",
];

/** 流量卡：时间范围切换 + 双序列面积图 + 峰值/平均统计栏。 */
export function ObsTrafficCard({ panel }: { panel: PanelStateResult }) {
  const [range, setRange] = useState<HistoryRange>("10m");
  const history = useHistoryRangeData(range);
  return (
    <FcCard className={cx(styles.card, styles.traffic)}>
      <FcCardHeader
        title="流量"
        actions={
          <div className={styles.rangeTabs} role="tablist" aria-label="时间范围">
            {RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={range === item.value}
                className={cx(styles.rangeTab, range === item.value && styles.rangeTabActive)}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />
      <TrafficChartBody range={range} history={history} panel={panel} />
    </FcCard>
  );
}

function TrafficChartBody({
  range,
  history,
  panel,
}: {
  range: HistoryRange;
  history: HistoryResult | null;
  panel: PanelStateResult;
}) {
  if (!hasPanelToken()) {
    return (
      <div className={styles.hintBlock}>
        历史流量需要面板后端持久化；直接模式下仅仪表盘上方的实时速度可用。
      </div>
    );
  }
  if (history === null) {
    return (
      <div className={styles.chartSkeleton}>
        <FcSkeleton height={120} radius="var(--fc-radius-sm)" />
        <div className={styles.summarySkeleton}>
          <FcSkeleton width="40%" height={12} />
          <FcSkeleton width="40%" height={12} />
        </div>
      </div>
    );
  }
  const points = history.points;
  const down = points.map((point) => point.down);
  const up = points.map((point) => point.up);
  // Downsample labels to ~5 ticks.
  const labelCount = Math.min(5, Math.max(2, points.length));
  const labels = Array.from({ length: labelCount }, (_, index) => {
    const position = Math.round((index * (points.length - 1)) / Math.max(1, labelCount - 1));
    const point = points[position];
    return point ? timeLabel(point.t, range) : "";
  });
  const summary = history.summary;
  return (
    <div className={styles.trafficBody}>
      <FcTimeChart
        height={150}
        labels={labels}
        series={[
          { label: "下载", color: "var(--fc-info)", values: down },
          { label: "上传", color: "var(--fc-warning)", values: up },
        ]}
      />
      <div className={styles.summary}>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          下载峰值 <strong>{formatRate(summary.down_peak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          下载平均 <strong>{formatRate(summary.down_avg)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          上传峰值 <strong>{formatRate(summary.up_peak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          上传平均 <strong>{formatRate(summary.up_avg)}</strong>
        </span>
      </div>
      <div className={styles.legend}>
        <span>
          <i className={cx(styles.dot, styles.dotDown)} /> 下载
        </span>
        <span>
          <i className={cx(styles.dot, styles.dotUp)} /> 上传
        </span>
        <span className={styles.hint}>{rangeHint(range, panel)}</span>
      </div>
    </div>
  );
}

function rangeHint(range: HistoryRange, panel: PanelStateResult): string {
  if (range === "10m") {
    return "";
  }
  return panel.state ? "" : "数据来自面板后端";
}

function timeLabel(tUnix: number, range: HistoryRange): string {
  const date = new Date(tUnix * 1000);
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (range === "7d" || range === "24h") {
    return `${date.getMonth() + 1}/${date.getDate()} ${hhmm}`;
  }
  return hhmm;
}

function formatRate(bytesPerMinute: number): string {
  // Buckets hold per-minute byte totals; present them as an average rate.
  return `${formatBytes(bytesPerMinute / 60)}/s`;
}

/** 出站下载量环形图：持久化 7 天累计，回退会话累计。 */
export function ObsOutboundCard({
  connections,
}: {
  connections: { data: { rows: Map<string, ConnectionRow> } } | null;
}) {
  const session = useSessionOutboundTotals(connections);
  const [fetched, setFetched] = useState<HistoryResult | null>(null);
  const now = useNow(30_000);
  // Session fallback anchor: the first polled timestamp (stable per session).
  const mountedAt = now;

  useEffect(() => {
    if (!hasPanelToken()) {
      return;
    }
    let cancelled = false;
    fetchHistory("7d")
      .then((value) => {
        if (!cancelled) {
          setFetched(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetched(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { totals, persisted } = mergeOutboundTotals(fetched, session);
  const top = totals.slice(0, 5);
  const rest = totals.slice(5).reduce((sum, [, value]) => sum + value, 0);
  const slices = [
    ...top.map(([label, value], index) => ({
      label,
      value,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
    })),
    ...(rest > 0 ? [{ label: "其他", value: rest, color: DONUT_COLORS[5] }] : []),
  ];
  const totalBytes = totals.reduce((sum, [, value]) => sum + value, 0);
  const since = fetched?.since ? fetched.since * 1000 : mountedAt;

  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        title="出站下载量"
        subtitle={persisted ? `自 ${formatDate(since)}` : "本会话"}
      />
      {totals.length === 0 ? (
        <div className={styles.hintBlock}>暂无出站流量数据</div>
      ) : (
        <FcDonut
          slices={slices}
          centerLabel={formatBytes(totalBytes)}
          size={116}
        />
      )}
      <div className={styles.cardFoot}>{now && persisted ? "近 7 天累计" : "会话级累计，重启清零"}</div>
    </FcCard>
  );
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 流量排行：设备 / 域名 两个维度（会话级）。 */
export function ObsRankingCard({ rows }: { rows: readonly ConnectionRow[] }) {
  const [dimension, setDimension] = useState<"device" | "host">("device");
  const ranking = useSessionRanking(rows, dimension);
  const max = ranking.length > 0 ? ranking[0][1] : 0;
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        title="流量排行"
        actions={
          <div className={styles.rangeTabs} role="tablist" aria-label="排行维度">
            <button
              type="button"
              role="tab"
              aria-selected={dimension === "device"}
              className={cx(styles.rangeTab, dimension === "device" && styles.rangeTabActive)}
              onClick={() => setDimension("device")}
            >
              设备
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dimension === "host"}
              className={cx(styles.rangeTab, dimension === "host" && styles.rangeTabActive)}
              onClick={() => setDimension("host")}
            >
              域名
            </button>
          </div>
        }
      />
      {ranking.length === 0 ? (
        <div className={styles.hintBlock}>暂无数据</div>
      ) : (
        <ul className={styles.ranking}>
          {ranking.map(([label, value]) => (
            <li key={label}>
              <div className={styles.rankHead}>
                <span className={styles.rankLabel} title={label}>
                  {label}
                </span>
                <span className={styles.rankValue}>{formatBytes(value)}</span>
              </div>
              <div className={styles.rankBar}>
                <span
                  className={styles.rankFill}
                  style={{ width: `${max > 0 ? Math.max(3, (value / max) * 100) : 3}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.cardFoot}>会话级统计，来自实时连接事件</div>
    </FcCard>
  );
}

/** CPU 使用率卡（面板后端采样）。 */
export function ObsCpuCard({ panel }: { panel: PanelStateResult }) {
  const cpu = typeof panel.state?.cpu_percent === "number" ? panel.state.cpu_percent : null;
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="memory" size={14} />}
        title="CPU 使用率"
        subtitle={panel.state ? undefined : "需要面板后端"}
      />
      {cpu === null ? (
        <div className={styles.hintBlock}>直接模式下不可用</div>
      ) : (
        <>
          <div className={styles.cpuValue}>{cpu.toFixed(1)}%</div>
          <div className={styles.cpuBar}>
            <span className={styles.cpuFill} style={{ width: `${Math.min(100, cpu)}%` }} />
          </div>
        </>
      )}
    </FcCard>
  );
}

/** 通知与问题：面板事件流（配置/服务/订阅/导入）。 */
export function ObsNotificationsCard() {
  const items = useNotifications();
  return (
    <FcCard className={cx(styles.card, styles.notificationsCard)}>
      <FcCardHeader
        icon={<Icon name="notifications" size={14} />}
        title="通知与问题"
        actions={items.length > 0 ? <span className={styles.countChip}>{items.length}</span> : undefined}
      />
      {items.length === 0 ? (
        <div className={styles.hintBlock}>暂无事件</div>
      ) : (
        <ul className={styles.feed}>
          {items.slice(0, 5).map((item) => (
            <li key={`${item.t}-${item.title}`}>
              <span className={cx(styles.feedDot, item.ok ? styles.feedOk : styles.feedBad)} />
              <span className={styles.feedTitle}>
                {item.title}
                {item.detail ? <span className={styles.feedDetail}> · {item.detail}</span> : null}
              </span>
              <span className={styles.feedTime}>
                {new Date(item.t * 1000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FcCard>
  );
}
