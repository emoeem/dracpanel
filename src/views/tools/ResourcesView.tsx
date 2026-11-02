import { useMemo } from "react";

import { formatMemoryBytes } from "../../api/format";
import { getPanelState, hasPanelToken } from "../../api/panel";
import type { PanelState } from "../../api/panel";
import { useStream } from "../../api/stream";
import { useApi, useNow } from "../../app/context";
import { useUnaryOnce } from "../../app/hooks";
import { useI18n } from "../../app/i18n";
import { navigate } from "../../app/context";
import { ServiceStatus_Type } from "../../gen/daemon/started_service_pb";
import { FcCard } from "../../components/flclash";
import { formatUptimeClock } from "../../lib/flclash/format";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./ResourcesView.module.css";

function Detail(props: { label: string; value: string }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{props.label}</span>
      <span className={styles.detailValue}>{props.value}</span>
    </div>
  );
}

export function ResourcesView() {
  const api = useApi();
  const { t } = useI18n();
  const now = useNow(1000);
  const status = useStream(api.status);
  const serviceStatus = useStream(api.serviceStatus);
  const serverInfo = useUnaryOnce(() => api.serverInfo(), true);
  const startedAt = useUnaryOnce(() => api.getStartedAt(), serviceStatus.phase === "active");
  const panelInfo = useUnaryOnce(() => getPanelState(), hasPanelToken());
  const current = status.data.current;
  const started = serviceStatus.data.status?.status === ServiceStatus_Type.STARTED;

  const rows = useMemo(() => {
    const panel: PanelState | null = panelInfo;
    return [
      [t("Memory"), current ? formatMemoryBytes(current.memory) : "—"],
      [t("Goroutines"), current ? String(current.goroutines) : "—"],
      [t("Live connections"), current ? String(current.connectionsIn + current.connectionsOut) : "—"],
      [t("Total upload"), current ? formatMemoryBytes(Number(current.uplinkTotal)) : "—"],
      [t("Total download"), current ? formatMemoryBytes(Number(current.downlinkTotal)) : "—"],
      [t("Uptime"), started && startedAt !== null ? formatUptimeClock(startedAt, now) : "—"],
      [t("Kernel version"), serverInfo?.version ?? "—"],
      [
        t("Traffic capture"),
        panelInfo?.mode === "ebpf"
          ? t("eBPF (kernel space)")
          : panelInfo?.mode === "tun"
            ? t("TUN (virtual adapter)")
            : (panelInfo?.mode ?? "—"),
      ],
      [t("Config path"), panel?.config_path ?? "—"],
      [t("Panel service"), panel?.service ? (panel.service.active ? t("Running") : t("Stopped")) : "—"],
      [t("Panel version"), panel?.panel_version ?? panel?.version ?? "—"],
    ] as const;
  }, [current, started, startedAt, now, serverInfo, panelInfo, t]);

  return (
    <div className="fc-page">
      <ToolsPageHeader title={t("Resources")} onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        <FcCard className={styles.card}>
          {rows.map(([label, value]) => (
            <Detail key={label} label={label} value={value} />
          ))}
        </FcCard>
      </div>
    </div>
  );
}
