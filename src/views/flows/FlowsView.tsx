import { useMemo, useState } from "react";

import type { ConnectionRow } from "../../api/daemon";
import { useApi } from "../../app/context";
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
  return (
    <div className={styles.column}>
      {nodes.map((node) => (
        <button
          key={node.key}
          type="button"
          className={cx(styles.node, selectedKey === node.key && styles.nodeActive)}
          title={`${node.key} · ${node.count} 条 · ${formatBytes(node.bytes)}`}
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
        title="连接拓扑"
        subtitle={
          selection === null
            ? `按${dimension === "rule" ? "规则" : "设备"}查看出站与节点的路径，点击行可筛选；覆盖 ${view.total} 条连接`
            : `已按「${selection.key}」筛选 · 覆盖 ${view.total} 条连接`
        }
        actions={
          <>
            {selection !== null && (
              <FcButton size="small" variant="text" onClick={() => setSelection(null)}>
                清除路径筛选
              </FcButton>
            )}
            <FcSegmented
              ariaLabel="拓扑维度"
              value={dimension}
              onChange={changeDimension}
              options={[
                { value: "rule", label: "按规则" },
                { value: "device", label: "按设备" },
              ]}
            />
          </>
        }
      />
      {props.rows.length === 0 ? (
        <div className={styles.empty}>暂无活动连接</div>
      ) : (
        <div className={styles.topoArea}>
          <div className={styles.topoHead}>
            <span>{dimension === "rule" ? "规则" : "设备"}</span>
            <span>出站</span>
            <span>节点</span>
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
            <p className={styles.topoNote}>每列最多显示 {COLUMN_LIMIT} 项，其余按计数截断。</p>
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
        title="分流"
        subtitle={`实时快照 · ${rows.length} 条活动连接`}
        actions={
          <FcSegmented
            ariaLabel="分流视图"
            value={tab}
            onChange={(value: string) => setTab(value as Tab)}
            options={[
              { value: "overview", label: "概览" },
              { value: "records", label: "记录" },
            ]}
          />
        }
      />
      <div className="fc-page-body">
        {tab === "overview" ? (
          <TopologyCard rows={rows} />
        ) : (
          <FcCard>
            <FcCardHeader title="连接记录" subtitle="当前活动连接，按开始时间倒序；实时快照不持久化" />
            <div className={styles.recordTable} role="table">
              <div className={cx(styles.recordRow, styles.recordHead)} role="row">
                <span role="columnheader">时间</span>
                <span role="columnheader">目标</span>
                <span role="columnheader">规则</span>
                <span role="columnheader">出站</span>
                <span role="columnheader">流量</span>
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
              {rows.length === 0 && <div className={styles.empty}>暂无数据</div>}
            </div>
          </FcCard>
        )}
      </div>
    </div>
  );
}
