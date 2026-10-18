import { useEffect, useState } from "react";

import { useStream } from "../api/stream";
import { ServiceStatus_Type } from "../gen/daemon/started_service_pb";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n } from "../app/i18n";
import type { ThemePreference } from "../app/context";
import { Icon } from "./Icon";
import styles from "./WebTopbar.module.css";

function BrandMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6l20 11.6v23.2L32 52.4 12 40.8V17.6z" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <path d="M32 18l11 6.4v12.8L32 43.6l-11-6.4V24.4z" fill="currentColor" />
      <circle cx="32" cy="31" r="3.4" className={styles.markCore} />
    </svg>
  );
}

export function WebTopbar(props: {
  version: string | null;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const serviceStatus = useStream(api.serviceStatus);
  const clashMode = useStream(api.clashMode);
  const [pendingMode, setPendingMode] = useState<string | null>(null);

  const status = serviceStatus.data.status?.status ?? ServiceStatus_Type.IDLE;
  const started = status === ServiceStatus_Type.STARTED;
  const transitioning =
    status === ServiceStatus_Type.STARTING || status === ServiceStatus_Type.STOPPING;
  const failed = status === ServiceStatus_Type.FATAL;
  const stateClass = started ? styles.good : transitioning ? styles.warn : styles.bad;

  const statusText = started
    ? t("Running")
    : transitioning
      ? t("Starting")
      : failed
        ? t("Fatal")
        : t("Stopped");

  const currentMode = pendingMode ?? clashMode.data.currentMode;
  // The four user-facing modes; Global is kept only when an external client
  // (e.g. the zashboard fallback) selected it.
  const modeList = clashMode.data.modeList.filter(
    (mode) => mode !== "Global" || mode === currentMode,
  );

  useEffect(() => {
    if (pendingMode !== null && clashMode.data.currentMode === pendingMode) {
      setPendingMode(null);
    }
  }, [pendingMode, clashMode.data.currentMode]);

  const changeMode = (mode: string) => {
    setPendingMode(mode);
    api.setClashMode(mode).catch((error: unknown) => {
      setPendingMode(null);
      showError(error);
    });
  };

  const reconnect = () => {
    api.reconnectNow();
  };

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span className={styles.markWrap}>
          <BrandMark />
        </span>
        <span className={styles.appName}>DracPanel</span>
        <span className={styles.appSuffix}>for sing-box</span>
      </div>

      <div className={styles.center}>
        <button
          type="button"
          className={`${styles.status} ${stateClass}`}
          title={t("Reconnect")}
          onClick={reconnect}
        >
          <span className={styles.dot} aria-hidden="true" />
          {statusText}
        </button>
        {props.version && <span className={styles.version}>v{props.version.replace(/^v/i, "")}</span>}
        {modeList.length > 0 && (
          <label className={styles.mode}>
            <span>{t("Mode")}</span>
            <select
              value={currentMode}
              aria-label={t("Mode")}
              disabled={!started}
              onChange={(event) => changeMode(event.target.value)}
            >
              {modeList.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          title={props.theme === "dark" ? t("Light") : t("Dark")}
          onClick={() => props.onThemeChange(props.theme === "dark" ? "light" : "dark")}
        >
          <Icon name={props.theme === "dark" ? "light_mode" : "dark_mode"} />
        </button>
        <button type="button" className={styles.iconButton} title={t("Refresh")} onClick={reconnect}>
          <Icon name="sync" />
        </button>
      </div>
    </header>
  );
}
