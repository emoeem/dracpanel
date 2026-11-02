import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import type { LogEntry } from "../api/daemon";
import { pad2 } from "../api/format";
import { isTerminalCode, useStream } from "../api/stream";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { useStreamOutage } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { useVirtualList } from "../app/useVirtualList";
import { Icon } from "../components/Icon";
import { StreamErrorBanner } from "../components/StreamBanner";
import { MenuItem, OthersMenu, SubMenu } from "../components/ui";
import {
  FcBadge,
  FcButton,
  FcCard,
  FcEmptyState,
  FcField,
  FcIconButton,
  FcPageToolbar,
  FcSearchField,
  FcSelect,
  FcSheet,
  type FcBadgeTone,
} from "../components/flclash";
import { LogLevel } from "../gen/daemon/started_service_pb";
import { ansiColorCss, parseAnsi, parseCssColor, stripAnsi, type Rgb } from "../lib/ansi";
import { extractLogType } from "../lib/logTools";
import {
  HISTOGRAM_BUCKET_MS,
  arrivalsPerMinute,
  buildLogHistogram,
  histogramMax,
} from "../lib/logHistogram";
import { canShare, shareError, shareFile } from "../lib/sharing";
import { cx } from "../lib/cx";
import { loadStoredJson, saveStoredJson } from "../lib/storage";
import { downloadTextFile } from "../lib/connectionTools";
import styles from "./LogsView.module.css";

const MAX_VISIBLE_LOGS = 1000;
const LOG_TYPE_KEY = "log-type-filter";
const LOG_HIDE_REGEX_KEY = "log-hide-regex";
const LOG_MAX_ENTRIES_KEY = "log-max-entries";
const MAX_ENTRY_OPTIONS = [200, 500, 1000, 3000, 10000] as const;

/** Log lines wrap, so the estimate only has to be close, not exact. */
const LOG_LINE_ESTIMATE = 27;

function logKey(entry: LogEntry): string {
  return String(entry.id);
}

function loadStringPreference(key: string, fallback: string): string {
  const value = loadStoredJson(key);
  return typeof value === "string" ? value : fallback;
}

function loadNumberPreference(key: string, fallback: number): number {
  const value = loadStoredJson(key);
  return typeof value === "number" && MAX_ENTRY_OPTIONS.includes(value as (typeof MAX_ENTRY_OPTIONS)[number])
    ? value
    : fallback;
}

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: LogLevel.ERROR, label: "Error" },
  { value: LogLevel.WARN, label: "Warn" },
  { value: LogLevel.INFO, label: "Info" },
  { value: LogLevel.DEBUG, label: "Debug" },
  { value: LogLevel.TRACE, label: "Trace" },
];

/**
 * Level → chip. PANIC/FATAL/ERROR all read as errors, WARN as warning, INFO as
 * the calm default and DEBUG/TRACE as faint outline chips so a staircase of
 * trace lines never competes with the one error above it.
 */
function levelChip(level: LogLevel): { label: string; tone: FcBadgeTone; variant: "soft" | "outline" } {
  if (level <= LogLevel.ERROR) {
    return { label: level === LogLevel.PANIC ? "PANIC" : level === LogLevel.FATAL ? "FATAL" : "ERROR", tone: "error", variant: "soft" };
  }
  if (level === LogLevel.WARN) {
    return { label: "WARN", tone: "warning", variant: "soft" };
  }
  if (level === LogLevel.INFO) {
    return { label: "INFO", tone: "neutral", variant: "soft" };
  }
  return { label: level === LogLevel.DEBUG ? "DEBUG" : "TRACE", tone: "neutral", variant: "outline" };
}

function useLogBackground(): Rgb {
  const [background, setBackground] = useState<Rgb>(() => resolveBackground());
  useEffect(() => {
    const observer = new MutationObserver(() => setBackground(resolveBackground()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return background;
}

function resolveBackground(): Rgb {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--card");
  return parseCssColor(value) ?? [255, 255, 255];
}

function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatClockSeconds(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function logFileName(): string {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${pad2(now.getHours())}.${pad2(now.getMinutes())}.${pad2(now.getSeconds())}`;
  return `logs-${timestamp}.txt`;
}

function onShareError(error: unknown): void {
  const reportableError = shareError(error);
  if (reportableError !== null) {
    showError(reportableError);
  }
}

export function LogsView() {
  const api = useApi();
  const { t } = useI18n();
  const logs = useStream(api.logs);
  const outage = useStreamOutage(logs, isTerminalCode(logs.errorCode));
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(() => loadStringPreference(LOG_TYPE_KEY, "all"));
  const [hideRegex, setHideRegex] = useState(() => loadStringPreference(LOG_HIDE_REGEX_KEY, ""));
  const [maxEntries, setMaxEntries] = useState(() => loadNumberPreference(LOG_MAX_ENTRIES_KEY, MAX_VISIBLE_LOGS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const background = useLogBackground();

  const effectiveLevel = level ?? logs.data.defaultLevel ?? LogLevel.INFO;

  const reconnect = () => {
    api.logs.reconnectNow();
  };

  const togglePause = () => {
    if (paused) {
      setPaused(false);
    } else {
      setFrozen(logs.data.entries);
      setPaused(true);
    }
  };

  const sourceEntries = paused ? frozen : logs.data.entries;

  // Arrival time is stamped once by the store when the line is pushed. Re-stamping
  // on mount used to rewrite the whole retained buffer to "now", flattening the
  // histogram into a single bar after switching pages.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const newest = sourceEntries[sourceEntries.length - 1]?.at;
    if (newest === undefined) {
      return;
    }
    // The tick can lag behind the newest line; a stale "now" would place it in
    // the future and drop it from the histogram.
    setClock((previous) => (newest > previous ? newest : previous));
  }, [sourceEntries]);

  const samples = useMemo(
    () => sourceEntries.map((entry) => ({ at: entry.at, level: entry.level })),
    [sourceEntries],
  );

  const histogram = useMemo(() => buildLogHistogram(samples, clock), [samples, clock]);
  const histogramPeak = histogramMax(histogram);
  const rate = useMemo(() => arrivalsPerMinute(samples, clock), [samples, clock]);

  const totals = useMemo(() => {
    let error = 0;
    let warn = 0;
    let info = 0;
    for (const bucket of histogram) {
      error += bucket.error;
      warn += bucket.warn;
      info += bucket.info;
    }
    return { error, warn, info };
  }, [histogram]);

  const typeOptions = useMemo(() => {
    const types = new Set<string>();
    for (const entry of sourceEntries) {
      types.add(extractLogType(entry.message));
    }
    return [...types].sort();
  }, [sourceEntries]);

  const hidePattern = useMemo(() => {
    const pattern = hideRegex.trim();
    if (pattern === "") {
      return { value: null, invalid: false };
    }
    try {
      return { value: new RegExp(pattern, "i"), invalid: false };
    } catch {
      return { value: null, invalid: true };
    }
  }, [hideRegex]);

  const filtered = useMemo(() => {
    let entries = sourceEntries.filter((entry) => entry.level <= effectiveLevel);
    if (windowStart !== null) {
      entries = entries.filter((entry) => {
        return entry.at >= windowStart && entry.at < windowStart + HISTOGRAM_BUCKET_MS;
      });
    }
    if (typeFilter !== "all") {
      entries = entries.filter((entry) => extractLogType(entry.message) === typeFilter);
    }
    if (hidePattern.value !== null) {
      entries = entries.filter((entry) => !hidePattern.value!.test(stripAnsi(entry.message)));
    }
    const query = search.trim().toLowerCase();
    if (query !== "") {
      entries = entries.filter((entry) => stripAnsi(entry.message).toLowerCase().includes(query));
    }
    return entries;
  }, [sourceEntries, effectiveLevel, typeFilter, hidePattern, search, windowStart]);

  const visible = useMemo(
    () =>
      filtered.length > maxEntries
        ? filtered.slice(filtered.length - maxEntries)
        : filtered,
    [filtered, maxEntries],
  );

  const virtual = useVirtualList({
    items: visible,
    getKey: logKey,
    estimate: LOG_LINE_ESTIMATE,
    overscan: 12,
    pinned: !paused,
  });

  const logsText = () => filtered.map((entry) => stripAnsi(entry.message)).join("\n");
  const sharingAvailable = canShare();

  const saveLogs = () => {
    downloadTextFile(logFileName(), logsText(), "text/plain");
  };

  const shareLogs = () => {
    const text = logsText();
    void shareFile(logFileName(), text, "text/plain").catch(onShareError);
  };

  let body: ReactNode;
  if (sourceEntries.length > 0 && outage === null && filtered.length === 0) {
    body = (
      <FcEmptyState
        icon="search"
        title={t("No results")}
        hint={t("The current level, type or search filters hide every line.")}
      />
    );
  } else if (sourceEntries.length > 0 && outage === null) {
    body = (
      <div className={styles.logView} ref={virtual.containerRef}>
        <div className={styles.logCanvas} style={{ height: virtual.height }}>
          {virtual.rows.map((row) => (
            <LogLine
              key={row.item.id}
              rowKey={String(row.item.id)}
              style={{ transform: `translateY(${row.top}px)` }}
              message={row.item.message}
              level={row.item.level}
              clock={row.item.at}
              highlight={search.trim()}
              background={background}
            />
          ))}
        </div>
      </div>
    );
  } else if (outage !== null) {
    body = null;
  } else if (logs.phase === "connecting") {
    body = (
      <FcEmptyState icon="sync" title={t("Connecting...")} />
    );
  } else {
    body = (
      <FcEmptyState
        icon="text_snippet"
        title={t("Empty logs")}
        hint={t("Lines appear here as soon as the core writes them.")}
      />
    );
  }

  const bucketLabel = (start: number, end: number) => `${formatClock(start)} – ${formatClock(end)}`;

  return (
    <div className="fc-page">
      <FcPageToolbar
        title={t("Logs")}
        subtitle={t("{count} lines", { count: filtered.length })}
        actions={
          <>
            <FcIconButton
              label={paused ? t("Resume scrolling") : t("Pause scrolling")}
              active={paused}
              onClick={togglePause}
            >
              <Icon name={paused ? "play_arrow" : "pause"} size={20} />
            </FcIconButton>
            <OthersMenu>
              <SubMenu label={t("Log Level")} icon="filter_list">
                <MenuItem checked={level === null} onSelect={() => setLevel(null)}>
                  {t("Default")}
                </MenuItem>
                {LEVEL_OPTIONS.map((option) => (
                  <MenuItem
                    key={option.value}
                    checked={level === option.value}
                    onSelect={() => setLevel(option.value)}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </SubMenu>
              <MenuItem icon="tune" onSelect={() => setSettingsOpen(true)}>
                {t("Filters")}
              </MenuItem>
              <SubMenu label={t("Save")} icon="save">
                <MenuItem
                  icon="content_copy"
                  onSelect={() => void navigator.clipboard.writeText(logsText()).catch(showError)}
                >
                  {t("To Clipboard")}
                </MenuItem>
                <MenuItem icon="save" onSelect={saveLogs}>
                  {t("To File")}
                </MenuItem>
                {sharingAvailable && (
                  <MenuItem icon="share" onSelect={shareLogs}>
                    {t("Share")}
                  </MenuItem>
                )}
              </SubMenu>
              <div className="menu-divider" />
              <MenuItem
                danger
                icon="delete"
                onSelect={() => {
                  // Clearing while paused used to leave the frozen copy on screen:
                  // the server-side buffer emptied but the list kept rendering it.
                  setFrozen([]);
                  setWindowStart(null);
                  void api.clearLogs().catch(showError);
                }}
              >
                {t("Clear Logs")}
              </MenuItem>
            </OthersMenu>
          </>
        }
      />
      <div className="fc-page-body">
        <div className={styles.controls}>
          <FcSearchField
            value={search}
            onChange={setSearch}
            placeholder={t("Search logs")}
            className={styles.search}
          />
          <span className={styles.streamState} data-state={paused ? "paused" : "live"}>
            <span className={styles.streamDot} />
            {paused ? t("Paused") : t("Streaming")}
          </span>
          <span className={styles.rate}>{t("{rate} lines per minute", { rate })}</span>
          {windowStart === null ? (
            <span className={styles.windowHint}>{t("Whole window")}</span>
          ) : (
            <button className={styles.clearWindow} onClick={() => setWindowStart(null)}>
              <Icon name="close" size={14} />
              {bucketLabel(windowStart, windowStart + HISTOGRAM_BUCKET_MS)}
            </button>
          )}
        </div>
        <StreamErrorBanner error={outage} onRetry={reconnect} />
        <FcCard className={cx(styles.surface, "fc-fill")}>
          <div className={styles.surfaceHead}>
            <span className={styles.surfaceTitle}>{t("Log volume")}</span>
            <span className={styles.surfaceCaption}>{t("Last 3 hours · one bar per 15 minutes")}</span>
            <div className={styles.legend}>
              <FcBadge tone="error" variant="outline">
                {t("Error")} {totals.error}
              </FcBadge>
              <FcBadge tone="warning" variant="outline">
                {t("Warn")} {totals.warn}
              </FcBadge>
              <FcBadge tone="neutral" variant="outline">
                {t("Info")} {totals.info}
              </FcBadge>
            </div>
          </div>
          {histogramPeak === 0 ? (
            <FcEmptyState compact icon="history" title={t("No log lines yet")} />
          ) : (
            <div className={styles.histogramWrap}>
              <div className={styles.histogram} role="group" aria-label={t("Log volume")}>
                {histogram.map((bucket) => {
                  const active = bucket.start === windowStart;
                  const label = `${bucketLabel(bucket.start, bucket.end)} · E ${bucket.error} / W ${bucket.warn} / I ${bucket.info}`;
                  return (
                    <button
                      key={bucket.start}
                      type="button"
                      className={styles.histogramBar}
                      data-active={active}
                      aria-pressed={active}
                      title={label}
                      aria-label={label}
                      onClick={() => setWindowStart((current) => (current === bucket.start ? null : bucket.start))}
                    >
                      <span
                        className={styles.histogramInfo}
                        style={{ height: `${(bucket.info / histogramPeak) * 100}%` }}
                      />
                      <span
                        className={styles.histogramWarn}
                        style={{ height: `${(bucket.warn / histogramPeak) * 100}%` }}
                      />
                      <span
                        className={styles.histogramError}
                        style={{ height: `${(bucket.error / histogramPeak) * 100}%` }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className={styles.histogramAxis}>
                <span>{formatClock(histogram[0]?.start ?? clock)}</span>
                <span>{formatClock(clock)}</span>
              </div>
            </div>
          )}
          {body}
        </FcCard>
      </div>
      {settingsOpen && (
        <FcSheet
          title={t("Filters")}
          onClose={() => setSettingsOpen(false)}
          footer={
            <>
              <FcButton
                variant="text"
                onClick={() => {
                  setTypeFilter("all");
                  setHideRegex("");
                  setMaxEntries(MAX_VISIBLE_LOGS);
                  saveStoredJson(LOG_TYPE_KEY, "all");
                  saveStoredJson(LOG_HIDE_REGEX_KEY, "");
                  saveStoredJson(LOG_MAX_ENTRIES_KEY, MAX_VISIBLE_LOGS);
                }}
              >
                {t("Reset")}
              </FcButton>
              <FcButton variant="primary" onClick={() => setSettingsOpen(false)}>
                {t("Done")}
              </FcButton>
            </>
          }
        >
          <FcField label={t("Log Type")}>
            <FcSelect
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value);
                saveStoredJson(LOG_TYPE_KEY, value);
              }}
            >
              <option value="all">{t("All types")}</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </FcSelect>
          </FcField>
          <FcField
            label={t("Hide log regex")}
            error={hidePattern.invalid ? t("Invalid regular expression") : undefined}
          >
            <input
              className={styles.sheetInput}
              value={hideRegex}
              aria-invalid={hidePattern.invalid}
              onChange={(event) => {
                setHideRegex(event.target.value);
                saveStoredJson(LOG_HIDE_REGEX_KEY, event.target.value);
              }}
            />
          </FcField>
          <FcField label={t("Max log entries")}>
            <FcSelect
              value={String(maxEntries)}
              onChange={(value) => {
                const next = Number(value);
                setMaxEntries(next);
                saveStoredJson(LOG_MAX_ENTRIES_KEY, next);
              }}
            >
              {MAX_ENTRY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </FcSelect>
          </FcField>
        </FcSheet>
      )}
    </div>
  );
}

const LogLine = memo(function LogLine(props: {
  message: string;
  level: LogLevel;
  clock: number | undefined;
  highlight: string;
  background: Rgb;
  rowKey: string;
  style: CSSProperties;
}) {
  const segments = parseAnsi(props.message);
  const query = props.highlight.toLowerCase();
  const chip = levelChip(props.level);

  const ranges: [number, number][] = [];
  if (query !== "") {
    const plain = segments.map((segment) => segment.text).join("");
    const lower = plain.toLowerCase();
    let index = lower.indexOf(query);
    while (index !== -1) {
      ranges.push([index, index + query.length]);
      index = lower.indexOf(query, index + query.length);
    }
  }

  const parts: ReactNode[] = [];
  let offset = 0;
  let key = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;

    let style: CSSProperties | undefined;
    if (segment.style) {
      style = {};
      if (segment.style.color) {
        style.color = ansiColorCss(segment.style.color, props.background);
      }
      if (segment.style.bold) {
        style.fontWeight = 700;
      }
      if (segment.style.italic) {
        style.fontStyle = "italic";
      }
      if (segment.style.underline) {
        style.textDecoration = "underline";
      }
    }

    const overlapping = ranges.filter(([from, to]) => to > start && from < end);
    let content: ReactNode;
    if (overlapping.length === 0) {
      content = segment.text;
    } else {
      const pieces: ReactNode[] = [];
      let cursor = 0;
      for (const [from, to] of overlapping) {
        const localFrom = Math.max(0, from - start);
        const localTo = Math.min(segment.text.length, to - start);
        if (localFrom > cursor) {
          pieces.push(segment.text.slice(cursor, localFrom));
        }
        pieces.push(<mark key={key++}>{segment.text.slice(localFrom, localTo)}</mark>);
        cursor = localTo;
      }
      if (cursor < segment.text.length) {
        pieces.push(segment.text.slice(cursor));
      }
      content = pieces;
    }

    if (style) {
      parts.push(
        <span key={key++} style={style}>
          {content}
        </span>,
      );
    } else {
      parts.push(<span key={key++}>{content}</span>);
    }
  }

  return (
    <div
      className={styles.logLine}
      data-level={props.level <= LogLevel.ERROR ? "error" : props.level === LogLevel.WARN ? "warn" : "info"}
      data-vkey={props.rowKey}
      style={props.style}
    >
      <span className={styles.logClock} aria-hidden="true">
        {props.clock === undefined ? "" : formatClockSeconds(props.clock)}
      </span>
      <FcBadge tone={chip.tone} variant={chip.variant} mono className={styles.logLevel}>
        {chip.label}
      </FcBadge>
      <span className={styles.logText}>{parts}</span>
    </div>
  );
});
