import { memo, useCallback, useEffect, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { formatBytes } from "../api/format";
import {
  applyPanelConfig,
  getPanelConfig,
  PanelAuthError,
  resyncAfterConfigChange,
  validatePanelConfig,
} from "../api/panel";
import { useApi, navigate } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n, type MessageKey } from "../app/i18n";
import { useRuleHits } from "../app/useRuleHits";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  SearchInput,
  Select,
  Spinner,
} from "../components/ui";
import { diffConfig, formatDiffValue, type ConfigChange } from "../lib/configDiff";
import { cx } from "../lib/cx";
import { parseRuleKey, totalHitBytes, type RuleHitStats } from "../lib/ruleHits";
import { notify } from "../lib/notifier";
import {
  emptyDraft,
  ruleToDraft,
  ruleValueToText,
  type RuleDraft,
  type RuleObject,
} from "../lib/ruleEditor";
import { RuleEditorDialog } from "./RuleEditorDialog";
import styles from "./RulesView.module.css";

interface ConfigShape {
  route?: {
    rules?: RuleObject[];
    rule_set?: RuleObject[];
    final?: string;
    default_domain_resolver?: string;
  };
  dns?: {
    rules?: RuleObject[];
    final?: string;
    default_domain_resolver?: string;
  };
  experimental?: {
    clash_api?: { default_mode?: string };
  };
}

type Tab = "route" | "dns" | "rule_set";
/** The two sections that hold editable rules. */
type RuleSection = "route" | "dns";

const RULES_UNDO_LIMIT = 30;
type RuleSort = "config" | "action" | "outbound";

const ACTION_LABELS: Record<string, MessageKey> = {
  route: "Route",
  reject: "Reject",
  sniff: "Sniff",
  "hijack-dns": "Hijack DNS",
  resolve: "Resolve",
  predefined: "Predefined response",
  evaluate: "Evaluate",
  respond: "Response",
};

const CHIP_KEYS = [
  "outbound",
  "server",
  "rule_set",
  "clash_mode",
  "protocol",
  "network",
  "port",
  "port_range",
  "domain",
  "domain_suffix",
  "domain_keyword",
  "domain_regex",
  "ip_cidr",
  "ip_is_private",
  "ip_version",
  "query_type",
  "package_name",
  "process_name",
  "user",
  "user_id",
  "inbound",
  "geoip",
  "geosite",
  "rcode",
  "invert",
];

function actionOf(rule: RuleObject): string {
  if (typeof rule.action === "string" && rule.action !== "") {
    return rule.action;
  }
  if (typeof rule.outbound === "string") {
    return "route";
  }
  if (Array.isArray(rule.rules)) {
    return "logical";
  }
  return "default";
}

/** Keeps the rule together with its position in the config, which is what the daemon reports as the matched rule. */
interface IndexedRule {
  rule: RuleObject;
  index: number;
}

function applyRuleView(
  rules: RuleObject[],
  query: string,
  actionFilter: string,
  sort: RuleSort,
): IndexedRule[] {
  const filtered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => {
      if (actionFilter !== "all" && actionOf(rule) !== actionFilter) {
        return false;
      }
      return query === "" || JSON.stringify(rule).toLowerCase().includes(query);
    });
  if (sort === "action") {
    filtered.sort((left, right) => actionOf(left.rule).localeCompare(actionOf(right.rule)));
  } else if (sort === "outbound") {
    filtered.sort((left, right) => {
      const leftValue = String(left.rule.outbound ?? left.rule.server ?? "");
      const rightValue = String(right.rule.outbound ?? right.rule.server ?? "");
      return leftValue.localeCompare(rightValue);
    });
  }
  return filtered;
}

function actionTone(action: string): "accent" | "danger" | "info" | "good" {
  switch (action) {
    case "reject":
      return "danger";
    case "route":
      return "accent";
    case "logical":
      return "info";
    default:
      return "good";
  }
}

function RuleChips(props: { rule: RuleObject }) {
  const { t } = useI18n();
  const chips = CHIP_KEYS.filter((key) => props.rule[key] !== undefined);
  if (chips.length === 0) {
    return <span className={styles.muted}>{t("Default rule")}</span>;
  }
  return (
    <span className={styles.chips}>
      {chips.map((key) => (
        <span key={key} className={styles.chip} title={`${key}: ${ruleValueToText(props.rule[key])}`}>
          <span className={styles.chipKey}>{key}</span>
          <span className={styles.chipValue}>{ruleValueToText(props.rule[key])}</span>
        </span>
      ))}
    </span>
  );
}

// Rules come from a locally cached config snapshot, so `rule` keeps a stable
// identity across filter/sort passes: memoising keeps a keystroke in the search
// box from re-rendering every rule card.
const RuleItem = memo(function RuleItem(props: {
  rule: RuleObject;
  index: number;
  depth?: number;
  hits?: RuleHitStats;
  /** Edit-mode buttons; absent while the view is read-only. */
  controls?: ReactNode;
}) {
  const { t } = useI18n();
  const rule = props.rule;
  const action = actionOf(rule);
  const actionLabel = ACTION_LABELS[action];
  const logical = Array.isArray(rule.rules) ? (rule.rules as RuleObject[]) : null;
  const outbound =
    typeof rule.outbound === "string" ? rule.outbound : typeof rule.server === "string" ? rule.server : null;
  return (
    <div className={cx(styles.rule, props.depth !== undefined && props.depth > 0 && styles.nested)}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleIndex}>#{props.index + 1}</span>
        <Badge tone={actionTone(action)}>
          {actionLabel !== undefined ? t(actionLabel) : action}
        </Badge>
        {logical !== null && (
          <Badge tone="info">
            {String(rule.mode ?? "and").toUpperCase()} · {logical.length}
          </Badge>
        )}
        {outbound !== null && <span className={styles.outbound}>→ {outbound}</span>}
        <span className={styles.ruleSpacer} />
        {props.hits !== undefined && props.hits.hits > 0 && (
          <span
            className={styles.hits}
            title={t("{hits} hits this session, {bytes} in total", {
              hits: props.hits.hits,
              bytes: formatBytes(totalHitBytes(props.hits)),
            })}
          >
            {props.hits.active > 0 && (
              <span className={styles.hitsActive}>
                {t("{count} active", { count: props.hits.active })}
              </span>
            )}
            {t("{count} hits", { count: props.hits.hits })} · {formatBytes(totalHitBytes(props.hits))}
          </span>
        )}
        {typeof rule.invert === "boolean" && rule.invert && <Badge tone="danger">invert</Badge>}
        {props.controls}
      </div>
      <div className={styles.ruleBody}>
        {logical === null ? (
          <RuleChips rule={rule} />
        ) : (
          <details className={styles.details}>
            <summary>{t("Expand {count} sub-rules", { count: logical.length })}</summary>
            <div className={styles.nestedList}>
              {logical.map((child, index) => (
                <RuleItem key={index} rule={child} index={index} depth={1} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
});

export function RulesView() {
  const { t } = useI18n();
  const api = useApi();
  const hits = useRuleHits(api);
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("route");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [sort, setSort] = useState<RuleSort>("config");
  /** Original config text, kept so an edit can be diffed before applying. */
  const [configText, setConfigText] = useState<string | null>(null);
  /** Working copy of both rule lists while editing; null means read-only. */
  const [working, setWorking] = useState<{ route: RuleObject[]; dns: RuleObject[] } | null>(null);
  const [history, setHistory] = useState<{ route: RuleObject[]; dns: RuleObject[] }[]>([]);
  const [editor, setEditor] = useState<{ section: RuleSection; index: number | null } | null>(null);
  const [pending, setPending] = useState<{ text: string; changes: ConfigChange[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getPanelConfig();
      const parsed = JSON.parse(result.text) as ConfigShape;
      setConfig(parsed);
      setConfigText(result.text);
    } catch (cause) {
      if (cause instanceof PanelAuthError) {
        setError(t("Panel token expired. Please sign in again."));
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedRouteRules = useMemo(() => config?.route?.rules ?? [], [config]);
  const savedDnsRules = useMemo(() => config?.dns?.rules ?? [], [config]);
  const routeRules = working?.route ?? savedRouteRules;
  const dnsRules = working?.dns ?? savedDnsRules;
  const ruleSets = useMemo(() => config?.route?.rule_set ?? [], [config]);
  const mode = config?.experimental?.clash_api?.default_mode;

  const query = search.trim().toLowerCase();
  const visibleRouteRules = useMemo(
    () => applyRuleView(routeRules, query, actionFilter, sort),
    [routeRules, query, actionFilter, sort],
  );
  const visibleDnsRules = useMemo(
    () => applyRuleView(dnsRules, query, actionFilter, sort),
    [dnsRules, query, actionFilter, sort],
  );
  const visibleRuleSets = useMemo(() => {
    return ruleSets.filter((set) => query === "" || JSON.stringify(set).toLowerCase().includes(query));
  }, [ruleSets, query]);
  const actionOptions = useMemo(
    () => [...new Set([...routeRules, ...dnsRules].map(actionOf))].sort(),
    [routeRules, dnsRules],
  );
  const filtersActive = query !== "" || actionFilter !== "all";

  // Buckets also exist for live traffic alone, so only the ones that actually
  // matched a connection are worth listing.
  const topHits = useMemo(() => hits.stats.filter((stats) => stats.hits > 0).slice(0, 8), [hits]);

  // The daemon labels a matched connection with a string we may not be able to
  // map back onto a config position; unmapped labels stay in the summary card
  // and the rule cards simply go without a badge.
  const hitsByPosition = useMemo(() => {
    const map = new Map<string, RuleHitStats>();
    for (const stats of hits.stats) {
      const parsed = parseRuleKey(stats.rule);
      if (parsed === null) {
        continue;
      }
      const key = `${parsed.section}:${parsed.index}`;
      if (!map.has(key)) {
        map.set(key, stats);
      }
    }
    return map;
  }, [hits]);

  const editing = working !== null;
  const dirty =
    working !== null &&
    (JSON.stringify(working.route) !== JSON.stringify(savedRouteRules) ||
      JSON.stringify(working.dns) !== JSON.stringify(savedDnsRules));

  const rulesOf = (section: RuleSection): RuleObject[] => (section === "route" ? routeRules : dnsRules);

  const replaceRules = (section: RuleSection, next: RuleObject[]) => {
    const base = working ?? { route: [...savedRouteRules], dns: [...savedDnsRules] };
    setHistory((stack) => [...stack, base].slice(-RULES_UNDO_LIMIT));
    setWorking(section === "route" ? { ...base, route: next } : { ...base, dns: next });
  };

  const undoRules = () => {
    const previous = history[history.length - 1];
    if (previous === undefined) {
      return;
    }
    setHistory((stack) => stack.slice(0, -1));
    setWorking(previous);
  };

  const discardRules = () => {
    setWorking(null);
    setHistory([]);
  };

  const startEditing = () => {
    setWorking({ route: [...savedRouteRules], dns: [...savedDnsRules] });
    setHistory([]);
    setSearch("");
    setActionFilter("all");
    setSort("config");
  };

  const moveRule = (section: RuleSection, index: number, delta: number) => {
    const list = [...rulesOf(section)];
    const target = index + delta;
    if (target < 0 || target >= list.length) {
      return;
    }
    const moved = list[index];
    list[index] = list[target];
    list[target] = moved;
    replaceRules(section, list);
  };

  const openEditor = (section: RuleSection, index: number) => {
    const rule = rulesOf(section)[index];
    if (rule !== undefined && Array.isArray(rule.rules)) {
      showError(
        t(
          "Combined rules (rules/mode) cannot be edited here; change the JSON under Manage → Config instead.",
        ),
      );
      return;
    }
    setEditor({ section, index });
  };

  const submitEditor = (rule: RuleObject) => {
    if (editor === null) {
      return;
    }
    const list = [...rulesOf(editor.section)];
    if (editor.index === null) {
      list.push(rule);
    } else {
      list[editor.index] = rule;
    }
    replaceRules(editor.section, list);
    setEditor(null);
  };

  const requestSave = () => {
    if (working === null || config === null || configText === null) {
      return;
    }
    const next: ConfigShape = {
      ...config,
      route: { ...config.route, rules: working.route },
      dns: { ...config.dns, rules: working.dns },
    };
    const text = JSON.stringify(next, null, 2);
    setPending({ text, changes: diffConfig(configText, text).changes });
  };

  const applyPending = async () => {
    if (pending === null || working === null) {
      return;
    }
    setSaving(true);
    try {
      const validated = await validatePanelConfig(pending.text);
      if (!validated.ok) {
        const failure = validated.message !== "" ? validated.message : t("Configuration validation failed");
        showError(failure);
        return;
      }
      const result = await applyPanelConfig(pending.text);
      if (!result.ok) {
        showError(result.message !== "" ? result.message : t("Apply failed"));
        return;
      }
      const resync = await resyncAfterConfigChange();
      if (resync.serverChanged) {
        window.location.reload();
        return;
      }
      api.reconnectNow();
      setWorking(null);
      setHistory([]);
      notify(
        "config",
        t("Configuration applied"),
        t("{route} route rules, {dns} DNS rules", {
          route: working.route.length,
          dns: working.dns.length,
        }),
      );
      await load();
    } catch (cause) {
      showError(cause);
    } finally {
      setSaving(false);
      setPending(null);
    }
  };

  const editorSection: RuleSection = tab === "dns" ? "dns" : "route";
  const editorDraft: RuleDraft | null =
    editor === null
      ? null
      : editor.index === null
        ? emptyDraft()
        : ruleToDraft(rulesOf(editor.section)[editor.index] ?? {});

  const ruleControls = (section: RuleSection, index: number) => (
    <span className={styles.ruleControls}>
      <Button size="small" onClick={() => openEditor(section, index)}>
        {t("Edit")}
      </Button>
      <Button
        size="small"
        aria-label={t("Move up")}
        disabled={index === 0}
        onClick={() => moveRule(section, index, -1)}
      >
        ↑
      </Button>
      <Button
        size="small"
        aria-label={t("Move down")}
        disabled={index >= rulesOf(section).length - 1}
        onClick={() => moveRule(section, index, 1)}
      >
        ↓
      </Button>
      <Button size="small" onClick={() => replaceRules(section, rulesOf(section).filter((_, i) => i !== index))}>
        {t("Delete")}
      </Button>
    </span>
  );

  const actions = (
    <>
      <Button onClick={() => void load()} disabled={loading}>
        {loading ? <Spinner /> : t("Refresh")}
      </Button>
      {editing ? (
        <>
          <Button onClick={() => setEditor({ section: editorSection, index: null })}>
            {t("Add rule")}
          </Button>
          <Button
            onClick={undoRules}
            disabled={history.length === 0}
            title={t("Undo the last rule change")}
          >
            {t("Undo")}
          </Button>
          <Button onClick={discardRules}>{t("Discard changes")}</Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={requestSave}>
            {saving ? <Spinner /> : t("Save and apply")}
          </Button>
        </>
      ) : (
        <Button disabled={config === null} onClick={startEditing}>
          {t("Edit rules")}
        </Button>
      )}
      <Button variant={editing ? undefined : "primary"} onClick={() => navigate("manage")}>
        {t("Edit config")}
      </Button>
    </>
  );

  return (
    <div className="page">
      <PageHeader title={t("Rules")} actions={actions} />
      {error !== "" && (
        <div className={styles.errorBox}>
          <span>{error}</span>
          <Button size="small" onClick={() => void load()}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {loading && config === null && (
        <div className={styles.loading}>
          <Spinner />
          <span>{t("Reading current configuration…")}</span>
        </div>
      )}
      {config !== null && (
        <>
          <div className={styles.summary}>
            <Card title={t("Route")}>
              <div className={styles.metric}>
                <small>{t("{count} rules", { count: routeRules.length })}</small>
              </div>
              <div className={styles.muted}>final → {config.route?.final ?? "—"}</div>
            </Card>
            <Card title="DNS">
              <div className={styles.metric}>
                <small>{t("{count} rules", { count: dnsRules.length })}</small>
              </div>
              <div className={styles.muted}>final → {config.dns?.final ?? "—"}</div>
            </Card>
            <Card title={t("Rule sets")}>
              <div className={styles.metric}>
                <small>{t("{count} sets", { count: ruleSets.length })}</small>
              </div>
              <div className={styles.muted}>
                {t("Clash default mode")} → {mode ?? "—"}
              </div>
            </Card>
          </div>

          <Card title={t("Hits this session")}>
            {topHits.length === 0 ? (
              <div className={styles.muted}>
                {hits.observed
                  ? t("No connection has matched a rule yet during this session.")
                  : t("Waiting for the connection snapshot…")}
              </div>
            ) : (
              <div className={styles.hitSummary}>
                {topHits.map((stats) => (
                  <div key={stats.rule} className={styles.hitRow}>
                    <span className={styles.hitLabel} title={stats.rule}>
                      {stats.rule}
                    </span>
                    <span className={styles.hitBar}>
                      <span
                        className={styles.hitBarFill}
                        style={{ width: `${Math.round((stats.hits / topHits[0].hits) * 100)}%` }}
                      />
                    </span>
                    <span className={styles.hitValue}>
                      {t("{count} hits", { count: stats.hits })} · {formatBytes(totalHitBytes(stats))}
                      {stats.active > 0 && ` · ${t("{count} active", { count: stats.active })}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "route"}
              className={cx(styles.tab, tab === "route" && styles.active)}
              onClick={() => setTab("route")}
            >
              {t("Route rules")} <span className={styles.count}>{routeRules.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "dns"}
              className={cx(styles.tab, tab === "dns" && styles.active)}
              onClick={() => setTab("dns")}
            >
              {t("DNS rules")} <span className={styles.count}>{dnsRules.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rule_set"}
              className={cx(styles.tab, tab === "rule_set" && styles.active)}
              onClick={() => setTab("rule_set")}
            >
              {t("Rule sets")} <span className={styles.count}>{ruleSets.length}</span>
            </button>
          </div>

          <div className={styles.filters}>
            <div className={styles.filterSearch}>
              <SearchInput value={search} onChange={setSearch} />
            </div>
            {tab !== "rule_set" && (
              <>
                <Select
                  options={[
                    { value: "all", label: t("All actions") },
                    ...actionOptions.map((action) => {
                      const label = ACTION_LABELS[action];
                      return { value: action, label: label !== undefined ? t(label) : action };
                    }),
                  ]}
                  value={actionFilter}
                  onChange={setActionFilter}
                />
                {/* Reordering while editing only makes sense in config order. */}
                {!editing && (
                  <Select
                    options={[
                      { value: "config", label: t("Configuration order") },
                      { value: "action", label: t("Action") },
                      { value: "outbound", label: t("Outbound") },
                    ]}
                    value={sort}
                    onChange={(value) => setSort(value as RuleSort)}
                  />
                )}
              </>
            )}
            {filtersActive && (
              <Button
                size="small"
                onClick={() => {
                  setSearch("");
                  setActionFilter("all");
                }}
              >
                {t("Clear filters")}
              </Button>
            )}
          </div>

          {tab === "route" &&
            (routeRules.length === 0 ? (
              <EmptyState icon="filter_list">{t("This configuration has no route rules")}</EmptyState>
            ) : visibleRouteRules.length === 0 ? (
              <EmptyState icon="search">{t("No results")}</EmptyState>
            ) : (
              <div className={styles.list}>
                {visibleRouteRules.map((entry, index) => (
                  <RuleItem
                    key={index}
                    rule={entry.rule}
                    index={entry.index}
                    hits={hitsByPosition.get(`route:${entry.index}`)}
                    controls={editing ? ruleControls("route", entry.index) : undefined}
                  />
                ))}
              </div>
            ))}

          {tab === "dns" &&
            (dnsRules.length === 0 ? (
              <EmptyState icon="dns">{t("This configuration has no DNS rules")}</EmptyState>
            ) : visibleDnsRules.length === 0 ? (
              <EmptyState icon="search">{t("No results")}</EmptyState>
            ) : (
              <div className={styles.list}>
                {visibleDnsRules.map((entry, index) => (
                  <RuleItem
                    key={index}
                    rule={entry.rule}
                    index={entry.index}
                    hits={hitsByPosition.get(`dns:${entry.index}`)}
                    controls={editing ? ruleControls("dns", entry.index) : undefined}
                  />
                ))}
              </div>
            ))}

          {tab === "rule_set" &&
            (ruleSets.length === 0 ? (
              <EmptyState icon="folder">{t("This configuration has no rule sets")}</EmptyState>
            ) : visibleRuleSets.length === 0 ? (
              <EmptyState icon="search">{t("No results")}</EmptyState>
            ) : (
              <div className={styles.ruleSets}>
                {visibleRuleSets.map((set, index) => {
                  const tag = set.tag;
                  return (
                    <div key={index} className={styles.ruleSet}>
                      <div className={styles.ruleSetHead}>
                        <Badge tone="accent">{Array.isArray(tag) ? tag.join(", ") : String(tag ?? "—")}</Badge>
                        <span className={styles.muted}>{String(set.type ?? "local")}</span>
                        {set.format !== undefined && <span className={styles.muted}>{String(set.format)}</span>}
                      </div>
                      <div className={styles.ruleSetPath}>
                        {String(set.path ?? set.url ?? "—")}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          {tab === "rule_set" && ruleSets.some((set) => set.type === "remote") && (
            <p className="hint">
              {t(
                "Remote rule sets are downloaded by the sing-box core on its own schedule. This panel exposes no endpoint to force an update — restart the core or wait for the next refresh.",
              )}
            </p>
          )}
          <p className={styles.footnote}>
            {t(
              "Rules come from the live sing-box configuration (panel API). The native gRPC API exposes no rule list; the order is the match order, so earlier entries win.",
            )}
          </p>
        </>
      )}

      {editorDraft !== null && editor !== null && (
        <RuleEditorDialog
          title={editor.index === null ? t("Add rule") : t("Edit rule #{index}", { index: editor.index + 1 })}
          targetLabel={
            editor.section === "dns"
              ? t("DNS server tag (server)")
              : t("Outbound tag (outbound)")
          }
          targetKey={editor.section === "dns" ? "server" : "outbound"}
          initial={editorDraft}
          onCancel={() => setEditor(null)}
          onSubmit={submitEditor}
        />
      )}

      {pending !== null && (
        <Dialog onClose={() => setPending(null)}>
          <h2>{t("Apply rule changes")}</h2>
          <p className={styles.confirmNote}>
            {t(
              "This writes the configuration and restarts the sing-box core; proxy connections drop meanwhile. {count} changes in total.",
              { count: pending.changes.length },
            )}
          </p>
          <div className={styles.confirmList}>
            {pending.changes.slice(0, 20).map((change) => (
              <div key={change.path} className={styles.confirmRow}>
                <Badge tone={change.kind === "removed" ? "danger" : "accent"}>{change.kind}</Badge>
                <span className={styles.confirmPath}>{change.path}</span>
                <span className={styles.confirmValue}>
                  {change.kind === "added"
                    ? formatDiffValue(change.after)
                    : change.kind === "removed"
                      ? formatDiffValue(change.before)
                      : `${formatDiffValue(change.before)} → ${formatDiffValue(change.after)}`}
                </span>
              </div>
            ))}
            {pending.changes.length > 20 && (
              <div className={styles.muted}>
                {t("…{count} more changes", { count: pending.changes.length - 20 })}
              </div>
            )}
          </div>
          <div className={styles.confirmActions}>
            <Button onClick={() => setPending(null)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={saving} onClick={() => void applyPending()}>
              {saving ? <Spinner /> : t("Validate and apply")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
