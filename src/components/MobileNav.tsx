import { navigate } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon, type IconName } from "./Icon";
import { cx } from "../lib/cx";
import styles from "./MobileNav.module.css";

export interface MobileNavItem {
  key: string;
  label: string;
  icon: IconName;
  page: string;
}

export function MobileNav(props: { items: MobileNavItem[]; activePage: string }) {
  const { items, activePage } = props;
  const { t } = useI18n();
  return (
    <nav className={styles.bar} aria-label={t("Bottom navigation")}>
      {items.map((item) => {
        const active = activePage === item.page;
        return (
          <button
            key={item.key}
            type="button"
            className={cx(styles.item, active && styles.active)}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(item.page)}
          >
            <span className={styles.icon}>
              <Icon name={item.icon} size={22} />
            </span>
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
