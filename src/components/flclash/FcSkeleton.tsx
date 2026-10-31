import type { CSSProperties } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcSkeleton.module.css";

interface FcSkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/** 1600ms cosine pulse, matching FlClash's skeleton cadence. */
export function FcSkeleton({
  width = "100%",
  height = 12,
  radius = "var(--fc-radius-sm)",
  className,
  style,
}: FcSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, className)}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function FcSkeletonLines({
  count = 3,
  gap = "var(--fc-space-8)",
  className,
}: {
  count?: number;
  gap?: string;
  className?: string;
}) {
  return (
    <span className={cx(styles.lines, className)} style={{ gap }}>
      {Array.from({ length: count }, (_, index) => (
        <FcSkeleton key={index} width={index === count - 1 ? "62%" : "100%"} />
      ))}
    </span>
  );
}
