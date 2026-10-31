import type { CSSProperties } from "react";

import { cx } from "../../lib/cx";
import { proxyDisplayType } from "../../api/format";
import { flagOfText } from "../../lib/flclash/country";
import { rateTone } from "../../lib/flclash/format";
import { Icon } from "../../components/Icon";
import type { GroupItem } from "../../gen/daemon/started_service_pb";
import styles from "./ProxyNodeCard.module.css";

interface ProxyNodeCardProps {
  item: GroupItem;
  selected: boolean;
  selectable: boolean;
  pinned?: boolean;
  testing?: boolean;
  index?: number;
  onSelect: () => void;
  onTest: () => void;
}

function delayLabel(item: GroupItem): string {
  if (item.urlTestDelay > 0) {
    return `${item.urlTestDelay} ms`;
  }
  if (item.urlTestTime > 0n) {
    return "超时";
  }
  return "测试";
}

export function ProxyNodeCard({
  item,
  selected,
  selectable,
  pinned,
  testing,
  index = 0,
  onSelect,
  onTest,
}: ProxyNodeCardProps) {
  const flag = flagOfText(item.tag);
  const tone = rateTone(item.urlTestDelay);
  const hasDelay = item.urlTestDelay > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      className={cx(styles.card, selected && styles.selected)}
      style={{ "--fc-node-index": index } as CSSProperties}
      onClick={() => {
        if (selectable) {
          onSelect();
        }
      }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && selectable) {
          event.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={selected}
      title={selectable ? `选择 ${item.tag}` : `${item.tag}（当前策略组不可选）`}
    >
      <span className={styles.top}>
        <span className={styles.flag} aria-hidden="true">
          {flag || "•"}
        </span>
        {selected && (
          <span className={styles.check} aria-label="已选择">
            <Icon name="check" size={12} />
          </span>
        )}
        {pinned && (
          <span className={styles.pin} aria-label="首选">
            <Icon name="push_pin" size={12} />
          </span>
        )}
      </span>
      <span className={styles.name}>{item.tag}</span>
      <span className={styles.meta}>
        <span className={styles.type}>{proxyDisplayType(item.type)}</span>
        <button
          type="button"
          className={cx(
            styles.delay,
            hasDelay && styles[tone],
            !hasDelay && item.urlTestTime > 0n && styles.bad,
          )}
          onClick={(event) => {
            event.stopPropagation();
            onTest();
          }}
          title="重新测试延迟"
        >
          {testing ? <span className={styles.spinner} /> : delayLabel(item)}
        </button>
      </span>
    </div>
  );
}
