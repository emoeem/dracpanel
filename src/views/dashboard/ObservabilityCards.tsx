import { useEffect, useState } from "react";

import { formatBytes } from "../../api/format";
import { hasPanelToken } from "../../api/panel";
import type { ConnectionRow } from "../../api/daemon";
import { useNow } from "../../app/context";
import { useI18n } from "../../app/i18n";
import type { MessageKey } from "../../app/translations";
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

type TrafficRange = HistoryRange | "live";

const RANGE_KEYS: { value: TrafficRange; label: MessageKey }[] = [
  { value: "live", label: "Realtime" },
  { value: "10m", label: "10 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

const DONUT_COLORS = [
  "var(--fc-primary)",
  "var(--fc-series-2)",
  "var(--fc-info)",
  "var(--fc-warning)",
  "var(--fc-success)",
  "var(--fc-on-surface-faint)",
];

/** 流量卡：时间范围切换（含实时）+ 双序列面积图 + 峰值/平均统计栏。 */
export function ObsTrafficCard({
  panel,
  live,
}: {
  panel: PanelStateResult;
  live?: { up: readonly number[]; down: readonly number[] };
}) {
  const { t } = useI18n();
  const [range, setRange] = useState<TrafficRange>("10m");
  // The realtime tab reads the live status stream; asking the backend for a
  // 10m history at the same time would be a wasted request every minute.
  const history = useHistoryRangeData(range === "live" ? "10m" : range, range !== "live");
  return (
    <FcCard className={cx(styles.card, styles.traffic)}>
      <FcCardHeader
        title={t("Traffic")}
        actions={
          <div className={styles.rangeTabs} role="tablist" aria-label={t("Time range")}>
            {RANGE_KEYS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={range === item.value}
                className={cx(styles.rangeTab, range === item.value && styles.rangeTabActive)}
                onClick={() => setRange(item.value)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        }
      />
      {range === "live" ? (
        <LiveChartBody live={live} />
      ) : (
        <TrafficChartBody range={range} history={history} panel={panel} />
      )}
    </FcCard>
  );
}

function LiveChartBody({ live }: { live?: { up: readonly number[]; down: readonly number[] } }) {
  const { t } = useI18n();
  if (!hasPanelToken() && live === undefined) {
    return <div className={styles.hintBlock}>{t("History needs the panel backend; direct mode only has the live speed above.")}</div>;
  }
  const down = live?.down ?? [];
  const up = live?.up ?? [];
  if (down.length < 2) {
    return <div className={styles.hintBlock}>{t("No samples yet")}</div>;
  }
  const labelCount = Math.min(5, down.length);
  const labels = Array.from({ length: labelCount }, (_, index) => {
    const secondsAgo = Math.round(((down.length - 1) * (labelCount - 1 - index)) / Math.max(1, labelCount - 1));
    return secondsAgo === 0 ? "0s" : `-${secondsAgo}s`;
  });
  const summary = summarize(down, up);
  return (
    <div className={styles.trafficBody}>
      <FcTimeChart
        height={150}
        labels={labels}
        series={[
          { label: t("Download"), color: "var(--fc-info)", values: [...down] },
          { label: t("Upload"), color: "var(--fc-warning)", values: [...up] },
        ]}
      />
      <div className={styles.summary}>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          {t("Download peak")} <strong>{formatRate(summary.downPeak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          {t("Download average")} <strong>{formatRate(summary.downAvg)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          {t("Upload peak")} <strong>{formatRate(summary.upPeak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          {t("Upload average")} <strong>{formatRate(summary.upAvg)}</strong>
        </span>
      </div>
      <div className={styles.legend}>
        <span>
          <i className={cx(styles.dot, styles.dotDown)} /> {t("Download")}
        </span>
        <span>
          <i className={cx(styles.dot, styles.dotUp)} /> {t("Upload")}
        </span>
        <span className={styles.hint}>{t("Last 30 seconds")}</span>
      </div>
    </div>
  );
}

function summarize(down: readonly number[], up: readonly number[]) {
  const peak = (values: readonly number[]) => (values.length === 0 ? 0 : Math.max(...values));
  const avg = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    downPeak: peak(down) * 60,
    downAvg: avg(down) * 60,
    upPeak: peak(up) * 60,
    upAvg: avg(up) * 60,
  };
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
  const { t } = useI18n();
  if (!hasPanelToken()) {
    return (
      <div className={styles.hintBlock}>
        {t("History needs the panel backend; direct mode only has the live speed above.")}
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
          { label: t("Download"), color: "var(--fc-info)", values: down },
          { label: t("Upload"), color: "var(--fc-warning)", values: up },
        ]}
      />
      <div className={styles.summary}>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          {t("Download peak")} <strong>{formatRate(summary.down_peak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotDown)} />
          {t("Download average")} <strong>{formatRate(summary.down_avg)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          {t("Upload peak")} <strong>{formatRate(summary.up_peak)}</strong>
        </span>
        <span className={styles.summaryRow}>
          <i className={cx(styles.dot, styles.dotUp)} />
          {t("Upload average")} <strong>{formatRate(summary.up_avg)}</strong>
        </span>
      </div>
      <div className={styles.legend}>
        <span>
          <i className={cx(styles.dot, styles.dotDown)} /> {t("Download")}
        </span>
        <span>
          <i className={cx(styles.dot, styles.dotUp)} /> {t("Upload")}
        </span>
        <span className={styles.hint}>{panel.state ? "" : t("This session")}</span>
      </div>
    </div>
  );
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
  const { t } = useI18n();
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
    ...(rest > 0 ? [{ label: t("Other"), value: rest, color: DONUT_COLORS[5] }] : []),
  ];
  const totalBytes = totals.reduce((sum, [, value]) => sum + value, 0);
  const since = fetched?.since ? fetched.since * 1000 : mountedAt;

  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        title={t("Outbound download")}
        subtitle={persisted ? t("Since {date}", { date: formatDate(since) }) : t("This session")}
      />
      {totals.length === 0 ? (
        <div className={styles.hintBlock}>{t("No outbound traffic yet")}</div>
      ) : (
        <FcDonut
          slices={slices}
          centerLabel={formatBytes(totalBytes)}
          size={116}
        />
      )}
      <div className={styles.cardFoot}>
        {now && persisted ? t("Last 7 days") : t("Session totals, reset on reload")}
      </div>
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
  const { t } = useI18n();
  const [dimension, setDimension] = useState<"device" | "host">("device");
  const ranking = useSessionRanking(rows, dimension);
  const max = ranking.length > 0 ? ranking[0][1] : 0;
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        title={t("Traffic ranking")}
        actions={
          <div className={styles.rangeTabs} role="tablist" aria-label={t("Ranking dimension")}>
            <button
              type="button"
              role="tab"
              aria-selected={dimension === "device"}
              className={cx(styles.rangeTab, dimension === "device" && styles.rangeTabActive)}
              onClick={() => setDimension("device")}
            >
              {t("Device")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dimension === "host"}
              className={cx(styles.rangeTab, dimension === "host" && styles.rangeTabActive)}
              onClick={() => setDimension("host")}
            >
              {t("Domain")}
            </button>
          </div>
        }
      />
      {ranking.length === 0 ? (
        <div className={styles.hintBlock}>{t("No samples yet")}</div>
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
      <div className={styles.cardFoot}>{t("Session-scope statistics from live connection events")}</div>
    </FcCard>
  );
}

/** CPU 使用率卡（面板后端采样）。 */
export function ObsCpuCard({ panel }: { panel: PanelStateResult }) {
  const { t } = useI18n();
  const state = panel.state;
  const ready = state?.cpu_ready === true;
  const cpu = typeof state?.cpu_percent === "number" ? state.cpu_percent : null;
  return (
    <FcCard className={styles.card}>
      <FcCardHeader
        icon={<Icon name="memory" size={14} />}
        title={t("CPU usage")}
        subtitle={state ? undefined : t("Requires the panel backend")}
      />
      {cpu === null || !ready ? (
        <div className={styles.hintBlock}>
          {state ? t("Sampling not ready yet") : t("Unavailable in direct mode")}
        </div>
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
  const { t } = useI18n();
  const items = useNotifications();
  return (
    <FcCard className={cx(styles.card, styles.notificationsCard)}>
      <FcCardHeader
        icon={<Icon name="notifications" size={14} />}
        title={t("Notifications")}
        actions={items.length > 0 ? <span className={styles.countChip}>{items.length}</span> : undefined}
      />
      {items.length === 0 ? (
        <div className={styles.hintBlock}>{t("No events yet")}</div>
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
