import { useId } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcSparkline.module.css";

interface FcSparklineProps {
  data: readonly number[];
  height?: number;
  className?: string;
  color?: string;
}

const WIDTH = 300;
const PAD_Y = 6;

/** FlClash's chart is a soft primary line anchored to the card's bottom edge. */
export function FcSparkline({ data, height = 88, className, color }: FcSparklineProps) {
  const gradientId = `fc-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const values = data.length >= 2 ? data : [0, 0];
  const max = Math.max(...values, 1);
  const step = WIDTH / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - PAD_Y - (Math.max(0, value) / max) * (height - PAD_Y * 2);
    return [x, y] as const;
  });
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${WIDTH} ${height} L 0 ${height} Z`;

  return (
    <div className={cx(styles.wrap, className)} style={{ height }} aria-hidden="true">
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={color ? { color } : undefined}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path className={styles.line} d={line} />
      </svg>
    </div>
  );
}
