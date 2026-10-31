import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcButtons.module.css";

interface FcButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "tonal" | "text" | "danger";
  size?: "normal" | "small";
  children?: ReactNode;
}

export function FcButton({
  variant = "tonal",
  size = "normal",
  className,
  children,
  ...rest
}: FcButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(styles.button, styles[variant], size === "small" && styles.small, className)}
    >
      {children}
    </button>
  );
}

interface FcIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  danger?: boolean;
}

export function FcIconButton({
  label,
  active,
  danger,
  className,
  children,
  ...rest
}: FcIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(styles.iconButton, active && styles.active, danger && styles.danger, className)}
    >
      {children}
    </button>
  );
}
