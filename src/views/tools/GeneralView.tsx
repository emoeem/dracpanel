import { useState } from "react";

import { hasPanelToken, lockPanel, serviceAction } from "../../api/panel";
import { loadServersState } from "../../api/config";
import { useApi, navigate, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useUnaryOnce } from "../../app/hooks";
import { useI18n } from "../../app/i18n";
import { usePanelState } from "../../app/usePanelState";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FcCard } from "../../components/flclash";
import { formatUptimeClock } from "../../lib/flclash/format";
import { setOpenLogsEnabled, openLogsEnabled } from "../../app/logToggle";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./GeneralView.module.css";

export function GeneralView() {
  const api = useApi();
  const { t } = useI18n();
  const now = useNow(1000);
  const panel = usePanelState();
  const serviceInfo = useUnaryOnce(() => api.serverInfo(), true);
  const startedAt = useUnaryOnce(() => api.getStartedAt(), true);
  const servers = loadServersState();
  const activeServer = servers.servers.find((server) => server.id === servers.activeId) ?? null;
  const [busy, setBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [logsOn, setLogsOn] = useState(openLogsEnabled);
  const panelAvailable = hasPanelToken();

  const run = async (action: "start" | "restart") => {
    setBusy(true);
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        throw new Error(result.message || "核心操作失败");
      }
      panel.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [
    ["状态", panel.state?.service ? (panel.state.service.active ? "运行中" : "已停止") : "—"],
    ["版本", serviceInfo?.version ?? "—"],
    ["配置路径", panel.state?.config_path ?? "—"],
    ["当前服务器", activeServer?.name ?? "—"],
  ];

  return (
    <div className="fc-page">
      <ToolsPageHeader title="常规" onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        <FcCard className={styles.card}>
          {rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <span>{label}</span>
              <span className={styles.value} title={value}>
                {value}
              </span>
            </div>
          ))}
          <div className={styles.row}>
            <span>运行时长</span>
            <span className={styles.value}>
              {startedAt !== null ? formatUptimeClock(startedAt, now) : "—"}
            </span>
          </div>
        </FcCard>

        <FcCard className={styles.card}>
          <div className={styles.actionsRow}>
            {panelAvailable ? (
              <>
                <button type="button" className={styles.action} disabled={busy} onClick={() => void run("restart")}>
                  <Icon name="restart_alt" size={16} /> 重启核心
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy}
                  onClick={() => {
                    void run("start");
                  }}
                >
                  <Icon name="play_arrow" size={16} /> 启动核心
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.danger}`}
                  disabled={busy}
                  onClick={() => setStopConfirm(true)}
                >
                  <Icon name="stop" size={16} /> 停止核心
                </button>
              </>
            ) : (
              <span className={styles.hint}>核心控制需要面板后端；直接模式下不可用。</span>
            )}
          </div>
        </FcCard>

        <FcCard className={styles.card}>
          <button
            type="button"
            role="switch"
            aria-checked={logsOn}
            className={styles.switchRow}
            onClick={() => {
              const next = !logsOn;
              setLogsOn(next);
              setOpenLogsEnabled(next);
            }}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>日志开关</span>
              <span className={styles.rowDetail}>开启后侧栏与底部导航显示「日志」页</span>
            </span>
            <span className={styles.switchTrack} data-on={logsOn}>
              <span className={styles.switchThumb} />
            </span>
          </button>
          <button type="button" className={styles.navRow} onClick={() => navigate("tools/servers")}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>服务器管理</span>
              <span className={styles.rowDetail}>{servers.servers.length} 个服务器</span>
            </span>
            <Icon name="chevron_right" size={16} />
          </button>
          <button
            type="button"
            className={styles.navRow}
            onClick={() => {
              lockPanel();
              window.location.reload();
            }}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t("Lock panel")}</span>
              <span className={styles.rowDetail}>清除凭据并返回登录界面</span>
            </span>
            <Icon name="logout" size={16} />
          </button>
        </FcCard>
      </div>
      {stopConfirm && (
        <ConfirmDialog
          title="停止核心"
          message="停止内核会中断所有经过它的连接，确定继续？"
          confirmLabel="停止"
          danger
          busy={busy}
          onConfirm={() => {
            setStopConfirm(false);
            void (async () => {
              setBusy(true);
              try {
                const result = await serviceAction("stop");
                if (!result.ok) {
                  throw new Error(result.message || "核心操作失败");
                }
                panel.refresh();
              } catch (error) {
                showError(error);
              } finally {
                setBusy(false);
              }
            })();
          }}
          onClose={() => setStopConfirm(false)}
        />
      )}
    </div>
  );
}
