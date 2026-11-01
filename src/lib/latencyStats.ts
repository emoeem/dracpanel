/**
 * Percentile helpers for the Connections latency card. Values are plain
 * numbers (ms); empty or all-invalid input returns null so the UI can show
 * "无延迟数据" instead of a fake 0.
 */

export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sorted.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Weighted percentile: each value counts `weight` times (e.g. connections). */
export function weightedPercentile(
  values: readonly number[],
  weights: readonly number[],
  p: number,
): number | null {
  const pairs: { value: number; weight: number }[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const weight = weights[i] ?? 0;
    if (Number.isFinite(value) && value > 0 && weight > 0) {
      pairs.push({ value, weight });
    }
  }
  if (pairs.length === 0) {
    return null;
  }
  pairs.sort((a, b) => a.value - b.value);
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  const target = Math.min(1, Math.max(0, p)) * total;
  let seen = 0;
  for (const pair of pairs) {
    seen += pair.weight;
    if (seen >= target) {
      return pair.value;
    }
  }
  return pairs[pairs.length - 1].value;
}

export function countWithData(values: readonly number[]): number {
  return values.filter((value) => Number.isFinite(value) && value > 0).length;
}
