import { cx } from "../../lib/cx";
import styles from "./FcSwitch.module.css";

interface FcSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** FlClash switch: 52×32 track, thumb morphs 24 → 40 wide on select. */
export function FcSwitch({ checked, onChange, label, disabled, className }: FcSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx(styles.switch, checked && styles.on, className)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  );
}
