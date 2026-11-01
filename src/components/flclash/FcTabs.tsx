import type { ReactNode } from "react";

import { cx } from "../../lib/cx";
import styles from "./FcTabs.module.css";

export interface FcTabOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** Underlined tab strip: the FlClash counterpart of the old Tabs component. */
export function FcTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: readonly FcTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(styles.tabs, className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cx(styles.tab, active && styles.active)}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
