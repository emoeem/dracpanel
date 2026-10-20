/**
 * Draft ↔ JSON conversion behind the visual rule editor.
 *
 * sing-box rules are plain JSON objects whose keys depend on the action and on
 * whether the rule lives under `route` or `dns`. The editor works on a flat
 * draft so a rule can be edited as "action + target + list of matchers", and
 * this module is the only place that knows how the two shapes map onto each
 * other — keeping it out of React makes the conversion unit testable.
 */

export type RuleObject = Record<string, unknown>;

/** Keys the editor owns; anything else in a rule is treated as a matcher. */
const RESERVED_KEYS = new Set(["action", "outbound", "server", "invert", "rules", "mode"]);

export const RULE_ACTIONS = [
  "route",
  "reject",
  "sniff",
  "hijack-dns",
  "resolve",
  "predefined",
  "evaluate",
  "respond",
];

export interface MatcherField {
  key: string;
  /** Comma-separated input is stored as an array. */
  multiple?: boolean;
  /** Rendered as a checkbox rather than a text field. */
  flag?: boolean;
  /** Whole numbers are stored as numbers instead of strings. */
  numeric?: boolean;
}

/** Matchers offered in the editor, ordered roughly by how common they are. */
export const MATCHER_FIELDS: MatcherField[] = [
  { key: "domain", multiple: true },
  { key: "domain_suffix", multiple: true },
  { key: "domain_keyword", multiple: true },
  { key: "domain_regex", multiple: true },
  { key: "geosite", multiple: true },
  { key: "rule_set", multiple: true },
  { key: "ip_cidr", multiple: true },
  { key: "geoip", multiple: true },
  { key: "ip_is_private", flag: true },
  { key: "ip_version", numeric: true },
  { key: "protocol", multiple: true },
  { key: "network", multiple: true },
  { key: "port", numeric: true, multiple: true },
  { key: "port_range", multiple: true },
  { key: "inbound", multiple: true },
  { key: "clash_mode" },
  { key: "process_name", multiple: true },
  { key: "package_name", multiple: true },
  { key: "user", multiple: true },
  { key: "user_id", numeric: true, multiple: true },
  { key: "query_type", multiple: true },
  { key: "rcode", multiple: true },
];

const MATCHER_BY_KEY = new Map(MATCHER_FIELDS.map((field) => [field.key, field]));

export interface RuleMatcher {
  key: string;
  value: string;
}

export interface RuleDraft {
  action: string;
  /** Outbound tag for route rules, DNS server tag for DNS rules. */
  target: string;
  invert: boolean;
  /** Rows with an empty key or value are dropped when converting. */
  matchers: RuleMatcher[];
}

export function matcherField(key: string): MatcherField | undefined {
  return MATCHER_BY_KEY.get(key);
}

export function emptyDraft(): RuleDraft {
  return {
    action: "route",
    target: "",
    invert: false,
    matchers: [{ key: "domain_suffix", value: "" }],
  };
}

/** Renders a raw JSON value the way it should appear in a text field. */
export function ruleValueToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function ruleToDraft(rule: RuleObject): RuleDraft {
  const rawAction = typeof rule.action === "string" ? rule.action : "";
  const target =
    typeof rule.outbound === "string"
      ? rule.outbound
      : typeof rule.server === "string"
        ? rule.server
        : "";
  const matchers: RuleMatcher[] = [];
  for (const [key, value] of Object.entries(rule)) {
    if (RESERVED_KEYS.has(key) || value === undefined) {
      continue;
    }
    matchers.push({ key, value: ruleValueToText(value) });
  }
  return {
    // Rules written for older sing-box releases have no `action` and rely on
    // `outbound` alone; those read back as a route rule.
    action: rawAction !== "" ? rawAction : target !== "" ? "route" : "reject",
    target,
    invert: rule.invert === true,
    matchers: matchers.length > 0 ? matchers : [{ key: "domain_suffix", value: "" }],
  };
}

/**
 * Turns text back into the JSON value sing-box expects for `field`.
 * Returns `null` for input that should not be written at all.
 */
export function textToRuleValue(text: string, field: MatcherField | undefined): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  if (field?.flag === true) {
    return trimmed === "true" || trimmed === "1";
  }
  const parts = field?.multiple === true ? splitList(trimmed) : [trimmed];
  const values = parts.map((part) => (field?.numeric === true ? toNumber(part) : part));
  if (values.length === 0) {
    return null;
  }
  return values.length === 1 ? values[0] : values;
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function toNumber(text: string): string | number {
  return /^\d+$/.test(text) ? Number(text) : text;
}

/** `targetKey` is `outbound` for route rules and `server` for DNS rules. */
export function draftToRule(draft: RuleDraft, targetKey: "outbound" | "server"): RuleObject {
  const rule: RuleObject = { action: draft.action };
  if (draft.target.trim() !== "") {
    rule[targetKey] = draft.target.trim();
  }
  for (const matcher of draft.matchers) {
    const key = matcher.key.trim();
    if (key === "" || RESERVED_KEYS.has(key)) {
      continue;
    }
    const value = textToRuleValue(matcher.value, matcherField(key));
    if (value === null) {
      continue;
    }
    rule[key] = value;
  }
  if (draft.invert) {
    rule.invert = true;
  }
  return rule;
}

/**
 * Returns the first problem that would make the rule unusable, or `null`.
 * A rule without matchers is allowed — it matches everything, which is what a
 * catch-all last rule does — but a route action without a target is not.
 */
export function draftIssue(draft: RuleDraft): string | null {
  if (draft.action === "route" && draft.target.trim() === "") {
    return "route 动作需要填写出站标签";
  }
  return null;
}
