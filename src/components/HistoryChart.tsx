export interface HistoryPoint {
  at: number;
  value: number;
}

export interface HistorySeries {
  label: string;
  color: string;
  points: HistoryPoint[];
}

export function HistoryChart(props: {
  series: HistorySeries[];
  height?: number;
}) {
  const height = props.height ?? 160;
  const width = 600;
  const padding = 4;
  const points = props.series.flatMap((series) => series.points);
  if (points.length < 2) {
    return null;
  }
  const minAt = Math.min(...points.map((point) => point.at));
  const maxAt = Math.max(...points.map((point) => point.at));
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const timeSpan = Math.max(maxAt - minAt, 1);

  const x = (at: number) => ((at - minAt) / timeSpan) * width;
  const y = (value: number) =>
    height - padding - Math.max(0, value) / (maxValue * 1.1) * (height - padding * 2);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1="0"
          x2={width}
          y1={height * fraction}
          y2={height * fraction}
          stroke="var(--border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {props.series.map((series) => {
        const path = series.points
          .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`)
          .join(" ");
        return (
          <path
            key={series.label}
            d={path}
            fill="none"
            stroke={series.color}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
