import { cx } from "../lib/cx";
import styles from "./Skeleton.module.css";

export function Skeleton(props: { width?: string; height?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, props.className)}
      style={{ width: props.width, height: props.height }}
    />
  );
}

/** A short stack of placeholder lines, for views that have not loaded yet. */
export function SkeletonLines(props: { lines?: number; className?: string }) {
  const count = props.lines ?? 3;
  return (
    <span aria-hidden="true" className={cx(styles.lines, props.className)}>
      {Array.from({ length: count }, (_unused, index) => (
        <Skeleton key={index} width={index === count - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}
