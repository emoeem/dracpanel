import { useId } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcWavyProgress.module.css";

interface FcWavyProgressProps {
  value: number;
  label: string;
  warning?: boolean;
  className?: string;
}

const WIDTH = 300;
const HEIGHT = 12;
const AMPLITUDE = 3;
const WAVELENGTH = 12;

function wavePath(): string {
  const middle = HEIGHT / 2;
  let path = `M 0 ${middle}`;
  for (let x = 2; x <= WIDTH; x += 2) {
    const y = middle + Math.sin((x / WAVELENGTH) * Math.PI * 2) * AMPLITUDE;
    path += ` L ${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  return path;
}

const PATH = wavePath();

/** FlClash's M3-expressive wavy usage bar: 4px stroke, 12px wavelength. */
export function FcWavyProgress({ value, label, warning, className }: FcWavyProgressProps) {
  const ratio = Math.min(1, Math.max(0, value));
  const percent = Math.round(ratio * 100);
  const clipId = `fc-wave-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div
      className={cx(styles.wrap, warning && styles.warning, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className={styles.track} d={PATH} />
        <clipPath id={clipId}>
          <rect x="0" y="0" width={ratio * WIDTH} height={HEIGHT} />
        </clipPath>
        <path className={styles.fill} d={PATH} clipPath={`url(#${clipId})`} />
      </svg>
      <span className={styles.dot} style={{ insetInlineStart: `${percent}%` }} />
    </div>
  );
}
