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
        throw new Error(result.message || t("Core action failed"));
      }
      panel.refresh();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [
    [t("Status"), panel.state?.service ? (panel.state.service.active ? t("Running") : t("Stopped")) : "—"],
    [t("Version"), serviceInfo?.version ?? "—"],
    [t("Config path"), panel.state?.config_path ?? "—"],
    [t("Current server"), activeServer?.name ?? "—"],
  ];

  return (
    <div className="fc-page">
      <ToolsPageHeader title={t("General")} onBack={() => navigate("tools")} />
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
            <span>{t("Uptime")}</span>
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
                  <Icon name="restart_alt" size={16} /> {t("Restart core")}
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy}
                  onClick={() => {
                    void run("start");
                  }}
                >
                  <Icon name="play_arrow" size={16} /> {t("Start core")}
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.danger}`}
                  disabled={busy}
                  onClick={() => setStopConfirm(true)}
                >
                  <Icon name="stop" size={16} /> {t("Stop core")}
                </button>
              </>
            ) : (
              <span className={styles.hint}>{t("Core controls require the panel backend; unavailable in direct mode.")}</span>
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
              <span className={styles.rowLabel}>{t("Log toggle")}</span>
              <span className={styles.rowDetail}>{t("Shows the Logs page in the sidebar and bottom navigation.")}</span>
            </span>
            <span className={styles.switchTrack} data-on={logsOn}>
              <span className={styles.switchThumb} />
            </span>
          </button>
          <button type="button" className={styles.navRow} onClick={() => navigate("tools/servers")}>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>{t("Server management")}</span>
              <span className={styles.rowDetail}>{t("{count} servers", { count: servers.servers.length })}</span>
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
              <span className={styles.rowDetail}>{t("Clear credentials and return to the sign-in screen")}</span>
            </span>
            <Icon name="logout" size={16} />
          </button>
        </FcCard>
      </div>
      {stopConfirm && (
        <ConfirmDialog
          title={t("Stop core")}
          message={t("Stopping the core drops every connection that goes through it. Continue?")}
          confirmLabel={t("Stop")}
          danger
          busy={busy}
          onConfirm={() => {
            setStopConfirm(false);
            void (async () => {
              setBusy(true);
              try {
                const result = await serviceAction("stop");
                if (!result.ok) {
                  throw new Error(result.message || t("Core action failed"));
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
