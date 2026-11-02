import { Icon } from "../Icon";
import { cx } from "../../lib/cx";
import styles from "./FcSearchField.module.css";

interface FcSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name; falls back to the placeholder. */
  label?: string;
  compact?: boolean;
  /** Fixed 220px width for toolbars, full width on mobile. */
  narrow?: boolean;
  className?: string;
}

/**
 * Toolbar search field. Pages previously mixed a bare `<input>` (native grey
 * box, 27px tall) with hand-built pills, so the same control looked different
 * on every page.
 */
export function FcSearchField({
  value,
  onChange,
  placeholder,
  label,
  compact = false,
  narrow = false,
  className,
}: FcSearchFieldProps) {
  return (
    <div className={cx(styles.field, compact && styles.compact, narrow && styles.narrow, className)}>
      <span className={styles.icon}>
        <Icon name="search" size={18} />
      </span>
      <input
        className={styles.input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className={styles.clear}
          aria-label={label === undefined ? "Clear" : `${label} — clear`}
          onClick={() => onChange("")}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
