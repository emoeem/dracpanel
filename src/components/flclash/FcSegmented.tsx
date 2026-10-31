import type { CSSProperties, ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcSegmented.module.css";

export interface FcSegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface FcSegmentedProps<T extends string> {
  options: readonly FcSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Connected segmented control. The selected fill is animated by CSS rather
 * than a moving pill so it keeps FlClash's radius morph on resize.
 */
export function FcSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  disabled,
}: FcSegmentedProps<T>) {
  return (
    <div
      className={cx(styles.group, className)}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--fc-segment-count": options.length } as CSSProperties}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            className={cx(styles.segment, selected && styles.selected)}
            onClick={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
          >
            {option.icon && <span className={styles.icon}>{option.icon}</span>}
            <span className={styles.label}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
