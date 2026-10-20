import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import styles from "./Breadcrumb.module.css";

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

export function Breadcrumb(props: { items: BreadcrumbItem[]; className?: string }) {
  const length = props.items.length;
  return (
    <nav className={cx(styles.breadcrumb, props.className)} aria-label="Breadcrumb">
      <ol className={styles.list}>
        {props.items.map((item, index) => {
          const isLast = index === length - 1;
          return (
            <li key={index} className={styles.item}>
              {item.href !== undefined && !isLast ? (
                <a className={styles.link} href={item.href}>
                  {item.label}
                </a>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={styles.current}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className={styles.separator}>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}