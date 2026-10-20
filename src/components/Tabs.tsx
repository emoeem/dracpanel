import { useRef, type KeyboardEvent } from "react";

import { cx } from "../lib/cx";
import styles from "./Tabs.module.css";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export function Tabs<T extends string>(props: {
  value: T;
  tabs: TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
  /**
   * When set, each tab gets `id="{idPrefix}-{value}"` and points at
   * `aria-controls="{idPrefix}-panel-{value}"`, so a sibling tabpanel can be
   * linked with `aria-labelledby`. Omitted by default: emitting `aria-controls`
   * that resolves to nothing is worse than omitting it.
   */
  idPrefix?: string;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const count = props.tabs.length;
  const index = props.tabs.findIndex((tab) => tab.value === props.value);

  const move = (target: number | "first" | "last") => {
    if (count === 0) {
      return;
    }
    const next =
      target === "first"
        ? 0
        : target === "last"
          ? count - 1
          : (((index + target) % count) + count) % count;
    const tab = props.tabs[next];
    if (tab === undefined) {
      return;
    }
    props.onChange(tab.value);
    buttons.current.get(tab.value)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight") {
      move(1);
    } else if (event.key === "ArrowLeft") {
      move(-1);
    } else if (event.key === "Home") {
      move("first");
    } else if (event.key === "End") {
      move("last");
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div className={cx(styles.tabs, props.className)} role="tablist">
      {props.tabs.map((tab, position) => {
        const active = props.value === tab.value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              if (node) {
                buttons.current.set(tab.value, node);
              } else {
                buttons.current.delete(tab.value);
              }
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (index === -1 && position === 0) ? 0 : -1}
            id={props.idPrefix === undefined ? undefined : `${props.idPrefix}-${tab.value}`}
            aria-controls={
              props.idPrefix === undefined ? undefined : `${props.idPrefix}-panel-${tab.value}`
            }
            className={cx(styles.tab, active && styles.active)}
            onClick={() => props.onChange(tab.value)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
