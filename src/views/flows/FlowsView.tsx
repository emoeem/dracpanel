import { useMemo, useState } from "react";

import type { ConnectionRow } from "../../api/daemon";
import { useApi } from "../../app/context";
import { useI18n } from "../../app/i18n";
import { useStream } from "../../api/stream";
import { FcCard, FcCardHeader, FcButton, FcPageToolbar, FcSegmented } from "../../components/flclash";
import { formatBytes } from "../../api/format";
import { connectionHost } from "../../lib/connectionTools";
import {
  buildFlowTopology,
  projectFlowView,
  type FlowDimension,
  type FlowSelection,
} from "../../lib/flowTopology";
import { cx } from "../../lib/cx";
import styles from "./FlowsView.module.css";

type Tab = "overview" | "records";

/** Fixed row pitch; the SVG link geometry depends on it. */
const ROW_HEIGHT = 44;
const ROW_GAP = 8;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;
const COLUMN_LIMIT = 8;
// viewBox x positions of the three equal columns (300 units wide).
const LINK_X = { col1Out: 96, col2In: 104, col2Out: 196, col3In: 204 } as const;

interface ColumnProps {
  nodes: ReturnType<typeof projectFlowView>["col1"];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}

function FlowColumnView({ nodes, selectedKey, onSelect }: ColumnProps) {
  const { t } = useI18n();
  return (
    <div className={styles.column}>
      {nodes.map((node) => (
        <button
          key={node.key}
          type="button"
          className={cx(styles.node, selectedKey === node.key && styles.nodeActive)}
          title={t("{name} · {count} links · {bytes}", {
            name: node.key,
            count: node.count,
            bytes: formatBytes(node.bytes),
          })}
          onClick={() => onSelect(node.key)}
        >
          <span className={styles.nodeLabel}>{node.key}</span>
          <span className={styles.nodeCount}>{node.count}</span>
        </button>
      ))}
    </div>
  );
}

function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function TopologyCard(props: { rows: readonly ConnectionRow[] }) {
  const { t } = useI18n();
  const [dimension, setDimension] = useState<FlowDimension>("rule");
  const [selection, setSelection] = useState<FlowSelection | null>(null);

  const topology = useMemo(() => buildFlowTopology(props.rows, dimension), [props.rows, dimension]);
  const view = useMemo(
    () => projectFlowView(topology, selection, COLUMN_LIMIT),
    [topology, selection],
  );

  const select = (dim: 1 | 2 | 3) => (key: string) => {
    setSelection((current) =>
      current !== null && current.dim === dim && current.key === key ? null : { dim, key },
    );
  };

  const changeDimension = (value: string) => {
    setDimension(value as FlowDimension);
    setSelection(null);
  };

  const rowCount = Math.max(view.col1.length, view.col2.length, view.col3.length);
  const wrapHeight = rowCount > 0 ? rowCount * ROW_PITCH - ROW_GAP : ROW_HEIGHT;
  const linkWidth = (count: number) => 1.5 + Math.min(3.5, Math.sqrt(count));
  const y = (index: number) => index * ROW_PITCH + ROW_HEIGHT / 2;
  const maxLink =
    Math.max(1, ...view.links12.map((link) => link.count), ...view.links23.map((link) => link.count));

  return (
    <FcCard>
      <FcCardHeader
        title={t("Connection topology")}
        subtitle={
          selection === null
            ? t("{dimension} → outbound → node paths; click a row to filter · {count} connections", {
                dimension: dimension === "rule" ? t("Rule") : t("Device"),
                count: view.total,
              })
            : t("Filtered by “{name}” · {count} connections", { name: selection.key, count: view.total })
        }
        actions={
          <>
            {selection !== null && (
              <FcButton size="small" variant="text" onClick={() => setSelection(null)}>
                {t("Clear path filter")}
              </FcButton>
            )}
            <FcSegmented
              ariaLabel={t("Topology dimension")}
              value={dimension}
              onChange={changeDimension}
              options={[
                { value: "rule", label: t("By rule") },
                { value: "device", label: t("By device") },
              ]}
            />
          </>
        }
      />
      {props.rows.length === 0 ? (
        <div className={styles.empty}>{t("No active connections")}</div>
      ) : (
        <div className={styles.topoArea}>
          <div className={styles.topoHead}>
            <span>{dimension === "rule" ? t("Rule") : t("Device")}</span>
            <span>{t("Outbound")}</span>
            <span>{t("Node")}</span>
          </div>
          <div className={styles.topoWrap} style={{ height: wrapHeight }}>
            <svg
              className={styles.topoLinks}
              viewBox={`0 0 300 ${Math.max(wrapHeight, 1)}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {view.links12.map((link) => (
                <path
                  key={`l12-${link.from}-${link.to}`}
                  d={linkPath(LINK_X.col1Out, y(link.from), LINK_X.col2In, y(link.to))}
                  className={styles.link}
                  style={{ opacity: 0.15 + 0.45 * (link.count / maxLink) }}
                  strokeWidth={linkWidth(link.count)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {view.links23.map((link) => (
                <path
                  key={`l23-${link.from}-${link.to}`}
                  d={linkPath(LINK_X.col2Out, y(link.from), LINK_X.col3In, y(link.to))}
                  className={styles.link}
                  style={{ opacity: 0.15 + 0.45 * (link.count / maxLink) }}
                  strokeWidth={linkWidth(link.count)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className={styles.topoGrid}>
              <FlowColumnView
                nodes={view.col1}
                selectedKey={selection?.dim === 1 ? selection.key : undefined}
                onSelect={select(1)}
              />
              <FlowColumnView
                nodes={view.col2}
                selectedKey={selection?.dim === 2 ? selection.key : undefined}
                onSelect={select(2)}
              />
              <FlowColumnView
                nodes={view.col3}
                selectedKey={selection?.dim === 3 ? selection.key : undefined}
                onSelect={select(3)}
              />
            </div>
          </div>
          {rowCount >= COLUMN_LIMIT && (
            <p className={styles.topoNote}>
              {t("At most {count} items per column; the rest are truncated by count", { count: COLUMN_LIMIT })}
            </p>
          )}
        </div>
      )}
    </FcCard>
  );
}

/**
 * 分流：实时连接的 规则（或设备）→ 出站 → 节点 路径拓扑。
 * 数据来自实时连接流，是即时快照，不做持久化。
 */
export function FlowsView() {
  const { t } = useI18n();
  const api = useApi();
  const connections = useStream(api.connections);
  const [tab, setTab] = useState<Tab>("overview");

  const rows = useMemo(() => {
    const list: ConnectionRow[] = [];
    for (const row of connections.data.rows.values()) {
      if (row.closedAt === null) {
        list.push(row);
      }
    }
    return list.sort((left, right) => Number(right.connection.createdAt) - Number(left.connection.createdAt));
  }, [connections.data.rows]);

  return (
    <div className="fc-page">
      <FcPageToolbar
        title={t("Flows")}
        subtitle={t("Live snapshot · {count} active connections", { count: rows.length })}
        actions={
          <FcSegmented
            ariaLabel={t("Flows view")}
            value={tab}
            onChange={(value: string) => setTab(value as Tab)}
            options={[
              { value: "overview", label: t("Overview") },
              { value: "records", label: t("Records") },
            ]}
          />
        }
      />
      <div className="fc-page-body">
        {tab === "overview" ? (
          <TopologyCard rows={rows} />
        ) : (
          <FcCard>
            <FcCardHeader
              title={t("Connection records")}
              subtitle={t("Current active connections, newest first; the live snapshot is not persisted")}
            />
            <div className={styles.recordTable} role="table">
              <div className={cx(styles.recordRow, styles.recordHead)} role="row">
                <span role="columnheader">{t("Time")}</span>
                <span role="columnheader">{t("Destination")}</span>
                <span role="columnheader">{t("Rule")}</span>
                <span role="columnheader">{t("Outbound")}</span>
                <span role="columnheader">{t("Traffic")}</span>
              </div>
              {rows.slice(0, 100).map((row) => (
                <div key={row.connection.id} className={styles.recordRow} role="row">
                  <span className={styles.recordTime} role="cell">
                    {new Date(Number(row.connection.createdAt)).toLocaleTimeString()}
                  </span>
                  <span className={styles.recordHost} title={connectionHost(row)} role="cell">
                    {connectionHost(row) || row.connection.destination || "—"}
                  </span>
                  <span className={styles.recordRule} role="cell">
                    {row.connection.rule || "final"}
                  </span>
                  <span role="cell">{row.connection.outbound}</span>
                  <span className={styles.recordBytes} role="cell">
                    {formatBytes(row.downlinkTotal + row.uplinkTotal)}
                  </span>
                </div>
              ))}
              {rows.length === 0 && <div className={styles.empty}>{t("No data")}</div>}
            </div>
          </FcCard>
        )}
      </div>
    </div>
  );
}
