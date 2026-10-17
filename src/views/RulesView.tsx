import { useCallback, useEffect, useState } from "react";

import { getPanelConfig, PanelAuthError } from "../api/panel";
import { navigate } from "../app/context";
import { useI18n } from "../app/i18n";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Card, EmptyState, Spinner } from "../components/ui";
import { cx } from "../lib/cx";
import styles from "./RulesView.module.css";

type JsonObject = Record<string, unknown>;

interface ConfigShape {
  route?: {
    rules?: JsonObject[];
    rule_set?: JsonObject[];
    final?: string;
    default_domain_resolver?: string;
  };
  dns?: {
    rules?: JsonObject[];
    final?: string;
    default_domain_resolver?: string;
  };
  experimental?: {
    clash_api?: { default_mode?: string };
  };
}

type Tab = "route" | "dns" | "rule_set";

const ACTION_LABELS: Record<string, string> = {
  route: "路由",
  reject: "拒绝",
  sniff: "嗅探",
  "hijack-dns": "劫持 DNS",
  resolve: "解析",
  predefined: "预定义响应",
  evaluate: "评估",
  respond: "响应",
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

function asString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function actionOf(rule: JsonObject): string {
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

function RuleChips(props: { rule: JsonObject }) {
  const chips = CHIP_KEYS.filter((key) => props.rule[key] !== undefined);
  if (chips.length === 0) {
    return <span className={styles.muted}>默认规则</span>;
  }
  return (
    <span className={styles.chips}>
      {chips.map((key) => (
        <span key={key} className={styles.chip} title={`${key}: ${asString(props.rule[key])}`}>
          <span className={styles.chipKey}>{key}</span>
          <span className={styles.chipValue}>{asString(props.rule[key])}</span>
        </span>
      ))}
    </span>
  );
}

function RuleItem(props: { rule: JsonObject; index: number; depth?: number }) {
  const rule = props.rule;
  const action = actionOf(rule);
  const logical = Array.isArray(rule.rules) ? (rule.rules as JsonObject[]) : null;
  const outbound =
    typeof rule.outbound === "string" ? rule.outbound : typeof rule.server === "string" ? rule.server : null;
  return (
    <div className={cx(styles.rule, props.depth !== undefined && props.depth > 0 && styles.nested)}>
      <div className={styles.ruleHead}>
        <span className={styles.ruleIndex}>#{props.index + 1}</span>
        <Badge tone={actionTone(action)}>{ACTION_LABELS[action] ?? action}</Badge>
        {logical !== null && (
          <Badge tone="info">
            {String(rule.mode ?? "and").toUpperCase()} · {logical.length}
          </Badge>
        )}
        {outbound !== null && <span className={styles.outbound}>→ {outbound}</span>}
        <span className={styles.ruleSpacer} />
        {typeof rule.invert === "boolean" && rule.invert && <Badge tone="danger">invert</Badge>}
      </div>
      <div className={styles.ruleBody}>
        {logical === null ? (
          <RuleChips rule={rule} />
        ) : (
          <details className={styles.details}>
            <summary>展开 {logical.length} 条子规则</summary>
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
}

export function RulesView() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("route");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getPanelConfig();
      const parsed = JSON.parse(result.text) as ConfigShape;
      setConfig(parsed);
    } catch (cause) {
      if (cause instanceof PanelAuthError) {
        setError("面板令牌已失效，请重新登录。");
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const routeRules = config?.route?.rules ?? [];
  const dnsRules = config?.dns?.rules ?? [];
  const ruleSets = config?.route?.rule_set ?? [];
  const mode = config?.experimental?.clash_api?.default_mode;

  const actions = (
    <>
      <Button onClick={() => void load()} disabled={loading}>
        {loading ? <Spinner /> : "刷新"}
      </Button>
      <Button variant="primary" onClick={() => navigate("manage")}>
        编辑配置
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
            重试
          </Button>
        </div>
      )}
      {loading && config === null && (
        <div className={styles.loading}>
          <Spinner />
          <span>正在读取当前配置…</span>
        </div>
      )}
      {config !== null && (
        <>
          <div className={styles.summary}>
            <Card title="路由">
              <div className={styles.metric}>
                {routeRules.length}
                <small>条规则</small>
              </div>
              <div className={styles.muted}>final → {config.route?.final ?? "—"}</div>
            </Card>
            <Card title="DNS">
              <div className={styles.metric}>
                {dnsRules.length}
                <small>条规则</small>
              </div>
              <div className={styles.muted}>final → {config.dns?.final ?? "—"}</div>
            </Card>
            <Card title="规则集">
              <div className={styles.metric}>
                {ruleSets.length}
                <small>个集合</small>
              </div>
              <div className={styles.muted}>Clash 默认模式 → {mode ?? "—"}</div>
            </Card>
          </div>

          <div className={styles.tabs}>
            <button
              type="button"
              className={cx(styles.tab, tab === "route" && styles.active)}
              onClick={() => setTab("route")}
            >
              路由规则 <span className={styles.count}>{routeRules.length}</span>
            </button>
            <button
              type="button"
              className={cx(styles.tab, tab === "dns" && styles.active)}
              onClick={() => setTab("dns")}
            >
              DNS 规则 <span className={styles.count}>{dnsRules.length}</span>
            </button>
            <button
              type="button"
              className={cx(styles.tab, tab === "rule_set" && styles.active)}
              onClick={() => setTab("rule_set")}
            >
              规则集 <span className={styles.count}>{ruleSets.length}</span>
            </button>
          </div>

          {tab === "route" &&
            (routeRules.length === 0 ? (
              <EmptyState icon="filter_list">当前配置没有路由规则</EmptyState>
            ) : (
              <div className={styles.list}>
                {routeRules.map((rule, index) => (
                  <RuleItem key={index} rule={rule} index={index} />
                ))}
              </div>
            ))}

          {tab === "dns" &&
            (dnsRules.length === 0 ? (
              <EmptyState icon="dns">当前配置没有 DNS 规则</EmptyState>
            ) : (
              <div className={styles.list}>
                {dnsRules.map((rule, index) => (
                  <RuleItem key={index} rule={rule} index={index} />
                ))}
              </div>
            ))}

          {tab === "rule_set" &&
            (ruleSets.length === 0 ? (
              <EmptyState icon="folder">当前配置没有规则集</EmptyState>
            ) : (
              <div className={styles.ruleSets}>
                {ruleSets.map((set, index) => {
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
          <p className={styles.footnote}>
            规则来自实时 sing-box 配置（面板 API）。原生 gRPC API 不提供规则列表；修改请到「管理 → 配置」。
          </p>
        </>
      )}
    </div>
  );
}
