/**
 * Traffic capture mode derived from the panel's state.
 *
 * `/api/state` reports two shapes:
 *  - `capture` (api_version 10+): the mode the backend already classified,
 *    plus the eBPF inbound's data plane/policy and the ports a client may use.
 *  - `inbounds` / `mode` (older panels): only the inbound *types*, so the UI
 *    has to classify them itself.
 *
 * Both are normalised here so no view re-derives the mode by hand. That
 * matters because the eBPF fork (reF1nd/sing-box) captures traffic through a
 * kernel `ebpf` inbound instead of a TUN device — a dashboard that keys off
 * "is there a tun inbound?" shows a disabled virtual NIC on a machine where
 * every packet is in fact being captured.
 */

export type InboundMode = "tun" | "ebpf" | "mixed" | "proxy" | "none" | "unknown";

export type EbpfPolicyMode = "off" | "whitelist" | "blacklist" | string;

export interface EbpfSharedInfo {
  enabled: boolean;
  dataPlane: string;
  interfaces: string[];
  dnsMode: string;
  bypassPrivate: boolean;
  ipv6: boolean;
}

export interface EbpfCaptureInfo {
  /** Policy selector: whitelist (include_uid), blacklist (exclude_uid) or off. */
  mode: EbpfPolicyMode;
  /** UIDs the policy selects (include for whitelist, exclude for blacklist). */
  uids: number[];
  include: number[];
  exclude: number[];
  /** Kernel hook the fork uses; `cgroup` in every build seen so far. */
  dataPlane: string;
  /** How DNS is handled for captured sockets (`hijack` most of the time). */
  dnsMode: string;
  /** Whether the inbound also captures IPv6. */
  ipv6: boolean;
  /** Optional "shared" block: capture for VMs behind a bridge (virbr0 …). */
  shared: EbpfSharedInfo | null;
}

export interface InboundModeSummary {
  mode: InboundMode;
  /** True when a TUN inbound is configured (system-wide capture via a NIC). */
  tun: boolean;
  /** True when the eBPF cgroup inbound is configured (per-app capture). */
  ebpf: boolean;
  /** Inbound types as reported by the panel, de-duplicated. */
  types: string[];
  /** Ports of port-based inbounds, i.e. what a client can point at. */
  proxyPorts: number[];
  /** eBPF details; null unless an eBPF inbound is present. */
  ebpfInfo: EbpfCaptureInfo | null;
  /** True when the config could not be read, so "none" would be a lie. */
  unknown: boolean;
  /** Why the mode is unknown, when the backend said so. */
  reason: string | null;
}

interface RawEbpfShared {
  enabled?: boolean;
  data_plane?: string;
  interface?: unknown;
  dns_mode?: string;
  bypass_private_address?: boolean;
  ipv6?: boolean;
}

interface RawEbpfCapture {
  present?: boolean;
  mode?: string;
  uids?: unknown;
  include?: unknown;
  exclude?: unknown;
  data_plane?: string;
  dns_mode?: string;
  ipv6?: boolean;
  shared?: RawEbpfShared;
}

export interface RawCapture {
  mode?: string;
  inbounds?: string[];
  tun?: boolean;
  proxy_ports?: unknown;
  ebpf?: RawEbpfCapture;
}

const KNOWN_MODES: readonly InboundMode[] = ["tun", "ebpf", "mixed", "proxy", "none", "unknown"];

const PORT_BASED = ["mixed", "socks", "http", "redirect", "tproxy"];

function toNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: number[] = [];
  for (const item of value) {
    const n = typeof item === "number" ? item : Number(item);
    if (Number.isFinite(n) && !out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Mirror the backend's precedence: eBPF wins, then TUN, then "mixed" for
 * port-based inbounds, then "proxy" for anything else.
 */
export function detectInboundMode(inbounds: readonly string[] | undefined): InboundModeSummary {
  if (inbounds === undefined) {
    return {
      mode: "unknown",
      tun: false,
      ebpf: false,
      types: [],
      proxyPorts: [],
      ebpfInfo: null,
      unknown: true,
      reason: null,
    };
  }
  const types = [...new Set(inbounds.filter((value) => value !== ""))];
  const base = {
    types,
    proxyPorts: [] as number[],
    ebpfInfo: null as EbpfCaptureInfo | null,
    unknown: false,
    reason: null as string | null,
  };
  if (types.length === 0) {
    return { ...base, mode: "none", tun: false, ebpf: false };
  }
  const has = (value: string): boolean => types.includes(value);
  const ebpf = has("ebpf");
  const tun = has("tun");
  if (ebpf) {
    return { ...base, mode: "ebpf", tun, ebpf };
  }
  if (tun) {
    return { ...base, mode: "tun", tun, ebpf };
  }
  if (types.some((value) => PORT_BASED.includes(value))) {
    return { ...base, mode: "mixed", tun, ebpf };
  }
  return { ...base, mode: "proxy", tun, ebpf };
}

function readShared(shared: RawEbpfShared | undefined): EbpfSharedInfo | null {
  if (!shared || shared.enabled === false) {
    return null;
  }
  const interfaces = Array.isArray(shared.interface)
    ? shared.interface.filter((item): item is string => typeof item === "string" && item !== "")
    : typeof shared.interface === "string" && shared.interface !== ""
      ? [shared.interface]
      : [];
  return {
    enabled: true,
    dataPlane: shared.data_plane ?? "packet_rewrite",
    interfaces,
    dnsMode: shared.dns_mode ?? "hijack",
    bypassPrivate: shared.bypass_private_address === true,
    ipv6: shared.ipv6 !== false,
  };
}

function readEbpf(info: RawEbpfCapture | undefined): EbpfCaptureInfo | null {
  if (!info || info.present === false) {
    return null;
  }
  const include = toNumbers(info.include);
  const exclude = toNumbers(info.exclude);
  const uids = toNumbers(info.uids);
  return {
    mode: info.mode ?? "off",
    uids: uids.length > 0 ? uids : include.length > 0 ? include : exclude,
    include,
    exclude,
    dataPlane: info.data_plane ?? "cgroup",
    dnsMode: info.dns_mode ?? "hijack",
    ipv6: info.ipv6 !== false,
    shared: readShared(info.shared),
  };
}

/**
 * Normalise `/api/state` into one capture summary. Prefers the backend's
 * `capture` block and falls back to classifying `inbounds` on older panels;
 * an unreadable config becomes `unknown` rather than a made-up "disabled TUN".
 */
export function readCapture(state: {
  capture?: RawCapture | null;
  inbounds?: string[];
  config_error?: string;
} | null | undefined): InboundModeSummary {
  if (!state) {
    return detectInboundMode(undefined);
  }
  const configError = (state.config_error ?? "").trim();
  const raw = state.capture ?? null;
  const types = raw?.inbounds ?? state.inbounds;
  const summary = detectInboundMode(types);
  const ebpfInfo = readEbpf(raw?.ebpf);
  const proxyPorts = toNumbers(raw?.proxy_ports);
  const declared = raw?.mode;
  const mode: InboundMode =
    declared && (KNOWN_MODES as readonly string[]).includes(declared)
      ? (declared as InboundMode)
      : ebpfInfo !== null
        ? "ebpf"
        : summary.mode;
  const unknown = configError !== "" || types === undefined;
  return {
    ...summary,
    // A config we cannot read is not the same as "no capture": keep the flags
    // we were told about, but never assert tun/ebpf from an empty list.
    mode: unknown && types === undefined ? "unknown" : mode,
    tun: raw?.tun ?? summary.tun,
    ebpf: ebpfInfo !== null || summary.ebpf,
    proxyPorts: proxyPorts.length > 0 ? proxyPorts : summary.proxyPorts,
    ebpfInfo,
    unknown,
    reason: configError !== "" ? configError : summary.reason,
  };
}

/** i18n keys (English source strings) for the mode badge. */
export const INBOUND_MODE_KEYS: Record<InboundMode, string> = {
  tun: "TUN (system-wide)",
  ebpf: "eBPF (per-app)",
  mixed: "Port proxy",
  proxy: "Proxy inbound",
  none: "No inbound",
  unknown: "Unknown",
};

/**
 * One-line explanation of what the mode means, as an i18n key.
 * `null` means "nothing worth explaining".
 */
export function inboundModeHintKey(mode: InboundMode): string | null {
  switch (mode) {
    case "tun":
      return "Captures all system traffic through a virtual NIC; needs CAP_NET_ADMIN.";
    case "ebpf":
      return "Captures traffic per application through a cgroup program; no virtual NIC.";
    case "mixed":
      return "Only applications pointed at the local proxy port are captured.";
    default:
      return null;
  }
}

/** i18n key for the eBPF policy selector. */
export function ebpfPolicyKey(mode: EbpfPolicyMode): string {
  switch (mode) {
    case "whitelist":
      return "Allow list";
    case "blacklist":
      return "Block list";
    default:
      return "No app filter";
  }
}
