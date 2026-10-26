import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "./Icon";
import styles from "./BottomNav.module.css";
import { cx } from "../lib/cx";

/** Phone-width destinations. "More" opens the full navigation drawer. */
export type BottomNavTarget = "dashboard" | "proxies" | "connections" | "logs" | "more";

export function BottomNav(props: { active: BottomNavTarget | null; onSelect: (target: BottomNavTarget) => void }) {
  const { t } = useI18n();
  const items: { target: BottomNavTarget; icon: IconName; label: string }[] = [
    { target: "dashboard", icon: "dashboard", label: t("Dashboard") },
    { target: "proxies", icon: "folder", label: t("Proxies") },
    { target: "connections", icon: "swap_vert", label: t("Connections") },
    { target: "logs", icon: "text_snippet", label: t("Logs") },
    { target: "more", icon: "menu", label: t("More") },
  ];

  return (
    <nav className={styles.bottomNav} aria-label={t("Toggle navigation")}>
      {items.map((item) => (
        <button
          key={item.target}
          type="button"
          className={cx(styles.item, props.active === item.target && styles.active)}
          aria-current={props.active === item.target ? "page" : undefined}
          onClick={() => props.onSelect(item.target)}
        >
          <span className={styles.itemIcon}>
            <Icon name={item.icon} size={18} />
          </span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
