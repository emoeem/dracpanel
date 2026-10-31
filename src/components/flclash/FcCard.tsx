import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcCard.module.css";

type CardShape = "dashboard" | "block" | "profile" | "proxy";

interface FcCardProps extends HTMLAttributes<HTMLDivElement> {
  shape?: CardShape;
  interactive?: boolean;
}

/** The FlClash surface: filled card, large radius, no border, e1 shadow. */
export function FcCard({
  shape = "dashboard",
  interactive = false,
  className,
  children,
  ...rest
}: FcCardProps) {
  return (
    <div
      className={cx(styles.card, styles[shape], interactive && styles.interactive, className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function FcCardHeader(props: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(styles.header, props.className)}>
      {props.icon && <span className={styles.headerIcon}>{props.icon}</span>}
      <span className={styles.headerTitle}>{props.title}</span>
      {props.subtitle && <span className={styles.headerSubtitle}>{props.subtitle}</span>}
      {props.actions && <div className={styles.headerActions}>{props.actions}</div>}
    </div>
  );
}
