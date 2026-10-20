import { useState, type AriaAttributes, type ReactNode } from "react";

import { cx } from "../lib/cx";
import styles from "./Table.module.css";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortBy?: (row: T) => string | number;
  align?: "start" | "end";
}

type SortState = { key: string; direction: "asc" | "desc" };

export function Table<T>(props: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState | null>(null);

  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  }

  const sortColumn = sort === null ? undefined : props.columns.find((c) => c.key === sort.key);
  const sorter = sortColumn?.sortBy;
  const rows =
    sort === null || sorter === undefined
      ? props.rows
      : [...props.rows].sort((a, b) => {
          const left = sorter(a);
          const right = sorter(b);
          const order = left < right ? -1 : left > right ? 1 : 0;
          return sort.direction === "asc" ? order : -order;
        });

  return (
    <table className={cx(styles.table, props.className)}>
      <thead>
        <tr>
          {props.columns.map((col) => {
            const sortable = col.sortBy !== undefined;
            const ariaSort: AriaAttributes["aria-sort"] | undefined = !sortable
              ? undefined
              : sort?.key === col.key
                ? sort.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
            return (
              <th
                key={col.key}
                scope="col"
                aria-sort={ariaSort}
                className={cx(col.align === "end" && styles.end)}
              >
                {sortable ? (
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span>{col.header}</span>
                    <span aria-hidden="true" className={styles.indicator}>
                      {sort?.key === col.key ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                ) : (
                  col.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={styles.empty} colSpan={props.columns.length}>
              {props.empty ?? "—"}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={props.rowKey(row)}>
              {props.columns.map((col) => (
                <td key={col.key} className={cx(col.align === "end" && styles.end)}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}