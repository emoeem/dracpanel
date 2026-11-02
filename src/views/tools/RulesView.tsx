import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyPanelConfig,
  getPanelConfig,
  hasPanelToken,
  validatePanelConfig,
} from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { useI18n } from "../../app/i18n";
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
  const { t } = useI18n();
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
        throw new Error(t("Failed to read the configuration"));
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
  }, [t]);

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
        throw new Error(t("Failed to read the configuration"));
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
        throw new Error(validation.message || t("Configuration validation failed; nothing was applied"));
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to write"));
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
  }, [api, dirty, routeDirty, dnsDirty, route, dns, load, t]);

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
        <ToolsPageHeader title={t("Additional rules")} onBack={() => navigate("tools/advanced")} />
        <div className={styles.empty}>{t("Rule editing requires the panel backend; unavailable in direct mode.")}</div>
      </div>
    );
  }

  return (
    <div className="fc-page">
      <ToolsPageHeader title={t("Additional rules")} onBack={() => navigate("tools/advanced")} />
      <div className="fc-page-body">
        <FcTabs
          className={styles.tabs}
          ariaLabel={t("Rule type")}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "route", label: t("Routing rules") },
            { value: "dns", label: t("DNS rules") },
            { value: "trace", label: t("Trace simulation") },
          ]}
        />
        {dirty && (
          <FcCard className={styles.applyBar}>
            <span className={styles.applyText}>
              {t(
                "Unapplied staged changes {scope}; applying validates the configuration and hot-reloads the core.",
                {
                  scope:
                    routeDirty && dnsDirty
                      ? t("(routing + DNS)")
                      : routeDirty
                        ? t("(routing rules)")
                        : t("(DNS rules)"),
                },
              )}
            </span>
            <span className={styles.applyActions}>
              <FcButton size="small" variant="text" disabled={busy} onClick={discard}>
                {t("Discard")}
              </FcButton>
              <FcButton size="small" variant="primary" disabled={busy} onClick={() => void apply()}>
                {t("Apply")}
              </FcButton>
            </span>
          </FcCard>
        )}
        {loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
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
