import type { ReactNode } from "react";

import { Icon } from "../Icon";
import { cx } from "../../lib/cx";
import styles from "./FcPageToolbar.module.css";

interface FcPageToolbarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}

/** FlClash page toolbar: 72px title row with trailing actions. */
export function FcPageToolbar({
  title,
  subtitle,
  actions,
  onBack,
  backLabel = "返回",
  className,
}: FcPageToolbarProps) {
  return (
    <header className={cx(styles.toolbar, className)}>
      <div className={styles.leading}>
        {onBack && (
          <button type="button" className={styles.back} aria-label={backLabel} onClick={onBack}>
            <Icon name="arrow_back" size={22} />
          </button>
        )}
        <div className={styles.titles}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
