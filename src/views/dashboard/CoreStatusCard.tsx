import { useState } from "react";

import { formatUptime } from "../../api/format";
import { hasPanelToken, serviceAction } from "../../api/panel";
import { useStream } from "../../api/stream";
import { useApi, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { usePendingValue, useUnaryOnce } from "../../app/hooks";
import { useI18n } from "../../app/i18n";
import { usePanelState } from "../../app/usePanelState";
import { Button, Dialog, DataLine, Spinner, StateDot } from "../../components/ui";
import { ServiceStatus_Type } from "../../gen/daemon/started_service_pb";
import styles from "./cards.module.css";

/** FlClash-style core status card: state, uptime, version and lifecycle actions. */
export function CoreStatusCard() {
  const api = useApi();
  const { t } = useI18n();
  const serviceStatus = useStream(api.serviceStatus);
  const panel = usePanelState();
  const now = useNow();
  const startedAt = useUnaryOnce(() => api.getStartedAt(), serviceStatus.phase === "active");
  const serverInfo = useUnaryOnce(() => api.serverInfo(), serviceStatus.phase === "active");
  const [pendingAction, setPendingAction] = usePendingValue<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [busy, setBusy] = useState(false);

  const panelAvailable = hasPanelToken();
  const statusType = serviceStatus.data.status?.status;
  const started = statusType === ServiceStatus_Type.STARTED;

  const runAction = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    setPendingAction(action);
    try {
      const result = await serviceAction(action);
      if (!result.ok && result.message) {
        showError(new Error(result.message));
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  let chip;
  if (serviceStatus.phase !== "active" && serviceStatus.data.status === null) {
    chip = (
      <span className={styles.statusChip}>
        <Spinner />
        {t("Connecting...")}
      </span>
    );
  } else {
    switch (statusType) {
      case ServiceStatus_Type.STARTED:
        chip = (
          <span className={styles.statusChip}>
            <StateDot tone="good" />
            {t("Running")}
          </span>
        );
        break;
      case ServiceStatus_Type.STARTING:
        chip = (
          <span className={styles.statusChip}>
            <StateDot tone="medium" />
            {t("Starting")}
          </span>
        );
        break;
      case ServiceStatus_Type.STOPPING:
        chip = (
          <span className={styles.statusChip}>
            <StateDot tone="medium" />
            {t("Stopping")}
          </span>
        );
        break;
      case ServiceStatus_Type.FATAL:
        chip = (
          <span className={styles.statusChip}>
            <StateDot tone="bad" />
            {t("Fatal")}
          </span>
        );
        break;
      default:
        chip = (
          <span className={styles.statusChip}>
            <StateDot />
            {t("Stopped")}
          </span>
        );
    }
  }

  return (
    <>
      {chip}
      <DataLine
        label={t("Uptime")}
        value={
          started && startedAt !== null ? formatUptime(startedAt, now) : "—"
        }
      />
      <DataLine label={t("Version")} value={serverInfo?.version ?? "—"} />
      {panel.state?.config_error ? (
        <DataLine label={t("Config error")} value={panel.state.config_error} />
      ) : null}
      {panelAvailable ? (
        <div className={styles.statusActions}>
          {!started && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void runAction("start");
              }}
            >
              {pendingAction === "start" && busy ? <Spinner /> : null}
              {t("Start")}
            </Button>
          )}
          {started && (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  void runAction("restart");
                }}
              >
                {t("Restart")}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirmingStop(true)}>
                {t("Stop")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className={styles.cardHint}>
          {t("Core lifecycle control requires the sing-box-panel backend.")}
        </p>
      )}
      {confirmingStop && (
        <Dialog onClose={() => setConfirmingStop(false)}>
          <h3>{t("Stop the sing-box service?")}</h3>
          <p className="dialog-message">
            {t("Stopping the core interrupts all connections routed through it.")}
          </p>
          <div className="row-actions dialog-actions">
            <Button onClick={() => setConfirmingStop(false)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmingStop(false);
                void runAction("stop");
              }}
            >
              {busy ? <Spinner /> : t("Stop")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
