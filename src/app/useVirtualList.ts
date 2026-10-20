/**
 * Windowed rendering for long scrolling lists.
 *
 * Rows are measured after paint, so wrapping text (log lines) is handled: the
 * offsets start from an estimate and settle as rows scroll through the window.
 * While `pinned` is true the list keeps itself stuck to the bottom, which is
 * what a live log view wants; otherwise the topmost visible row stays put when
 * measurements shift the layout.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildOffsets,
  findRowIndex,
  sliceWindow,
  totalHeight,
  windowRange,
  type VirtualRow,
} from "../lib/virtualWindow";

export interface VirtualListOptions<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  /** Row height used until a row has been measured. */
  estimate?: number;
  overscan?: number;
  /** Keep the view glued to the newest row. */
  pinned?: boolean;
}

export interface VirtualList<T> {
  containerRef: (element: HTMLElement | null) => void;
  rows: VirtualRow<T>[];
  height: number;
}

const BOTTOM_SLACK_PX = 24;
const MAX_STALE_HEIGHTS = 400;

export function useVirtualList<T>(options: VirtualListOptions<T>): VirtualList<T> {
  const { items, getKey, estimate = 24, overscan = 8, pinned = false } = options;

  // Both a state and a ref: the state makes effects re-run when the container
  // mounts (it can appear after the first paint, replacing a placeholder),
  // while the ref is what the imperative scroll code reads and writes.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const attachContainer = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
    setContainer(element);
  }, []);
  const heightsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(heightsRef.current);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const atBottomRef = useRef(true);
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);

  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const offsets = useMemo(
    () => buildOffsets(keys.map((key) => heights.get(key) ?? estimate)),
    [estimate, heights, keys],
  );

  const range = useMemo(
    () => windowRange(offsets, scrollTop, viewportHeight, overscan),
    [offsets, overscan, scrollTop, viewportHeight],
  );
  const rows = useMemo(() => sliceWindow(items, offsets, range), [items, offsets, range]);
  const height = totalHeight(offsets);

  const onScroll = useCallback(() => {
    const view = containerRef.current;
    if (view === null) {
      return;
    }
    const top = view.scrollTop;
    setScrollTop(top);
    atBottomRef.current = view.scrollHeight - top - view.clientHeight <= BOTTOM_SLACK_PX;
    const index = findRowIndex(offsets, top);
    const key = keys[index];
    anchorRef.current = key === undefined ? null : { key, offset: top - offsets[index] };
    // `container` only re-attaches the listener; the math reads the ref.
    void container;
  }, [container, keys, offsets]);

  useLayoutEffect(() => {
    const view = containerRef.current;
    if (view === null) {
      return;
    }
    view.addEventListener("scroll", onScroll, { passive: true });
    const measureViewport = () => setViewportHeight(view.clientHeight);
    measureViewport();
    const observer = new ResizeObserver(measureViewport);
    observer.observe(view);
    return () => {
      view.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [container, onScroll]);

  // Keep the scroll position stable while measured heights replace estimates.
  useLayoutEffect(() => {
    const view = containerRef.current;
    if (view === null) {
      return;
    }
    if (pinned || atBottomRef.current) {
      view.scrollTop = view.scrollHeight;
      atBottomRef.current = true;
      return;
    }
    const anchor = anchorRef.current;
    if (anchor === null) {
      return;
    }
    const index = keys.indexOf(anchor.key);
    if (index === -1) {
      return;
    }
    view.scrollTop = offsets[index] + anchor.offset;
  }, [container, keys, offsets, pinned]);

  // Measure whatever is mounted. Runs after every commit: the window is small,
  // so walking it is cheaper than tracking per-row observers. It self-limits
  // because it only calls setHeights when a measured height actually changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally dependency-free
  useLayoutEffect(() => {
    const view = containerRef.current;
    if (view === null) {
      return;
    }
    const children = view.querySelectorAll<HTMLElement>("[data-vkey]");
    if (children.length === 0) {
      return;
    }
    const next = new Map(heightsRef.current);
    let changed = false;
    for (const child of children) {
      const key = child.dataset.vkey;
      if (key === undefined) {
        continue;
      }
      const measured = child.offsetHeight;
      if (measured > 0 && Math.abs((next.get(key) ?? -1) - measured) > 0.5) {
        next.set(key, measured);
        changed = true;
      }
    }
    if (keys.length > 0 && next.size > keys.length + MAX_STALE_HEIGHTS) {
      const live = new Set(keys);
      for (const key of [...next.keys()]) {
        if (!live.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
    }
    if (!changed) {
      return;
    }
    heightsRef.current = next;
    setHeights(next);
  });

  return { containerRef: attachContainer, rows, height };
}
