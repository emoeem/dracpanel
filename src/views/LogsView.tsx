import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import type { LogEntry } from "../api/daemon";
import { pad2 } from "../api/format";
import { isTerminalCode, useStream } from "../api/stream";
import { useApi } from "../app/context";
import { useDesktopHost } from "../app/desktop";
import { showError } from "../app/errorStore";
import { useStreamOutage } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { useVirtualList } from "../app/useVirtualList";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamErrorBanner } from "../components/StreamBanner";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  MenuItem,
  OthersMenu,
  SearchInput,
  Select,
  Spinner,
  SubMenu,
} from "../components/ui";
import { LogLevel } from "../gen/daemon/started_service_pb";
import { ansiColorCss, parseAnsi, parseCssColor, stripAnsi, type Rgb } from "../lib/ansi";
import { extractLogType } from "../lib/logTools";
import { canShare, shareError, shareFile } from "../lib/sharing";
import { loadStoredJson, saveStoredJson } from "../lib/storage";
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
  const host = useDesktopHost();
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
  }, [sourceEntries, effectiveLevel, typeFilter, hidePattern, search]);

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
  const sharingAvailable = canShare(host);

  const saveLogs = () => {
    const url = URL.createObjectURL(new Blob([logsText()], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = logFileName();
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareLogs = () => {
    const text = logsText();
    void shareFile(host, logFileName(), text, "text/plain").catch(onShareError);
  };

  let body: ReactNode;
  if (sourceEntries.length > 0 && outage === null && filtered.length === 0) {
    body = <EmptyState icon="search">{t("No results")}</EmptyState>;
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
      <EmptyState>
        <Spinner />
      </EmptyState>
    );
  } else {
    body = <EmptyState icon="text_snippet">{t("Empty logs")}</EmptyState>;
  }

  return (
    <div className="page page-full">
      <PageHeader
        title={t("Logs")}
        actions={
          <>
            <IconButton
              active={paused}
              title={paused ? t("Resume scrolling") : t("Pause scrolling")}
              onClick={togglePause}
            >
              <Icon name={paused ? "play_arrow" : "pause"} />
            </IconButton>
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
                  void api.clearLogs().catch(showError);
                }}
              >
                {t("Clear Logs")}
              </MenuItem>
            </OthersMenu>
          </>
        }
      />
      <div className="field">
        <SearchInput value={search} onChange={setSearch} />
      </div>
      <StreamErrorBanner error={outage} onRetry={reconnect} />
      {body}
      {settingsOpen && (
        <Dialog onClose={() => setSettingsOpen(false)}>
          <h3>{t("Filters")}</h3>
          <Field label={t("Log Type")}>
            <Select
              options={[
                { value: "all", label: t("All types") },
                ...typeOptions.map((type) => ({ value: type, label: type })),
              ]}
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value);
                saveStoredJson(LOG_TYPE_KEY, value);
              }}
            />
          </Field>
          <Field label={t("Hide log regex")}>
            <input
              className="input"
              value={hideRegex}
              aria-invalid={hidePattern.invalid}
              onChange={(event) => {
                setHideRegex(event.target.value);
                saveStoredJson(LOG_HIDE_REGEX_KEY, event.target.value);
              }}
            />
          </Field>
          <Field label={t("Max log entries")}>
            <Select
              options={MAX_ENTRY_OPTIONS.map((value) => ({
                value,
                label: String(value),
              }))}
              value={maxEntries}
              onChange={(value) => {
                setMaxEntries(value);
                saveStoredJson(LOG_MAX_ENTRIES_KEY, value);
              }}
            />
          </Field>
          <div className="row-actions dialog-actions">
            <Button
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
            </Button>
            <Button variant="primary" onClick={() => setSettingsOpen(false)}>
              {t("Done")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const LogLine = memo(function LogLine(props: {
  message: string;
  highlight: string;
  background: Rgb;
  rowKey: string;
  style: CSSProperties;
}) {
  const segments = parseAnsi(props.message);
  const query = props.highlight.toLowerCase();

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
    <div className={styles.logLine} data-vkey={props.rowKey} style={props.style}>
      {parts}
    </div>
  );
});
