import { useState } from "react";

import { PANEL_FEATURES } from "../../api/panelCapabilities";
import { serviceAction, type PanelState } from "../../api/panel";
import { usePanelState } from "../../app/usePanelState";
import { useI18n } from "../../app/i18n";
import { showError } from "../../app/errorStore";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  FcBadge,
  FcButton,
  FcCard,
  FcCardHeader,
  FcIconButton,
  FcPageToolbar,
} from "../../components/flclash";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { formatBytes } from "../../api/format";
import { downloadTextFile } from "../../lib/connectionTools";
import styles from "../ops/ops.module.css";

function formatTimestamp(value: string | undefined): string {
  if (value === undefined || value === "") {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * One fact. Values are auto-sized: a short number stays display-sized, while a
 * long path or a sentence drops to monospace footnote so it never wraps into a
 * 22px wall of text (the config path used to dominate its whole card).
 */
function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const long = value.length > 18 || value.includes("/");
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} data-long={long} data-mono={mono ?? long}>
        {value}
      </span>
    </div>
  );
}

/** 系统状态：服务、内核、资源与配置事实，以及核心控制。 */
export function SystemStatusView() {
  const { t } = useI18n();
  const panel = usePanelState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [frozen, setFrozen] = useState<{ state: PanelState; at: number } | null>(null);
  // Pausing freezes what is on screen. The poll keeps running underneath so
  // that resuming is instant and never shows a stale frame as "live".
  const state = frozen === null ? panel.state : frozen.state;
  const active = state?.service?.active === true;

  const run = async (action: "start" | "restart" | "stop") => {
    setBusy(true);
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        throw new Error(result.message || t("Service control failed"));
      }
      toast(result.message || t("Executed"), "good");
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
        <FcPageToolbar title={t("System Status")} />
        <div className="fc-page-body">
          <div className={styles.empty}>{panel.error ? t("Panel backend unavailable") : t("Loading...")}</div>
        </div>
      </div>
    );
  }

  const capability = state.apply_capability;
  return (
    <div className="fc-page">
      <FcPageToolbar
        title={t("System Status")}
        subtitle={
          frozen === null
            ? t("sing-box {version}", { version: state.version || t("Unknown version") })
            : t("Frozen snapshot from {time}", {
                time: new Date(frozen.at).toLocaleTimeString(),
              })
        }
        actions={
          <>
            <FcIconButton
              label={t("Export JSON")}
              onClick={() =>
                downloadTextFile(
                  `dracpanel-system-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`,
                  JSON.stringify(state, null, 2),
                  "application/json",
                )
              }
            >
              <Icon name="download" size={18} />
            </FcIconButton>
            <FcIconButton
              label={frozen === null ? t("Pause updates") : t("Resume updates")}
              active={frozen !== null}
              onClick={() => {
                if (frozen === null) {
                  if (panel.state !== null) {
                    setFrozen({ state: panel.state, at: Date.now() });
                  }
                  return;
                }
                setFrozen(null);
              }}
            >
              <Icon name={frozen === null ? "pause" : "play_arrow"} size={18} />
            </FcIconButton>
            <FcIconButton label={t("Refresh")} onClick={panel.refresh}>
              <Icon name="sync" size={18} />
            </FcIconButton>
          </>
        }
      />
      <div className="fc-page-body">
        <FcCard>
          <FcCardHeader
            title={t("Service")}
            subtitle={
              <FcBadge tone={active ? "success" : "neutral"} dot>
                {active ? t("Running") : t("Stopped")}
              </FcBadge>
            }
          />
          <div className={styles.statGrid}>
            <Stat label="PID" value={state.service?.pid || "—"} mono />
            <Stat label={t("Started at")} value={formatTimestamp(state.service?.since)} />
            <Stat label={t("Run mode")} value={state.mode || "mixed"} mono />
          </div>
          <div className={styles.row}>
            <FcButton
              variant="tonal"
              onClick={() => void run("restart")}
              disabled={busy || !active}
            >
              {t("Restart core")}
            </FcButton>
            <FcButton variant="tonal" onClick={() => void run("start")} disabled={busy || active}>
              {t("Start core")}
            </FcButton>
            <FcButton variant="danger" onClick={() => setStopOpen(true)} disabled={busy || !active}>
              {t("Stop core")}
            </FcButton>
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader title={t("Resources")} />
          <div className={styles.statGrid}>
            <Stat
              label="CPU"
              value={
                state.cpu_ready && typeof state.cpu_percent === "number"
                  ? `${state.cpu_percent.toFixed(1)}%`
                  : t("Sampling not ready")
              }
            />
            <Stat label={t("Panel memory")} value={formatBytes(state.memory_app ?? 0)} />
            <Stat label={t("Kernel memory")} value={formatBytes(state.memory_kernel ?? 0)} />
            <Stat label={t("Process")} value={state.service?.active ? "systemd" : "—"} mono />
          </div>
        </FcCard>

        <FcCard>
          <FcCardHeader title={t("Configuration")} subtitle={state.dry_run ? "dry-run" : undefined} />
          <div className={styles.statGrid}>
            <Stat label={t("Path")} value={state.config_path || "—"} />
            <Stat label={t("Size")} value={formatBytes(state.config_bytes ?? 0)} />
            <Stat
              label={t("Modified at")}
              value={state.config_mtime ? new Date(state.config_mtime * 1000).toLocaleString() : "—"}
            />
            <Stat
              label={t("Apply policy")}
              value={
                capability
                  ? `${capability.strategy}${capability.reload_supported ? ` · ${t("Supports hot reload")}` : ""}`
                  : "—"
              }
            />
          </div>
          {state.config_error ? (
            <div className={styles.configError}>
              <Icon name="warning_amber" size={15} />
              <span>{state.config_error}</span>
            </div>
          ) : null}
        </FcCard>

        <FcCard>
          <FcCardHeader
            title={t("Capabilities")}
            subtitle={
              state.features === undefined
                ? t("Not advertised")
                : t("{count} features", { count: state.features.length })
            }
          />
          <div className={styles.capabilityGrid}>
            {PANEL_FEATURES.map((feature) => {
              const known = state.features === undefined ? null : state.features.includes(feature);
              return (
                <FcBadge
                  key={feature}
                  className={styles.capabilityChip}
                  tone={known === null ? "neutral" : known ? "success" : "neutral"}
                  variant={known === false ? "outline" : "soft"}
                  mono
                  title={feature}
                >
                  <Icon name={known === false ? "close" : known === null ? "info" : "check"} size={12} />
                  {feature}
                </FcBadge>
              );
            })}
          </div>
          <div className={styles.statGrid}>
            <Stat label={t("Panel version")} value={state.panel_version || "—"} mono />
            <Stat label={t("API version")} value={state.api_version === undefined ? "—" : String(state.api_version)} mono />
            <Stat label={t("Token file")} value={state.token_file ? t("Configured") : "—"} />
          </div>
        </FcCard>
      </div>

      {stopOpen && (
        <ConfirmDialog
          title={t("Stop core")}
          message={t("After stopping, all proxy connections are interrupted until you restart the core.")}
          confirmLabel={t("Stop")}
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
