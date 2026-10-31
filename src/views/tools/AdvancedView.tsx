import { hasPanelToken } from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { usePanelState } from "../../app/usePanelState";
import type { PanelStateResult } from "../../app/usePanelState";
import type { ConfigToggleControl, SystemProxyControl } from "../../app/useRuntimeToggles";
import { useLanControl, useSystemProxy, useTunControl } from "../../app/useRuntimeToggles";
import { Icon } from "../../components/Icon";
import { FcCard, FcSheet, FcSwitch } from "../../components/flclash";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./AdvancedView.module.css";

function ToggleRow(props: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowIcon}>
        <Icon name={props.icon} size={16} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{props.label}</span>
        <span className={styles.rowDetail}>{props.detail}</span>
      </span>
      <FcSwitch checked={props.checked} disabled={props.disabled} label={props.label} onChange={props.onChange} />
    </div>
  );
}

function LinkRow(props: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.row} onClick={props.onClick}>
      <span className={styles.rowIcon}>
        <Icon name={props.icon} size={16} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{props.label}</span>
        {props.detail && <span className={styles.rowDetail}>{props.detail}</span>}
      </span>
      <Icon name="chevron_right" size={16} />
    </button>
  );
}

function ConfirmSheet(props: {
  title: string;
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <FcSheet
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className={styles.cancelAction} disabled={props.busy} onClick={props.onClose}>
            取消
          </button>
          <button type="button" className={styles.primaryAction} disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? "应用中…" : "应用并重启"}
          </button>
        </>
      }
    >
      <p className={styles.confirmText}>{props.message}</p>
    </FcSheet>
  );
}

export function useAdvancedToggles(panel: PanelStateResult): {
  systemProxy: SystemProxyControl;
  tun: ConfigToggleControl;
  lan: ConfigToggleControl;
} {
  const api = useApi();
  const systemProxy = useSystemProxy();
  const tun = useTunControl(api, panel);
  const lan = useLanControl(api);
  return { systemProxy, tun, lan };
}

export function AdvancedView() {
  const panel = usePanelState();
  const { systemProxy, tun, lan } = useAdvancedToggles(panel);

  return (
    <div className="fc-page">
      <ToolsPageHeader title="进阶配置" onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        {!hasPanelToken() && <div className={styles.hint}>直接模式下，以下开关与配置工具不可用。</div>}

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>网络</h2>
          <ToggleRow
            icon="swap_horiz"
            label="系统代理"
            detail={
              !systemProxy.supported
                ? "需要面板后端提供 /api/system-proxy 接口"
                : systemProxy.enabled
                  ? `已开启${systemProxy.port ? ` · 端口 ${systemProxy.port}` : ""}`
                  : "已关闭"
            }
            checked={systemProxy.enabled}
            disabled={!systemProxy.supported}
            onChange={(next) => {
              void systemProxy.toggle(next);
            }}
          />
          <ToggleRow
            icon={tun.ebpfMode ? "shield" : "vpn_lock"}
            label={tun.ebpfMode ? "流量接管（eBPF）" : "虚拟网卡（TUN）"}
            detail={
              !tun.supported
                ? tun.reason ?? "需要面板后端"
                : tun.ebpfMode
                  ? "eBPF 模式下流量由内核 ebpf 入站接管"
                  : tun.enabled
                    ? "已开启（tun inbound）"
                    : tun.reason ?? "已关闭"
            }
            checked={tun.ebpfMode ? true : (tun.pending ?? tun.enabled)}
            disabled={!tun.supported || tun.ebpfMode || tun.busy || (tun.reason !== null && !tun.enabled)}
            onChange={(next) => tun.request(next)}
          />
          <ToggleRow
            icon="lan"
            label="局域网代理"
            detail={
              !lan.supported
                ? lan.reason ?? "不可用"
                : lan.enabled
                  ? `已开启${lan.port ? ` · 端口 ${lan.port}` : ""}`
                  : "已关闭（仅本机监听）"
            }
            checked={lan.pending ?? lan.enabled}
            disabled={!lan.supported || lan.busy}
            onChange={(next) => lan.request(next)}
          />
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>配置与规则</h2>
          <LinkRow
            icon="rule"
            label="附加规则"
            detail="编辑 route.rules 并写回配置"
            onClick={() => navigate("tools/rules")}
          />
          <LinkRow
            icon="rule"
            label="自定义资源"
            detail="rule_set 远程规则集"
            onClick={() => navigate("tools/rulesets")}
          />
          <LinkRow
            icon="code"
            label="配置文件"
            detail="JSON 配置编辑器（含校验、备份、恢复）"
            onClick={() => navigate("tools/config")}
          />
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>诊断</h2>
          <LinkRow
            icon="network_check"
            label="网络质量"
            onClick={() => navigate("tools/network-quality")}
          />
          <LinkRow icon="hub" label="STUN 测试" onClick={() => navigate("tools/stun")} />
          <LinkRow
            icon="cable"
            label="连通性诊断"
            onClick={() => navigate("tools/connectivity")}
          />
        </FcCard>
      </div>

      {tun.pending !== null && (
        <ConfirmSheet
          title={tun.pending ? "开启虚拟网卡" : "关闭虚拟网卡"}
          message={
            tun.pending
              ? "将把之前保存的 TUN 入站恢复到配置中，并重启内核。"
              : "将从配置中移除 TUN 入站并保存为预设，方便之后恢复。"
          }
          busy={tun.busy}
          onConfirm={() => void tun.confirm()}
          onClose={tun.cancel}
        />
      )}
      {lan.pending !== null && (
        <ConfirmSheet
          title={lan.pending ? "开启局域网代理" : "关闭局域网代理"}
          message={
            lan.pending
              ? "将把本地入站监听切换为 0.0.0.0 并重启内核；请确认防火墙已放行。"
              : "将把本地入站监听切回 127.0.0.1 并重启内核。"
          }
          busy={lan.busy}
          onConfirm={() => void lan.confirm()}
          onClose={lan.cancel}
        />
      )}
    </div>
  );
}
