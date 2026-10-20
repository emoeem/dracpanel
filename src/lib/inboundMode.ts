/**
 * Traffic capture mode derived from the panel's inbound list.
 *
 * `/api/state` reports `inbounds` as the *types* of the configured inbounds
 * (for example `["tun", "mixed"]`), not their tags. The panel uses that same
 * list to pick its own mode, so we can mirror the decision without another
 * endpoint — and without pretending we can flip it, which the HTTP API does
 * not support.
 */

export type InboundMode = "tun" | "ebpf" | "mixed" | "proxy" | "none" | "unknown";

export interface InboundModeSummary {
  mode: InboundMode;
  /** True when a TUN inbound is configured (system-wide capture). */
  tun: boolean;
  /** True when the eBPF cgroup helper is configured (per-app capture). */
  ebpf: boolean;
  /** Inbound types as reported by the panel, de-duplicated. */
  types: string[];
}

/**
 * Mirror the panel's own precedence: eBPF wins, then TUN, then "mixed" for
 * port-based inbounds, then "proxy" for anything else.
 */
export function detectInboundMode(inbounds: readonly string[] | undefined): InboundModeSummary {
  if (inbounds === undefined) {
    return { mode: "unknown", tun: false, ebpf: false, types: [] };
  }
  const types = [...new Set(inbounds.filter((value) => value !== ""))];
  if (types.length === 0) {
    return { mode: "none", tun: false, ebpf: false, types };
  }
  const has = (value: string): boolean => types.includes(value);
  const ebpf = has("ebpf");
  const tun = has("tun");
  if (ebpf) {
    return { mode: "ebpf", tun, ebpf, types };
  }
  if (tun) {
    return { mode: "tun", tun, ebpf, types };
  }
  const portBased = ["mixed", "socks", "http", "redirect", "tproxy"];
  if (types.some((value) => portBased.includes(value))) {
    return { mode: "mixed", tun, ebpf, types };
  }
  return { mode: "proxy", tun, ebpf, types };
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
