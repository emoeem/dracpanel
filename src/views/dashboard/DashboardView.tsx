import { useMemo, useRef, useState } from "react";

import { formatBytes, formatDurationMs, formatMemoryBytes, formatRelativeTime } from "../../api/format";
import { hasPanelToken, serviceAction } from "../../api/panel";
import { useStream } from "../../api/stream";
import { navigate, useApi, useNow } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useDismiss, useUnaryOnce } from "../../app/hooks";
import { useI18n } from "../../app/i18n";
import { usePanelState, type PanelStateResult } from "../../app/usePanelState";
import type { ConfigToggleControl, SystemProxyControl } from "../../app/useRuntimeToggles";
import { useLanControl, useSystemProxy, useTunControl } from "../../app/useRuntimeToggles";
import { Icon } from "../../components/Icon";
import {
  FcAvatar,
  FcButton,
  FcCard,
  FcCardHeader,
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
import styles from "./Dashboard.module.css";

function splitRate(value: number): { amount: string; unit: string } {
  const formatted = formatBytes(value);
  const space = formatted.lastIndexOf(" ");
  return { amount: formatted.slice(0, space), unit: formatted.slice(space + 1) };
}

function statusLabelOf(type: ServiceStatus_Type | null | undefined): string {
  switch (type) {
    case ServiceStatus_Type.STARTED:
      return "运行中";
    case ServiceStatus_Type.STARTING:
    case ServiceStatus_Type.STOPPING:
      return "挂起中…";
    case ServiceStatus_Type.FATAL:
      return "启动失败";
    default:
      return "未运行";
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
  return (
    <button
      type="button"
      className={cx(styles.startButton, running && styles.startRunning)}
      onClick={onClick}
      disabled={disabled || busy}
      title={running ? "停止核心" : "启动核心"}
      aria-label={running ? "停止核心" : "启动核心"}
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
}) {
  const tone = statusToneOf(statusType);
  return (
    <FcCard className={cx(styles.statusCard, className)}>
      <CookieBlob running={started} />
      <div className={styles.statusContent}>
        <div className={styles.statusHeader}>
          <span className={styles.statusTitle}>
            <Icon name="verified" size={16} />
            状态
          </span>
          <span className={cx(styles.statusChip, styles[tone])}>
            <span className={styles.statusDot} />
            {statusLabelOf(statusType)}
          </span>
        </div>
        <div className={styles.ipRow}>
          <button
            type="button"
            className={styles.countryBadge}
            onClick={onReprobe}
            title="重新检测出口 IP"
            aria-label="重新检测出口 IP"
          >
            {probing ? <span className={styles.miniSpinner} /> : countryCode || "—"}
          </button>
          <span className={styles.ipText}>{ip || "—"}</span>
        </div>
        <div className={styles.statusChips}>
          <span className={styles.chip}>{ipType}</span>
          <span className={styles.chip}>{ipQuality ? `质量 ${ipQuality}` : "质量未知"}</span>
        </div>
        <div className={styles.statusMeta}>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>运行时长</span>
            <span className={styles.metaValue}>{uptime}</span>
          </div>
          <div className={styles.metaCell}>
            <span className={styles.metaLabel}>组织</span>
            <span className={styles.metaValue} title={organization}>
              {organization}
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
  return (
    <FcCard className={cx(styles.speedCard, up ? styles.uploadCard : styles.downloadCard)}>
      <div className={styles.speedHeader}>
        <span className={styles.speedTitle}>
          <Icon name={up ? "arrow_upward" : "arrow_downward"} size={14} />
          {up ? "上传" : "下载"}
        </span>
        <span className={styles.speedPeak}>峰值 {formatPeak(history)}</span>
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
          <div className={styles.rateTotal}>累计 {formatBytes(total)}</div>
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
  const change = (segment: OutboundModeSegment) => {
    setPending(segment);
    onChange(segment);
    window.setTimeout(() => setPending(null), 1500);
  };
  return (
    <FcCard shape="block" className={cx(styles.modeCard, className)}>
      <span className={styles.modeLabel}>
        <Icon name="swap_horiz" size={16} />
        出站模式
      </span>
      <FcSegmented
        className={styles.modeSegments}
        ariaLabel="出站模式"
        value={selected}
        disabled={disabled}
        options={OUTBOUND_MODES.map((mode) => ({
          value: mode.value,
          label: mode.label,
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
}: {
  icon: "swap_horiz" | "vpn_lock" | "shield";
  title: string;
  subtitle: string;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FcCard shape="block" className={styles.takeoverCard}>
      <span className={cx(styles.takeoverIcon, checked && styles.takeoverIconActive)}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.takeoverText}>
        <span className={styles.takeoverTitle}>{title}</span>
        <span className={styles.takeoverSub}>{busy ? "处理中…" : subtitle}</span>
      </span>
      <FcSwitch
        checked={checked}
        disabled={disabled || busy}
        label={title}
        onChange={onChange}
      />
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
  return (
    <FcSheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <FcButton variant="text" onClick={onClose} disabled={busy}>
            取消
          </FcButton>
          <FcButton variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? "应用中…" : "应用并重启"}
          </FcButton>
        </>
      }
    >
      <p className={styles.confirmText}>{message}</p>
      <div className={styles.confirmHint}>
        修改会写入配置文件并重启内核，当前连接会短暂中断；校验失败时面板会自动回滚。
      </div>
    </FcSheet>
  );
}

function SystemProxyCard({ control }: { control: SystemProxyControl }) {
  const subtitle = !control.supported
    ? "需要面板后端接口"
    : control.enabled
      ? `已开启${control.port ? ` · 端口 ${control.port}` : ""}`
      : "已关闭";
  return (
    <TakeoverShell
      icon="swap_horiz"
      title="系统代理"
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
  const subtitle = !control.supported
    ? control.reason ?? "需要面板后端"
    : control.ebpfMode
      ? "eBPF 数据面接管中"
      : control.pending !== null
        ? control.pending
          ? "准备开启"
          : "准备关闭"
        : control.enabled
          ? "已开启"
          : control.reason ?? "已关闭";
  return (
    <>
      <TakeoverShell
        icon={control.ebpfMode ? "shield" : "vpn_lock"}
        title={control.ebpfMode ? "流量接管" : "虚拟网卡"}
        subtitle={subtitle}
        checked={control.ebpfMode ? true : (control.pending ?? control.enabled)}
        busy={control.busy}
        disabled={!control.supported || control.ebpfMode || (control.reason !== null && !control.enabled)}
        onChange={(next) => control.request(next)}
      />
      {control.pending !== null && (
        <ConfirmToggle
          title={control.pending ? "开启虚拟网卡" : "关闭虚拟网卡"}
          message={
            control.pending
              ? "将把之前保存的 TUN 入站恢复到配置中，并重启内核。"
              : "将从配置中移除 TUN 入站并保存为预设，方便之后恢复。"
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
  const shown = ip ? (lan.enabled && lan.port ? `${ip}:${lan.port}` : ip) : "无网络";
  const subtitle = !lan.supported
    ? lan.reason ?? "不可用"
    : lan.enabled
      ? `已开启${lan.port ? ` · 端口 ${lan.port}` : ""}`
      : "已关闭";
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="lan" size={16} />}
        title="内网 IP"
        actions={
          <FcIconButton
            label="复制内网 IP"
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
          <span className={styles.lanTitle}>局域网代理</span>
          <span className={styles.lanSub}>{subtitle}</span>
        </span>
        <FcSwitch
          checked={lan.pending ?? lan.enabled}
          disabled={!lan.supported || lan.busy}
          label="局域网代理"
          onChange={(next) => lan.request(next)}
        />
      </div>
      {lan.pending !== null && (
        <ConfirmToggle
          title={lan.pending ? "开启局域网代理" : "关闭局域网代理"}
          message={
            lan.pending
              ? "将把本地入站的监听地址切换为 0.0.0.0，并重启内核；请确认系统防火墙已放行该端口。"
              : "将把本地入站的监听地址切回 127.0.0.1，并重启内核。"
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
  const { language } = useI18n();
  const now = useNow(30_000);
  const days = summary.daysLeft;
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="description" size={16} />}
        title="配置"
        actions={
          <>
            <FcIconButton
              label="更新当前配置"
              disabled={busy || !summary.subscription}
              onClick={onSync}
            >
              <Icon name="sync" size={16} />
            </FcIconButton>
            <FcIconButton label="打开配置页" onClick={() => navigate("profiles")}>
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
          更新于{" "}
          {summary.updatedAt
            ? formatRelativeTime(summary.updatedAt, now, language)
            : "—"}
        </span>
        {days !== null && (
          <span className={cx(styles.expiry, days <= 7 && styles.expiryWarning)}>
            {formatExpiryDays(days)}
          </span>
        )}
      </div>
      {summary.hasUsage ? (
        <>
          <div className={styles.usageRow}>
            <span>
              <strong>{percentLabel(summary.usage.ratio)}</strong> 已用
            </span>
            <span>
              {formatBytes(summary.usage.used)} / {formatBytes(summary.usage.total)}
            </span>
          </div>
          <FcWavyProgress
            value={summary.usage.ratio}
            label="配置用量"
            warning={summary.usage.ratio >= 0.9}
          />
        </>
      ) : (
        <div className={styles.profileCounts}>
          <span className={styles.countCell}>
            <strong>{groupsCount}</strong>
            <span>策略组</span>
          </span>
          <span className={styles.countCell}>
            <strong>{proxyCount}</strong>
            <span>代理</span>
          </span>
          <span className={styles.countCell}>
            <strong>—</strong>
            <span>规则</span>
          </span>
        </div>
      )}
    </FcCard>
  );
}

function serviceText(result: ServiceResult): string {
  switch (result.state) {
    case "available":
      return result.delayMs !== null ? `${result.delayMs} ms` : "可用";
    case "timeout":
      return "超时";
    case "unavailable":
      return "不可用";
    case "error":
      return "检测失败";
    case "testing":
      return "检测中";
    default:
      return "待检测";
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
  const chip = testing
    ? { label: "检测中", tone: "warning" as const }
    : summary.allAvailable
      ? { label: "全部可用", tone: "good" as const }
      : summary.abnormal > 0
        ? { label: `${summary.abnormal} 项异常`, tone: "warning" as const }
        : { label: "待检测", tone: "neutral" as const };
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="verified" size={16} />}
        title="服务状态"
        actions={
          <>
            <span className={cx(styles.serviceChip, styles[chip.tone])}>{chip.label}</span>
            <FcIconButton label="全部检测" disabled={testing || !proxyTag} onClick={onRun}>
              <Icon name="bolt" size={16} />
            </FcIconButton>
            <FcIconButton label="查看全部服务" onClick={() => setOpen(true)}>
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
                <span className={styles.serviceDelay}>{serviceText(result)}</span>
              </span>
              <ServiceStateMark state={result.state} />
            </div>
          );
        })}
      </div>
      {open && (
        <FcSheet
          title="服务状态"
          subtitle={proxyTag ? `通过 ${proxyTag} 检测` : "没有可用的代理出口"}
          onClose={() => setOpen(false)}
          footer={
            <FcButton
              variant="primary"
              disabled={testing || !proxyTag}
              onClick={onRun}
            >
              {testing ? "检测中…" : "全部检测"}
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
                    {serviceText(result)}
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
  return (
    <FcCard className={styles.middleCard}>
      <FcCardHeader
        icon={<Icon name="memory" size={16} />}
        title="内存信息"
        actions={
          <FcIconButton label="资源详情" onClick={() => navigate("tools/resources")}>
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
              <i className={styles.legendApp} /> 应用 {formatMemoryBytes(app)}
            </span>
            <span>
              <i className={styles.legendKernel} /> 内核 {formatMemoryBytes(kernel)}
            </span>
          </>
        ) : (
          <span>
            <i className={styles.legendApp} /> 总计
          </span>
        )}
      </div>
      <div className={styles.memoryFoot}>协程 {goroutines || "—"}</div>
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
      label: "来源",
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
      label: "目标",
      flex: 1.6,
      render: (row) => <span title={connectionHost(row)}>{connectionHost(row) || "—"}</span>,
    },
    {
      key: "protocol",
      label: "协议",
      width: 52,
      hideBelow: 620,
      render: (row) => row.connection.network.toUpperCase() || "—",
    },
    {
      key: "rule",
      label: "规则",
      flex: 1,
      hideBelow: 720,
      render: (row) => <span className={styles.muted}>{row.connection.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: "出口",
      width: 104,
      render: (row) => <span className={styles.truncate} title={row.connection.outbound}>{row.connection.outbound || "—"}</span>,
    },
    {
      key: "download",
      label: "下载",
      width: 76,
      align: "end",
      render: (row) => formatRate(row.downlinkRate),
    },
    {
      key: "upload",
      label: "上传",
      width: 76,
      align: "end",
      render: (row) => formatRate(row.uplinkRate),
    },
    {
      key: "duration",
      label: "时长",
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
      label: "时间",
      width: 76,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "source",
      label: "来源",
      width: 120,
      hideBelow: 640,
      render: (entry) => <span className={styles.muted}>{entry.inbound || "—"}</span>,
    },
    {
      key: "target",
      label: "目标",
      flex: 1.3,
      render: (entry) => <span title={entry.host}>{entry.host || "—"}</span>,
    },
    {
      key: "rule",
      label: "规则",
      flex: 1,
      hideBelow: 760,
      render: (entry) => <span className={styles.muted}>{entry.rule || "—"}</span>,
    },
    {
      key: "outbound",
      label: "出口",
      width: 100,
      render: (entry) => <span className={styles.truncate} title={entry.chain}>{entry.chain || "—"}</span>,
    },
    {
      key: "traffic",
      label: "流量",
      width: 72,
      align: "end",
      render: (entry) => formatBytes(entry.downloadTotal + entry.uploadTotal),
    },
  ];

  const dnsColumns: FcColumn<(typeof dns)[number]>[] = [
    {
      key: "time",
      label: "时间",
      width: 76,
      render: (entry) => new Date(entry.at).toLocaleTimeString(),
    },
    {
      key: "name",
      label: "域名",
      flex: 1.3,
      render: (entry) => <span title={entry.name}>{entry.name}</span>,
    },
    {
      key: "type",
      label: "类型",
      width: 60,
      render: (entry) => entry.type,
    },
    {
      key: "source",
      label: "发起",
      width: 72,
      hideBelow: 900,
      render: (entry) => <span className={styles.muted}>{entry.source || "—"}</span>,
    },
    {
      key: "result",
      label: "结果",
      flex: 1,
      render: (entry) => <span className={entry.ok ? styles.goodText : styles.badText}>{entry.result || "—"}</span>,
    },
    {
      key: "elapsed",
      label: "耗时",
      width: 64,
      align: "end",
      render: (entry) => `${entry.elapsedMs} ms`,
    },
  ];

  const tabs: { key: FeedTab; label: string; count: number }[] = [
    { key: "connections", label: "实时连接", count: activeRows.length },
    { key: "requests", label: "最近请求", count: requests.length },
    { key: "dns", label: "DNS查询", count: dns.length },
  ];

  return (
    <FcCard className={styles.feedCard}>
      <div className={styles.feedHeader}>
        <div className={styles.tabs} role="tablist" aria-label="连接数据">
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
                {value === "all" ? "全部" : value.toUpperCase()}
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
            emptyLabel={loaded ? "暂无数据" : "加载中…"}
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
            emptyLabel="暂无数据"
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
            emptyLabel="暂无数据"
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
        title="策略组"
        actions={
          <>
            <span className={styles.countChip}>{groups.length}</span>
            {timeout > 0 && <span className={styles.timeoutChip}>{timeout} 超时</span>}
            {!compact && (
              <FcIconButton label="打开代理页" onClick={() => navigate("proxies")}>
                <Icon name="chevron_right" size={16} />
              </FcIconButton>
            )}
          </>
        }
      />
      <div className={cx(styles.groupsGrid, compact && styles.groupsGridCompact)}>
        {visible.length === 0 ? (
          <div className={styles.groupsEmpty}>暂无策略组</div>
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
  return (
    <FcCard className={styles.statsCard}>
      <div className={styles.statsGrid}>
        <button type="button" className={styles.stat} onClick={() => navigate("connections")}>
          <strong>{connections}</strong>
          <span>实时连接</span>
        </button>
        <button type="button" className={styles.stat} onClick={() => navigate("tools/requests")}>
          <strong>{requests}</strong>
          <span>最近请求</span>
        </button>
        <button type="button" className={styles.stat} onClick={() => navigate("tools/dns")}>
          <strong>{dns}</strong>
          <span>DNS查询</span>
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const tone = statusToneOf(statusType);
  const panelAvailable = hasPanelToken();

  const run = async (action: "start" | "stop" | "restart") => {
    if (!panelAvailable) {
      showError(new Error("直接模式无法控制核心；请使用面板后端"));
      return;
    }
    setBusy(true);
    try {
      const result = await serviceAction(action);
      if (!result.ok) {
        throw new Error(result.message || "核心操作失败");
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
        aria-label="核心状态"
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
            <span className={styles.coreMenuTitle}>{statusLabelOf(statusType)}</span>
            <span className={styles.coreMenuMeta}>{api.config.name}</span>
          </div>
          <div className={styles.coreMenuMeta}>
            版本 {version ?? "—"} · {started ? "核心运行中" : "核心已停止"}
          </div>
          <div className={styles.coreMenuDivider} />
          {!started && (
            <button
              type="button"
              className={styles.coreMenuRow}
              disabled={busy}
              onClick={() => void run("start")}
            >
              <Icon name="play_arrow" size={16} /> 启动核心
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
                <Icon name="restart_alt" size={16} /> 重启核心
              </button>
              <button
                type="button"
                className={cx(styles.coreMenuRow, styles.coreMenuDanger)}
                disabled={busy}
                onClick={() => void run("stop")}
              >
                <Icon name="stop" size={16} /> 停止核心
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
  const ipType = panel.state?.ip_type ?? "类型未知";
  const ipQuality = panel.state?.ip_quality ?? null;
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
      showError(new Error("核心未运行，无法切换出站模式"));
      return;
    }
    const mode = modeForSegment(segment, clashMode.data.modeList);
    api.setClashMode(mode).catch((error: unknown) => {
      showError(error);
    });
  };

  const runCore = () => {
    if (!hasPanelToken()) {
      showError(new Error("直接模式无法控制核心；请使用面板后端"));
      return;
    }
    const action = started ? "stop" : "start";
    serviceAction(action)
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.message || "核心操作失败");
        }
        panel.refresh();
      })
      .catch(showError);
  };

  return (
    <div className="fc-page">
      <div className={styles.toolbarRow}>
        <div>
          <h1 className={styles.pageTitle}>仪表盘</h1>
        </div>
        <CoreStatusButton
          panel={panel}
          statusType={statusType}
          started={started}
          version={serverInfo?.version ?? null}
        />
      </div>
      <div
        ref={layout.ref}
        className={cx("fc-page-body", styles.dashboard)}
        data-columns={layout.layout.columns}
        data-compact={layout.layout.compact}
      >
        <div className={styles.grid} style={{ gap: layout.layout.gap }}>
          <StatusCard
            className={styles.statusSlot}
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
          />
          <SpeedCard
            direction="upload"
            rate={Number(status.data.current?.uplink ?? 0)}
            total={Number(status.data.current?.uplinkTotal ?? 0)}
            history={status.data.uplinkHistory}
            loading={!trafficAvailable}
            chartHeight={layout.layout.compact ? 62 : 88}
          />
          <SpeedCard
            direction="download"
            rate={Number(status.data.current?.downlink ?? 0)}
            total={Number(status.data.current?.downlinkTotal ?? 0)}
            history={status.data.downlinkHistory}
            loading={!trafficAvailable}
            chartHeight={layout.layout.compact ? 62 : 88}
          />
          <ModeCard
            className={styles.modeSlot}
            currentMode={currentMode}
            disabled={!started}
            onChange={runMode}
          />
          <SystemProxyCard control={systemProxy} />
          <TunCard control={tun} />
          <IntranetCard ip={localIp} lan={lan} />
          <ProfileCard
            summary={profiles.summary}
            busy={profiles.busy}
            groupsCount={groups.data.groups.length}
            proxyCount={proxyCount}
            onSync={() => {
              void profiles.sync();
            }}
          />
          <ServiceStatusCard
            results={service.results}
            testing={service.testing}
            proxyTag={proxyTag}
            onRun={() => {
              void service.run();
            }}
          />
          <MemoryCard
            memory={memory}
            goroutines={goroutines}
            app={appMemory}
            kernel={kernelMemory}
          />
        </div>
        <div className={styles.obsRow} data-columns={layout.layout.columns}>
          <ObsTrafficCard panel={panel} />
          <ObsOutboundCard connections={connections} />
          <ObsRankingCard rows={connectionRows} />
        </div>
        <div className={styles.obsRow2} data-columns={layout.layout.columns}>
          <ObsCpuCard panel={panel} />
          <ObsNotificationsCard />
        </div>
        {layout.layout.showTables ? (
          <div className={styles.bottomRow}>
            <ConnectionsFeed
              rows={[...connections.data.rows.values()]}
              now={now}
              loaded={connections.data.loaded}
            />
            <ProxyGroupsPanel groups={groups.data.groups} />
          </div>
        ) : (
          <div className={styles.summaryRow}>
            <ConnectionStats
              connections={activeCount}
              requests={requestCount}
              dns={dnsCount}
            />
            <ProxyGroupsPanel groups={groups.data.groups} compact />
          </div>
        )}
      </div>
    </div>
  );
}
