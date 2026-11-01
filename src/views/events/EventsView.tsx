import { useCallback, useEffect, useMemo, useState } from "react";

import { getJournal, hasPanelToken, type PanelJournalEntry } from "../../api/panel";
import { FcCard, FcIconButton, FcPageToolbar, FcSegmented } from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { filterBySeverity, groupJournalByDay, isEventEntry } from "../../lib/journal";
import { cx } from "../../lib/cx";
import styles from "../ops/ops.module.css";

const REFRESH_MS = 30_000;

type Tab = "events" | "operations";
type SeverityFilter = "" | "warn" | "error";

function severityClass(severity: string): string {
  if (severity === "error") {
    return styles["dot-error"];
  }
  if (severity === "warn") {
    return styles["dot-warn"];
  }
  return styles["dot-info"];
}

function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function download(entries: PanelJournalEntry[], name: string) {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 事件：异常与状态变更；操作记录：配置/服务/订阅/导入的审计时间线。 */
export function EventsView() {
  const [tab, setTab] = useState<Tab>("events");
  const [entries, setEntries] = useState<PanelJournalEntry[]>([]);
  const [severity, setSeverity] = useState<SeverityFilter>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      setError("事件中心需要面板后端");
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
  }, []);

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
    return filterBySeverity(entries.filter(isEventEntry), severity);
  }, [entries, severity, tab]);

  const groups = groupJournalByDay(filtered);

  return (
    <div className="fc-page">
      <FcPageToolbar
        title="事件"
        subtitle={tab === "events" ? "异常与状态变更" : "配置、服务、订阅与导入记录"}
        actions={
          <>
            <FcIconButton
              label="导出 JSON"
              onClick={() => download(filtered, `dracpanel-${tab}.json`)}
            >
              <Icon name="download" size={18} />
            </FcIconButton>
            <FcIconButton label="刷新" onClick={() => void load()}>
              <Icon name="sync" size={18} />
            </FcIconButton>
          </>
        }
      />
      <div className="fc-page-body">
        <div className={styles.filters}>
          <FcSegmented
            ariaLabel="事件视图"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            options={[
              { value: "events", label: "事件" },
              { value: "operations", label: "操作记录" },
            ]}
          />
          {tab === "events" && (
            <FcSegmented
              ariaLabel="事件级别"
              value={severity}
              onChange={(value) => setSeverity(value as SeverityFilter)}
              options={[
                { value: "", label: "全部" },
                { value: "warn", label: "警告" },
                { value: "error", label: "错误" },
              ]}
            />
          )}
        </div>
        {error !== "" ? (
          <div className={styles.empty}>{error}</div>
        ) : loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{tab === "events" ? "暂无事件" : "暂无操作记录"}</div>
        ) : (
          <FcCard className={styles.card}>
            {groups.map((group) => (
              <div key={group.key}>
                <div className={styles["day-label"]}>{group.label}</div>
                {group.items.map((entry, index) => (
                  <div key={`${entry.t}-${index}`} className={styles.event}>
                    <span className={styles.time}>{clock(entry.t)}</span>
                    <span className={cx(styles.dot, severityClass(entry.severity))} />
                    <span className={styles.body}>
                      <span className={styles.title}>{entry.title}</span>
                      {entry.detail && <span className={styles.detail}>{entry.detail}</span>}
                    </span>
                    <span className={styles.meta}>
                      {tab === "events" ? entry.severity : entry.kind}
                    </span>
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
