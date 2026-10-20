import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import styles from "./Tooltip.module.css";

export function Tooltip(props: {
  label: string;
  placement?: "top" | "bottom";
  children: ReactNode;
}) {
  const placement = props.placement ?? "top";
  return (
    <span className={cx(styles.tooltip, styles[placement])}>
      {props.children}
      <span className={styles.label} role="tooltip">
        {props.label}
      </span>
    </span>
  );
}
