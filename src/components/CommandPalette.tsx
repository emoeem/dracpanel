import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../app/i18n";
import { filterCommands, moveSelection, type CommandEntry } from "../lib/commandPalette";
import { cx } from "../lib/cx";
import { Icon, type IconName } from "./Icon";
import { Dialog } from "./ui";
import styles from "./CommandPalette.module.css";

export interface Command extends CommandEntry {
  icon?: IconName;
  /** Shortcut hint rendered on the right, e.g. "Ctrl+1". */
  hint?: string;
  run(): void;
}

export function CommandPalette(props: { commands: readonly Command[]; onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterCommands(props.commands, query), [props.commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, matches]);

  const commit = (index: number) => {
    const command = matches[index];
    if (command === undefined) {
      return;
    }
    props.onClose();
    command.run();
  };

  return (
    <Dialog onClose={props.onClose} className={styles.palette}>
      <h3 className="sr-only">{t("Command palette")}</h3>
      <div className={styles.inputRow}>
        <Icon name="search" />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={t("Type a command or search")}
          spellCheck={false}
          autoComplete="off"
          aria-controls="command-palette-list"
          aria-activedescendant={
            matches.length > 0 ? `command-palette-item-${matches[selected]?.id ?? ""}` : undefined
          }
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => moveSelection(value, 1, matches.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => moveSelection(value, -1, matches.length));
            } else if (event.key === "Home") {
              event.preventDefault();
              setSelected(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setSelected(Math.max(matches.length - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              commit(selected);
            }
          }}
        />
      </div>
      {matches.length === 0 ? (
        <p className={styles.empty}>{t("No results")}</p>
      ) : (
        <ul className={styles.list} id="command-palette-list" role="listbox" ref={listRef}>
          {matches.map((command, index) => (
            <li
              key={command.id}
              id={`command-palette-item-${command.id}`}
              role="option"
              aria-selected={index === selected}
              className={cx(styles.item, index === selected && styles.active)}
              onMouseMove={() => setSelected(index)}
              onClick={() => commit(index)}
            >
              {command.icon && <Icon name={command.icon} />}
              <span className={styles.label}>{command.label}</span>
              {command.group && <span className={styles.group}>{command.group}</span>}
              {command.hint && <kbd className={styles.hint}>{command.hint}</kbd>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
