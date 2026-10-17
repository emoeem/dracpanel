import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import type { DaemonApi } from "../api/daemon";
import { formatBytes, formatDateTime } from "../api/format";
import {
  addSubscription,
  applyPanelConfig,
  applySubscriptions,
  backupPanelConfig,
  clearPanelToken,
  deleteSubscription,
  getEbpfPolicy,
  getPanelConfig,
  getPanelState,
  listApps,
  listSubscriptions,
  probeEbpf,
  resyncAfterConfigChange,
  restorePanelBackup,
  serviceAction,
  setEbpfPolicy,
  updateAllSubscriptions,
  updateSubscription,
  validatePanelConfig,
  type PanelApp,
  type PanelBackup,
  type PanelConfig,
  type PanelEbpfPolicy,
  type PanelState,
  type PanelSubscription,
} from "../api/panel";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Button, Card, Dialog, SearchInput, Spinner } from "../components/ui";
import { cx } from "../lib/cx";
import styles from "./ManageView.module.css";

const JsonEditor = lazy(() =>
  import("../components/JsonEditor").then((module) => ({ default: module.JsonEditor })),
);

type Tab = "status" | "subscriptions" | "ebpf" | "config";
const TAB_KEY = "panel_manage_tab";

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
  const [tab, setTab] = useState<Tab>(() => {
    const stored = localStorage.getItem(TAB_KEY);
    return stored === "subscriptions" || stored === "ebpf" || stored === "config" ? stored : "status";
  });

  const selectTab = (next: Tab) => {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
  };

  return (
    <div className="page">
      <PageHeader
        title={t("Manage")}
        actions={
          <Button
            onClick={() => {
              clearPanelToken();
              window.location.reload();
            }}
          >
            锁定面板
          </Button>
        }
      />
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
      </div>

      <div hidden={tab !== "status"}>
        <StatusTab />
      </div>
      <div hidden={tab !== "subscriptions"}>
        <SubscriptionsTab />
      </div>
      <div hidden={tab !== "ebpf"}>
        <EbpfTab />
      </div>
      <div hidden={tab !== "config"}>
        <ConfigTab />
      </div>
    </div>
  );
}

/* ── 运行状态 ─────────────────────────────────────────────── */

function StatusTab() {
  const api = useApi();
  const native = useStream(api.status);
  const [state, setState] = useState<PanelState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"stop" | "restart" | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getPanelState());
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

  useEffect(() => {
    void load();
    const handle = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(handle);
  }, [load]);

  const run = async (action: "start" | "stop" | "restart" | "reload") => {
    setBusy(true);
    setMessage("");
    try {
      const result = await serviceAction(action);
      setMessage(result.message ?? "");
      if (!result.ok) {
        setError(result.message ?? "服务操作失败");
      } else if (action !== "stop") {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await sleep(500);
          const next = await getPanelState();
          setState(next);
          if (next.service?.active) {
            break;
          }
        }
        api.reconnectNow();
      }
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const current = native.data.current;
  const active = state?.service?.active ?? false;

  return (
    <div className={styles.section}>
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}

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
  const [items, setItems] = useState<PanelSubscription[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PanelSubscription | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSubscriptions();
      setItems(result.subscriptions ?? []);
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (url.trim() === "") {
      setError("请填写订阅 URL");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await addSubscription(name.trim(), url.trim());
      setMessage(result.message ?? "");
      if (result.ok) {
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
    setMessage("");
    try {
      const result = await updateAllSubscriptions();
      const results = result.results ?? [];
      setMessage(`更新完成：${results.filter((item) => item.ok).length}/${results.length} 成功`);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await applySubscriptions();
      setMessage(result.message ?? "");
      if (result.ok) {
        await afterConfigChange(api);
      }
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  };

  const runItem = async (item: PanelSubscription, action: "update" | "delete") => {
    setBusy(true);
    setMessage("");
    try {
      const result =
        action === "update" ? await updateSubscription(item.id) : await deleteSubscription(item.id);
      setMessage(result.message ?? "");
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

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
        <span className={styles.muted}>{items.length} 个订阅</span>
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
          {items.map((item) => (
            <div key={item.id} className={styles.row}>
              <div className={styles.rowMain}>
                <strong>{item.name || "未命名订阅"}</strong>
                <span className={styles.mono}>{item.url}</span>
              </div>
              <div className={styles.rowMeta}>
                <span>{item.node_count ?? 0} 节点</span>
                <span>更新于 {formatTime(item.last_update, language)}</span>
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
          ))}
        </div>
      )}

      {confirmApply && (
        <ConfirmDialog
          title="写入订阅节点"
          message="将把订阅节点写入 sing-box 配置并重启核心，失败会自动回滚。"
          confirmLabel="写入并重启"
          busy={busy}
          onConfirm={() => void apply()}
          onClose={() => setConfirmApply(false)}
        />
      )}
      {deleteTarget !== null && (
        <ConfirmDialog
          title="删除订阅"
          message={`确定删除「${deleteTarget.name || deleteTarget.url}」？这不会立即改动当前配置。`}
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
  const [probeResult, setProbeResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextPolicy, nextApps] = await Promise.all([getEbpfPolicy(), listApps()]);
      setPolicy(nextPolicy);
      setApps(nextApps.apps ?? []);
      setMode(nextPolicy.mode === "blacklist" || nextPolicy.mode === "whitelist" ? nextPolicy.mode : "off");
      setSelected(new Set((nextPolicy.uids ?? []).map(Number)));
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

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
      setProbeResult(result);
      setError(result.ok ? "" : "探测返回错误");
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
                <span className={styles.appMeta}>UID {app.uid}</span>
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
            <pre className={styles.probeResult}>{JSON.stringify(probeResult, null, 2)}</pre>
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
  const { language } = useI18n();
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [backups, setBackups] = useState<PanelBackup[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ kind: "apply" } | { kind: "restore"; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const config: PanelConfig = await getPanelConfig();
      setText(config.text);
      setOriginal(config.text);
      setBackups(config.backups ?? []);
      setEditorKey((value) => value + 1);
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const dirty = text !== original;

  return (
    <div className={styles.section}>
      {error !== "" && <div className={styles.errorBox}>{error}</div>}
      {message !== "" && <div className={styles.successBox}>{message}</div>}

      <div className={styles.toolbar}>
        <span className={styles.muted}>
          {loading ? "正在读取配置…" : dirty ? "有未应用的修改" : "配置已同步"}
        </span>
        <div className={styles.actions}>
          <Button onClick={() => void validate()} disabled={busy || loading}>
            校验
          </Button>
          <Button variant="primary" onClick={() => setPending({ kind: "apply" })} disabled={busy || loading || !dirty}>
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
              onChange={(value) => setText(value)}
              onSave={() => setPending({ kind: "apply" })}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {pending !== null && (
        <ConfirmDialog
          title={pending.kind === "apply" ? "应用配置" : "恢复备份"}
          message={
            pending.kind === "apply"
              ? "将写入配置并重启 sing-box；校验失败会保留原配置，运行失败会自动回滚。"
              : `将恢复备份「${pending.name}」并重启 sing-box，当前配置会被面板自动备份。`
          }
          confirmLabel={pending.kind === "apply" ? "应用并重启" : "恢复并重启"}
          busy={busy}
          onConfirm={() => {
            if (pending.kind === "apply") {
              void apply();
            } else {
              void restore(pending.name);
            }
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
