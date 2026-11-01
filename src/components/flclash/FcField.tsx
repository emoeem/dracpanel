import type { ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcField.module.css";

/** Label + hint + control, matching the spacing of the FlClash cards. */
export function FcField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      {children}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
}

/** Styled native select; keeps mobile pickers and keyboard behaviour. */
export function FcSelect({
  value,
  onChange,
  children,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      className={cx(styles.select, className)}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}
