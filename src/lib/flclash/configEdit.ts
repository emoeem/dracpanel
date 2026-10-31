import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

const FORMAT = {
  formattingOptions: { insertSpaces: true, tabSize: 2 },
};

export type ConfigEditCode = "parse" | "no-inbound" | "no-tun";

export class ConfigEditError extends Error {
  constructor(
    readonly code: ConfigEditCode,
    message: string,
  ) {
    super(message);
    this.name = "ConfigEditError";
  }
}

export interface InboundInfo {
  index: number;
  type: string;
  listen: string | null;
  listenPort: number | null;
}

export interface TunInboundPreset {
  inbound: Record<string, unknown>;
  index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0];
    throw new ConfigEditError(
      "parse",
      `配置文件解析失败（偏移 ${first.offset}）：${String(first.error)}`,
    );
  }
  if (!isRecord(value)) {
    throw new ConfigEditError("parse", "配置文件必须是 JSON 对象");
  }
  return value;
}

function readInboundArray(config: Record<string, unknown>): unknown[] {
  return Array.isArray(config.inbounds) ? config.inbounds : [];
}

export function readInbounds(text: string): InboundInfo[] {
  const config = parseConfig(text);
  return readInboundArray(config).flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.type !== "string") {
      return [];
    }
    return [
      {
        index,
        type: entry.type,
        listen: typeof entry.listen === "string" ? entry.listen : null,
        listenPort:
          typeof entry.listen_port === "number" && Number.isInteger(entry.listen_port)
            ? entry.listen_port
            : null,
      },
    ];
  });
}

export function hasTunInbound(text: string): boolean {
  return readInbounds(text).some((inbound) => inbound.type === "tun");
}

/**
 * Remove every TUN inbound, returning the removed objects so the toggle can
 * restore them later. Higher indices are removed first so the lower indices
 * remain valid, and jsonc-parser preserves comments and formatting.
 */
export function removeTunInbounds(text: string): {
  text: string;
  removed: TunInboundPreset[];
} {
  const config = parseConfig(text);
  const inbounds = readInboundArray(config);
  const targets = inbounds
    .map((entry, index) => (isRecord(entry) && entry.type === "tun" ? index : -1))
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  if (targets.length === 0) {
    return { text, removed: [] };
  }
  let next = text;
  const removed: TunInboundPreset[] = [];
  for (const index of targets) {
    const inbound = inbounds[index];
    if (!isRecord(inbound)) {
      continue;
    }
    removed.unshift({ inbound: JSON.parse(JSON.stringify(inbound)) as Record<string, unknown>, index });
    const edits = modify(next, ["inbounds", index], undefined, FORMAT);
    next = applyEdits(next, edits);
  }
  return { text: next, removed };
}

export function appendTunInbound(text: string, preset: Record<string, unknown>): string {
  const config = parseConfig(text);
  const path =
    Array.isArray(config.inbounds) ? (["inbounds", -1] as const) : (["inbounds"] as const);
  const edits = modify(text, [...path], path.length === 1 ? [preset] : preset, FORMAT);
  return applyEdits(text, edits);
}

export interface LanProxyInfo {
  enabled: boolean;
  listen: string | null;
  port: number | null;
  inboundType: string | null;
}

const LAN_INBOUND_TYPES = new Set(["mixed", "http", "socks", "redirect", "tproxy"]);

function lanInbound(text: string): InboundInfo | null {
  return (
    readInbounds(text).find(
      (inbound) => LAN_INBOUND_TYPES.has(inbound.type) && inbound.listenPort !== null,
    ) ?? null
  );
}

export function lanProxyInfo(text: string): LanProxyInfo {
  const inbound = lanInbound(text);
  if (!inbound) {
    return { enabled: false, listen: null, port: null, inboundType: null };
  }
  return {
    enabled:
      inbound.listen === "0.0.0.0" || inbound.listen === "::" || inbound.listen === "::0",
    listen: inbound.listen,
    port: inbound.listenPort,
    inboundType: inbound.type,
  };
}

/** Toggle the first port-based inbound between loopback and all interfaces. */
export function setLanProxyEnabled(text: string, enabled: boolean): string {
  const inbound = lanInbound(text);
  if (!inbound) {
    throw new ConfigEditError("no-inbound", "配置中没有可切换的 mixed/http/socks 入站");
  }
  const listen = enabled ? "0.0.0.0" : "127.0.0.1";
  const edits = modify(text, ["inbounds", inbound.index, "listen"], listen, FORMAT);
  return applyEdits(text, edits);
}
