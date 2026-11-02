import { useCallback, useEffect, useMemo, useState } from "react";

import { getJournal, hasPanelToken, type PanelJournalEntry } from "../../api/panel";
import { useI18n } from "../../app/i18n";
import type { MessageKey } from "../../app/translations";
import {
  FcBadge,
  FcCard,
  FcIconButton,
  FcPageToolbar,
  FcSegmented,
  FcSwitch,
  type FcBadgeTone,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { downloadTextFile } from "../../lib/connectionTools";
import { filterBySeverity, groupJournalByDay, isEventEntry } from "../../lib/journal";
import { loadStoredJson, saveStoredJson } from "../../lib/storage";
import { cx } from "../../lib/cx";
import styles from "../ops/ops.module.css";

const REFRESH_MS = 30_000;
const HIDE_SERVICE_KEY = "events-hide-service";

type Tab = "events" | "operations";
type SeverityFilter = "" | "warn" | "error";

function severityClass(severity: string): string {
  if (severity === "error") {
    return styles.dotError;
  }
  if (severity === "warn") {
    return styles.dotWarn;
  }
  return styles.dotInfo;
}

function severityTone(severity: string): FcBadgeTone {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warn") {
    return "warning";
  }
  return "neutral";
}

/** `today` / `yesterday` come from the grouping key, not from a baked string. */
function dayLabel(key: string, t: (key: MessageKey) => string): string {
  if (key === "today") {
    return t("Today");
  }
  if (key === "yesterday") {
    return t("Yesterday");
  }
  const at = Number(key);
  return Number.isNaN(at) ? key : new Date(at).toLocaleDateString();
}

function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function download(entries: PanelJournalEntry[], name: string) {
  downloadTextFile(name, JSON.stringify(entries, null, 2), "application/json");
}

/** 事件：异常与状态变更；操作记录：配置/服务/订阅/导入的审计时间线。 */
export function EventsView() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("events");
  const [entries, setEntries] = useState<PanelJournalEntry[]>([]);
  const [severity, setSeverity] = useState<SeverityFilter>("");
  const [hideService, setHideService] = useState(() => loadStoredJson(HIDE_SERVICE_KEY) === true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      setError(t("The events center requires the panel backend"));
      return;
    }
    try {
      const next = await getJournal({ limit: 400 });
      setEntries(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === "operations") {
      return entries.filter((entry) => entry.category === "operation");
    }
    // Service start/stop rows are the panel's own chatter; doona hides them by
    // default so a restart burst cannot bury real warnings.
    const events = entries.filter((entry) => isEventEntry(entry) && !(hideService && entry.kind === "service"));
    return filterBySeverity(events, severity);
  }, [entries, hideService, severity, tab]);

  const groups = groupJournalByDay(filtered);

  return (
    <div className="fc-page">
      <FcPageToolbar
        title={t("Events")}
        subtitle={
          tab === "events"
            ? t("Exceptions and state changes")
            : t("Configuration, service, subscription and import records")
        }
        actions={
          <>
            <FcIconButton
              label={t("Export JSON")}
              onClick={() => download(filtered, `dracpanel-${tab}.json`)}
            >
              <Icon name="download" size={18} />
            </FcIconButton>
            <FcIconButton label={t("Refresh")} onClick={() => void load()}>
              <Icon name="sync" size={18} />
            </FcIconButton>
          </>
        }
      />
      <div className="fc-page-body">
        <div className={styles.filters}>
          <FcSegmented
            className={styles.filterTabs}
            ariaLabel={t("Events view")}
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: "events", label: t("Events") },
              { value: "operations", label: t("Operations") },
            ]}
          />
          {tab === "events" && (
            <>
              <FcSegmented
                className={styles.filterSeverity}
                ariaLabel={t("Event severity")}
                value={severity}
                onChange={(value) => setSeverity(value as SeverityFilter)}
                options={[
                  { value: "", label: t("All") },
                  { value: "warn", label: t("Warning") },
                  { value: "error", label: t("Error") },
                ]}
              />
              <label className={styles.toggleFixed}>
                <FcSwitch
                  checked={hideService}
                  label={t("Hide service events")}
                  onChange={(value) => {
                    setHideService(value);
                    saveStoredJson(HIDE_SERVICE_KEY, value);
                  }}
                />
                <span>{t("Hide service events")}</span>
              </label>
            </>
          )}
        </div>
        {error !== "" ? (
          <div className={styles.empty}>{error}</div>
        ) : loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{tab === "events" ? t("No events") : t("No operations")}</div>
        ) : (
          <FcCard className={styles.card}>
            {groups.map((group) => (
              <div key={group.key}>
                <div className={styles.dayLabel}>{dayLabel(group.key, t)}</div>
                {group.items.map((entry, index) => (
                  <div key={`${entry.t}-${index}`} className={styles.event}>
                    <span className={styles.time}>{clock(entry.t)}</span>
                    <span className={cx(styles.dot, severityClass(entry.severity))} />
                    <span className={styles.body}>
                      <span className={styles.title}>{entry.title}</span>
                      {entry.detail && <span className={styles.detail}>{entry.detail}</span>}
                    </span>
                    {tab === "events" ? (
                      <FcBadge tone={severityTone(entry.severity)} variant="outline" mono>
                        {entry.severity}
                      </FcBadge>
                    ) : (
                      <FcBadge tone="neutral" variant="soft">
                        {entry.kind}
                      </FcBadge>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </FcCard>
        )}
      </div>
    </div>
  );
}
