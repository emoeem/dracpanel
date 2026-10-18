export interface LatencySample {
  at: number;
  delay: number;
}

export const LATENCY_HISTORY_LIMIT = 30;

export function appendLatencySample(
  history: readonly LatencySample[],
  sample: LatencySample,
  limit = LATENCY_HISTORY_LIMIT,
): LatencySample[] {
  if (!Number.isFinite(sample.delay) || sample.delay <= 0 || limit <= 0) {
    return [...history];
  }
  const last = history[history.length - 1];
  if (last !== undefined && sample.at < last.at) {
    return [...history];
  }
  const next = last !== undefined && sample.at === last.at ? history.slice(0, -1) : [...history];
  next.push(sample);
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export interface LatencyStats {
  min: number;
  avg: number;
  max: number;
  latest: number;
  count: number;
}

export function latencyStats(history: readonly LatencySample[]): LatencyStats | null {
  const values = history.map((sample) => sample.delay).filter((delay) => delay > 0);
  if (values.length === 0) {
    return null;
  }
  let min = values[0];
  let max = values[0];
  let total = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    total += value;
  }
  return {
    min,
    avg: Math.round(total / values.length),
    max,
    latest: values[values.length - 1],
    count: values.length,
  };
}
