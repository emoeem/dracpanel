import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyPanelConfig,
  getPanelConfig,
  hasPanelToken,
  validatePanelConfig,
} from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { FcButton, FcCard, FcTabs } from "../../components/flclash";
import type { RuleObject } from "../../lib/ruleEditor";
import { patchConfigTextMany, readConfigValue, type ConfigPath } from "../../lib/configPatch";
import { DnsRulesTab } from "./rules/DnsRulesTab";
import { RouteRulesTab } from "./rules/RouteRulesTab";
import { TraceRulesTab } from "./rules/TraceRulesTab";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./RulesView.module.css";

type RulesTab = "route" | "dns" | "trace";

interface RuleSections {
  route: RuleObject[];
  dns: RuleObject[];
}

const EMPTY_SECTIONS: RuleSections = { route: [], dns: [] };

function sameRules(a: readonly RuleObject[], b: readonly RuleObject[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tagList(value: { tag?: unknown }[]): string[] {
  return value.map((entry) => (typeof entry.tag === "string" ? entry.tag : "")).filter((tag) => tag !== "");
}

export function RulesView() {
  const api = useApi();
  const [tab, setTab] = useState<RulesTab>("route");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Baseline mirrors the config on disk; route/dns are the staged edits.
  const [baseline, setBaseline] = useState<RuleSections>(EMPTY_SECTIONS);
  const [route, setRoute] = useState<RuleObject[]>([]);
  const [dns, setDns] = useState<RuleObject[]>([]);
  const [configText, setConfigText] = useState("");

  const load = useCallback(async (resetStaged: boolean) => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error("读取配置失败");
      }
      const next: RuleSections = {
        route: readConfigValue<RuleObject[]>(config.text, ["route", "rules"], []),
        dns: readConfigValue<RuleObject[]>(config.text, ["dns", "rules"], []),
      };
      setConfigText(config.text);
      setBaseline(next);
      // A failed apply re-reads the disk truth but keeps the user's staged
      // edits; only a fresh page (or successful apply) resets them.
      if (resetStaged) {
        setRoute(next.route);
        setDns(next.dns);
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const routeDirty = !sameRules(route, baseline.route);
  const dnsDirty = !sameRules(dns, baseline.dns);
  const dirty = routeDirty || dnsDirty;

  const apply = useCallback(async () => {
    if (!dirty) {
      return;
    }
    setBusy(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error("读取配置失败");
      }
      // One write carries both sections; the patch keeps comments intact.
      const patches: { path: ConfigPath; value: unknown }[] = [];
      if (routeDirty) {
        patches.push({ path: ["route", "rules"], value: route });
      }
      if (dnsDirty) {
        patches.push({ path: ["dns", "rules"], value: dns });
      }
      const text = patchConfigTextMany(config.text, patches);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || "配置校验失败，未应用");
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || "写入失败");
      }
      await afterConfigChange(api);
      setBaseline({ route, dns });
    } catch (error) {
      showError(error);
      // Refresh the baseline (the config may have moved under us) but keep
      // the staged edits so the user can retry after fixing the cause.
      await load(false);
    } finally {
      setBusy(false);
    }
  }, [api, dirty, routeDirty, dnsDirty, route, dns, load]);

  const discard = useCallback(() => {
    setRoute(baseline.route);
    setDns(baseline.dns);
  }, [baseline]);

  const meta = useMemo(
    () => ({
      outbounds: tagList(readConfigValue<{ tag?: unknown }[]>(configText, ["outbounds"], [])),
      ruleSetTags: tagList(readConfigValue<{ tag?: unknown }[]>(configText, ["route", "rule_set"], [])),
      serverTags: tagList(readConfigValue<{ tag?: unknown }[]>(configText, ["dns", "servers"], [])),
      final: readConfigValue<unknown>(configText, ["route", "final"], ""),
    }),
    [configText],
  );
  const finalOutbound = typeof meta.final === "string" ? meta.final : "";

  if (!hasPanelToken()) {
    return (
      <div className="fc-page">
        <ToolsPageHeader title="附加规则" onBack={() => navigate("tools/advanced")} />
        <div className={styles.empty}>规则编辑需要面板后端；直接模式下不可用。</div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <ToolsPageHeader title="附加规则" onBack={() => navigate("tools/advanced")} />
      <div className="fc-page-body">
        <FcTabs
          className={styles.tabs}
          ariaLabel="规则类型"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "route", label: "路由规则" },
            { value: "dns", label: "DNS 规则" },
            { value: "trace", label: "追踪模拟" },
          ]}
        />
        {dirty && (
          <FcCard className={styles.applyBar}>
            <span className={styles.applyText}>
              有未应用的暂存改动
              {routeDirty && dnsDirty ? "（路由 + DNS）" : routeDirty ? "（路由规则）" : "（DNS 规则）"}
              ，应用时会校验配置并热更新内核。
            </span>
            <span className={styles.applyActions}>
              <FcButton size="small" variant="text" disabled={busy} onClick={discard}>
                放弃
              </FcButton>
              <FcButton size="small" variant="primary" disabled={busy} onClick={() => void apply()}>
                应用
              </FcButton>
            </span>
          </FcCard>
        )}
        {loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : (
          <>
            {tab === "route" && (
              <RouteRulesTab
                rules={route}
                onChange={setRoute}
                outbounds={meta.outbounds}
                ruleSetTags={meta.ruleSetTags}
                finalOutbound={finalOutbound}
                busy={busy}
              />
            )}
            {tab === "dns" && (
              <DnsRulesTab rules={dns} onChange={setDns} serverTags={meta.serverTags} busy={busy} />
            )}
            {tab === "trace" && <TraceRulesTab rules={route} finalTarget={finalOutbound} />}
          </>
        )}
      </div>
    </div>
  );
}
