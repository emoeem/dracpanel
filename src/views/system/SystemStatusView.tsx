import { useState } from "react";

import { serviceAction } from "../../api/panel";
import { usePanelState } from "../../app/usePanelState";
import { showError } from "../../app/errorStore";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FcButton, FcCard, FcCardHeader, FcPageToolbar } from "../../components/flclash";
import { useToast } from "../../components/Toast";
import { formatBytes } from "../../api/format";
import styles from "../ops/ops.module.css";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles["stat-label"]}>{label}</span>
      <span className={styles["stat-value"]}>{value}</span>
    </div>
  );
}

/** 系统状态：服务、内核、资源与配置事实，以及核心控制。 */
export function SystemStatusView() {
  const panel = usePanelState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const state = panel.state;
  const active = state?.service?.active === true;

  const run = async (action: "start" | "restart" | "stop") => {
    setBusy(true);
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        throw new Error(result.message || "服务控制失败");
      }
      toast(result.message || "已执行", "good");
      panel.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="fc-page">
        <FcPageToolbar title="系统状态" />
        <div className="fc-page-body">
          <div className={styles.empty}>{panel.error ? "面板后端不可用" : "加载中…"}</div>
        </div>
      </div>
    );
  }

  const capability = state.apply_capability;
  return (
    <div className="fc-page">
      <FcPageToolbar title="系统状态" subtitle={`sing-box ${state.version || "未知版本"}`} />
      <div className="fc-page-body">
        <FcCard>
          <FcCardHeader title="服务" subtitle={active ? "运行中" : "已停止"} />
          <div className={styles["stat-grid"]}>
            <Stat label="状态" value={active ? "运行中" : "已停止"} />
            <Stat label="PID" value={state.service?.pid || "—"} />
            <Stat label="启动时间" value={state.service?.since || "—"} />
            <Stat label="运行模式" value={state.mode || "mixed"} />
          </div>
          <div className={styles.row}>
            <FcButton
              variant="tonal"
              onClick={() => void run("restart")}
              disabled={busy || !active}
            >
              重启核心
            </FcButton>
            <FcButton variant="tonal" onClick={() => void run("start")} disabled={busy || active}>
              启动核心
            </FcButton>
            <FcButton variant="danger" onClick={() => setStopOpen(true)} disabled={busy || !active}>
              停止核心
            </FcButton>
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader title="资源" />
          <div className={styles["stat-grid"]}>
            <Stat
              label="CPU"
              value={
                state.cpu_ready && typeof state.cpu_percent === "number"
                  ? `${state.cpu_percent.toFixed(1)}%`
                  : "采样未就绪"
              }
            />
            <Stat label="面板内存" value={formatBytes(state.memory_app ?? 0)} />
            <Stat label="内核内存" value={formatBytes(state.memory_kernel ?? 0)} />
            <Stat label="进程" value={state.service?.active ? "systemd" : "—"} />
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader title="配置" subtitle={state.dry_run ? "dry-run" : undefined} />
          <div className={styles["stat-grid"]}>
            <Stat label="路径" value={state.config_path || "—"} />
            <Stat label="大小" value={formatBytes(state.config_bytes ?? 0)} />
            <Stat
              label="修改时间"
              value={state.config_mtime ? new Date(state.config_mtime * 1000).toLocaleString() : "—"}
            />
            <Stat
              label="应用策略"
              value={
                capability
                  ? `${capability.strategy}${capability.reload_supported ? " · 支持热重载" : ""}`
                  : "—"
              }
            />
          </div>
          {state.config_error ? <div className={styles.detail}>{state.config_error}</div> : null}
        </FcCard>
      </div>

      {stopOpen && (
        <ConfirmDialog
          title="停止核心"
          message="停止后所有代理连接会中断，直到你重新启动核心。"
          confirmLabel="停止"
          danger
          busy={busy}
          onConfirm={() => {
            setStopOpen(false);
            void run("stop");
          }}
          onClose={() => setStopOpen(false)}
        />
      )}
    </div>
  );
}
