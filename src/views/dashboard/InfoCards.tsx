import { useEffect, useState } from "react";

import {
  formatDateTime,
  formatMemoryBytes,
  formatRelativeTime,
} from "../../api/format";
import { getEbpfPolicy, hasPanelToken, type PanelEbpfPolicy } from "../../api/panel";
import { useStream } from "../../api/stream";
import { navigate, useApi, useNow } from "../../app/context";
import { useI18n } from "../../app/i18n";
import type { PanelStateResult } from "../../app/usePanelState";
import { Badge, DataLine, IconButton, Sparkline } from "../../components/ui";
import { Icon } from "../../components/Icon";
import styles from "./cards.module.css";

function PanelUnavailableHint() {
  const { t } = useI18n();
  return (
    <p className={styles.cardHint}>
      {t("This card needs the sing-box-panel backend; it is unavailable in direct mode.")}
    </p>
  );
}

/** Memory usage with a compact history sparkline (FlClash memory card). */
export function MemoryCard() {
  const api = useApi();
  const { t } = useI18n();
  const status = useStream(api.status);
  const current = status.data.current;
  const history = status.data.history.map((sample) => sample.memory);
  return (
    <>
      <div className={styles.metric}>{current ? formatMemoryBytes(current.memory) : "…"}</div>
      <div className={styles.metricSub}>
        {current ? t("Goroutines") + ": " + current.goroutines : "…"}
      </div>
      <Sparkline data={history} />
    </>
  );
}

/** Exit IP reported by the panel (read-only; honest about the data source). */
export function EgressIpCard(props: { panel: PanelStateResult }) {
  const { t } = useI18n();
  const ip = props.panel.state?.egress_ip;
  if (ip) {
    return (
      <div className={styles.ipRow}>
        <span className={styles.ipValue}>{ip}</span>
        <IconButton
          title={t("Copy")}
          onClick={() => {
            void navigator.clipboard.writeText(ip).catch(() => {});
          }}
        >
          <Icon name="content_copy" size={14} />
        </IconButton>
      </div>
    );
  }
  if (!hasPanelToken() || props.panel.error) {
    return (
      <>
        <span className={styles.unavailable}>{t("Unavailable")}</span>
        <PanelUnavailableHint />
      </>
    );
  }
  return <span className={styles.unavailable}>{t("Checking...")}</span>;
}

/** TUN state derived from the panel's live config (read-only by design). */
export function TunCard(props: { panel: PanelStateResult }) {
  const { t } = useI18n();
  const state = props.panel.state;
  if (!hasPanelToken() || (props.panel.error && state === null)) {
    return <PanelUnavailableHint />;
  }
  const tunEnabled = (state?.inbounds ?? []).some((inbound) => inbound === "tun");
  return (
    <>
      <span className={styles.statusChip}>
        <Badge tone={tunEnabled ? "good" : undefined}>
          {tunEnabled ? t("Enabled") : t("Disabled")}
        </Badge>
      </span>
      <p className={styles.cardHint}>
        {tunEnabled
          ? t("A tun inbound is enabled in the running configuration.")
          : t("No tun inbound is enabled; edit the configuration to add one.")}
      </p>
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => navigate("system")}
      >
        {t("Edit config")}
      </button>
    </>
  );
}

/** System takeover status: the panel's eBPF policy (read-only here). */
export function SystemTakeoverCard() {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<PanelEbpfPolicy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    if (!hasPanelToken()) {
      setFailed(true);
      return;
    }
    getEbpfPolicy()
      .then((value) => {
        if (!stale) {
          setPolicy(value);
        }
      })
      .catch(() => {
        if (!stale) {
          setFailed(true);
        }
      });
    return () => {
      stale = true;
    };
  }, []);

  if (!hasPanelToken() || (failed && policy === null)) {
    return <PanelUnavailableHint />;
  }
  const mode = policy?.mode ?? "off";
  return (
    <>
      <span className={styles.statusChip}>
        <Badge tone={mode === "off" ? undefined : "good"}>
          {mode === "off" ? t("Disabled") : mode}
        </Badge>
      </span>
      <p className={styles.cardHint}>
        {t("eBPF-based system takeover; manage it on the System page.")}
      </p>
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => navigate("system")}
      >
        {t("System")}
      </button>
    </>
  );
}

/** Active configuration summary from the panel (FlClash profile card). */
export function ProfileCard(props: { panel: PanelStateResult }) {
  const { t, language } = useI18n();
  const now = useNow(30_000);
  const state = props.panel.state;
  if (!hasPanelToken() || (props.panel.error && state === null)) {
    return <PanelUnavailableHint />;
  }
  const configName = state?.config_path?.split("/").pop() ?? null;
  const updated = state?.config_mtime ? state.config_mtime * 1000 : null;
  return (
    <>
      {configName ? (
        <div className={styles.metric} style={{ fontSize: "var(--text-lg)" }}>
          {configName}
        </div>
      ) : (
        <div className={styles.metric}>{t("Checking...")}</div>
      )}
      <DataLine label={t("Config file")} value={state?.config_path ?? "—"} mono />
      <DataLine
        label={t("Last update")}
        value={
          updated !== null
            ? `${formatDateTime(updated, language)} · ${formatRelativeTime(updated, now, language)}`
            : "—"
        }
      />
      {state?.config_error ? (
        <p className={styles.cardHint + " " + styles.unavailable}>{state.config_error}</p>
      ) : null}
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => navigate("profiles")}
      >
        {t("Profiles")}
      </button>
    </>
  );
}
