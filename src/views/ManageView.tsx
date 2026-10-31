import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadServersState } from "../api/config";

/** How often the manage tab refreshes the panel state while it is visible. */
const STATE_POLL_INTERVAL_MS = 5000;
import type { DaemonApi } from "../api/daemon";
import { formatBytes, formatDateTime, isHttpUrl } from "../api/format";
import {
  applyPanelConfig,
  backupPanelConfig,
  downloadPanelBackup,
  getClashVersion,
  getEbpfPolicy,
  getPanelConfig,
  getPanelLogs,
  getPanelState,
  listApps,
  lockPanel,
  MANAGED_SERVER_ID,
  probeEbpf,
  resyncAfterConfigChange,
  restorePanelBackup,
  serviceAction,
  setEbpfPolicy,
  validatePanelConfig,
  type PanelApp,
  type PanelBackup,
  type PanelConfig,
  type PanelEbpfPolicy,
  type PanelEbpfProbeData,
  type PanelState,
} from "../api/panel";
import {
  usePanelCapabilities,
  type PanelFeature,
} from "../api/panelCapabilities";
import { useStream } from "../api/stream";
import type { JsonEditorSchema } from "../components/JsonEditor";
import { navigate, useApi, useNow } from "../app/context";
import { useI18n, type MessageKey } from "../app/i18n";
import { useAsyncGeneration } from "../app/useAsyncGeneration";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Card, Dialog, SearchInput, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { diffConfig, diffLines, formatDiffValue } from "../lib/configDiff";
import {
  detectInboundMode,
  inboundModeHintKey,
  INBOUND_MODE_KEYS,
} from "../lib/inboundMode";
import {
  ageParams,
  clearConfigDraft,
  draftIsMeaningful,
  formatAge,
  pushUndoEntry,
  readConfigDraft,
  readLastApplied,
  undoTop,
  UNDO_COALESCE_MS,
  writeConfigDraft,
  writeLastApplied,
  type AppliedSnapshot,
  type ConfigDraft,
} from "../lib/configDraft";
import { cx } from "../lib/cx";
import {
  isNotifyEnabled,
  loadNotifierConfig,
  NOTIFY_EVENTS,
  saveNotifierConfig,
  sendNotification,
  type NotifierConfig,
  type NotifyEvent,
} from "../lib/notifier";
import styles from "./ManageView.module.css";

const JsonEditor = lazy(() =>
  import("../components/JsonEditor").then((module) => ({ default: module.JsonEditor })),
);

type Tab = "status" | "ebpf" | "config" | "notify";
const TAB_KEY = "panel_manage_tab";

const PANEL_FEATURE_LABELS: Partial<Record<PanelFeature, MessageKey>> = {
  "subscriptions.schedule": "Subscription auto-update",
  "subscriptions.managed": "Managed subscription node lookup",
  "subscriptions.userinfo": "Subscription traffic and expiry info",
  "config.backup.download": "Configuration backup download",
  logs: "System logs",
  "clash.version": "Clash version check",
  geoip: "Global connection map (GeoIP)",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(seconds: number | null | undefined, language: string): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
    return "—";
  }
  return formatDateTime(seconds * 1000, language);
}


function ConfigDiffDialog(props: {
  original: string;
  text: string;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        diff: diffConfig(props.original, props.text),
        lines: diffLines(props.original, props.text),
      };
    } catch (error) {
      return { ok: false as const, message: errorText(error) };
    }
  }, [props.original, props.text]);

  const sensitiveCount = result.ok
    ? result.diff.changes.filter((change) => change.sensitive).length
    : 0;

  return (
    <Dialog
      className={styles.diffDialog}
      onClose={() => (props.busy ? undefined : props.onClose())}
    >
      <h3>{t("Changes before applying the configuration")}</h3>
      {!result.ok ? (
        <div className={styles.errorBox}>
          {t("The configuration cannot be parsed yet: {message}. Fix the syntax, then view the diff.", {
            message: result.message,
          })}
        </div>
      ) : result.diff.changes.length === 0 ? (
        <p className="dialog-message">
          {t("The configuration has not changed, so there is nothing to apply.")}
        </p>
      ) : (
        <>
          <p className="dialog-message">
            {result.diff.truncated
              ? t("Showing the first {count} changes, with more to follow", {
                  count: result.diff.changes.length,
                })
              : t("{count} changes in total", { count: result.diff.changes.length })}
            {sensitiveCount > 0
              ? t(" {count} of them touch listeners, DNS, routing, outbounds or secrets.", {
                  count: sensitiveCount,
                })
              : "."}
          </p>

          <div className={styles.diffSummary} aria-label={t("Field-level change summary")}>
            {result.diff.changes.map((change) => {
              const before = change.sensitive
                ? t("(hidden)")
                : formatDiffValue(change.before);
              const after = change.sensitive
                ? t("(hidden)")
                : formatDiffValue(change.after);
              const kindClass =
                change.kind === "added"
                  ? styles.diffKindAdded
                  : change.kind === "removed"
                    ? styles.diffKindRemoved
                    : styles.diffKindChanged;
              return (
                <div
                  key={`${change.kind}:${change.path}`}
                  className={cx(
                    styles.diffSummaryRow,
                    change.sensitive && styles.diffSensitive,
                  )}
                >
                  <span className={cx(styles.diffKind, kindClass)}>
                    {change.kind === "added"
                      ? t("Added")
                      : change.kind === "removed"
                        ? t("Delete")
                        : t("Modified")}
                  </span>
                  <code>{change.path || "$"}</code>
                  <span>
                    {change.kind === "added"
                      ? after
                      : change.kind === "removed"
                        ? before
                        : `${before} → ${after}`}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className={styles.diffLines}
            role="region"
            aria-label={t("Line-level configuration diff")}
          >
            {result.lines.map((line, index) => (
              <div
                key={`${index}:${line.kind}`}
                className={cx(
                  styles.diffLine,
                  line.kind === "added" && styles.diffAdded,
                  line.kind === "removed" && styles.diffRemoved,
                )}
              >
                <span className={styles.diffLineNo}>{line.oldLine ?? ""}</span>
                <span className={styles.diffLineNo}>{line.newLine ?? ""}</span>
                <span className={styles.diffSign}>
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                </span>
                <code>{line.text === "" ? " " : line.text}</code>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="row-actions dialog-actions">
        <Button onClick={props.onClose} disabled={props.busy}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={props.onApply}
          disabled={props.busy || !result.ok || result.diff.changes.length === 0}
        >
          {props.busy ? <Spinner /> : t("Apply and restart")}
        </Button>
      </div>
    </Dialog>
  );
}

async function afterConfigChange(api: DaemonApi) {
  const result = await resyncAfterConfigChange();
  if (result.serverChanged) {
    window.location.reload();
    return;
  }
  api.reconnectNow();
}

export function ManageView() {
  const { t } = useI18n();
  const capabilities = usePanelCapabilities();
  const missingFeatures = capabilities.detected
    ? capabilities.missing.filter((feature) => feature !== "subscriptions.userinfo")
    : [];
  const [tab, setTab] = useState<Tab>(() => {
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === "subscriptions") {
      // The subscriptions tab moved to the dedicated Profiles page.
      navigate("profiles");
      return "status";
    }
    return stored === "ebpf" || stored === "config" || stored === "notify"
      ? stored
      : "status";
  });
  // Keep a tab mounted after its first visit so drafts survive switching, but
  // do not mount Status (5s polling) or fetch the full config until needed.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([tab]));

  const selectTab = (next: Tab) => {
    setTab(next);
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
    localStorage.setItem(TAB_KEY, next);
  };

  const missingLabels = missingFeatures
    .map((feature) => PANEL_FEATURE_LABELS[feature])
    .filter((label): label is MessageKey => label !== undefined)
    .map((label) => t(label));

  return (
    <div className="page">
      <PageHeader
        title={t("System")}
        actions={
          <Button
            onClick={() => {
              lockPanel();
              window.location.reload();
            }}
          >
            {t("Lock panel")}
          </Button>
        }
      />
      {missingFeatures.length > 0 && (
        <div className={styles.warnBox}>
          {t(
            "This sing-box-panel is missing the following endpoints: {features}. They become available after upgrading to 0.1.0-8; the other management features are unaffected.",
            { features: missingLabels.join(", ") },
          )}
        </div>
      )}
      <div className={styles.tabs}>
        <button type="button" className={cx(styles.tab, tab === "status" && styles.active)} onClick={() => selectTab("status")}>
          <Icon name="power_settings_new" /> {t("Service status")}
        </button>
        <button type="button" className={cx(styles.tab, tab === "ebpf" && styles.active)} onClick={() => selectTab("ebpf")}>
          <Icon name="filter_list" /> eBPF
        </button>
        <button type="button" className={cx(styles.tab, tab === "config" && styles.active)} onClick={() => selectTab("config")}>
          <Icon name="description" /> {t("Configuration")}
        </button>
        <button type="button" className={cx(styles.tab, tab === "notify" && styles.active)} onClick={() => selectTab("notify")}>
          <Icon name="notifications" /> {t("Notifications")}
        </button>
      </div>

      {tab === "status" && <StatusTab />}
      {visited.has("ebpf") && (
        <div hidden={tab !== "ebpf"}>
          <EbpfTab />
        </div>
      )}
      {visited.has("config") && (
        <div hidden={tab !== "config"}>
          <ConfigTab />
        </div>
      )}
      {visited.has("notify") && (
        <div hidden={tab !== "notify"}>
          <NotificationsTab />
        </div>
      )}
    </div>
  );
}

/* ── 通知 ─────────────────────────────────────────────────── */

function NotificationsTab() {
  const { t } = useI18n();
  const [config, setConfig] = useState<NotifierConfig>(() => loadNotifierConfig());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");

  const update = (next: NotifierConfig) => {
    setConfig(next);
    saveNotifierConfig(next);
    setResult("");
  };

  const toggleEvent = (event: NotifyEvent, on: boolean) => {
    update({ ...config, events: on ? [...config.events, event] : config.events.filter((e) => e !== event) });
  };

  const test = async () => {
    if (!isNotifyEnabled(config, "error")) {
      setResult(t("Enter a webhook URL and select at least one event first."));
      return;
    }
    setTesting(true);
    setResult("");
    const delivered = await sendNotification(
      {
        event: "error",
        title: "测试通知",
        detail: t("Receiving it means the webhook is configured correctly."),
        at: Date.now(),
      },
      config,
    );
    setResult(
      delivered ? t("Delivered.") : t("Failed to send; check the address and your network."),
    );
    setTesting(false);
  };

  return (
    <div className={styles.section}>
      <Card title={t("Webhook notifications")}>
        <p className={styles.note}>
          {t(
            "The panel only runs while this tab is open, and browsers do not allow background push. To keep receiving alerts after closing the page, the only workable option is POSTing events to your own webhook (Slack, DingTalk, ntfy, a self-hosted service, and so on). The address is stored in this browser only and is never uploaded.",
          )}
        </p>
        <div className={styles.formRow}>
          <label className={cx(styles.label, styles.grow)}>
            {t("Webhook URL")}
            <input
              placeholder="https://ntfy.sh/dracpanel"
              value={config.url}
              onChange={(event) => update({ ...config, url: event.target.value })}
            />
          </label>
        </div>
        {config.url !== "" && !isHttpUrl(config.url) && (
          <div className={styles.errorText}>{t("Only http(s) addresses are accepted.")}</div>
        )}
        <div className={styles.eventList}>
          {NOTIFY_EVENTS.map((event) => (
            <label key={event.id} className={styles.eventRow}>
              <input
                type="checkbox"
                checked={config.events.includes(event.id)}
                onChange={(change) => toggleEvent(event.id, change.target.checked)}
              />
              <span>{t(event.label)}</span>
              <span className={styles.muted}>{t(event.hint)}</span>
            </label>
          ))}
        </div>
        <div className={styles.actions}>
          <Button disabled={testing || config.url === ""} onClick={() => void test()}>
            {testing ? <Spinner /> : t("Send test")}
          </Button>
          {result !== "" && <span className={styles.muted}>{result}</span>}
        </div>
        <pre className={styles.codeBlock} aria-hidden="true">
          {`POST ${config.url === "" ? "https://…" : config.url}
content-type: application/json

{"event":"error","title":"…","detail":"…","at":1700000000000}`}
        </pre>
      </Card>
    </div>
  );
}

/* ── 运行状态 ─────────────────────────────────────────────── */

function StatusTab() {
  const api = useApi();
  const { t } = useI18n();
  const capabilities = usePanelCapabilities();
  const logsSupported = !capabilities.detected || capabilities.supports("logs");
  const clashSupported =
    !capabilities.detected || capabilities.supports("clash.version");
  const native = useStream(api.status);
  const [state, setState] = useState<PanelState | null>(null);
  // Read-only: the panel HTTP API exposes no endpoint to switch capture modes.
  const inbound = useMemo(() => detectInboundMode(state?.inbounds), [state?.inbounds]);
  const inboundHint = inboundModeHintKey(inbound.mode);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [waitAttempt, setWaitAttempt] = useState(0);
  const [logs, setLogs] = useState("");
  const [logsError, setLogsError] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [clashStatus, setClashStatus] = useState<"checking" | "online" | "offline">("checking");
  const [clashVersion, setClashVersion] = useState("");
  const cancelWait = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
      cancelWait.current = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setState(await getPanelState());
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

  const loadLogs = useCallback(async () => {
    if (!logsSupported) {
      setLogs("");
      setLogsError(t("This panel does not support /api/logs; upgrade to 0.1.0-8 to view system logs."));
      setLogsLoading(false);
      return;
    }
    setLogsLoading(true);
    try {
      const result = await getPanelLogs(200);
      setLogs(result.lines ?? "");
      setLogsError("");
    } catch (cause) {
      setLogsError(errorText(cause));
    } finally {
      setLogsLoading(false);
    }
  }, [logsSupported, t]);

  const loadClash = useCallback(async () => {
    if (!clashSupported) {
      setClashStatus("offline");
      setClashVersion("");
      return;
    }
    setClashStatus("checking");
    try {
      const result = await getClashVersion();
      setClashStatus(result.ok ? "online" : "offline");
      setClashVersion(typeof result.data?.version === "string" ? result.data.version : "");
    } catch {
      setClashStatus("offline");
      setClashVersion("");
    }
  }, [clashSupported]);

  useEffect(() => {
    void load();
    void loadLogs();
    void loadClash();
    // Skip the poll while the tab is in the background, then refresh immediately
    // on return so the panel never shows a stale 5-second-old snapshot.
    const tick = () => {
      if (document.hidden) {
        return;
      }
      void load();
    };
    const handle = window.setInterval(tick, STATE_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, loadLogs, loadClash]);

  const copyClashSecret = async () => {
    if (!state?.clash_secret) {
      return;
    }
    if (!navigator.clipboard) {
      setActionError(t("This browser does not support the clipboard"));
      return;
    }
    try {
      await navigator.clipboard.writeText(state.clash_secret);
      setMessage(t("Clash API secret copied"));
    } catch (cause) {
      setActionError(errorText(cause));
    }
  };

  const run = async (action: "start" | "stop" | "restart" | "reload") => {
    setBusy(true);
    setActionError("");
    setMessage("");
    cancelWait.current = false;
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        await load();
        setActionError(result.message ?? t("Service action failed"));
        return;
      }
      setMessage(result.message ?? "");
      if (action === "stop") {
        await load();
        return;
      }

      let started = false;
      setWaiting(true);
      setWaitAttempt(0);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(500);
        if (!mounted.current || cancelWait.current) {
          break;
        }
        setWaitAttempt(attempt + 1);
        const next = await getPanelState();
        if (!mounted.current || cancelWait.current) {
          break;
        }
        setState(next);
        if (next.service?.active) {
          started = true;
          break;
        }
      }
      setWaiting(false);
      if (!mounted.current) {
        return;
      }
      await load();
      if (started) {
        api.reconnectNow();
        void loadClash();
      } else if (cancelWait.current) {
        setMessage(t("Stopped waiting; the core may still be starting, refresh later."));
      } else {
        setMessage("");
        setActionError(
          t(
            "The core did not confirm startup within 15 seconds; check the system log below, or run journalctl -u sing-box.",
          ),
        );
        void loadLogs();
      }
    } catch (cause) {
      if (mounted.current) {
        setActionError(errorText(cause));
      }
    } finally {
      if (mounted.current) {
        setWaiting(false);
        setBusy(false);
        setConfirm(null);
      }
    }
  };

  const current = native.data.current;
  const active = state?.service?.active ?? false;
  const managedServer = loadServersState().servers.find((server) => server.id === MANAGED_SERVER_ID);
  const nativeSecretEmpty = managedServer !== undefined && managedServer.secret === "";

  return (
    <div className={styles.section}>
      {actionError !== "" && <div className={styles.errorBox}>{actionError}</div>}
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}
      {state?.config_error ? (
        <div className={styles.warnBox}>
          {t("Failed to read the configuration: {reason}", { reason: state.config_error })}
        </div>
      ) : null}
      {nativeSecretEmpty && (
        <div className={styles.warnBox}>
          {t(
            "The native API secret is empty: other local processes can control sing-box directly. Set a non-empty secret under services.api.",
          )}
        </div>
      )}
      {waiting && (
        <div className={styles.toolbar}>
          <span className={styles.muted}>
            {t("Waiting for the core to start… {attempt}/30", { attempt: waitAttempt })}
          </span>
          <Button
            size="small"
            onClick={() => {
              cancelWait.current = true;
            }}
          >
            {t("Stop waiting")}
          </Button>
        </div>
      )}

      <div className={styles.cards}>
        <Card title={t("Services")}>
          <div className={styles.statusLine}>
            <span className={cx(styles.dot, active ? styles.online : styles.offline)} />
            <strong>{active ? t("Running") : t("Stopped")}</strong>
            {state?.service?.enabled && <span className={styles.muted}>{t("Start at boot")}</span>}
          </div>
          <dl className={styles.facts}>
            <dt>PID</dt>
            <dd>{state?.service?.pid || "—"}</dd>
            <dt>{t("Started at")}</dt>
            <dd>{state?.service?.since || "—"}</dd>
            <dt>{t("Core version")}</dt>
            <dd>{state?.version || "—"}</dd>
          </dl>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void run("start")} disabled={busy || active}>
              {t("Start service")}
            </Button>
            <Button onClick={() => setConfirm("restart")} disabled={busy}>
              {t("Restart")}
            </Button>
            <Button onClick={() => void run("reload")} disabled={busy || !active}>
              {t("Reload")}
            </Button>
            <Button variant="danger" onClick={() => setConfirm("stop")} disabled={busy || !active}>
              {t("Stop")}
            </Button>
          </div>
        </Card>

        <Card title={t("Live traffic")}>
          <dl className={styles.facts}>
            <dt>{t("Uplink")}</dt>
            <dd>{current?.trafficAvailable ? `${formatBytes(current.uplink)}/s` : "—"}</dd>
            <dt>{t("Downlink")}</dt>
            <dd>{current?.trafficAvailable ? `${formatBytes(current.downlink)}/s` : "—"}</dd>
            <dt>{t("Total uplink")}</dt>
            <dd>{current?.trafficAvailable ? formatBytes(current.uplinkTotal) : "—"}</dd>
            <dt>{t("Total downlink")}</dt>
            <dd>{current?.trafficAvailable ? formatBytes(current.downlinkTotal) : "—"}</dd>
            <dt>{t("Connections")}</dt>
            <dd>
              {current
                ? t("{inbound} in / {outbound} out", {
                    inbound: current.connectionsIn,
                    outbound: current.connectionsOut,
                  })
                : "—"}
            </dd>
          </dl>
        </Card>

        <Card title={t("Configuration file")}>
          <dl className={styles.facts}>
            <dt>{t("Path")}</dt>
            <dd className={styles.mono}>{state?.config_path || "—"}</dd>
            <dt>{t("Size")}</dt>
            <dd>{state?.config_bytes !== undefined ? formatBytes(state.config_bytes) : "—"}</dd>
            <dt>{t("Modified")}</dt>
            <dd>
              {state?.config_mtime
                ? new Date(state.config_mtime * 1000).toLocaleString()
                : "—"}
            </dd>
            <dt>{t("Run mode")}</dt>
            <dd>{state?.mode || "—"}</dd>
          </dl>
        </Card>
      </div>

      <Card title={t("Integrations and alternate dashboards")}>
        <dl className={styles.facts}>
          <dt>Clash API</dt>
          <dd className={styles.mono}>{state?.clash_api || "—"}</dd>
          <dt>{t("Status")}</dt>
          <dd>
            {!clashSupported ? (
              <span className={styles.muted}>{t("Not supported by this panel, requires 0.1.0-8")}</span>
            ) : clashStatus === "checking" ? (
              <span className={styles.muted}>{t("Checking…")}</span>
            ) : (
              <>
                <span
                  className={cx(
                    styles.dot,
                    clashStatus === "online" ? styles.online : styles.offline,
                  )}
                />{" "}
                <span>
                  {clashStatus === "online" ? t("Online") : t("Unavailable")}
                  {clashVersion ? ` · ${clashVersion}` : ""}
                </span>
              </>
            )}
            <Button
              size="small"
              onClick={() => void loadClash()}
              disabled={busy || !clashSupported}
            >
              {t("Check")}
            </Button>
          </dd>
          <dt>{t("Clash secret")}</dt>
          <dd>
            <span className={styles.mono}>{state?.clash_secret || t("(not set)")}</span>
            {state?.clash_secret ? (
              <Button size="small" onClick={() => void copyClashSecret()}>
                {t("Copy")}
              </Button>
            ) : null}
          </dd>
          <dt>Panel</dt>
          <dd>
            {state?.panel_version || "—"}
            {state?.dry_run ? <span className={styles.muted}> · dry-run</span> : null}
          </dd>
          <dt>{t("Token file")}</dt>
          <dd className={styles.mono}>{state?.token_file || "—"}</dd>
          <dt>{t("Inbound")}</dt>
          <dd>
            {inbound.mode === "unknown" ? (
              "—"
            ) : (
              <>
                <Badge tone={inbound.tun || inbound.ebpf ? "accent" : "neutral"}>
                  {t(INBOUND_MODE_KEYS[inbound.mode] as MessageKey)}
                </Badge>
                {inbound.types.length > 0 ? (
                  <span className={styles.muted}> · {inbound.types.join(" / ")}</span>
                ) : null}
              </>
            )}
            {inboundHint !== null && (
              <div className="hint">{t(inboundHint as MessageKey)}</div>
            )}
          </dd>
        </dl>
        <div className={styles.actions}>
          {state?.zash_setup_url && state?.zashboard_available !== false && isHttpUrl(state.zash_setup_url) ? (
            <a href={state.zash_setup_url} target="_blank" rel="noreferrer">
              {t("zashboard (secret filled in automatically)")}
            </a>
          ) : null}
          {state?.metacubexd_url && isHttpUrl(state.metacubexd_url) ? (
            <a href={state.metacubexd_url} target="_blank" rel="noreferrer">
              MetaCubeXD
            </a>
          ) : null}
          {state?.official_dashboard_available === true && state.official_dashboard_url && isHttpUrl(state.official_dashboard_url) ? (
            <a href={state.official_dashboard_url} target="_blank" rel="noreferrer">
              {t("Official dashboard")}
            </a>
          ) : null}
        </div>
      </Card>

      <Card title={t("System logs")}>
        <div className={styles.toolbar}>
          <span className={styles.muted}>{t("journalctl -u sing-box · last 200 lines")}</span>
          <Button
            size="small"
            onClick={() => void loadLogs()}
            disabled={logsLoading || !logsSupported}
          >
            {logsLoading ? <Spinner /> : t("Refresh")}
          </Button>
        </div>
        {logsError !== "" && <div className={styles.errorBox}>{logsError}</div>}
        <pre className={styles.probeResult}>{logs || t("(empty)")}</pre>
      </Card>

      {confirm !== null && (
        <ConfirmDialog
          title={confirm === "stop" ? t("Stop sing-box") : t("Restart sing-box")}
          message={
            confirm === "stop"
              ? t(
                  "After stopping, every proxy connection drops; the panel can still restart the core from the Manage page.",
                )
              : t("Restarting interrupts all connections briefly; traffic reconnects automatically.")
          }
          confirmLabel={confirm === "stop" ? t("Stop") : t("Restart")}
          danger={confirm === "stop"}
          busy={busy}
          onConfirm={() => void run(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ── 订阅 ─────────────────────────────────────────────────── */

/* ── eBPF ─────────────────────────────────────────────────── */

function EbpfTab() {
  const api = useApi();
  const { t } = useI18n();
  const [policy, setPolicy] = useState<PanelEbpfPolicy | null>(null);
  const [apps, setApps] = useState<PanelApp[]>([]);
  const [mode, setMode] = useState<"off" | "blacklist" | "whitelist">("off");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [probeIface, setProbeIface] = useState("");
  const [probeResult, setProbeResult] = useState<PanelEbpfProbeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);

  const generation = useAsyncGeneration();

  const load = useCallback(async () => {
    const round = generation.begin();
    try {
      const [nextPolicy, nextApps] = await Promise.all([getEbpfPolicy(), listApps()]);
      if (!generation.isCurrent(round)) {
        return;
      }
      setPolicy(nextPolicy);
      setApps(nextApps.apps ?? []);
      setMode(nextPolicy.mode === "blacklist" || nextPolicy.mode === "whitelist" ? nextPolicy.mode : "off");
      setSelected(new Set((nextPolicy.uids ?? []).map(Number)));
      setError("");
    } catch (cause) {
      if (generation.isCurrent(round)) {
        setError(errorText(cause));
      }
    }
  }, [generation]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await setEbpfPolicy(mode, [...selected]);
      setMessage(result.message ?? "");
      if (result.ok) {
        await afterConfigChange(api);
        await load();
      } else {
        setError(result.message ?? t("Failed to apply"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  };

  const probe = async () => {
    setBusy(true);
    setProbeResult(null);
    try {
      const result = await probeEbpf(probeIface.trim());
      setProbeResult(result.data ?? null);
      setError(result.ok && result.data?.ok !== false ? "" : t("Probe returned an error"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const query = search.trim().toLowerCase();
  const filtered = apps.filter((app) => {
    if (query === "") {
      return true;
    }
    return (
      String(app.uid).includes(query) ||
      app.label.toLowerCase().includes(query) ||
      app.execs.some((exec) => exec.toLowerCase().includes(query))
    );
  });
  const visible = filtered.slice(0, 400);
  const present = policy?.present ?? false;

  return (
    <div className={styles.section}>
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}
      {policy !== null && !present && (
        <div className={styles.warnBox}>
          {t("The current configuration has no eBPF inbound, so per-app policies are unavailable.")}
        </div>
      )}

      <Card title={t("Per-app policy")}>
        <div className={styles.modeRow}>
          {(["off", "blacklist", "whitelist"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cx(styles.modeButton, mode === value && styles.active)}
              onClick={() => setMode(value)}
              disabled={!present}
            >
              {value === "off" ? t("Close") : value === "blacklist" ? t("Blacklist") : t("Whitelist")}
            </button>
          ))}
          <span className={styles.muted}>
            {mode === "blacklist"
              ? t("Selected apps bypass the proxy")
              : mode === "whitelist"
                ? t("Only selected apps use the proxy")
                : t("No app restrictions")}
          </span>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={!present || busy}>
            {t("Apply policy")}
          </Button>
          <span className={styles.muted}>{t("{count} UIDs selected", { count: selected.size })}</span>
        </div>
      </Card>

      <div className={styles.cardSplit}>
        <Card title={t("Apps ({count})", { count: filtered.length })}>
          <SearchInput value={search} onChange={setSearch} />
          <div className={styles.appList}>
            {visible.map((app) => (
              <label key={app.uid} className={styles.appRow}>
                <input
                  type="checkbox"
                  checked={selected.has(app.uid)}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) {
                        next.add(app.uid);
                      } else {
                        next.delete(app.uid);
                      }
                      return next;
                    });
                  }}
                />
                <span className={styles.appLabel}>{app.label}</span>
                <span className={styles.appMeta}>
                  UID {app.uid}
                  {app.execs.length > 0 ? ` · ${app.execs.slice(0, 2).join(", ")}` : ""}
                  {app.pids.length > 0 ? t(" · {count} processes", { count: app.pids.length }) : ""}
                </span>
              </label>
            ))}
            {visible.length === 0 && <div className={styles.empty}>{t("No matching apps")}</div>}
          </div>
          {filtered.length > visible.length && (
            <p className={styles.muted}>
              {t("Showing only the first {count} apps; use search to narrow the list.", {
                count: visible.length,
              })}
            </p>
          )}
        </Card>

        <Card title={t("Capability probe")}>
          <div className={styles.formRow}>
            <label className={cx(styles.label, styles.grow)}>
              {t("Downstream interface (optional)")}
              <input
                value={probeIface}
                onChange={(event) => setProbeIface(event.target.value)}
                placeholder={t("for example virbr0")}
                spellCheck={false}
              />
            </label>
            <Button onClick={() => void probe()} disabled={busy}>
              {busy ? <Spinner /> : t("Run probe")}
            </Button>
          </div>
          {probeResult !== null && (
            <div>
              {probeResult.summary ? (
                <p className={styles.muted}>
                  {probeResult.result
                    ? `${t("Result: {result}", { result: probeResult.result })} · `
                    : ""}
                  PASS {probeResult.summary.pass ?? 0} / FAIL{" "}
                  {probeResult.summary.fail ?? 0} / UNKNOWN{" "}
                  {probeResult.summary.unknown ?? 0}
                  {(probeResult.summary.required_issues ?? 0) > 0
                    ? t(" · {count} required issues", {
                        count: probeResult.summary.required_issues ?? 0,
                      })
                    : ""}
                </p>
              ) : null}
              {(probeResult.findings ?? []).length > 0 ? (
                <div className={styles.rows}>
                  {(probeResult.findings ?? []).map((finding, index) => (
                    <div key={`${finding.feature ?? "finding"}-${index}`} className={styles.row}>
                      <div className={styles.rowMain}>
                        <strong>{finding.feature || "—"}</strong>
                        <span
                          className={
                            typeof finding.status === "string" &&
                            finding.status.toLowerCase() === "fail"
                              ? styles.errorText
                              : styles.muted
                          }
                        >
                          {[finding.status, finding.scope, finding.importance]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className={styles.rowMeta}>{finding.detail || "—"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>{t("No structured checks.")}</p>
              )}
              <details>
                <summary className={styles.muted}>{t("Raw JSON")}</summary>
                <pre className={styles.probeResult}>{JSON.stringify(probeResult, null, 2)}</pre>
              </details>
            </div>
          )}
        </Card>
      </div>

      {confirmApply && (
        <ConfirmDialog
          title={t("Apply eBPF policy")}
          message={t(
            "This writes the configuration and restarts sing-box to apply the per-app policy; failures roll back automatically.",
          )}
          confirmLabel={t("Apply and restart")}
          busy={busy}
          onConfirm={() => void apply()}
          onClose={() => setConfirmApply(false)}
        />
      )}
    </div>
  );
}

/* ── 配置 ─────────────────────────────────────────────────── */

function ConfigTab() {
  const api = useApi();
  const now = useNow(30_000);
  const { language, t } = useI18n();
  const capabilities = usePanelCapabilities();
  const canDownload =
    !capabilities.detected || capabilities.supports("config.backup.download");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [backups, setBackups] = useState<PanelBackup[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ kind: "restore"; name: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [schema, setSchema] = useState<JsonEditorSchema | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [applied, setApplied] = useState<AppliedSnapshot | null>(() => readLastApplied());
  const [ready, setReady] = useState(false);
  const generation = useAsyncGeneration();

  // Undo snapshots are coalesced: a burst of keystrokes becomes one step.
  const previousText = useRef(text);
  const lastSnapshotAt = useRef(0);

  useEffect(() => {
    const before = previousText.current;
    previousText.current = text;
    if (before === text) {
      return;
    }
    const now = Date.now();
    if (now - lastSnapshotAt.current < UNDO_COALESCE_MS) {
      return;
    }
    lastSnapshotAt.current = now;
    setUndoStack((stack) => pushUndoEntry(stack, before));
  }, [text]);

  const applyText = useCallback((next: string) => {
    previousText.current = next;
    lastSnapshotAt.current = Date.now();
    setText(next);
  }, []);

  const undo = () => {
    setUndoStack((stack) => {
      const result = undoTop(stack);
      if (result.text !== null) {
        applyText(result.text);
      }
      return result.stack;
    });
  };

  const restoreApplied = () => {
    if (applied === null) {
      return;
    }
    setUndoStack((stack) => pushUndoEntry(stack, text));
    applyText(applied.text);
  };

  const restoreDraft = () => {
    if (draft === null) {
      return;
    }
    setUndoStack((stack) => pushUndoEntry(stack, text));
    applyText(draft.text);
    setDraft(null);
  };

  // Autosave the draft while it differs from what the daemon holds.
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (text === original) {
      if (draft === null) {
        clearConfigDraft();
      }
      return;
    }
    const timer = setTimeout(() => writeConfigDraft(text, original), 600);
    return () => clearTimeout(timer);
  }, [draft, original, ready, text]);

  const load = useCallback(async () => {
    const round = generation.begin();
    setLoading(true);
    try {
      const config: PanelConfig = await getPanelConfig();
      if (!generation.isCurrent(round)) {
        return;
      }
      setText(config.text);
      setOriginal(config.text);
      setBackups(config.backups ?? []);
      setEditorKey((value) => value + 1);
      setError("");
      // A draft from a previous session is only offered while it still differs
      // from the config the daemon actually holds.
      const saved = readConfigDraft();
      setDraft(draftIsMeaningful(saved, config.text) ? saved : null);
      setReady(true);
    } catch (cause) {
      if (!generation.isCurrent(round)) {
        return;
      }
      setError(errorText(cause));
    } finally {
      if (generation.isCurrent(round)) {
        setLoading(false);
      }
    }
  }, [generation]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}sing-box.schema.json`;
    fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (
          !cancelled &&
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          setSchema(value as JsonEditorSchema);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const validate = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await validatePanelConfig(text);
      setMessage(result.message ?? (result.ok ? t("Validation passed") : t("Validation failed")));
      if (!result.ok) {
        setError(result.message ?? t("Validation failed"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await applyPanelConfig(text);
      setMessage(result.message ?? "");
      if (result.ok) {
        const snapshot = { text, appliedAt: Date.now() };
        writeLastApplied(text);
        setApplied(snapshot);
        clearConfigDraft();
        setDraft(null);
        setUndoStack([]);
        await load();
        await afterConfigChange(api);
      } else {
        setError(result.message ?? t("Failed to apply"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setPending(null);
      setShowDiff(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await backupPanelConfig();
      setMessage(result.message ?? "");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await restorePanelBackup(name);
      setMessage(result.message ?? "");
      if (result.ok) {
        await load();
        await afterConfigChange(api);
      } else {
        setError(result.message ?? t("Failed to restore"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const download = async (name: string) => {
    if (!canDownload) {
      setError(t("This panel does not support backup downloads; available after upgrading to 0.1.0-8."));
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await downloadPanelBackup(name);
      setMessage(t("Downloaded {name}", { name }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const dirty = text !== original;

  return (
    <div className={styles.section}>
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}
      {draft !== null && (
        <div className={styles.noticeBox}>
          <div>
            {t("Found an unapplied local draft from {age}{changed}.", {
              age: t(
                formatAge(now - draft.savedAt) as MessageKey,
                ageParams(now - draft.savedAt),
              ),
              changed:
                draft.base !== original
                  ? t("; the server configuration has changed since")
                  : "",
            })}
          </div>
          <div className={styles.noticeActions}>
            <Button size="small" onClick={restoreDraft}>
              {t("Restore draft")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                clearConfigDraft();
                setDraft(null);
              }}
            >
              {t("Discard")}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <span
          className={styles.muted}
          title={t("The schema ships with the UI and is never fetched from an external site while editing")}
        >
          {loading
            ? t("Reading configuration…")
            : dirty
              ? t("Unapplied changes")
              : t("Configuration in sync")}
          {schema !== null ? t(" · Schema completion") : ""}
        </span>
        <div className={styles.actions}>
          <Button
            onClick={undo}
            disabled={undoStack.length === 0 || busy}
            title={t("Undo the last edit")}
          >
            {t("Undo")}
          </Button>
          <Button
            onClick={restoreApplied}
            disabled={busy || applied === null}
            title={t("Back to the last successfully applied configuration")}
          >
            {t("Last applied")}
          </Button>
          <Button onClick={() => void validate()} disabled={busy || loading}>
            {t("Validate")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowDiff(true)}
            disabled={busy || loading || !dirty}
          >
            {t("Apply and restart")}
          </Button>
          <Button onClick={() => void backup()} disabled={busy || loading}>
            {t("Backup")}
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : t("Refresh")}
          </Button>
        </div>
      </div>

      <div className={styles.editor}>
        {loading && text === "" ? (
          <div className={styles.editorLoading}>
            <Spinner />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className={styles.editorLoading}>
                <Spinner />
              </div>
            }
          >
            <JsonEditor
              key={editorKey}
              className={styles.jsonEditor}
              initialValue={text}
              schema={schema}
              onChange={(value) => setText(value)}
              onSave={() => setShowDiff(true)}
            />
          </Suspense>
        )}
      </div>

      <Card title={t("Backups ({count})", { count: backups.length })}>
        {backups.length === 0 ? (
          <div className={styles.empty}>{t("No backups yet")}</div>
        ) : (
          <div className={styles.rows}>
            {backups.map((item) => (
              <div key={item.name} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.mono}>{item.name}</span>
                  <span className={styles.muted}>{formatBytes(item.size)}</span>
                </div>
                <div className={styles.rowMeta}>
                  <span>{formatTime(item.mtime, language)}</span>
                </div>
                <div className={styles.actions}>
                  <Button
                    size="small"
                    onClick={() => setPending({ kind: "restore", name: item.name })}
                    disabled={busy}
                  >
                    {t("Restore")}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void download(item.name)}
                    disabled={busy || !canDownload}
                    title={!canDownload ? t("Requires sing-box-panel 0.1.0-8") : undefined}
                  >
                    {t("Download")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showDiff && (
        <ConfigDiffDialog
          original={original}
          text={text}
          busy={busy}
          onApply={() => void apply()}
          onClose={() => setShowDiff(false)}
        />
      )}

      {pending !== null && (
        <ConfirmDialog
          title={t("Restore backup")}
          message={t(
            "This restores backup “{name}” and restarts sing-box; the panel backs up the current configuration automatically.",
            { name: pending.name },
          )}
          confirmLabel={t("Restore and restart")}
          busy={busy}
          onConfirm={() => void restore(pending.name)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
