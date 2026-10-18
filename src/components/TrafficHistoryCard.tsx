import { useMemo, useState } from "react";

import { formatBytes, formatMemoryBytes } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import { Card, EmptyState, Select } from "../components/ui";
import { HistoryChart, type HistoryPoint } from "./HistoryChart";
import styles from "./TrafficHistoryCard.module.css";

type RangeValue = "60" | "300" | "3600";

const RANGES: { value: RangeValue; label: string }[] = [
  { value: "60", label: "1m" },
  { value: "300", label: "5m" },
  { value: "3600", label: "1h" },
];

export function TrafficHistoryCard() {
  const api = useApi();
  const { t } = useI18n();
  const status = useStream(api.status);
  const [range, setRange] = useState<RangeValue>("60");
  const now = useNow(1000);
  const rangeSeconds = Number(range);
  const cutoff = now - rangeSeconds * 1000;

  const history = useMemo(
    () => status.data.history.filter((sample) => sample.at >= cutoff),
    [status.data.history, cutoff],
  );

  const uploadPoints: HistoryPoint[] = history.map((sample) => ({
    at: sample.at,
    value: sample.uplink,
  }));
  const downloadPoints: HistoryPoint[] = history.map((sample) => ({
    at: sample.at,
    value: sample.downlink,
  }));
  const connectionPoints: HistoryPoint[] = history.map((sample) => ({
    at: sample.at,
    value: sample.connections,
  }));

  const current = status.data.current;
  const latestMemory = history.length > 0 ? history[history.length - 1].memory : 0;

  return (
    <Card
      title={t("Traffic History")}
      icon="speed"
      wide
      actions={
        <Select
          options={RANGES.map((option) => ({ value: option.value, label: option.label }))}
          value={range}
          onChange={setRange}
          inline
        />
      }
    >
      {history.length < 2 ? (
        <EmptyState icon="speed">{t("No history yet")}</EmptyState>
      ) : (
        <>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: "var(--accent)" }} />
              {t("Upload")} {current ? `${formatBytes(Number(current.uplink))}/s` : "—"}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: "var(--good)" }} />
              {t("Download")} {current ? `${formatBytes(Number(current.downlink))}/s` : "—"}
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: "var(--info)" }} />
              {t("Connections")} {current ? current.connectionsIn + current.connectionsOut : "—"}
            </span>
            <span className={styles.legendItem}>
              {t("Memory")} {latestMemory > 0 ? formatMemoryBytes(latestMemory) : "—"}
            </span>
          </div>
          <div className={styles.chart}>
            <HistoryChart
              series={[
                { label: t("Upload"), color: "var(--accent)", points: uploadPoints },
                { label: t("Download"), color: "var(--good)", points: downloadPoints },
              ]}
              height={170}
            />
          </div>
          <div className={styles.subChart}>
            <span className={styles.subLabel}>{t("Connections")}</span>
            <HistoryChart
              series={[{ label: t("Connections"), color: "var(--info)", points: connectionPoints }]}
              height={56}
            />
          </div>
        </>
      )}
    </Card>
  );
}
