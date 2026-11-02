import { useState } from "react";

import {
  applyPanelConfig,
  getPanelConfig,
  hasPanelToken,
  validatePanelConfig,
} from "../api/panel";
import { useApi } from "../app/context";
import { afterConfigChange } from "../app/configResync";
import { showError } from "../app/errorStore";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { FcIconButton } from "../components/flclash";
import { useToast } from "../components/Toast";
import { patchConfigTextMany, readConfigValue, type ConfigPath } from "../lib/configPatch";
import type { RuleDraft, RuleObject } from "../lib/ruleEditor";
import { RuleEditorDialog } from "./RuleEditorDialog";

interface RuleMeta {
  /** Outbound tags for the route-rule datalist. */
  outbounds: string[];
  /** DNS server tags for the dns-rule datalist. */
  servers: string[];
  /** `route.final`, used as the default route target (mirrors the rules page). */
  final: string;
}

function tagList(value: { tag?: unknown }[]): string[] {
  return value.map((entry) => (typeof entry.tag === "string" ? entry.tag : "")).filter((tag) => tag !== "");
}

/**
 * Inline "add rule" action for observation rows (connection detail, DNS log,
 * flow records): opens the shared rule editor prefilled with the row's domain
 * and applies the result immediately through the single config pipeline
 * (patch → validate → apply). doona exposes the same affordance on rows.
 *
 * Renders nothing without a panel token — rule edits need the panel backend.
 */
export function AddRuleButton(props: { domain: string; scope?: "route" | "dns" }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const scope = props.scope ?? "route";
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [meta, setMeta] = useState<RuleMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const domain = props.domain.trim();
  if (!hasPanelToken() || domain === "") {
    return null;
  }

  const open = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error(t("Failed to read the configuration"));
      }
      const nextMeta: RuleMeta = {
        outbounds: tagList(readConfigValue<{ tag?: unknown }[]>(config.text, ["outbounds"], [])),
        servers: tagList(readConfigValue<{ tag?: unknown }[]>(config.text, ["dns", "servers"], [])),
        final: readConfigValue<string>(config.text, ["route", "final"], ""),
      };
      setMeta(nextMeta);
      setDraft({
        action: "route",
        target: scope === "dns" ? (nextMeta.servers[0] ?? "local") : nextMeta.final,
        invert: false,
        // Exact domain for DNS rules; suffix (covers subdomains) for routing.
        matchers: [{ key: scope === "dns" ? "domain" : "domain_suffix", value: domain }],
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (rule: RuleObject) => {
    setBusy(true);
    try {
      const config = await getPanelConfig();
      if (!config.ok) {
        throw new Error(t("Failed to read the configuration"));
      }
      const path: ConfigPath = scope === "dns" ? ["dns", "rules"] : ["route", "rules"];
      const rules = readConfigValue<RuleObject[]>(config.text, path, []);
      const text = patchConfigTextMany(config.text, [{ path, value: [...rules, rule] }]);
      const validation = await validatePanelConfig(text);
      if (!validation.ok) {
        throw new Error(validation.message || t("Configuration validation failed"));
      }
      const result = await applyPanelConfig(text, config.mtime);
      if (!result.ok) {
        throw new Error(result.message || t("Failed to write"));
      }
      await afterConfigChange(api);
      toast(t("Rule added: {domain}", { domain }), "good");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
      setDraft(null);
    }
  };

  return (
    <>
      <FcIconButton
        label={t("Add rule for {domain}", { domain })}
        disabled={busy}
        onClick={() => void open()}
      >
        <Icon name="add" size={16} />
      </FcIconButton>
      {draft !== null && meta !== null && (
        <RuleEditorDialog
          title={t("Add rule for {domain}", { domain })}
          targetKey={scope === "dns" ? "server" : "outbound"}
          targetLabel={scope === "dns" ? t("DNS server") : t("Outbound")}
          targetOptions={scope === "dns" ? meta.servers : meta.outbounds}
          initial={draft}
          onCancel={() => setDraft(null)}
          onSubmit={(rule) => void submit(rule)}
        />
      )}
    </>
  );
}
