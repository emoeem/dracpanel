import { useMemo, useState } from "react";

import { formatBytes } from "../api/format";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { useI18n, type MessageKey } from "../app/i18n";
import { Badge, Button, Card, EmptyState, Select } from "../components/ui";
import { groupConnectionRows, type ConnectionGroupKey } from "../lib/connectionTools";
import styles from "./ConnectionHistoryCard.module.css";

const GROUP_OPTIONS: { value: ConnectionGroupKey; label: MessageKey }[] = [
  { value: "host", label: "Destination" },
  { value: "source", label: "Source" },
  { value: "process", label: "Process" },
  { value: "outbound", label: "Outbound" },
  { value: "rule", label: "Rule" },
];

const TOP_GROUPS = 8;

export function ConnectionHistoryCard() {
  const api = useApi();
  const { t } = useI18n();
  const connections = useStream(api.connections);
  const [groupBy, setGroupBy] = useState<ConnectionGroupKey>("host");

  const groups = useMemo(() => {
    const rows = [...connections.data.rows.values()];
    return groupConnectionRows(rows, groupBy)
      .map((group) => ({
        ...group,
        total: group.uplink + group.downlink,
      }))
      .sort((left, right) => Number(right.total - left.total))
      .slice(0, TOP_GROUPS);
  }, [connections.data.rows, groupBy]);

  const maxTotal = groups.reduce((max, group) => Math.max(max, Number(group.total)), 1);
  const closedCount = [...connections.data.rows.values()].filter(
    (row) => row.closedAt !== null,
  ).length;

  return (
    <Card
      title={t("Connection History")}
      icon="hub"
      wide
      actions={
        <>
          <Select
            options={GROUP_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
            value={groupBy}
            onChange={setGroupBy}
            inline
          />
          <Button
            size="small"
            disabled={closedCount === 0}
            onClick={() => api.clearConnectionHistory()}
          >
            {t("Clear")}
          </Button>
        </>
      }
    >
      {groups.length === 0 ? (
        <EmptyState icon="hub">{t("No history yet")}</EmptyState>
      ) : (
        <>
          <div className={styles.caption}>
            {t("Recent connections")} · {connections.data.rows.size}
          </div>
          <div className={styles.list}>
            {groups.map((group) => (
              <div key={group.key} className={styles.row}>
                <div className={styles.head}>
                  <span className={styles.key} title={group.key}>{group.key}</span>
                  <Badge>{group.rows.length}</Badge>
                  <span className={styles.bytes}>↑ {formatBytes(group.uplink)} · ↓ {formatBytes(group.downlink)}</span>
                </div>
                <div className={styles.bar}>
                  <span
                    className={styles.barFill}
                    style={{ width: `${Math.max(2, (Number(group.total) / maxTotal) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
