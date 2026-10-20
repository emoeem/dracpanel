/**
 * Windowing maths for long lists.
 *
 * Kept pure so it can be tested without a DOM: given per-row heights we build
 * prefix offsets, then answer "which rows intersect this scroll position?".
 */

export interface VirtualRow<T> {
  item: T;
  index: number;
  top: number;
  height: number;
}

/** Prefix sums; `offsets.length === heights.length + 1`, last entry is the total. */
export function buildOffsets(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  let total = 0;
  for (let index = 0; index < heights.length; index++) {
    total += heights[index];
    offsets[index + 1] = total;
  }
  return offsets;
}

export function totalHeight(offsets: readonly number[]): number {
  return offsets.length === 0 ? 0 : offsets[offsets.length - 1];
}

/** Index of the row that contains `offset` (clamped to the last row). */
export function findRowIndex(offsets: readonly number[], offset: number): number {
  const count = offsets.length - 1;
  if (count <= 0) {
    return 0;
  }
  if (offset <= 0) {
    return 0;
  }
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.min(low, count - 1);
}

export interface VirtualRange {
  start: number;
  /** Exclusive. */
  end: number;
}

export function windowRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): VirtualRange {
  const count = offsets.length - 1;
  if (count <= 0) {
    return { start: 0, end: 0 };
  }
  const height = viewportHeight > 0 ? viewportHeight : 1;
  const first = findRowIndex(offsets, scrollTop);
  const last = findRowIndex(offsets, scrollTop + height);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan + 1),
  };
}

export function sliceWindow<T>(
  items: readonly T[],
  offsets: readonly number[],
  range: VirtualRange,
): VirtualRow<T>[] {
  const rows: VirtualRow<T>[] = [];
  for (let index = range.start; index < range.end; index++) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }
    rows.push({ item, index, top: offsets[index], height: offsets[index + 1] - offsets[index] });
  }
  return rows;
}
