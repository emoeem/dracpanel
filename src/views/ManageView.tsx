import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadServersState } from "../api/config";

/** How often the manage tab refreshes the panel state while it is visible. */
const STATE_POLL_INTERVAL_MS = 5000;
import type { DaemonApi } from "../api/daemon";
import { formatBytes, formatDateTime, isHttpUrl } from "../api/format";
import {
  addSubscription,
  applyPanelConfig,
  applySubscriptions,
  backupPanelConfig,
  deleteSubscription,
  downloadPanelBackup,
  getClashVersion,
  getEbpfPolicy,
  getManagedSubscriptions,
  getPanelConfig,
  getPanelLogs,
  getPanelState,
  listApps,
  listSubscriptions,
  lockPanel,
  MANAGED_SERVER_ID,
  probeEbpf,
  resyncAfterConfigChange,
  restorePanelBackup,
  serviceAction,
  setEbpfPolicy,
  setSubscriptionSchedule,
  updateAllSubscriptions,
  updateSubscription,
  validatePanelConfig,
  type PanelApp,
  type PanelBackup,
  type PanelConfig,
  type PanelEbpfPolicy,
  type PanelEbpfProbeData,
  type PanelManagedSubscriptions,
  type PanelState,
  type PanelSubscription,
  type PanelSubscriptionUpdate,
} from "../api/panel";
import {
  usePanelCapabilities,
  type PanelFeature,
} from "../api/panelCapabilities";
import { useStream } from "../api/stream";
import type { JsonEditorSchema } from "../components/JsonEditor";
import { useApi, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import { useAsyncGeneration } from "../app/useAsyncGeneration";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Button, Card, Dialog, SearchInput, Spinner } from "../components/ui";
import { diffConfig, diffLines, formatDiffValue } from "../lib/configDiff";
import {
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

type Tab = "status" | "subscriptions" | "ebpf" | "config" | "notify";
const TAB_KEY = "panel_manage_tab";

const PANEL_FEATURE_LABELS: Partial<Record<PanelFeature, string>> = {
  "subscriptions.schedule": "订阅自动更新",
  "subscriptions.managed": "订阅托管节点查询",
  "subscriptions.userinfo": "订阅流量/到期信息",
  "config.backup.download": "配置备份下载",
  logs: "系统日志",
  "clash.version": "Clash 版本检查",
  geoip: "全球连接地图（GeoIP）",
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

function formatInterval(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    return `每 ${seconds / 86400} 天`;
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `每 ${seconds / 3600} 小时`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `每 ${seconds / 60} 分钟`;
  }
  return `每 ${seconds} 秒`;
}

function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={() => (props.busy ? undefined : props.onClose())}>
      <h3>{props.title}</h3>
      <p className="dialog-message">{props.message}</p>
      <div className="row-actions dialog-actions">
        <Button onClick={props.onClose} disabled={props.busy}>
          取消
        </Button>
        <Button
          variant={props.danger ? "danger" : "primary"}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? <Spinner /> : props.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

function ConfigDiffDialog(props: {
  original: string;
  text: string;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
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
      <h3>应用配置前的变更</h3>
      {!result.ok ? (
        <div className={styles.errorBox}>
          配置暂时无法解析：{result.message}。请先修复语法，再查看差异。
        </div>
      ) : result.diff.changes.length === 0 ? (
        <p className="dialog-message">配置没有变化，无需应用。</p>
      ) : (
        <>
          <p className="dialog-message">
            {result.diff.truncated
              ? `已显示前 ${result.diff.changes.length} 处变更（还有更多）`
              : `共 ${result.diff.changes.length} 处变更`}
            {sensitiveCount > 0
              ? `，其中 ${sensitiveCount} 处涉及监听、DNS、路由、出站或密钥。`
              : "。"}
          </p>

          <div className={styles.diffSummary} aria-label="字段级变更摘要">
            {result.diff.changes.map((change) => {
              const before = change.sensitive
                ? "（已隐藏）"
                : formatDiffValue(change.before);
              const after = change.sensitive
                ? "（已隐藏）"
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
                      ? "新增"
                      : change.kind === "removed"
                        ? "删除"
                        : "修改"}
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
            aria-label="配置行级差异"
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
          取消
        </Button>
        <Button
          variant="primary"
          onClick={props.onApply}
          disabled={props.busy || !result.ok || result.diff.changes.length === 0}
        >
          {props.busy ? <Spinner /> : "应用并重启"}
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
    return stored === "subscriptions" ||
      stored === "ebpf" ||
      stored === "config" ||
      stored === "notify"
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

  return (
    <div className="page">
      <PageHeader
        title={t("Manage")}
        actions={
          <Button
            onClick={() => {
              lockPanel();
              window.location.reload();
            }}
          >
            锁定面板
          </Button>
        }
      />
      {missingFeatures.length > 0 && (
        <div className={styles.warnBox}>
          当前 sing-box-panel 缺少以下接口：
          {missingFeatures.map((feature) => PANEL_FEATURE_LABELS[feature]).join("、")}。
          升级到 0.1.0-8 后可用；其余管理功能不受影响。
        </div>
      )}
      <div className={styles.tabs}>
        <button type="button" className={cx(styles.tab, tab === "status" && styles.active)} onClick={() => selectTab("status")}>
          <Icon name="power_settings_new" /> 运行状态
        </button>
        <button
          type="button"
          className={cx(styles.tab, tab === "subscriptions" && styles.active)}
          onClick={() => selectTab("subscriptions")}
        >
          <Icon name="cloud_off" /> 订阅
        </button>
        <button type="button" className={cx(styles.tab, tab === "ebpf" && styles.active)} onClick={() => selectTab("ebpf")}>
          <Icon name="filter_list" /> eBPF
        </button>
        <button type="button" className={cx(styles.tab, tab === "config" && styles.active)} onClick={() => selectTab("config")}>
          <Icon name="description" /> 配置
        </button>
        <button type="button" className={cx(styles.tab, tab === "notify" && styles.active)} onClick={() => selectTab("notify")}>
          <Icon name="notifications" /> 通知
        </button>
      </div>

      {tab === "status" && <StatusTab />}
      {visited.has("subscriptions") && (
        <div hidden={tab !== "subscriptions"}>
          <SubscriptionsTab />
        </div>
      )}
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
      setResult("请先填写 Webhook 地址并勾选至少一个事件。");
      return;
    }
    setTesting(true);
    setResult("");
    const delivered = await sendNotification(
      { event: "error", title: "DracPanel 测试通知", detail: "收到即表示 Webhook 配置正确。", at: Date.now() },
      config,
    );
    setResult(delivered ? "已送达。" : "发送失败，请检查地址与网络。");
    setTesting(false);
  };

  return (
    <div className={styles.section}>
      <Card title="Webhook 通知">
        <p className={styles.note}>
          面板只在这个标签页打开时运行，浏览器不允许后台推送；若希望关闭页面后仍能收到告警，
          唯一可行的办法是把事件 POST 给你自己的 Webhook（Slack、钉钉、ntfy、自建服务等）。
          地址只保存在本机浏览器，不会上传。
        </p>
        <div className={styles.formRow}>
          <label className={cx(styles.label, styles.grow)}>
            Webhook 地址
            <input
              placeholder="https://ntfy.sh/dracpanel"
              value={config.url}
              onChange={(event) => update({ ...config, url: event.target.value })}
            />
          </label>
        </div>
        {config.url !== "" && !isHttpUrl(config.url) && (
          <div className={styles.errorText}>只接受 http(s) 地址。</div>
        )}
        <div className={styles.eventList}>
          {NOTIFY_EVENTS.map((event) => (
            <label key={event.id} className={styles.eventRow}>
              <input
                type="checkbox"
                checked={config.events.includes(event.id)}
                onChange={(change) => toggleEvent(event.id, change.target.checked)}
              />
              <span>{event.label}</span>
              <span className={styles.muted}>{event.hint}</span>
            </label>
          ))}
        </div>
        <div className={styles.actions}>
          <Button disabled={testing || config.url === ""} onClick={() => void test()}>
            {testing ? <Spinner /> : "发送测试"}
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
  const capabilities = usePanelCapabilities();
  const logsSupported = !capabilities.detected || capabilities.supports("logs");
  const clashSupported =
    !capabilities.detected || capabilities.supports("clash.version");
  const native = useStream(api.status);
  const [state, setState] = useState<PanelState | null>(null);
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
      setLogsError("当前 panel 不支持 /api/logs；升级到 0.1.0-8 后可查看系统日志。");
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
  }, [logsSupported]);

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
      setActionError("当前浏览器不支持剪贴板");
      return;
    }
    try {
      await navigator.clipboard.writeText(state.clash_secret);
      setMessage("已复制 Clash API 密钥");
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
        setActionError(result.message ?? "服务操作失败");
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
        setMessage("已停止等待；核心可能仍在启动，请稍后刷新。");
      } else {
        setMessage("");
        setActionError(
          "核心在 15 秒内未确认启动；请查看下方系统日志，或执行 journalctl -u sing-box。",
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
        <div className={styles.warnBox}>配置读取失败：{state.config_error}</div>
      ) : null}
      {nativeSecretEmpty && (
        <div className={styles.warnBox}>
          原生 API 的 secret 为空：本机其他进程可以直接控制 sing-box。请在 services.api 中设置非空 secret。
        </div>
      )}
      {waiting && (
        <div className={styles.toolbar}>
          <span className={styles.muted}>
            正在等待核心启动… {waitAttempt}/30
          </span>
          <Button
            size="small"
            onClick={() => {
              cancelWait.current = true;
            }}
          >
            停止等待
          </Button>
        </div>
      )}

      <div className={styles.cards}>
        <Card title="服务">
          <div className={styles.statusLine}>
            <span className={cx(styles.dot, active ? styles.online : styles.offline)} />
            <strong>{active ? "运行中" : "已停止"}</strong>
            {state?.service?.enabled && <span className={styles.muted}>开机自启</span>}
          </div>
          <dl className={styles.facts}>
            <dt>PID</dt>
            <dd>{state?.service?.pid || "—"}</dd>
            <dt>启动时间</dt>
            <dd>{state?.service?.since || "—"}</dd>
            <dt>内核版本</dt>
            <dd>{state?.version || "—"}</dd>
          </dl>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void run("start")} disabled={busy || active}>
              启动
            </Button>
            <Button onClick={() => setConfirm("restart")} disabled={busy}>
              重启
            </Button>
            <Button onClick={() => void run("reload")} disabled={busy || !active}>
              重载
            </Button>
            <Button variant="danger" onClick={() => setConfirm("stop")} disabled={busy || !active}>
              停止
            </Button>
          </div>
        </Card>

        <Card title="实时流量">
          <dl className={styles.facts}>
            <dt>上行</dt>
            <dd>{current?.trafficAvailable ? `${formatBytes(current.uplink)}/s` : "—"}</dd>
            <dt>下行</dt>
            <dd>{current?.trafficAvailable ? `${formatBytes(current.downlink)}/s` : "—"}</dd>
            <dt>累计上行</dt>
            <dd>{current?.trafficAvailable ? formatBytes(current.uplinkTotal) : "—"}</dd>
            <dt>累计下行</dt>
            <dd>{current?.trafficAvailable ? formatBytes(current.downlinkTotal) : "—"}</dd>
            <dt>连接</dt>
            <dd>
              {current ? `${current.connectionsIn} 入 / ${current.connectionsOut} 出` : "—"}
            </dd>
          </dl>
        </Card>

        <Card title="配置文件">
          <dl className={styles.facts}>
            <dt>路径</dt>
            <dd className={styles.mono}>{state?.config_path || "—"}</dd>
            <dt>大小</dt>
            <dd>{state?.config_bytes !== undefined ? formatBytes(state.config_bytes) : "—"}</dd>
            <dt>修改时间</dt>
            <dd>
              {state?.config_mtime
                ? new Date(state.config_mtime * 1000).toLocaleString()
                : "—"}
            </dd>
            <dt>运行模式</dt>
            <dd>{state?.mode || "—"}</dd>
          </dl>
        </Card>
      </div>

      <Card title="集成与备用入口">
        <dl className={styles.facts}>
          <dt>Clash API</dt>
          <dd className={styles.mono}>{state?.clash_api || "—"}</dd>
          <dt>状态</dt>
          <dd>
            {!clashSupported ? (
              <span className={styles.muted}>当前 panel 不支持，需要 0.1.0-8</span>
            ) : clashStatus === "checking" ? (
              <span className={styles.muted}>检查中…</span>
            ) : (
              <>
                <span
                  className={cx(
                    styles.dot,
                    clashStatus === "online" ? styles.online : styles.offline,
                  )}
                />{" "}
                <span>
                  {clashStatus === "online" ? "在线" : "不可用"}
                  {clashVersion ? ` · ${clashVersion}` : ""}
                </span>
              </>
            )}
            <Button
              size="small"
              onClick={() => void loadClash()}
              disabled={busy || !clashSupported}
            >
              检查
            </Button>
          </dd>
          <dt>Clash 密钥</dt>
          <dd>
            <span className={styles.mono}>{state?.clash_secret || "（未设置）"}</span>
            {state?.clash_secret ? (
              <Button size="small" onClick={() => void copyClashSecret()}>
                复制
              </Button>
            ) : null}
          </dd>
          <dt>Panel</dt>
          <dd>
            {state?.panel_version || "—"}
            {state?.dry_run ? <span className={styles.muted}> · dry-run</span> : null}
          </dd>
          <dt>令牌文件</dt>
          <dd className={styles.mono}>{state?.token_file || "—"}</dd>
          <dt>入站</dt>
          <dd>{state?.inbounds?.length ? state.inbounds.join(" / ") : "—"}</dd>
        </dl>
        <div className={styles.actions}>
          {state?.zash_setup_url && state?.zashboard_available !== false && isHttpUrl(state.zash_setup_url) ? (
            <a href={state.zash_setup_url} target="_blank" rel="noreferrer">
              zashboard（自动填密钥）
            </a>
          ) : null}
          {state?.metacubexd_url && isHttpUrl(state.metacubexd_url) ? (
            <a href={state.metacubexd_url} target="_blank" rel="noreferrer">
              MetaCubeXD
            </a>
          ) : null}
          {state?.official_dashboard_available === true && state.official_dashboard_url && isHttpUrl(state.official_dashboard_url) ? (
            <a href={state.official_dashboard_url} target="_blank" rel="noreferrer">
              官方 dashboard
            </a>
          ) : null}
        </div>
      </Card>

      <Card title="系统日志">
        <div className={styles.toolbar}>
          <span className={styles.muted}>journalctl -u sing-box · 最近 200 行</span>
          <Button
            size="small"
            onClick={() => void loadLogs()}
            disabled={logsLoading || !logsSupported}
          >
            {logsLoading ? <Spinner /> : "刷新"}
          </Button>
        </div>
        {logsError !== "" && <div className={styles.errorBox}>{logsError}</div>}
        <pre className={styles.probeResult}>{logs || "(空)"}</pre>
      </Card>

      {confirm !== null && (
        <ConfirmDialog
          title={confirm === "stop" ? "停止 sing-box" : "重启 sing-box"}
          message={
            confirm === "stop"
              ? "停止后所有代理连接会中断，面板仍可通过管理页重新启动核心。"
              : "重启会短暂中断所有连接，数据流会自动重连。"
          }
          confirmLabel={confirm === "stop" ? "停止" : "重启"}
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

function SubscriptionsTab() {
  const api = useApi();
  const { language } = useI18n();
  const capabilities = usePanelCapabilities();
  const managedSupported =
    !capabilities.detected || capabilities.supports("subscriptions.managed");
  const scheduleSupported =
    !capabilities.detected || capabilities.supports("subscriptions.schedule");
  const now = useNow(30_000);
  const [items, setItems] = useState<PanelSubscription[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PanelSubscription | null>(null);
  const [managed, setManaged] = useState<PanelManagedSubscriptions | null>(null);
  const generation = useAsyncGeneration();

  const load = useCallback(async () => {
    const round = generation.begin();
    setLoading(true);
    try {
      const [result, managedResult] = await Promise.allSettled([
        listSubscriptions(),
        managedSupported ? getManagedSubscriptions() : Promise.resolve(null),
      ]);
      if (!generation.isCurrent(round)) {
        return;
      }
      if (result.status === "rejected") {
        throw result.reason;
      }
      setItems(result.value.subscriptions ?? []);
      setManaged(
        managedSupported && managedResult.status === "fulfilled"
          ? managedResult.value
          : null,
      );
      setError("");
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
  }, [generation, managedSupported]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (url.trim() === "") {
      setError("请填写订阅 URL");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await addSubscription(name.trim(), url.trim());
      if (result.ok) {
        const skipped = result.skipped ?? [];
        setMessage(
          `${result.message ?? ""}${skipped.length ? `；不支持：${skipped.join("、")}` : ""}`,
        );
        setName("");
        setUrl("");
        await load();
      } else {
        setError(result.message ?? "添加失败");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateAll = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await updateAllSubscriptions();
      const results = result.results ?? [];
      const failed = results.filter((item) => !item.ok);
      const skipped = [...new Set(results.flatMap((item) => item.skipped ?? []))];
      const skippedText = skipped.length ? `；不支持 ${skipped.join("、")}` : "";
      await load();
      if (!result.ok) {
        setError(result.message ?? "全量更新失败");
      } else if (failed.length > 0) {
        setMessage(`更新完成：${results.length - failed.length}/${results.length} 成功${skippedText}`);
        setError(
          `${failed.length} 个订阅更新失败：${failed
            .map((item) => item.name ?? "未命名")
            .join("、")}（${failed[0].message ?? "未知错误"}）`,
        );
      } else if (results.length === 0) {
        setMessage(result.message ?? "没有需要更新的订阅");
      } else {
        setMessage(`更新完成：${results.length}/${results.length} 成功${skippedText}`);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await applySubscriptions();
      await load();
      if (result.ok) {
        setMessage(result.message ?? "");
        await afterConfigChange(api);
      } else {
        setError(result.message ?? "写入失败");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  };

  const runItem = async (item: PanelSubscription, action: "update" | "delete") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        action === "update" ? await updateSubscription(item.id) : await deleteSubscription(item.id);
      const skipped =
        action === "update" ? ((result as PanelSubscriptionUpdate).skipped ?? []) : [];
      await load();
      if (result.ok) {
        setMessage(
          `${result.message ?? ""}${skipped.length ? `；不支持：${skipped.join("、")}` : ""}`,
        );
      } else {
        setError(result.message ?? (action === "update" ? "更新失败" : "删除失败"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const setSchedule = async (item: PanelSubscription, interval: number) => {
    if (!scheduleSupported) {
      setError("当前 panel 不支持自动更新设置；升级到 0.1.0-8 后可用。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await setSubscriptionSchedule(item.id, interval);
      await load();
      if (result.ok) {
        setMessage(result.message ?? "自动更新设置已保存");
      } else {
        setError(result.message ?? "自动更新设置失败");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const managedGroups = [managed?.managed_group, managed?.managed_urltest].filter(
    (value): value is string => Boolean(value),
  );
  const managedCount = managed?.outbound_tags.length ?? 0;
  const applyMessage = managed
    ? `将写入订阅节点并重建当前 ${managedCount} 个托管节点${
        managedGroups.length > 0 ? `（组 ${managedGroups.join(" / ")}）` : ""
      }，然后重启 sing-box；失败会自动回滚。`
    : "将把订阅节点写入 sing-box 配置并重启核心，失败会自动回滚。";
  const deleteManagedCount = deleteTarget
    ? (managed?.by_subscription?.[deleteTarget.id]?.length ?? 0)
    : 0;

  return (
    <div className={styles.section}>
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}

      <Card title="添加订阅">
        <div className={styles.formRow}>
          <label className={styles.label}>
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="可选" />
          </label>
          <label className={cx(styles.label, styles.grow)}>
            URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/subscription"
              spellCheck={false}
            />
          </label>
          <Button variant="primary" onClick={() => void add()} disabled={busy}>
            添加
          </Button>
        </div>
      </Card>

      <div className={styles.toolbar}>
        <span className={styles.muted}>
          {items.length} 个订阅
          {managedCount > 0 ? ` · 托管 ${managedCount} 节点` : ""}
          {managedGroups.length > 0 ? ` · 组 ${managedGroups.join(" / ")}` : ""}
          {managed?.updated ? ` · 上次写入 ${formatTime(managed.updated, language)}` : ""}
        </span>
        <div className={styles.actions}>
          <Button onClick={() => void updateAll()} disabled={busy || items.length === 0}>
            全量更新
          </Button>
          <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={busy || items.length === 0}>
            写入配置
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : "刷新"}
          </Button>
        </div>
      </div>

      {items.length === 0 && !loading ? (
        <div className={styles.empty}>还没有订阅</div>
      ) : (
        <div className={styles.rows}>
          {items.map((item) => {
            const userinfo = item.userinfo ?? {};
            const usedBytes = (userinfo.upload ?? 0) + (userinfo.download ?? 0);
            const hasTraffic =
              typeof userinfo.upload === "number" ||
              typeof userinfo.download === "number" ||
              typeof userinfo.total === "number";
            const expire = userinfo.expire;
            const interval = item.update_interval ?? 0;
            const nextUpdate = item.next_update ?? 0;
            const due = nextUpdate > 0 && nextUpdate * 1000 <= now;
            const managedTags = managed?.by_subscription?.[item.id]?.length ?? 0;
            return (
              <div key={item.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <strong>{item.name || "未命名订阅"}</strong>
                  <span className={styles.mono}>{item.url}</span>
                </div>
                <div className={styles.rowMeta}>
                  <span>{item.node_count ?? 0} 节点</span>
                  {managedTags > 0 ? <span>托管 {managedTags} 节点</span> : null}
                  <span>更新于 {formatTime(item.last_update, language)}</span>
                  {hasTraffic && (
                    <span>
                      已用 {formatBytes(usedBytes)}
                      {typeof userinfo.total === "number" && userinfo.total > 0
                        ? ` / ${formatBytes(userinfo.total)}`
                        : ""}
                      {typeof expire === "number" && expire > 0
                        ? ` · 到期 ${formatDateTime(expire * 1000, language)}`
                        : ""}
                    </span>
                  )}
                  {!hasTraffic && typeof expire === "number" && expire > 0 && (
                    <span>到期 {formatDateTime(expire * 1000, language)}</span>
                  )}
                  <span>
                    自动更新{" "}
                    {!scheduleSupported ? (
                      <span className={styles.muted}>需要 0.1.0-8</span>
                    ) : (
                      <select
                        value={String(interval)}
                        onChange={(event) => void setSchedule(item, Number(event.target.value))}
                        disabled={busy}
                        aria-label={`${item.name || item.url} 自动更新间隔`}
                      >
                        <option value="0">关闭</option>
                        {interval > 0 && ![21600, 43200, 86400].includes(interval) && (
                          <option value={String(interval)}>{formatInterval(interval)}</option>
                        )}
                        <option value="21600">每 6 小时</option>
                        <option value="43200">每 12 小时</option>
                        <option value="86400">每天</option>
                      </select>
                    )}
                  </span>
                  {interval > 0 && (
                    <span>
                      {due ? "等待自动更新" : `下次 ${formatTime(nextUpdate, language)}`}
                    </span>
                  )}
                  {item.last_error ? <span className={styles.errorText}>失败：{item.last_error}</span> : null}
                </div>
                <div className={styles.actions}>
                  <Button size="small" onClick={() => void runItem(item, "update")} disabled={busy}>
                    更新
                  </Button>
                  <Button size="small" variant="danger" onClick={() => setDeleteTarget(item)} disabled={busy}>
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmApply && (
        <ConfirmDialog
          title="写入订阅节点"
          message={applyMessage}
          confirmLabel="写入并重启"
          busy={busy}
          onConfirm={() => void apply()}
          onClose={() => setConfirmApply(false)}
        />
      )}
      {deleteTarget !== null && (
        <ConfirmDialog
          title="删除订阅"
          message={`确定删除「${deleteTarget.name || deleteTarget.url}」？这不会立即改动当前配置${
            deleteManagedCount > 0
              ? `；它当前托管 ${deleteManagedCount} 个节点，下次“写入配置”时会把它们移除`
              : ""
          }。`}
          confirmLabel="删除"
          danger
          busy={busy}
          onConfirm={() => void runItem(deleteTarget, "delete")}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/* ── eBPF ─────────────────────────────────────────────────── */

function EbpfTab() {
  const api = useApi();
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
        setError(result.message ?? "应用失败");
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
      setError(result.ok && result.data?.ok !== false ? "" : "探测返回错误");
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
        <div className={styles.warnBox}>当前配置没有 eBPF 入站，分应用策略不可用。</div>
      )}

      <Card title="分应用策略">
        <div className={styles.modeRow}>
          {(["off", "blacklist", "whitelist"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cx(styles.modeButton, mode === value && styles.active)}
              onClick={() => setMode(value)}
              disabled={!present}
            >
              {value === "off" ? "关闭" : value === "blacklist" ? "黑名单" : "白名单"}
            </button>
          ))}
          <span className={styles.muted}>
            {mode === "blacklist" ? "选中的应用绕过代理" : mode === "whitelist" ? "仅选中的应用走代理" : "不限制应用"}
          </span>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={!present || busy}>
            应用策略
          </Button>
          <span className={styles.muted}>已选择 {selected.size} 个 UID</span>
        </div>
      </Card>

      <div className={styles.cardSplit}>
        <Card title={`应用（${filtered.length}）`}>
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
                  {app.pids.length > 0 ? ` · ${app.pids.length} 进程` : ""}
                </span>
              </label>
            ))}
            {visible.length === 0 && <div className={styles.empty}>没有匹配的应用</div>}
          </div>
          {filtered.length > visible.length && (
            <p className={styles.muted}>仅显示前 {visible.length} 个应用，请用搜索缩小范围。</p>
          )}
        </Card>

        <Card title="能力预检">
          <div className={styles.formRow}>
            <label className={cx(styles.label, styles.grow)}>
              下游接口（可选）
              <input
                value={probeIface}
                onChange={(event) => setProbeIface(event.target.value)}
                placeholder="例如 virbr0"
                spellCheck={false}
              />
            </label>
            <Button onClick={() => void probe()} disabled={busy}>
              {busy ? <Spinner /> : "运行预检"}
            </Button>
          </div>
          {probeResult !== null && (
            <div>
              {probeResult.summary ? (
                <p className={styles.muted}>
                  {probeResult.result ? `结果：${probeResult.result} · ` : ""}
                  PASS {probeResult.summary.pass ?? 0} / FAIL{" "}
                  {probeResult.summary.fail ?? 0} / UNKNOWN{" "}
                  {probeResult.summary.unknown ?? 0}
                  {(probeResult.summary.required_issues ?? 0) > 0
                    ? ` · 必需项问题 ${probeResult.summary.required_issues}`
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
                <p className={styles.muted}>没有结构化检查条目。</p>
              )}
              <details>
                <summary className={styles.muted}>原始 JSON</summary>
                <pre className={styles.probeResult}>{JSON.stringify(probeResult, null, 2)}</pre>
              </details>
            </div>
          )}
        </Card>
      </div>

      {confirmApply && (
        <ConfirmDialog
          title="应用 eBPF 策略"
          message="将写入配置并重启 sing-box 以应用分应用策略，失败会自动回滚。"
          confirmLabel="应用并重启"
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
  const { language } = useI18n();
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
      setMessage(result.message ?? (result.ok ? "校验通过" : "校验失败"));
      if (!result.ok) {
        setError(result.message ?? "校验失败");
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
        setError(result.message ?? "应用失败");
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
        setError(result.message ?? "恢复失败");
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
      setError("当前 panel 不支持备份下载；升级到 0.1.0-8 后可用。");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await downloadPanelBackup(name);
      setMessage(`已下载 ${name}`);
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
            发现 {formatAge(now - draft.savedAt)}未应用的本地草稿
            {draft.base !== original ? "（服务器配置此后已变化）" : ""}。
          </div>
          <div className={styles.noticeActions}>
            <Button size="small" onClick={restoreDraft}>
              恢复草稿
            </Button>
            <Button
              size="small"
              onClick={() => {
                clearConfigDraft();
                setDraft(null);
              }}
            >
              丢弃
            </Button>
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <span
          className={styles.muted}
          title="Schema 随 UI 一起提供，不会在编辑时请求外部站点"
        >
          {loading ? "正在读取配置…" : dirty ? "有未应用的修改" : "配置已同步"}
          {schema !== null ? " · Schema 补全" : ""}
        </span>
        <div className={styles.actions}>
          <Button
            onClick={undo}
            disabled={undoStack.length === 0 || busy}
            title="撤销上一次编辑"
          >
            撤销
          </Button>
          <Button
            onClick={restoreApplied}
            disabled={busy || applied === null}
            title="回到最近一次成功应用的配置"
          >
            上次应用
          </Button>
          <Button onClick={() => void validate()} disabled={busy || loading}>
            校验
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowDiff(true)}
            disabled={busy || loading || !dirty}
          >
            应用并重启
          </Button>
          <Button onClick={() => void backup()} disabled={busy || loading}>
            备份
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : "刷新"}
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

      <Card title={`备份（${backups.length}）`}>
        {backups.length === 0 ? (
          <div className={styles.empty}>还没有备份</div>
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
                    恢复
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void download(item.name)}
                    disabled={busy || !canDownload}
                    title={!canDownload ? "需要 sing-box-panel 0.1.0-8" : undefined}
                  >
                    下载
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
          title="恢复备份"
          message={`将恢复备份「${pending.name}」并重启 sing-box，当前配置会被面板自动备份。`}
          confirmLabel="恢复并重启"
          busy={busy}
          onConfirm={() => void restore(pending.name)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
