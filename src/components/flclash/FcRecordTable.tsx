import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { cx } from "../../lib/cx";
import styles from "./FcRecordTable.module.css";

export interface FcColumn<T> {
  key: string;
  label: ReactNode;
  width?: number;
  flex?: number;
  minWidth?: number;
  align?: "start" | "end";
  /** Hide the column when the table is narrower than this (px). */
  hideBelow?: number;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface FcRecordTableProps<T> {
  columns: readonly FcColumn<T>[];
  rows: readonly T[];
  getKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  emptyLabel?: ReactNode;
  className?: string;
  bodyClassName?: string;
  rowClassName?: (row: T) => string | false | undefined;
  maxRows?: number;
  dense?: boolean;
}

function useElementWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => setWidth(element.clientWidth || 1200);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** FlClash record table: sticky tonal header, 34px rows, responsive columns. */
export function FcRecordTable<T>({
  columns,
  rows,
  getKey,
  onRowClick,
  sortKey,
  sortDirection = "desc",
  onSort,
  emptyLabel = "暂无数据",
  className,
  bodyClassName,
  rowClassName,
  maxRows = 100,
  dense = false,
}: FcRecordTableProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const visibleColumns = columns.filter(
    (column) => column.hideBelow === undefined || width >= column.hideBelow,
  );
  const template = visibleColumns
    .map((column) =>
      column.width !== undefined
        ? `${column.width}px`
        : `minmax(${column.minWidth ?? 0}px, ${column.flex ?? 1}fr)`,
    )
    .join(" ");
  const visibleRows = rows.slice(0, maxRows);
  const hasMore = rows.length > maxRows;

  return (
    <div ref={wrapRef} className={cx(styles.wrap, dense && styles.dense, className)} role="table">
      <div
        className={styles.header}
        role="row"
        style={{ "--fc-record-columns": template } as CSSProperties}
      >
        {visibleColumns.map((column) => {
          const active = column.sortable && sortKey === column.key;
          return (
            <div
              key={column.key}
              role="columnheader"
              aria-sort={
                active ? (sortDirection === "asc" ? "ascending" : "descending") : undefined
              }
              className={cx(styles.headerCell, column.align === "end" && styles.end)}
            >
              {column.sortable && onSort ? (
                <button
                  type="button"
                  className={styles.sortButton}
                  onClick={() => onSort(column.key)}
                >
                  <span>{column.label}</span>
                  <span className={cx(styles.sortMark, active && styles.sortActive)}>
                    {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </button>
              ) : (
                <span className={styles.headerLabel}>{column.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className={cx(styles.body, bodyClassName)} role="rowgroup">
        {visibleRows.length === 0 ? (
          <div className={styles.empty}>{emptyLabel}</div>
        ) : (
          visibleRows.map((row) => {
            const clickable = onRowClick !== undefined;
            return (
              <div
                key={getKey(row)}
                role="row"
                tabIndex={clickable ? 0 : undefined}
                className={cx(
                  styles.row,
                  clickable && styles.clickable,
                  rowClassName?.(row),
                )}
                style={{ "--fc-record-columns": template } as CSSProperties}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {visibleColumns.map((column) => (
                  <div
                    key={column.key}
                    role="cell"
                    className={cx(styles.cell, column.align === "end" && styles.end)}
                  >
                    {column.render(row)}
                  </div>
                ))}
              </div>
            );
          })
        )}
        {hasMore && <div className={styles.fade} aria-hidden="true" />}
      </div>
    </div>
  );
}

/** 22px rounded process avatar used by the connection/request tables. */
export function FcAvatar({ name, className }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={cx(styles.avatar, className)} title={name}>
      {letter}
    </span>
  );
}
