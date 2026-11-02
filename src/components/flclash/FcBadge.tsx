import type { ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcBadge.module.css";

export type FcBadgeTone = "neutral" | "accent" | "success" | "warning" | "error" | "info";

interface FcBadgeProps {
  tone?: FcBadgeTone;
  variant?: "soft" | "outline";
  /** Monospace, uppercase — for levels and protocol tags. */
  mono?: boolean;
  /** Leading status dot in the chip's own colour. */
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The one chip in the panel: 22px tall, pill radius, tone from the shared
 * success/warning/error tokens. Pages previously hand-rolled `.badge`,
 * dotted spans and coloured `<span>`s for the same job.
 */
export function FcBadge({
  tone = "neutral",
  variant = "soft",
  mono = false,
  dot = false,
  title,
  className,
  children,
}: FcBadgeProps) {
  return (
    <span
      className={cx(styles.badge, styles[tone], variant === "outline" && styles.outline, mono && styles.mono, className)}
      title={title}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
