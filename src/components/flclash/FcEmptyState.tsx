import type { ReactNode } from "react";

import { Icon, type IconName } from "../Icon";
import { cx } from "../../lib/cx";
import styles from "./FcEmptyState.module.css";

interface FcEmptyStateProps {
  icon?: IconName;
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  /** Inline variant for short list bodies (histogram strip, side panels). */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * One empty state for the whole panel: icon medallion, title, optional hint
 * and action. Previously each page rendered bare grey text (or nothing at all)
 * which read as a rendering bug rather than as "there is nothing here yet".
 */
export function FcEmptyState({
  icon = "info",
  title,
  hint,
  action,
  compact = false,
  className,
  children,
}: FcEmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.compact, className)} role="status">
      <span className={styles.icon}>
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      {title !== undefined && <span className={styles.title}>{title}</span>}
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      {children}
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  );
}
