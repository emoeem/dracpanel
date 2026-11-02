import { useEffect, useState } from "react";

import { navigate } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "./Icon";
import { loadStoredJson, loadStoredString, saveStoredJson, saveStoredString } from "../lib/storage";
import { cx } from "../lib/cx";
import styles from "./Sidebar.module.css";

const EXPANDED_KEY = "sidebar-expanded";
const GROUPS_KEY = "sidebar-groups";

export interface SidebarItem {
  key: string;
  label: string;
  icon: IconName;
  page: string;
  hidden?: boolean;
}

export interface SidebarGroup {
  key: string;
  label: string;
  icon: IconName;
  children: SidebarItem[];
}

export type SidebarEntry = SidebarItem | SidebarGroup;

function isGroup(entry: SidebarEntry): entry is SidebarGroup {
  return "children" in entry;
}

export function entryPage(entry: SidebarEntry): string {
  return isGroup(entry) ? (entry.children.find((child) => !child.hidden)?.page ?? "") : entry.page;
}

export function isEntryActive(entry: SidebarEntry, activePage: string): boolean {
  if (!isGroup(entry)) {
    return entry.page === activePage;
  }
  return entry.children.some((child) => !child.hidden && child.page === activePage);
}

export function useSidebarExpanded(): [boolean, (value: boolean) => void] {
  const [expanded, setExpanded] = useState(() => loadStoredString(EXPANDED_KEY) !== "false");
  const update = (value: boolean) => {
    setExpanded(value);
    saveStoredString(EXPANDED_KEY, value ? "true" : "false");
  };
  return [expanded, update];
}

function useGroupState(): [Record<string, boolean>, (key: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const stored = loadStoredJson(GROUPS_KEY);
    return typeof stored === "object" && stored !== null ? (stored as Record<string, boolean>) : {};
  });
  const toggle = (key: string) => {
    setOpen((current) => {
      const next = { ...current, [key]: !(current[key] ?? true) };
      saveStoredJson(GROUPS_KEY, next);
      return next;
    });
  };
  return [open, toggle];
}

export function Sidebar(props: {
  items: SidebarEntry[];
  activePage: string;
  expanded: boolean;
  onToggle: (value: boolean) => void;
  overlay?: boolean;
}) {
  const { items, activePage, expanded, onToggle, overlay } = props;
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [openGroups, toggleGroup] = useGroupState();
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const renderItem = (item: SidebarItem, nested: boolean) => {
    const active = activePage === item.page;
    return (
      <button
        key={item.key}
        type="button"
        className={cx(styles.item, nested && styles.subitem, active && styles.active)}
        onClick={() => navigate(item.page)}
        title={item.label}
        aria-current={active ? "page" : undefined}
      >
        <span className={cx(styles.indicator, active && styles.indicatorActive)} />
        <span className={styles.icon}>
          <Icon name={item.icon} size={nested ? 18 : 22} />
        </span>
        <span className={styles.label}>{item.label}</span>
      </button>
    );
  };

  return (
    <nav
      className={cx(
        styles.sidebar,
        expanded ? styles.expanded : styles.collapsed,
        overlay && styles.overlay,
        mounted && styles.ready,
      )}
      aria-label={t("Main navigation")}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-label={expanded ? t("Collapse sidebar") : t("Expand sidebar")}
        aria-expanded={expanded}
        onClick={() => onToggle(!expanded)}
      >
        <Icon name="menu" size={20} />
      </button>
      <div className={styles.items}>
        {items.map((entry) => {
          if (isGroup(entry)) {
            const children = entry.children.filter((child) => !child.hidden);
            if (children.length === 0) {
              return null;
            }
            const active = isEntryActive(entry, activePage);
            // Collapsed rails cannot show children; the group icon opens its
            // first page so navigation still works at 72px wide.
            if (!expanded) {
              return (
                <button
                  key={entry.key}
                  type="button"
                  className={cx(styles.item, active && styles.active)}
                  onClick={() => navigate(children[0].page)}
                  title={entry.label}
                >
                  <span className={cx(styles.indicator, active && styles.indicatorActive)} />
                  <span className={styles.icon}>
                    <Icon name={entry.icon} size={22} />
                  </span>
                  <span className={styles.label}>{entry.label}</span>
                </button>
              );
            }
            const open = openGroups[entry.key] ?? true;
            return (
              <div key={entry.key} className={styles.group}>
                <button
                  type="button"
                  className={cx(styles.item, styles.groupHeader, active && styles.active)}
                  onClick={() => toggleGroup(entry.key)}
                  aria-expanded={open}
                  title={entry.label}
                >
                  <span className={cx(styles.indicator, active && styles.indicatorActive)} />
                  <span className={styles.icon}>
                    <Icon name={entry.icon} size={22} />
                  </span>
                  <span className={styles.label}>{entry.label}</span>
                  <span className={cx(styles.chevron, open && styles.chevronOpen)}>
                    <Icon name="expand_more" size={16} />
                  </span>
                </button>
                {open && (
                  <div className={styles.children}>{children.map((child) => renderItem(child, true))}</div>
                )}
              </div>
            );
          }
          return entry.hidden ? null : renderItem(entry, false);
        })}
      </div>
    </nav>
  );
}
