import { useMemo } from "react";

import { formatMemoryBytes } from "../../api/format";
import { getPanelState, hasPanelToken } from "../../api/panel";
import type { PanelState } from "../../api/panel";
import { useStream } from "../../api/stream";
import { useApi, useNow } from "../../app/context";
import { useUnaryOnce } from "../../app/hooks";
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
      ["内存", current ? formatMemoryBytes(current.memory) : "—"],
      ["协程", current ? String(current.goroutines) : "—"],
      ["实时连接", current ? String(current.connectionsIn + current.connectionsOut) : "—"],
      ["累计上传", current ? formatMemoryBytes(Number(current.uplinkTotal)) : "—"],
      ["累计下载", current ? formatMemoryBytes(Number(current.downlinkTotal)) : "—"],
      ["运行时长", started && startedAt !== null ? formatUptimeClock(startedAt, now) : "—"],
      ["内核版本", serverInfo?.version ?? "—"],
      [
        "流量接管",
        panelInfo?.mode === "ebpf"
          ? "eBPF（内核态）"
          : panelInfo?.mode === "tun"
            ? "TUN（虚拟网卡）"
            : (panelInfo?.mode ?? "—"),
      ],
      ["配置路径", panel?.config_path ?? "—"],
      ["面板服务", panel?.service ? (panel.service.active ? "运行中" : "已停止") : "—"],
      ["面板版本", panel?.panel_version ?? panel?.version ?? "—"],
    ] as const;
  }, [current, started, startedAt, now, serverInfo, panelInfo]);

  return (
    <div className="fc-page">
      <ToolsPageHeader title="资源" onBack={() => navigate("tools")} />
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
