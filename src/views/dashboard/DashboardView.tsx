import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { formatBytes, formatDurationMs, formatMemoryBytes, formatRelativeTime } from "../../api/format";
import { hasPanelToken, serviceAction } from "../../api/panel";
import { useStream } from "../../api/stream";
import { navigate, useApi, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useDismiss, useUnaryOnce } from "../../app/hooks";
import { useI18n, type MessageKey, type Translate } from "../../app/i18n";
import { usePanelState, type PanelStateResult } from "../../app/usePanelState";
import type { ConfigToggleControl, SystemProxyControl } from "../../app/useRuntimeToggles";
import { useLanControl, useSystemProxy, useTunControl } from "../../app/useRuntimeToggles";
import { Icon } from "../../components/Icon";
import {
  FcAvatar,
  FcBadge,
  FcButton,
  FcCard,
  FcCardHeader,
  FcEmptyState,
  FcIconButton,
  FcRecordTable,
  FcSegmented,
  FcSheet,
  FcSkeleton,
  FcSparkline,
  FcSwitch,
  FcWavyProgress,
  type FcColumn,
} from "../../components/flclash";
import type { ConnectionRow } from "../../api/daemon";
import { ServiceStatus_Type } from "../../gen/daemon/started_service_pb";
import type { Group } from "../../gen/daemon/started_service_pb";
import { connectionHost, connectionProcessName } from "../../lib/connectionTools";
import { countryCodeOf } from "../../lib/flclash/country";
import { buildRequestLedger } from "../../lib/requestLedger";
import { useDnsLedger } from "../../lib/flclash/dnsLedger";
import { ebpfPolicyKey } from "../../lib/inboundMode";
import { formatExpiryDays, formatPeak, formatRate, formatUptimeClock, percentLabel } from "../../lib/flclash/format";
import { OUTBOUND_MODES, modeForSegment, segmentOfMode, type OutboundModeSegment } from "../../lib/flclash/mode";
import { useLocalIp } from "../../lib/flclash/localIp";
import {
  SERVICE_TARGETS,
  serviceTone,
  summarizeServices,
  type ServiceResult,
  type ServiceState,
} from "../../lib/flclash/serviceStatus";
import { cx } from "../../lib/cx";
import { ProxyGroupSheet } from "../proxies/ProxyGroupSheet";
import {
  useDashboardLayout,
  useEgress,
  useProfilesSummary,
  useProxyTag,
  useServiceStatus,
} from "./useDashboardData";
import {
  ObsCpuCard,
  ObsNotificationsCard,
  ObsOutboundCard,
  ObsRankingCard,
  ObsTrafficCard,
} from "./ObservabilityCards";
import { attribution, chipLabel, statusChips } from "./statusChips";
import { DashboardEditSheet } from "./DashboardEditSheet";
import {
  WidgetDnsResults,
  WidgetGlobalOutbound,
  WidgetLatency,
  WidgetOutboundConnections,
} from "./DashboardWidgets";
import {
  defaultLayout,
  effectiveSpan,
  loadWidgetLayout,
  saveWidgetLayout,
  visiblePlacements,
  type WidgetLayout,
  type WidgetPlacement,
} from "./widgets";
import styles from "./Dashboard.module.css";

function splitRate(value: number): { amount: string; unit: string } {
  const formatted = formatBytes(value);
  const space = formatted.lastIndexOf(" ");
  return { amount: formatted.slice(0, space), unit: formatted.slice(space + 1) };
}

function statusLabelKey(type: ServiceStatus_Type | null | undefined): MessageKey {
  switch (type) {
    case ServiceStatus_Type.STARTED:
      return "Running";
    case ServiceStatus_Type.STARTING:
    case ServiceStatus_Type.STOPPING:
      return "Pending…";
    case ServiceStatus_Type.FATAL:
      return "Start failed";
    default:
      return "Not running";
  }
}

function statusToneOf(type: ServiceStatus_Type | null | undefined): "good" | "warning" | "bad" | "neutral" {
  switch (type) {
    case ServiceStatus_Type.STARTED:
      return "good";
    case ServiceStatus_Type.STARTING:
    case ServiceStatus_Type.STOPPING:
      return "warning";
    case ServiceStatus_Type.FATAL:
      return "bad";
    default:
      return "neutral";
  }
}

function cookiePath(lobes = 12, outer = 50, inner = 41): string {
  const center = 60;
  const step = (Math.PI * 2) / lobes;
  let path = `M ${center + outer} ${center}`;
  for (let index = 1; index <= lobes; index += 1) {
    const middle = (index - 0.5) * step;
    const end = index * step;
    const controlX = center + Math.cos(middle) * inner;
    const controlY = center + Math.sin(middle) * inner;
    const x = center + Math.cos(end) * outer;
    const y = center + Math.sin(end) * outer;
    path += ` Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${path} Z`;
}

const COOKIE_PATH = cookiePath();

function CookieBlob({ running }: { running: boolean }) {
  return (
    <svg
      className={cx(styles.cookie, running && styles.cookieRunning)}
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <path d={COOKIE_PATH} fill="currentColor" />
    </svg>
  );
}

function StartButton({
  running,
  busy,
  disabled,
  onClick,
}: {
  running: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={cx(styles.startButton, running && styles.startRunning)}
      onClick={onClick}
      disabled={disabled || busy}
      title={running ? t("Stop core") : t("Start core")}
      aria-label={running ? t("Stop core") : t("Start core")}
    >
      <span className={styles.startShape} aria-hidden="true" />
      <span className={styles.startGlyph}>
        {busy ? (
          <span className={styles.startSpinner} />
        ) : (
          <Icon name={running ? "pause" : "play_arrow"} size={38} />
        )}
      </span>
    </button>
  );
}

function StatusCard({
  className,
  statusType,
  started,
  busy,
  ip,
  countryCode,
  organization,
  ipType,
  ipQuality,
  uptime,
  probing,
  onReprobe,
  onStartStop,
  panelAvailable,
  configError,
  egressConfigured,
  geoLocation,
}: {
  className?: string;
  statusType: ServiceStatus_Type | null;
  started: boolean;
  busy: boolean;
  ip: string | null;
  countryCode: string | null;
  organization: string;
  ipType: string;
  ipQuality: string | null;
  uptime: string;
  probing: boolean;
  onReprobe: () => void;
  onStartStop: () => void;
  panelAvailable: boolean;
  configError: string | null;
  /** False when panel.json sets neither egress_ip nor egress_ip_probe_url. */
  egressConfigured: boolean;
  /** "SG · Singapore" from the GeoIP lookup of the exit IP; empty without one. */
  geoLocation: string;
}) {
  const tone = statusToneOf(statusType);
  const ipMissing = ip === null || ip === "";
  const chips = statusChips({ ip, ipType, ipQuality, geoLocation, egressConfigured });
  const { t } = useI18n();
  return (
    <FcCard className={cx(styles.statusCard, className)}>
      <CookieBlob running={started} />
      <div className={styles.statusContent}>
        <div className={styles.statusHeader}>
          <span className={styles.statusTitle}>
            <Icon name="verified" size={16} />
            {t("Status")}
          </span>
          <span className={cx(styles.statusChip, styles[tone])}>
            <span className={styles.statusDot} />
            {t(statusLabelKey(statusType))}
          </span>
        </div>
        <div className={styles.ipRow}>
          <button
            type="button"
            className={styles.countryBadge}
            onClick={onReprobe}
            title={
              ipMissing && !egressConfigured
                ? t("Egress IP probe is not configured")
                : t("Re-check egress IP")
            }
            aria-label={
              ipMissing && !egressConfigured
                ? t("Egress IP probe is not configured")
                : t("Re-check egress IP")
            }
          >
            {probing ? <span className={styles.miniSpinner} /> : countryCode || "—"}
          </button>
          {ipMissing ? (
            <span
              className={styles.ipText}
              title={t(
                "The panel does not make outbound requests; probing starts once egress_ip_probe_url is configured.",
              )}
            >
              {egressConfigured ? t("Probe failed") : t("Probe not configured")}
            </span>
          ) : (
            <span className={styles.ipText}>{ip}</span>
          )}
        </div>
        {chips.length > 0 && (
          <div className={styles.statusChips}>
            {chips.map((chip) => {
              const label = chipLabel(chip, t);
              return (
                <span key={label} className={styles.chip}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
        <div className={styles.statusMeta}>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>{t("Uptime")}</span>
            <span className={styles.metaValue}>{uptime}</span>
          </div>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>{t("Attribution")}</span>
            <span className={styles.metaValue} title={attribution(organization, geoLocation)}>
              {attribution(organization, geoLocation)}
            </span>
          </div>
        </div>
        {configError && <div className={styles.configError}>{configError}</div>}
      </div>
      <div className={styles.startArea}>
        <StartButton
          running={started}
          busy={busy}
          disabled={!panelAvailable}
          onClick={onStartStop}
        />
      </div>
    </FcCard>
  );
}

function SpeedCard({
  direction,
  rate,
  total,
  history,
  loading,
  chartHeight,
}: {
  direction: "upload" | "download";
  rate: number;
  total: number;
  history: readonly number[];
  loading: boolean;
  chartHeight: number;
}) {
  const up = direction === "upload";
  const { amount, unit } = splitRate(rate);
  const { t } = useI18n();
  return (
    <FcCard className={cx(styles.speedCard, up ? styles.uploadCard : styles.downloadCard)}>
      <div className={styles.speedHeader}>
        <span className={styles.speedTitle}>
          <Icon name={up ? "arrow_upward" : "arrow_downward"} size={14} />
          {up ? t("Upload") : t("Download")}
        </span>
        <span className={styles.speedPeak}>{t("Peak {value}", { value: formatPeak(history) })}</span>
      </div>
      {loading ? (
        <div className={styles.speedLoading}>
          <FcSkeleton width="48%" height={36} radius="var(--fc-radius-sm)" />
          <FcSkeleton width="30%" height={12} />
        </div>
      ) : (
        <>
          <div className={styles.rate}>
            <span className={styles.rateValue}>{amount}</span>
            <span className={styles.rateUnit}>{unit}/s</span>
          </div>
          <div className={styles.rateTotal}>{t("Total {value}", { value: formatBytes(total) })}</div>
        </>
      )}
      <FcSparkline
        data={history}
        height={chartHeight}
        color={up ? "var(--fc-series-2)" : "var(--fc-primary)"}
        className={styles.spark}
      />
    </FcCard>
  );
}

function ModeCard({
  className,
  currentMode,
  disabled,
  onChange,
}: {
  className?: string;
  currentMode: string;
  disabled: boolean;
  onChange: (segment: OutboundModeSegment) => void;
}) {
  const [pending, setPending] = useState<OutboundModeSegment | null>(null);
  const selected = pending ?? segmentOfMode(currentMode);
  const { t } = useI18n();
  const change = (segment: OutboundModeSegment) => {
    setPending(segment);
    onChange(segment);
    window.setTimeout(() => setPending(null), 1500);
  };
  return (
    <FcCard shape="block" className={cx(styles.modeCard, className)}>
      <span className={styles.modeLabel}>
        <Icon name="swap_horiz" size={16} />
        {t("Outbound mode")}
      </span>
      <FcSegmented
        className={styles.modeSegments}
        ariaLabel={t("Outbound mode")}
        value={selected}
        disabled={disabled}
        options={OUTBOUND_MODES.map((mode) => ({
          value: mode.value,
          label: t(mode.label),
          icon: <Icon name={mode.icon} size={15} />,
        }))}
        onChange={change}
      />
    </FcCard>
  );
}

function TakeoverShell({
  icon,
  title,
  subtitle,
  checked,
  busy,
  disabled,
  onChange,
  footer,
}: {
  icon: "swap_horiz" | "vpn_lock" | "shield";
  title: string;
  subtitle: string;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  /** Optional second row: capture details, badges, a link to the full page. */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <FcCard shape="block" className={cx(styles.takeoverCard, footer !== undefined && styles.takeoverCardStacked)}>
      <div className={styles.takeoverRow}>
        <span className={cx(styles.takeoverIcon, checked && styles.takeoverIconActive)}>
          <Icon name={icon} size={18} />
        </span>
        <span className={styles.takeoverText}>
          <span className={styles.takeoverTitle}>{title}</span>
          <span className={styles.takeoverSub}>{busy ? t("Working…") : subtitle}</span>
        </span>
        <FcSwitch
          checked={checked}
          disabled={disabled || busy}
          label={title}
          onChange={onChange}
        />
      </div>
      {footer !== undefined && <div className={styles.takeoverFooter}>{footer}</div>}
    </FcCard>
  );
}

function ConfirmToggle({
  title,
  message,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FcSheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <FcButton variant="text" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </FcButton>
          <FcButton variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? t("Applying…") : t("Apply and restart")}
          </FcButton>
        </>
      }
    >
      <p className={styles.confirmText}>{message}</p>
      <div className={styles.confirmHint}>
        {t(
          "Changes are written to the config file and the core restarts, briefly dropping current connections; the panel rolls back automatically if validation fails.",
        )}
      </div>
    </FcSheet>
  );
}

function SystemProxyCard({ control }: { control: SystemProxyControl }) {
  const { t } = useI18n();
  const subtitle = !control.supported
    ? t("Requires the panel backend")
    : control.enabled
      ? control.port
        ? t("Enabled · port {port}", { port: control.port })
        : t("Enabled")
      : t("Disabled");
  return (
    <TakeoverShell
      icon="swap_horiz"
      title={t("System proxy")}
      subtitle={subtitle}
      checked={control.enabled}
      busy={control.busy}
      disabled={!control.supported}
      onChange={(next) => {
        void control.toggle(next);
      }}
    />
  );
}

function TunCard({ control }: { control: ConfigToggleControl }) {
  const { t } = useI18n();
  const capture = control.capture;
  const ebpf = control.ebpfMode ? (capture?.ebpfInfo ?? null) : null;
  const unknown = capture?.mode === "unknown";
  // The eBPF fork captures through the kernel, so the interesting facts are
  // the hook, the per-app policy and whether IPv6 is captured too — none of
  // which a "virtual NIC: disabled" line would ever tell you.
  const subtitle = !control.supported
    ? control.reason ?? t("Requires the panel backend")
    : control.ebpfMode
      ? ebpf
        ? ebpf.mode === "off"
          ? t("{plane} hook · {policy}", {
              plane: ebpf.dataPlane,
              policy: t(ebpfPolicyKey(ebpf.mode) as MessageKey),
            })
          : t("{plane} hook · {policy} · {apps}", {
              plane: ebpf.dataPlane,
              policy: t(ebpfPolicyKey(ebpf.mode) as MessageKey),
              apps: ebpf.uids.length,
            })
        : t("eBPF data plane is taking over")
      : unknown
        ? t("The configuration could not be read, so the capture mode is unknown")
        : control.pending !== null
          ? control.pending
            ? t("About to enable")
            : t("About to disable")
          : control.enabled
            ? t("Enabled")
            : control.reason ?? t("Disabled");
  return (
    <>
      <TakeoverShell
        icon={control.ebpfMode ? "shield" : "vpn_lock"}
        title={control.ebpfMode ? t("Traffic takeover") : t("Virtual NIC")}
        subtitle={subtitle}
        checked={control.ebpfMode ? true : (control.pending ?? control.enabled)}
        busy={control.busy}
        disabled={!control.supported || control.ebpfMode || unknown || (control.reason !== null && !control.enabled)}
        onChange={(next) => control.request(next)}
        footer={
          ebpf ? (
            <>
              <FcBadge tone="accent" variant="soft">
                {t("Kernel eBPF")}
              </FcBadge>
              <FcBadge tone="neutral" variant="outline">
                {ebpf.dnsMode === "hijack" ? t("DNS hijacked") : ebpf.dnsMode}
              </FcBadge>
              {ebpf.ipv6 && (
                <FcBadge tone="neutral" variant="outline">
                  IPv6
                </FcBadge>
              )}
              {ebpf.shared !== null && ebpf.shared.interfaces.length > 0 && (
                <FcBadge tone="info" variant="outline">
                  {t("Shared {interface}", { interface: ebpf.shared.interfaces.join(", ") })}
                </FcBadge>
              )}
              <button
                type="button"
                className={styles.takeoverLink}
                onClick={() => navigate("config?tab=ebpf")}
              >
                {t("Manage per-app rules")}
                <Icon name="chevron_right" size={14} />
              </button>
            </>
          ) : undefined
        }
      />
      {control.pending !== null && (
        <ConfirmToggle
          title={control.pending ? t("Enable virtual NIC") : t("Disable virtual NIC")}
          message={
            control.pending
              ? t("Restore the saved TUN inbound to the config and restart the core.")
              : t("Remove the TUN inbound from the config and keep it as a preset for later restore.")
          }
          busy={control.busy}
          onConfirm={() => {
            void control.confirm();
          }}
          onClose={control.cancel}
        />
      )}
    </>
  );
}

function IntranetCard({
  ip,
  lan,
}: {
  ip: string | null;
  lan: ConfigToggleControl;
}) {
  const { t } = useI18n();
  const shown = ip ? (lan.enabled && lan.port ? `${ip}:${lan.port}` : ip) : t("No network");
  const subtitle = !lan.supported
    ? lan.reason ?? t("Unavailable")
    : lan.enabled
      ? lan.port
        ? t("Enabled · port {port}", { port: lan.port })
        : t("Enabled")
      : t("Disabled");
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="lan" size={16} />}
        title={t("Intranet IP")}
        actions={
          <FcIconButton
            label={t("Copy intranet IP")}
            disabled={!ip}
            onClick={() => {
              if (ip) {
                void navigator.clipboard.writeText(shown).catch(() => {});
              }
            }}
          >
            <Icon name="content_copy" size={16} />
          </FcIconButton>
        }
      />
      <div className={styles.intranetValue}>{shown}</div>
      <div className={styles.lanRow}>
        <span className={styles.lanIcon}>
          <Icon name="wifi" size={16} />
        </span>
        <span className={styles.lanText}>
          <span className={styles.lanTitle}>{t("LAN proxy")}</span>
          <span className={styles.lanSub}>{subtitle}</span>
        </span>
        <FcSwitch
          checked={lan.pending ?? lan.enabled}
          disabled={!lan.supported || lan.busy}
          label={t("LAN proxy")}
          onChange={(next) => lan.request(next)}
        />
      </div>
      {lan.pending !== null && (
        <ConfirmToggle
          title={lan.pending ? t("Enable LAN proxy") : t("Disable LAN proxy")}
          message={
            lan.pending
              ? t(
                  "Switch the local inbound listen address to 0.0.0.0 and restart the core; make sure the system firewall allows this port.",
                )
              : t("Switch the local inbound listen address back to 127.0.0.1 and restart the core.")
          }
          busy={lan.busy}
          onConfirm={() => {
            void lan.confirm();
          }}
          onClose={lan.cancel}
        />
      )}
    </FcCard>
  );
}

function ProfileCard({
  summary,
  busy,
  groupsCount,
  proxyCount,
  onSync,
}: {
  summary: ReturnType<typeof useProfilesSummary>["summary"];
  busy: boolean;
  groupsCount: number;
  proxyCount: number;
  onSync: () => void;
}) {
  const { language, t } = useI18n();
  const now = useNow(30_000);
  const days = summary.daysLeft;
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="description" size={16} />}
        title={t("Profile")}
        actions={
          <>
            <FcIconButton
              label={t("Update current profile")}
              disabled={busy || !summary.subscription}
              onClick={onSync}
            >
              <Icon name="sync" size={16} />
            </FcIconButton>
            <FcIconButton label={t("Open profile page")} onClick={() => navigate("profiles")}>
              <Icon name="chevron_right" size={16} />
            </FcIconButton>
          </>
        }
      />
      <div className={styles.profileTitle} title={summary.name}>
        {summary.name}
      </div>
      <div className={styles.profileMeta}>
        <span>
          {t("Updated {time}", {
            time: summary.updatedAt
              ? formatRelativeTime(summary.updatedAt, now, language)
              : "—",
          })}
        </span>
        {days !== null && (
          <span className={cx(styles.expiry, days <= 7 && styles.expiryWarning)}>
            {formatExpiryDays(days, t)}
          </span>
        )}
      </div>
      {summary.hasUsage ? (
        <>
          <div className={styles.usageRow}>
            <span>
              <strong>{percentLabel(summary.usage.ratio)}</strong> {t("used")}
            </span>
            <span>
              {formatBytes(summary.usage.used)} / {formatBytes(summary.usage.total)}
            </span>
          </div>
          <FcWavyProgress
            value={summary.usage.ratio}
            label={t("Profile usage")}
            warning={summary.usage.ratio >= 0.9}
          />
        </>
      ) : (
        <div className={styles.profileCounts}>
          <span className={styles.countCell}>
            <strong>{groupsCount}</strong>
            <span>{t("Policy groups")}</span>
          </span>
          <span className={styles.countCell}>
            <strong>{proxyCount}</strong>
            <span>{t("Proxies")}</span>
          </span>
          <span className={styles.countCell}>
            <strong>—</strong>
            <span>{t("Rules")}</span>
          </span>
        </div>
      )}
    </FcCard>
  );
}

function serviceText(result: ServiceResult, t: Translate): string {
  switch (result.state) {
    case "available":
      return result.delayMs !== null ? `${result.delayMs} ms` : t("Available");
    case "timeout":
      return t("Timeout");
    case "unavailable":
      return t("Unavailable");
    case "error":
      return t("Check failed");
    case "testing":
      return t("Testing");
    default:
      return t("Not tested");
  }
}

function ServiceLetter({ label }: { label: string }) {
  const initials = label.replace(/[^A-Za-z0-9+]/g, "").slice(0, 2) || "?";
  return <span className={styles.serviceLetter}>{initials}</span>;
}

function ServiceStateMark({ state }: { state: ServiceState }) {
  if (state === "testing") {
    return <span className={styles.serviceSpinner} />;
  }
  return <span className={cx(styles.serviceDot, styles[serviceTone(state)])} />;
}

function ServiceStatusCard({
  results,
  testing,
  proxyTag,
  onRun,
}: {
  results: ServiceResult[];
  testing: boolean;
  proxyTag: string | null;
  onRun: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeServices(results);
  const targets = new Map(SERVICE_TARGETS.map((target) => [target.key, target]));
  const { t } = useI18n();
  const chip = testing
    ? { label: t("Testing"), tone: "warning" as const }
    : summary.allAvailable
      ? { label: t("All available"), tone: "good" as const }
      : summary.abnormal > 0
        ? { label: t("{count} abnormal", { count: summary.abnormal }), tone: "warning" as const }
        : { label: t("Not tested"), tone: "neutral" as const };
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="verified" size={16} />}
        title={t("Service status")}
        actions={
          <>
            <span className={cx(styles.serviceChip, styles[chip.tone])}>{chip.label}</span>
            <FcIconButton
              label={t("Test all")}
              disabled={testing || !proxyTag}
              onClick={onRun}
            >
              <Icon name="bolt" size={16} />
            </FcIconButton>
            <FcIconButton label={t("View all services")} onClick={() => setOpen(true)}>
              <Icon name="chevron_right" size={16} />
            </FcIconButton>
          </>
        }
      />
      <div className={styles.serviceGrid}>
        {results.slice(0, 4).map((result) => {
          const target = targets.get(result.key);
          if (!target) {
            return null;
          }
          return (
            <div key={result.key} className={cx(styles.serviceCell, styles[serviceTone(result.state)])}>
              <ServiceLetter label={target.label} />
              <span className={styles.serviceText}>
                <span className={styles.serviceName}>{target.label}</span>
                <span className={styles.serviceDelay}>{serviceText(result, t)}</span>
              </span>
              <ServiceStateMark state={result.state} />
            </div>
          );
        })}
      </div>
      {open && (
        <FcSheet
          title={t("Service status")}
          subtitle={
            proxyTag
              ? t("Checked via {name}", { name: proxyTag })
              : t("No usable proxy outbound")
          }
          onClose={() => setOpen(false)}
          footer={
            <FcButton
              variant="primary"
              disabled={testing || !proxyTag}
              onClick={onRun}
            >
              {testing ? t("Testing…") : t("Test all")}
            </FcButton>
          }
        >
          <div className={styles.serviceSheetList}>
            {results.map((result) => {
              const target = targets.get(result.key);
              if (!target) {
                return null;
              }
              return (
                <div key={result.key} className={styles.serviceSheetRow}>
                  <ServiceLetter label={target.label} />
                  <span className={styles.serviceSheetName}>{target.label}</span>
                  <span className={cx(styles.serviceSheetState, styles[serviceTone(result.state)])}>
                    {serviceText(result, t)}
                  </span>
                </div>
              );
            })}
          </div>
        </FcSheet>
      )}
    </FcCard>
  );
}

function MemoryCard({
  memory,
  goroutines,
  app,
  kernel,
}: {
  memory: number;
  goroutines: number;
  app: number | null;
  kernel: number | null;
}) {
  const hasSplit = app !== null && kernel !== null && app + kernel > 0;
  const total = memory > 0 ? memory : (app ?? 0) + (kernel ?? 0);
  const appPercent = hasSplit ? Math.min(100, (app / (app + kernel)) * 100) : 100;
  const { t } = useI18n();
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="memory" size={16} />}
        title={t("Memory")}
        actions={
          <FcIconButton label={t("Resource details")} onClick={() => navigate("tools/resources")}>
            <Icon name="chevron_right" size={16} />
          </FcIconButton>
        }
      />
      <div className={styles.memoryValue}>{total > 0 ? formatMemoryBytes(total) : "—"}</div>
      <div className={styles.memoryBar}>
        <span className={styles.memoryApp} style={{ width: `${appPercent}%` }} />
        {hasSplit && <span className={styles.memoryKernel} style={{ width: `${100 - appPercent}%` }} />}
      </div>
      <div className={styles.memoryLegend}>
        {hasSplit ? (
          <>
            <span>
              <i className={styles.legendApp} /> {t("App")} {formatMemoryBytes(app)}
            </span>
            <span>
              <i className={styles.legendKernel} /> {t("Kernel")} {formatMemoryBytes(kernel)}
            </span>
          </>
        ) : (
          <span>
            <i className={styles.legendApp} /> {t("Total")}
          </span>
        )}
      </div>
      <div className={styles.memoryFoot}>
        {t("Goroutines")} {goroutines || "—"}
      </div>
    </FcCard>
  );
}

type FeedTab = "connections" | "requests" | "dns";
type NetworkFilter = "all" | "tcp" | "udp";

function ConnectionsFeed({
  rows,
  now,
  loaded,
}: {
  rows: readonly ConnectionRow[];
  now: number;
  loaded: boolean;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<FeedTab>("connections");
  const [network, setNetwork] = useState<NetworkFilter>("all");
  const dns = useDnsLedger();
  const requests = useMemo(() => buildRequestLedger(rows, now), [rows, now]);
  const activeRows = useMemo(
    () =>
      rows
        .filter((row) => row.closedAt === null)
        .filter(
          (row) => network === "all" || row.connection.network.toLowerCase() === network,
        )
        .sort((left, right) => Number(right.connection.createdAt) - Number(left.connection.createdAt)),
    [rows, network],
  );

  const connectionColumns: FcColumn<ConnectionRow>[] = [
    {
      key: "process",
      label: t("Source"),
      width: 140,
      render: (row) => {
        const name = connectionProcessName(row) || row.connection.inbound || "—";
        return (
          <span className={styles.sourceCell}>
            <FcAvatar name={name} />
            <span className={styles.truncate}>{name}</span>
          </span>
        );
      },
    },
    {
      key: "target",
      label: t("Target"),
      flex: 1.6,
      render: (row) => <span title={connectionHost(row)}>{connectionHost(row) || "—"}</span>,
    },
    {
      key: "protocol",
      label: t("Protocol"),
      width: 52,
      hideBelow: 620,
      render: (row) => row.connection.network.toUpperCase() || "—",
    },
    {
      key: "rule",
      label: t("Rule"),
      flex: 1,
      hideBelow: 720,
      render: (row) => <span className={styles.muted}>{row.connection.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: t("Outbound"),
      width: 104,
      render: (row) => <span className={styles.truncate} title={row.connection.outbound}>{row.connection.outbound || "—"}</span>,
    },
    {
      key: "download",
      label: t("Download"),
      width: 76,
      align: "end",
      render: (row) => formatRate(row.downlinkRate),
    },
    {
      key: "upload",
      label: t("Upload"),
      width: 76,
      align: "end",
      render: (row) => formatRate(row.uplinkRate),
    },
    {
      key: "duration",
      label: t("Duration"),
      width: 64,
      align: "end",
      hideBelow: 880,
      render: (row) =>
        formatDurationMs(Math.max(0, now - Number(row.connection.createdAt))),
    },
  ];

  const requestColumns: FcColumn<(typeof requests)[number]>[] = [
    {
      key: "time",
      label: t("Time"),
      width: 76,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "source",
      label: t("Source"),
      width: 120,
      hideBelow: 640,
      render: (entry) => <span className={styles.muted}>{entry.inbound || "—"}</span>,
    },
    {
      key: "target",
      label: t("Target"),
      flex: 1.3,
      render: (entry) => <span title={entry.host}>{entry.host || "—"}</span>,
    },
    {
      key: "rule",
      label: t("Rule"),
      flex: 1,
      hideBelow: 760,
      render: (entry) => <span className={styles.muted}>{entry.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: t("Outbound"),
      width: 100,
      render: (entry) => <span className={styles.truncate} title={entry.chain}>{entry.chain || "—"}</span>,
    },
    {
      key: "traffic",
      label: t("Traffic"),
      width: 72,
      align: "end",
      render: (entry) => formatBytes(entry.downloadTotal + entry.uploadTotal),
    },
  ];

  const dnsColumns: FcColumn<(typeof dns)[number]>[] = [
    {
      key: "time",
      label: t("Time"),
      width: 76,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "name",
      label: t("Domain"),
      flex: 1.3,
      render: (entry) => <span title={entry.name}>{entry.name}</span>,
    },
    {
      key: "type",
      label: t("Type"),
      width: 60,
      render: (entry) => entry.type,
    },
    {
      key: "source",
      label: t("Initiator"),
      width: 72,
      hideBelow: 900,
      render: (entry) => <span className={styles.muted}>{entry.source || "—"}</span>,
    },
    {
      key: "result",
      label: t("Results"),
      flex: 1,
      render: (entry) => <span className={entry.ok ? styles.goodText : styles.badText}>{entry.result || "—"}</span>,
    },
    {
      key: "elapsed",
      label: t("Elapsed"),
      width: 64,
      align: "end",
      render: (entry) => `${entry.elapsedMs} ms`,
    },
  ];

  const tabs: { key: FeedTab; label: string; count: number }[] = [
    { key: "connections", label: t("Live connections"), count: activeRows.length },
    { key: "requests", label: t("Recent Requests"), count: requests.length },
    { key: "dns", label: t("DNS query"), count: dns.length },
  ];

  return (
    <FcCard className={styles.feedCard}>
      <div className={styles.feedHeader}>
        <div className={styles.tabs} role="tablist" aria-label={t("Connection data")}>
          {tabs.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className={cx(styles.tab, tab === entry.key && styles.tabActive)}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
              <span className={styles.tabCount}>{entry.count}</span>
            </button>
          ))}
        </div>
        {tab === "connections" && (
          <div className={styles.networkChips}>
            {(["all", "tcp", "udp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={cx(styles.networkChip, network === value && styles.networkChipActive)}
                onClick={() => setNetwork(value)}
              >
                {value === "all" ? t("All") : value.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.feedTable}>
        {tab === "connections" && (
          <FcRecordTable
            columns={connectionColumns}
            rows={activeRows}
            getKey={(row) => row.connection.id}
            emptyLabel={loaded ? t("No data") : t("Loading…")}
            maxRows={100}
            dense
            onRowClick={() => navigate("connections")}
          />
        )}
        {tab === "requests" && (
          <FcRecordTable
            columns={requestColumns}
            rows={requests}
            getKey={(entry) => entry.id}
            emptyLabel={t("No data")}
            maxRows={100}
            dense
            onRowClick={() => navigate("tools/requests")}
          />
        )}
        {tab === "dns" && (
          <FcRecordTable
            columns={dnsColumns}
            rows={dns}
            getKey={(entry) => entry.id}
            emptyLabel={t("No data")}
            maxRows={100}
            dense
            onRowClick={() => navigate("tools/dns")}
          />
        )}
      </div>
    </FcCard>
  );
}

function groupIcon(group: Group): "bolt" | "swap_horiz" | "tune" | "layers" {
  const type = group.type.toLowerCase();
  if (type === "urltest") {
    return "bolt";
  }
  if (type === "fallback" || type === "loadbalance") {
    return "swap_horiz";
  }
  if (type === "selector") {
    return "tune";
  }
  return "layers";
}

function ProxyGroupsPanel({
  groups,
  compact = false,
}: {
  groups: readonly Group[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [sheetGroup, setSheetGroup] = useState<Group | null>(null);
  const timeout = groups.reduce(
    (count, group) =>
      count +
      group.items.filter((item) => item.urlTestTime > 0n && item.urlTestDelay <= 0).length,
    0,
  );
  const visible = compact ? groups.slice(0, 2) : groups;
  return (
    <FcCard className={cx(styles.groupsCard, compact && styles.groupsCompact)}>
      <FcCardHeader
        icon={<Icon name="layers" size={16} />}
        title={t("Policy groups")}
        actions={
          <>
            <span className={styles.countChip}>{groups.length}</span>
            {timeout > 0 && (
              <span className={styles.timeoutChip}>
                {t("{count} timed out", { count: timeout })}
              </span>
            )}
            {!compact && (
              <FcIconButton label={t("Open proxies page")} onClick={() => navigate("proxies")}>
                <Icon name="chevron_right" size={16} />
              </FcIconButton>
            )}
          </>
        }
      />
      <div className={cx(styles.groupsGrid, compact && styles.groupsGridCompact)}>
        {visible.length === 0 ? (
          <div className={styles.groupsEmpty}>{t("No policy groups")}</div>
        ) : (
          visible.map((group) => (
            <button
              key={group.tag}
              type="button"
              className={styles.groupTile}
              onClick={() => setSheetGroup(group)}
            >
              <span className={styles.groupIcon}>
                <Icon name={groupIcon(group)} size={18} />
              </span>
              <span className={styles.groupText}>
                <span className={styles.groupName}>{group.tag}</span>
                <span className={styles.groupSelected}>{group.selected || "—"}</span>
              </span>
            </button>
          ))
        )}
      </div>
      {sheetGroup && (
        <ProxyGroupSheet group={sheetGroup} onClose={() => setSheetGroup(null)} />
      )}
    </FcCard>
  );
}

function ConnectionStats({
  connections,
  requests,
  dns,
}: {
  connections: number;
  requests: number;
  dns: number;
}) {
  const { t } = useI18n();
  return (
    <FcCard className={styles.statsCard}>
      <div className={styles.statsGrid}>
        <button type="button" className={styles.stat} onClick={() => navigate("connections")}>
          <strong>{connections}</strong>
          <span>{t("Live connections")}</span>
        </button>
        <button type="button" className={styles.stat} onClick={() => navigate("tools/requests")}>
          <strong>{requests}</strong>
          <span>{t("Recent Requests")}</span>
        </button>
        <button type="button" className={styles.stat} onClick={() => navigate("tools/dns")}>
          <strong>{dns}</strong>
          <span>{t("DNS query")}</span>
        </button>
      </div>
    </FcCard>
  );
}

function CoreStatusButton({
  panel,
  statusType,
  started,
  version,
}: {
  panel: PanelStateResult;
  statusType: ServiceStatus_Type | null;
  started: boolean;
  version: string | null;
}) {
  const api = useApi();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const tone = statusToneOf(statusType);
  const panelAvailable = hasPanelToken();

  const run = async (action: "start" | "stop" | "restart") => {
    if (!panelAvailable) {
      showError(new Error(t("Direct mode cannot control the core; use the panel backend.")));
      return;
    }
    setBusy(true);
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        throw new Error(result.message || t("Core operation failed"));
      }
      panel.refresh();
      setOpen(false);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.coreWrap} ref={ref}>
      <button
        type="button"
        className={cx(styles.coreButton, styles[tone])}
        aria-label={t("Core status")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? (
          <span className={styles.coreSpinner} />
        ) : (
          <Icon name={tone === "bad" ? "warning_amber" : "check"} size={20} />
        )}
      </button>
      {open && (
        <div className={styles.coreMenu} role="menu">
          <div className={styles.coreMenuHeader}>
            <span className={styles.coreMenuTitle}>{t(statusLabelKey(statusType))}</span>
            <span className={styles.coreMenuMeta}>{api.config.name}</span>
          </div>
          <div className={styles.coreMenuMeta}>
            {t("Version {version}", { version: version ?? "—" })} ·{" "}
            {started ? t("Core running") : t("Core not running")}
          </div>
          <div className={styles.coreMenuDivider} />
          {!started && (
            <button
              type="button"
              className={styles.coreMenuRow}
              disabled={busy}
              onClick={() => void run("start")}
            >
              <Icon name="play_arrow" size={16} /> {t("Start core")}
            </button>
          )}
          {started && (
            <>
              <button
                type="button"
                className={styles.coreMenuRow}
                disabled={busy}
                onClick={() => void run("restart")}
              >
                <Icon name="restart_alt" size={16} /> {t("Restart core")}
              </button>
              <button
                type="button"
                className={cx(styles.coreMenuRow, styles.coreMenuDanger)}
                disabled={busy}
                onClick={() => void run("stop")}
              >
                <Icon name="stop" size={16} /> {t("Stop core")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardView() {
  const api = useApi();
  const { t } = useI18n();
  const panel = usePanelState();
  const serviceStatus = useStream(api.serviceStatus);
  const status = useStream(api.status);
  const groups = useStream(api.groups);
  const clashMode = useStream(api.clashMode);
  const connections = useStream(api.connections);
  const now = useNow(1000);
  const statusType = serviceStatus.data.status?.status ?? null;
  const started = statusType === ServiceStatus_Type.STARTED;
  const starting = statusType === ServiceStatus_Type.STARTING || statusType === ServiceStatus_Type.STOPPING;
  const serverInfo = useUnaryOnce(() => api.serverInfo(), true);
  const startedAt = useUnaryOnce(() => api.getStartedAt(), serviceStatus.phase === "active");
  const proxyTag = useProxyTag(groups.data.groups);
  const service = useServiceStatus(started, proxyTag);
  const egress = useEgress(panel);
  const profiles = useProfilesSummary(panel);
  const systemProxy = useSystemProxy();
  const tun = useTunControl(api, panel);
  const lan = useLanControl(api);
  const localIp = useLocalIp(panel.state?.local_ip);
  const layout = useDashboardLayout();
  const memory = Number(status.data.current?.memory ?? 0);
  const goroutines = status.data.current?.goroutines ?? 0;
  const trafficAvailable = status.data.current?.trafficAvailable ?? false;
  const currentMode = clashMode.data.currentMode;
  const countryCode = countryCodeOf(egress.geo?.country);
  const organization =
    egress.geo?.organization ??
    egress.geo?.org ??
    (egress.geo?.asn ? `AS${egress.geo.asn}` : "—");
  const ipType = panel.state?.ip_type ?? "";
  const geoLocation = [egress.geo?.country, egress.geo?.city].filter(Boolean).join(" · ");
  const ipQuality = panel.state?.ip_quality ?? null;
  // Old panels omit the field; only an explicit false means "not configured".
  const egressConfigured = panel.state?.egress_probe_configured !== false;
  const appMemory = panel.state?.memory_app ?? null;
  const kernelMemory = panel.state?.memory_kernel ?? null;
  const uptime =
    started && startedAt !== null ? formatUptimeClock(startedAt, now) : "—";
  const proxyCount = new Set(
    groups.data.groups.flatMap((group) => group.items.map((item) => item.tag)),
  ).size;
  const activeCount = useMemo(
    () => [...connections.data.rows.values()].filter((row) => row.closedAt === null).length,
    [connections.data.rows],
  );
  const requestCount = useMemo(
    () => buildRequestLedger(connections.data.rows.values(), now).length,
    [connections.data.rows, now],
  );
  const dnsCount = useDnsLedger().length;
  const connectionRows = useMemo(
    () => [...connections.data.rows.values()],
    [connections.data.rows],
  );

  const runMode = (segment: OutboundModeSegment) => {
    if (!started) {
      showError(new Error(t("The core is not running; the outbound mode cannot be switched.")));
      return;
    }
    const mode = modeForSegment(segment, clashMode.data.modeList);
    api.setClashMode(mode).catch((error: unknown) => {
      showError(error);
    });
  };

  const runCore = () => {
    if (!hasPanelToken()) {
      showError(new Error(t("Direct mode cannot control the core; use the panel backend.")));
      return;
    }
    const action = started ? "stop" : "start";
    serviceAction(action)
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.message || t("Core operation failed"));
        }
        panel.refresh();
      })
      .catch(showError);
  };

  const [widgetLayout, setWidgetLayout] = useState<WidgetLayout>(loadWidgetLayout);
  const [editing, setEditing] = useState(false);
  const [editBaseline, setEditBaseline] = useState<WidgetLayout>(widgetLayout);
  const columns = layout.layout.columns;
  const widgets = visiblePlacements(widgetLayout);

  // Persist from state so the sheet's functional updaters are the single source
  // of truth (two toggles in one frame used to overwrite each other).
  useEffect(() => {
    saveWidgetLayout(widgetLayout);
  }, [widgetLayout]);
  const applyLayout = (update: WidgetLayout | ((previous: WidgetLayout) => WidgetLayout)) =>
    setWidgetLayout(update);
  const openEditor = () => {
    setEditBaseline(widgetLayout);
    setEditing(true);
  };

  const renderWidget = (placement: WidgetPlacement) => {
    switch (placement.id) {
      case "status":
        return (
          <StatusCard
            statusType={statusType}
            started={started}
            busy={starting}
            ip={egress.ip}
            countryCode={countryCode}
            organization={organization}
            ipType={ipType}
            ipQuality={ipQuality}
            uptime={uptime}
            probing={egress.probing}
            onReprobe={egress.reprobe}
            onStartStop={runCore}
            panelAvailable={hasPanelToken()}
            configError={panel.state?.config_error ?? null}
            egressConfigured={egressConfigured}
            geoLocation={geoLocation}
          />
        );
      case "upload":
        return (
          <SpeedCard
            direction="upload"
            rate={Number(status.data.current?.uplink ?? 0)}
            total={Number(status.data.current?.uplinkTotal ?? 0)}
            history={status.data.uplinkHistory}
            loading={!trafficAvailable}
            chartHeight={layout.layout.compact ? 62 : 88}
          />
        );
      case "download":
        return (
          <SpeedCard
            direction="download"
            rate={Number(status.data.current?.downlink ?? 0)}
            total={Number(status.data.current?.downlinkTotal ?? 0)}
            history={status.data.downlinkHistory}
            loading={!trafficAvailable}
            chartHeight={layout.layout.compact ? 62 : 88}
          />
        );
      case "mode":
        return <ModeCard currentMode={currentMode} disabled={!started} onChange={runMode} />;
      case "global-outbound":
        return <WidgetGlobalOutbound groups={groups.data.groups} />;
      case "system-proxy":
        return <SystemProxyCard control={systemProxy} />;
      case "tun":
        return <TunCard control={tun} />;
      case "intranet":
        return <IntranetCard ip={localIp} lan={lan} />;
      case "quota":
        return (
          <ProfileCard
            summary={profiles.summary}
            busy={profiles.busy}
            groupsCount={groups.data.groups.length}
            proxyCount={proxyCount}
            onSync={() => {
              void profiles.sync();
            }}
          />
        );
      case "services":
        return (
          <ServiceStatusCard
            results={service.results}
            testing={service.testing}
            proxyTag={proxyTag}
            onRun={() => {
              void service.run();
            }}
          />
        );
      case "memory":
        return <MemoryCard memory={memory} goroutines={goroutines} app={appMemory} kernel={kernelMemory} />;
      case "stats":
        return <ConnectionStats connections={activeCount} requests={requestCount} dns={dnsCount} />;
      case "traffic":
        return (
          <ObsTrafficCard
            panel={panel}
            live={{ up: status.data.uplinkHistory, down: status.data.downlinkHistory }}
          />
        );
      case "outbound-share":
        return <ObsOutboundCard connections={connections} />;
      case "ranking":
        return <ObsRankingCard rows={connectionRows} />;
      case "cpu":
        return <ObsCpuCard panel={panel} />;
      case "latency":
        return (
          <WidgetLatency
            groups={groups.data.groups}
            histories={groups.data.latencyHistory}
            onOpenNodes={() => navigate("nodes")}
          />
        );
      case "outbound-connections":
        return <WidgetOutboundConnections rows={connectionRows} />;
      case "dns-results":
        return <WidgetDnsResults onOpenDns={() => navigate("dns")} />;
      case "policy-groups":
        return <ProxyGroupsPanel groups={groups.data.groups} compact />;
      case "notifications":
        return <ObsNotificationsCard />;
      case "connections":
        return (
          <ConnectionsFeed
            rows={[...connections.data.rows.values()]}
            now={now}
            loaded={connections.data.loaded}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="fc-page">
      <div className={styles.toolbarRow}>
        <div>
          <h1 className={styles.pageTitle}>{t("Activity")}</h1>
        </div>
        <div className={styles.toolbarActions}>
          <FcButton variant="tonal" onClick={openEditor}>
            <Icon name="tune" size={16} />
            <span>{t("Edit dashboard")}</span>
          </FcButton>
          <CoreStatusButton
            panel={panel}
            statusType={statusType}
            started={started}
            version={serverInfo?.version ?? null}
          />
        </div>
      </div>
      <div
        ref={layout.ref}
        className={cx("fc-page-body", styles.dashboard)}
        data-columns={columns}
        data-compact={layout.layout.compact}
      >
        <div className={styles.widgetGrid} data-columns={columns} style={{ gap: layout.layout.gap }}>
          {widgets.length === 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <FcEmptyState
                icon="grid_view"
                title={t("Every widget is hidden")}
                hint={t("Open the editor to show the widgets you need again.")}
                action={
                  <FcButton variant="tonal" onClick={openEditor}>
                    {t("Edit dashboard")}
                  </FcButton>
                }
              />
            </div>
          )}
          {widgets.map((placement) => (
            <div
              key={placement.id}
              className={styles.widgetCell}
              data-widget={placement.id}
              style={{
                gridColumn: `span ${effectiveSpan(placement, columns)}`,
                minHeight: placement.rows > 0 ? placement.rows * 96 : undefined,
              }}
            >
              {renderWidget(placement)}
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <DashboardEditSheet
          layout={widgetLayout}
          baseline={editBaseline}
          onChange={applyLayout}
          onReset={() => applyLayout(defaultLayout())}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
