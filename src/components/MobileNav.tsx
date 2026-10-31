import { navigate } from "../app/context";
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
  return (
    <nav className={styles.bar} aria-label="底部导航">
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
