import { LogLevel } from "../gen/daemon/started_service_pb";

/**
 * Log level histogram for the logs page (doona parity, batch 4).
 *
 * sing-box log lines do not carry a reliable timestamp in every build, so the
 * histogram is built from *arrival* times recorded by the page while the stream
 * is open. A bucket therefore reads "lines that reached this tab during this
 * window" — never a value invented from the message text.
 */

export interface LogArrival {
  at: number;
  level: LogLevel;
}

export interface LogHistogramBucket {
  start: number;
  end: number;
  error: number;
  warn: number;
  info: number;
  total: number;
}

export const HISTOGRAM_BUCKET_MS = 15 * 60_000;
export const HISTOGRAM_BUCKETS = 12;

export function buildLogHistogram(
  arrivals: Iterable<LogArrival>,
  now: number,
  bucketMs = HISTOGRAM_BUCKET_MS,
  bucketCount = HISTOGRAM_BUCKETS,
): LogHistogramBucket[] {
  if (bucketMs <= 0 || bucketCount <= 0) {
    return [];
  }
  const alignedNow = Math.floor(now / bucketMs) * bucketMs;
  const firstStart = alignedNow - (bucketCount - 1) * bucketMs;
  const buckets: LogHistogramBucket[] = Array.from({ length: bucketCount }, (_, index) => {
    const start = firstStart + index * bucketMs;
    return { start, end: start + bucketMs, error: 0, warn: 0, info: 0, total: 0 };
  });
  for (const arrival of arrivals) {
    if (!Number.isFinite(arrival.at) || arrival.at < firstStart || arrival.at > now) {
      continue;
    }
    const index = Math.min(bucketCount - 1, Math.floor((arrival.at - firstStart) / bucketMs));
    const bucket = buckets[index];
    if (bucket === undefined) {
      continue;
    }
    if (arrival.level <= LogLevel.ERROR) {
      bucket.error += 1;
    } else if (arrival.level === LogLevel.WARN) {
      bucket.warn += 1;
    } else {
      bucket.info += 1;
    }
    bucket.total += 1;
  }
  return buckets;
}

export function histogramMax(buckets: readonly LogHistogramBucket[]): number {
  return buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0);
}

/** Entries per minute over the trailing window, for the streaming indicator. */
export function arrivalsPerMinute(arrivals: Iterable<LogArrival>, now: number, windowMs = 60_000): number {
  if (windowMs <= 0) {
    return 0;
  }
  let count = 0;
  for (const arrival of arrivals) {
    if (arrival.at > now - windowMs && arrival.at <= now) {
      count += 1;
    }
  }
  return Math.round((count / windowMs) * 60_000);
}
