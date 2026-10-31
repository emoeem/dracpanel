import { useId } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcTimeChart.module.css";

export interface TimeChartSeries {
  label: string;
  color: string;
  values: readonly number[];
}

interface FcTimeChartProps {
  series: readonly TimeChartSeries[];
  /** Optional second y-axis scale for series with much smaller magnitudes. */
  labels?: readonly string[];
  height?: number;
  className?: string;
}

/** doona-style dual-series area chart with baseline grid and time labels. */
export function FcTimeChart({ series, labels, height = 140, className }: FcTimeChartProps) {
  const gradientBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 600;
  const padBottom = 18;
  const chartHeight = height - padBottom;

  const longest = series.reduce((max, item) => Math.max(max, item.values.length), 0);
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const step = longest > 1 ? width / (longest - 1) : width;

  const linePath = (values: readonly number[]) => {
    if (values.length === 0) {
      return "";
    }
    const parts: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const x = index * step;
      const y = chartHeight - (Math.max(0, values[index]) / max) * (chartHeight - 6);
      parts.push(`${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(" ");
  };
  const areaPath = (values: readonly number[]) => {
    const line = linePath(values);
    if (line === "") {
      return "";
    }
    const endX = (values.length - 1) * step;
    return `${line} L ${endX.toFixed(1)} ${chartHeight} L 0 ${chartHeight} Z`;
  };

  const gridLines = [0.25, 0.5, 0.75];

  return (
    <div className={cx(styles.wrap, className)}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ height }}
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.label} id={`${gradientBase}-g${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0.04" />
            </linearGradient>
          ))}
        </defs>
        {gridLines.map((ratio) => (
          <line
            key={ratio}
            className={styles.grid}
            x1="0"
            x2={width}
            y1={chartHeight * ratio}
            y2={chartHeight * ratio}
          />
        ))}
        {series.map((item, index) => (
          <g key={item.label}>
            <path d={areaPath(item.values)} fill={`url(#${gradientBase}-g${index})`} />
            <path
              d={linePath(item.values)}
              fill="none"
              stroke={item.color}
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {labels && labels.length > 0 && (
          <g className={styles.labels}>
            {labels.map((label, index) => {
              const count = labels.length;
              const x = count > 1 ? (index * width) / (count - 1) : 0;
              const anchor = index === 0 ? "start" : index === count - 1 ? "end" : "middle";
              return (
                <text key={`${label}-${index}`} x={x} y={height - 4} textAnchor={anchor}>
                  {label}
                </text>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
