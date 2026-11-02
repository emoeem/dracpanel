import { hasPanelToken } from "../../api/panel";
import { useI18n } from "../../app/i18n";
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
  const { t } = useI18n();
  return (
    <FcSheet
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className={styles.cancelAction} disabled={props.busy} onClick={props.onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className={styles.primaryAction} disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? t("Applying…") : t("Apply and restart")}
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
  const { t } = useI18n();
  const panel = usePanelState();
  const { systemProxy, tun, lan } = useAdvancedToggles(panel);

  return (
    <div className="fc-page">
      <ToolsPageHeader title={t("Advanced Configuration")} onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        {!hasPanelToken() && <div className={styles.hint}>{t("In direct mode, the switches and configuration tools below are unavailable.")}</div>}

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>{t("Network")}</h2>
          <ToggleRow
            icon="swap_horiz"
            label={t("System proxy")}
            detail={
              !systemProxy.supported
                ? t("The panel backend must expose /api/system-proxy.")
                : systemProxy.enabled
                  ? `${t("Enabled")}${systemProxy.port ? ` · ${t("Port {port}", { port: systemProxy.port })}` : ""}`
                  : t("Disabled")
            }
            checked={systemProxy.enabled}
            disabled={!systemProxy.supported}
            onChange={(next) => {
              void systemProxy.toggle(next);
            }}
          />
          <ToggleRow
            icon={tun.ebpfMode ? "shield" : "vpn_lock"}
            label={tun.ebpfMode ? t("Traffic capture (eBPF)") : t("Virtual adapter (TUN)")}
            detail={
              !tun.supported
                ? tun.reason ?? t("Panel backend required")
                : tun.ebpfMode
                  ? t("In eBPF mode, the kernel's ebpf inbound handles traffic.")
                  : tun.enabled
                    ? t("Enabled (tun inbound)")
                    : tun.reason ?? t("Disabled")
            }
            checked={tun.ebpfMode ? true : (tun.pending ?? tun.enabled)}
            disabled={!tun.supported || tun.ebpfMode || tun.busy || (tun.reason !== null && !tun.enabled)}
            onChange={(next) => tun.request(next)}
          />
          <ToggleRow
            icon="lan"
            label={t("LAN proxy")}
            detail={
              !lan.supported
                ? lan.reason ?? t("Unavailable")
                : lan.enabled
                  ? `${t("Enabled")}${lan.port ? ` · ${t("Port {port}", { port: lan.port })}` : ""}`
                  : t("Disabled (loopback only)")
            }
            checked={lan.pending ?? lan.enabled}
            disabled={!lan.supported || lan.busy}
            onChange={(next) => lan.request(next)}
          />
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>{t("Configuration and rules")}</h2>
          <LinkRow
            icon="rule"
            label={t("Additional rules")}
            detail={t("Edit route.rules and write them back to the configuration")}
            onClick={() => navigate("tools/rules")}
          />
          <LinkRow
            icon="rule"
            label={t("Custom Resources")}
            detail={t("rule_set remote rule sets")}
            onClick={() => navigate("tools/rulesets")}
          />
          <LinkRow
            icon="code"
            label={t("Configuration file")}
            detail={t("JSON configuration editor (with validation, backup, and restore)")}
            onClick={() => navigate("tools/config")}
          />
        </FcCard>

        <FcCard className={styles.card}>
          <h2 className={styles.cardTitle}>{t("Diagnostics")}</h2>
          <LinkRow
            icon="network_check"
            label={t("Network quality")}
            onClick={() => navigate("tools/network-quality")}
          />
          <LinkRow icon="hub" label={t("STUN test")} onClick={() => navigate("tools/stun")} />
          <LinkRow
            icon="cable"
            label={t("Connectivity diagnostics")}
            onClick={() => navigate("tools/connectivity")}
          />
        </FcCard>
      </div>

      {tun.pending !== null && (
        <ConfirmSheet
          title={tun.pending ? t("Enable virtual adapter") : t("Disable virtual adapter")}
          message={
            tun.pending
              ? t("The previously saved TUN inbound will be restored to the configuration and the core restarted.")
              : t("The TUN inbound will be removed from the configuration and saved as a preset so you can restore it later.")
          }
          busy={tun.busy}
          onConfirm={() => void tun.confirm()}
          onClose={tun.cancel}
        />
      )}
      {lan.pending !== null && (
        <ConfirmSheet
          title={lan.pending ? t("Enable LAN proxy") : t("Disable LAN proxy")}
          message={
            lan.pending
              ? t("The local inbound listener will switch to 0.0.0.0 and the core will restart; make sure your firewall allows it.")
              : t("The local inbound listener will switch back to 127.0.0.1 and the core will restart.")
          }
          busy={lan.busy}
          onConfirm={() => void lan.confirm()}
          onClose={lan.cancel}
        />
      )}
    </div>
  );
}
