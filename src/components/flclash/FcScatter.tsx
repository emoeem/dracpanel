import { useId } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcScatter.module.css";

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
}

interface FcScatterProps {
  points: readonly ScatterPoint[];
  onSelect?: (id: string) => void;
  className?: string;
  height?: number;
}

const WIDTH = 640;
const PAD = 34;
const TICKS = [1, 1e3, 1e6, 1e9];

function formatTick(value: number): string {
  if (value < 1e3) {
    return "0 B";
  }
  if (value < 1e6) {
    return "1 KB";
  }
  if (value < 1e9) {
    return "1 MB";
  }
  return "1 GB";
}

/**
 * Log-log scatter with a diagonal "upload = download" reference, matching the
 * Connections traffic view: x = uploaded, y = downloaded, one dot per
 * connection.
 */
export function FcScatter({ points, onSelect, className, height = 300 }: FcScatterProps) {
  const gradientId = `fc-scatter-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const values = points.flatMap((point) => [point.x, point.y, 1]);
  const max = Math.max(...values, 1e3);
  const maxExp = Math.log10(max) + 0.2;
  const plotW = WIDTH - PAD * 2;
  const plotH = height - PAD * 2;
  const scale = (value: number) => Math.log10(Math.max(1, value)) / maxExp;

  const tickPos = (value: number) => PAD + scale(value) * plotW;

  return (
    <svg
      className={cx(styles.chart, className)}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="连接流量散点图"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--fc-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--fc-primary)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {TICKS.map((tick) => (
        <g key={`tick-${tick}`}>
          <line
            x1={tickPos(tick)}
            y1={PAD}
            x2={tickPos(tick)}
            y2={height - PAD}
            className={styles.grid}
          />
          <line
            x1={PAD}
            y1={height - PAD - scale(tick) * plotH}
            x2={WIDTH - PAD}
            y2={height - PAD - scale(tick) * plotH}
            className={styles.grid}
          />
          <text x={tickPos(tick)} y={height - PAD + 14} className={styles.tick} textAnchor="middle">
            {formatTick(tick)}
          </text>
          <text x={PAD - 6} y={height - PAD - scale(tick) * plotH + 4} className={styles.tick} textAnchor="end">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <line
        x1={PAD}
        y1={height - PAD}
        x2={WIDTH - PAD}
        y2={PAD}
        className={styles.diagonal}
      />
      {points.map((point) => {
        const cx = PAD + scale(point.x) * plotW;
        const cy = height - PAD - scale(point.y) * plotH;
        return (
          <circle
            key={point.id}
            cx={cx}
            cy={cy}
            r={4}
            fill={point.color}
            className={styles.dot}
            onClick={() => onSelect?.(point.id)}
          >
            <title>{point.label}</title>
          </circle>
        );
      })}
    </svg>
  );
}
