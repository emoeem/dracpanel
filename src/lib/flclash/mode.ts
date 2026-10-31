export type OutboundModeSegment = "rule" | "global" | "direct";

interface ModeDefinition {
  value: OutboundModeSegment;
  label: string;
  icon: "rule" | "public" | "gps_fixed";
  aliases: readonly string[];
}

export const OUTBOUND_MODES: readonly ModeDefinition[] = [
  {
    value: "rule",
    label: "规则",
    icon: "rule",
    aliases: ["rule", "rules", "proxy", "规则"],
  },
  {
    value: "global",
    label: "全局",
    icon: "public",
    aliases: ["global", "全局"],
  },
  {
    value: "direct",
    label: "直连",
    icon: "gps_fixed",
    aliases: ["direct", "直连"],
  },
];

function normalize(mode: string): string {
  return mode.trim().toLowerCase();
}

/** Map any core mode onto FlClash's three segments. */
export function segmentOfMode(mode: string | null | undefined): OutboundModeSegment {
  if (mode === null || mode === undefined) {
    return "rule";
  }
  const value = normalize(mode);
  if (value === "global" || value === "全局") {
    return "global";
  }
  if (value === "direct" || value === "直连") {
    return "direct";
  }
  return "rule";
}

/**
 * Resolve the string to send to SetClashMode. Prefer the exact casing the core
 * advertises so a config that uses "Proxy"/"RuleAllowAds" still works; fall
 * back to the canonical sing-box names.
 */
export function modeForSegment(
  segment: OutboundModeSegment,
  modeList: readonly string[],
): string {
  const definition = OUTBOUND_MODES.find((entry) => entry.value === segment);
  if (!definition) {
    return "Rule";
  }
  for (const alias of definition.aliases) {
    const match = modeList.find((mode) => normalize(mode) === alias);
    if (match !== undefined) {
      return match;
    }
  }
  if (segment === "rule") {
    const custom = modeList.find((mode) => {
      const value = normalize(mode);
      return value !== "global" && value !== "direct" && value !== "全局" && value !== "直连";
    });
    if (custom !== undefined) {
      return custom;
    }
    return "Rule";
  }
  return segment === "global" ? "Global" : "Direct";
}

export function modeOption(segment: OutboundModeSegment): ModeDefinition {
  return OUTBOUND_MODES.find((entry) => entry.value === segment) ?? OUTBOUND_MODES[0];
}
