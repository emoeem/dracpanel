import { useEffect, useState } from "react";

import { navigate } from "../app/context";
import { Icon, type IconName } from "./Icon";
import { loadStoredString, saveStoredString } from "../lib/storage";
import { cx } from "../lib/cx";
import styles from "./Sidebar.module.css";

const EXPANDED_KEY = "sidebar-expanded";

export interface SidebarItem {
  key: string;
  label: string;
  icon: IconName;
  page: string;
  hidden?: boolean;
}

export function useSidebarExpanded(): [boolean, (value: boolean) => void] {
  const [expanded, setExpanded] = useState(() => loadStoredString(EXPANDED_KEY) !== "false");
  const update = (value: boolean) => {
    setExpanded(value);
    saveStoredString(EXPANDED_KEY, value ? "true" : "false");
  };
  return [expanded, update];
}

export function Sidebar(props: {
  items: SidebarItem[];
  activePage: string;
  expanded: boolean;
  onToggle: (value: boolean) => void;
  overlay?: boolean;
}) {
  const { items, activePage, expanded, onToggle, overlay } = props;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <nav
      className={cx(
        styles.sidebar,
        expanded ? styles.expanded : styles.collapsed,
        overlay && styles.overlay,
        mounted && styles.ready,
      )}
      aria-label="主导航"
    >
      <button
        type="button"
        className={styles.toggle}
        aria-label={expanded ? "收起侧栏" : "展开侧栏"}
        aria-expanded={expanded}
        onClick={() => onToggle(!expanded)}
      >
        <Icon name="menu" size={20} />
      </button>
      <div className={styles.items}>
        {items
          .filter((item) => !item.hidden)
          .map((item) => {
            const active = activePage === item.page;
            return (
              <button
                key={item.key}
                type="button"
                className={cx(styles.item, active && styles.active)}
                onClick={() => navigate(item.page)}
                title={item.label}
              >
                <span className={cx(styles.indicator, active && styles.indicatorActive)} />
                <span className={styles.icon}>
                  <Icon name={item.icon} size={22} />
                </span>
                <span className={styles.label}>{item.label}</span>
              </button>
            );
          })}
      </div>
    </nav>
  );
}
