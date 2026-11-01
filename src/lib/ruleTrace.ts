/**
 * Kernel-free evaluation of sing-box route rules.
 *
 * The trace tab walks `route.rules` in order and decides each rule from a
 * domain / IP / port / network tuple alone. Anything only the kernel can
 * decide (rule_set contents, GeoIP databases, process names, logical rules…)
 * stops the walk at that rule and reports "needs the kernel" instead of
 * guessing. The result is therefore conservative: when the trace names a
 * rule or the final outbound, every matcher on the way was provably true.
 */

import { isNestedRule, type RuleObject } from "./ruleEditor";

export interface TraceInput {
  domain: string;
  ip: string;
  port: string;
  /** "" | "tcp" | "udp"; "" means the user has not picked one yet. */
  network: string;
}

export type TraceVerdict = "match" | "no_match" | "unknown";

export interface TraceStep {
  index: number;
  verdict: TraceVerdict;
  /** Why the walk stopped here (unknown verdict) or which rule matched. */
  reason: string;
}

export type TraceOutcome =
  | { kind: "rule"; index: number; action: string; target: string }
  | { kind: "final"; target: string }
  | { kind: "unknown"; index: number; reason: string };

export interface TraceResult {
  steps: TraceStep[];
  outcome: TraceOutcome;
}

interface MatcherResult {
  /** The matcher is definitively true or false. */
  ok: boolean;
  /** True when the matcher cannot be decided without the kernel/more input. */
  unknown: boolean;
  reason: string;
}

const MATCH_TRUE: MatcherResult = { ok: true, unknown: false, reason: "" };
const MATCH_FALSE: MatcherResult = { ok: false, unknown: false, reason: "" };

function unknownMatcher(reason: string): MatcherResult {
  return { ok: true, unknown: true, reason };
}

/** Keys that are not matchers; the rest of a rule is treated as one. */
const NON_MATCHER_KEYS = new Set([
  "action",
  "outbound",
  "server",
  "invert",
  "type",
  "mode",
  "rules",
]);

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function normalizeDomain(text: string): string {
  return text.trim().toLowerCase().replace(/\.$/, "");
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(text: string): number | null {
  const match = IPV4_RE.exec(text.trim());
  if (match === null) {
    return null;
  }
  let result = 0;
  for (const part of match.slice(1)) {
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/** RFC1918/loopback/link-local for IPv4, string prefixes for IPv6. */
export function isPrivateIp(ip: string): boolean {
  const value = parseIpv4(ip);
  if (value !== null) {
    return (
      (value >>> 24) === 127 ||
      (value >>> 24) === 10 ||
      (value >>> 20) === 0xac1 ||
      (value >>> 16) === 0xc0a8 ||
      (value >>> 16) === 0xa9fe
    );
  }
  const lower = ip.trim().toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  );
}

function cidrContains(cidr: string, ip: string): boolean | null {
  const [range, bitsText] = cidr.split("/", 2);
  if (bitsText === undefined) {
    return null;
  }
  const rangeBits = Number(bitsText);
  if (!Number.isInteger(rangeBits) || rangeBits < 0 || rangeBits > 32) {
    return null;
  }
  const rangeValue = parseIpv4(range ?? "");
  const ipValue = parseIpv4(ip);
  if (rangeValue === null || ipValue === null) {
    return null; // IPv6 or malformed: let the kernel decide.
  }
  if (rangeBits === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - rangeBits)) >>> 0;
  return (rangeValue & mask) === (ipValue & mask);
}

function portNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : null;
}

function evalMatcher(key: string, value: unknown, input: TraceInput): MatcherResult {
  switch (key) {
    case "domain":
    case "domain_suffix":
    case "domain_keyword":
    case "domain_regex": {
      const domain = normalizeDomain(input.domain);
      if (domain === "") {
        return unknownMatcher("未填写域名，无法判定域名类匹配");
      }
      for (const item of asArray(value)) {
        const pattern = String(item).trim().toLowerCase();
        if (pattern === "") {
          continue;
        }
        if (key === "domain" && domain === pattern) {
          return MATCH_TRUE;
        }
        if (
          key === "domain_suffix" &&
          (domain === pattern ||
            domain.endsWith(`.${pattern}`) ||
            (pattern.startsWith(".") && domain.endsWith(pattern)))
        ) {
          return MATCH_TRUE;
        }
        if (key === "domain_keyword" && domain.includes(pattern)) {
          return MATCH_TRUE;
        }
        if (key === "domain_regex") {
          try {
            if (new RegExp(pattern).test(domain)) {
              return MATCH_TRUE;
            }
          } catch {
            return unknownMatcher(`domain_regex 无法编译：${pattern}`);
          }
        }
      }
      return MATCH_FALSE;
    }
    case "ip_cidr": {
      const ip = input.ip.trim();
      if (ip === "") {
        return unknownMatcher("未填写目标 IP，无法判定 ip_cidr");
      }
      for (const item of asArray(value)) {
        const contains = cidrContains(String(item).trim(), ip);
        if (contains === null) {
          return unknownMatcher(`ip_cidr 无法本地判定：${String(item)}`);
        }
        if (contains) {
          return MATCH_TRUE;
        }
      }
      return MATCH_FALSE;
    }
    case "geoip": {
      const ip = input.ip.trim();
      if (ip === "") {
        return unknownMatcher("未填写目标 IP，无法判定 geoip");
      }
      const items = asArray(value).map((item) => String(item).trim().toLowerCase());
      if (items.every((item) => item === "private")) {
        return items.length > 0 && isPrivateIp(ip) ? MATCH_TRUE : MATCH_FALSE;
      }
      return unknownMatcher("geoip 数据库需内核判定");
    }
    case "ip_is_private": {
      const ip = input.ip.trim();
      if (ip === "") {
        return unknownMatcher("未填写目标 IP，无法判定 ip_is_private");
      }
      return isPrivateIp(ip) ? MATCH_TRUE : MATCH_FALSE;
    }
    case "port": {
      const port = portNumber(input.port);
      if (port === null) {
        return unknownMatcher("未填写端口，无法判定 port");
      }
      for (const item of asArray(value)) {
        if (portNumber(item) === port) {
          return MATCH_TRUE;
        }
      }
      return MATCH_FALSE;
    }
    case "port_range": {
      const port = portNumber(input.port);
      if (port === null) {
        return unknownMatcher("未填写端口，无法判定 port_range");
      }
      for (const item of asArray(value)) {
        const [loText, hiText] = String(item).split(":", 2);
        const lo = portNumber(loText ?? "");
        const hi = hiText === undefined ? lo : portNumber(hiText);
        if (lo === null || hi === null || lo > hi) {
          return unknownMatcher(`port_range 无法解析：${String(item)}`);
        }
        if (port >= lo && port <= hi) {
          return MATCH_TRUE;
        }
      }
      return MATCH_FALSE;
    }
    case "network": {
      const network = input.network.trim().toLowerCase();
      if (network === "") {
        return unknownMatcher("未选择网络类型（TCP/UDP）");
      }
      return asArray(value).some((item) => String(item).toLowerCase() === network)
        ? MATCH_TRUE
        : MATCH_FALSE;
    }
    default:
      return unknownMatcher(`“${key}” 需内核判定`);
  }
}

/** Evaluates one rule; `unknown` means the walk must stop at it. */
export function evalTraceRule(
  rule: RuleObject,
  input: TraceInput,
): { verdict: "match" | "no_match" } | { verdict: "unknown"; reason: string } {
  if (isNestedRule(rule)) {
    return { verdict: "unknown", reason: "逻辑组合规则（rules[]）需内核判定" };
  }
  let anyFalse = false;
  let pendingReason = "";
  for (const [key, value] of Object.entries(rule)) {
    if (NON_MATCHER_KEYS.has(key) || value === undefined) {
      continue;
    }
    const result = evalMatcher(key, value, input);
    if (!result.unknown && !result.ok) {
      // AND semantics: one false matcher settles the rule — but settle it
      // after invert, which flips the whole conjunction.
      anyFalse = true;
      continue;
    }
    if (result.unknown && pendingReason === "") {
      pendingReason = result.reason;
    }
  }
  // A false matcher wins even over unknown ones: false AND x is false either
  // way, inverted or not. Otherwise an undecidable matcher blocks the proof.
  if (!anyFalse && pendingReason !== "") {
    return { verdict: "unknown", reason: pendingReason };
  }
  const matched = rule.invert === true ? anyFalse : !anyFalse;
  return { verdict: matched ? "match" : "no_match" };
}

export function traceRuleAction(rule: RuleObject): string {
  return typeof rule.action === "string" ? rule.action : "route";
}

/** Walks the rules in order; first provable match or the final outbound wins. */
export function traceRules(
  rules: readonly RuleObject[],
  input: TraceInput,
  finalTarget: string,
): TraceResult {
  const steps: TraceStep[] = [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index] ?? {};
    const result = evalTraceRule(rule, input);
    if (result.verdict === "no_match") {
      steps.push({ index, verdict: "no_match", reason: "" });
      continue;
    }
    if (result.verdict === "unknown") {
      steps.push({ index, verdict: "unknown", reason: result.reason });
      return { steps, outcome: { kind: "unknown", index, reason: result.reason } };
    }
    steps.push({ index, verdict: "match", reason: "" });
    return {
      steps,
      outcome: {
        kind: "rule",
        index,
        action: traceRuleAction(rule),
        target: typeof rule.outbound === "string" ? rule.outbound : "",
      },
    };
  }
  return { steps, outcome: { kind: "final", target: finalTarget } };
}
