import { useId } from "react";

import { formatBytes } from "../../api/format";
import { cx } from "../../lib/cx";
import styles from "./FcDonut.module.css";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface FcDonutProps {
  slices: readonly DonutSlice[];
  centerLabel: string;
  size?: number;
  className?: string;
}

const STROKE = 14;

/** doona-style outbound-traffic donut with total in the middle. */
export function FcDonut({ slices, centerLabel, size = 132, className }: FcDonutProps) {
  const clipId = `fc-donut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  const arcs: (DonutSlice & { dash: number; offset: number })[] = [];
  let running = 0;
  for (const slice of slices) {
    if (slice.value <= 0 || total <= 0) {
      continue;
    }
    const dash = (slice.value / total) * circumference;
    arcs.push({ ...slice, dash, offset: running });
    running += dash;
  }

  return (
    <div className={cx(styles.wrap, className)}>
      <div className={styles.chart} style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
          <circle
            className={styles.track}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={STROKE}
            fill="none"
          />
          <clipPath id={clipId}>
            <rect x="0" y="0" width={size} height={size} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {arcs.map((arc) => (
              <circle
                key={arc.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth={STROKE}
                strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                strokeDashoffset={-arc.offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ))}
          </g>
        </svg>
        <span className={styles.center}>{centerLabel}</span>
      </div>
      <ul className={styles.legend}>
        {slices.map((slice) => (
          <li key={slice.label}>
            <i style={{ background: slice.color }} />
            <span className={styles.legendLabel}>{slice.label}</span>
            <span className={styles.legendValue}>{formatBytes(slice.value)}</span>
            <span className={styles.legendPercent}>
              {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
        {arcs.length === 0 && <li className={styles.empty}>暂无数据</li>}
      </ul>
    </div>
  );
}
