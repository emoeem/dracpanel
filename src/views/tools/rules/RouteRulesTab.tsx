import { useMemo, useState } from "react";

import { useI18n, type Translate } from "../../../app/i18n";
import { FcButton, FcField, FcSegmented, FcSelect, FcSheet } from "../../../components/flclash";
import type { RuleObject } from "../../../lib/ruleEditor";
import {
  RULE_TEMPLATES,
  resolveTemplateRule,
  type RuleTemplate,
} from "../../../lib/ruleTemplates";
import { cx } from "../../../lib/cx";
import { RuleEditorList } from "./RuleEditorList";
import styles from "../RulesView.module.css";

type RouteMode = "simple" | "advanced";

/** Cards shown on the simple tab before the "more templates" sheet. */
const SIMPLE_TEMPLATE_COUNT = 4;

/** How the generated rule will source its matchers, shown on the card. */
function templateSource(
  t: Translate,
  template: RuleTemplate,
  ruleSetTags: readonly string[],
): { viaRuleSet: boolean; text: string } {
  if (template.staticRule !== undefined) {
    return { viaRuleSet: false, text: t("Fixed matchers") };
  }
  const available = (template.preferredRuleSets ?? []).filter((tag) => ruleSetTags.includes(tag));
  if (available.length > 0) {
    return { viaRuleSet: true, text: t("References rule sets {tags}", { tags: available.join(", ") }) };
  }
  return {
    viaRuleSet: false,
    text: t("Static domain suffixes: {count}", { count: template.domainSuffixes.length }),
  };
}

function TemplateCard(props: {
  template: RuleTemplate;
  outbound: string;
  ruleSetTags: readonly string[];
  stagedRules: readonly RuleObject[];
  disabled: boolean;
  onAdd: (rule: RuleObject) => void;
}) {
  const { t } = useI18n();
  const { template } = props;
  const source = templateSource(t, template, props.ruleSetTags);
  const generated = useMemo(
    () => resolveTemplateRule(template, props.outbound, props.ruleSetTags),
    [template, props.outbound, props.ruleSetTags],
  );
  // Same JSON already staged: adding it again would duplicate the rule.
  const generatedKey = JSON.stringify(generated);
  const exists = props.stagedRules.some((rule) => JSON.stringify(rule) === generatedKey);

  return (
    <div className={styles.templateCard}>
      <div className={styles.templateHead}>
        <span className={styles.templateName}>{t(template.nameKey)}</span>
        <span
          className={cx(styles.templateAction, template.action === "reject" && styles.templateReject)}
        >
          {template.action === "reject" ? t("Reject") : t("Route")}
        </span>
      </div>
      <p className={styles.templateDesc}>{t(template.descriptionKey)}</p>
      <span
        className={cx(styles.templateSource, source.viaRuleSet && styles.templateSourceSet)}
        title={
          source.viaRuleSet
            ? t("Prefer an existing rule_set in the configuration; more accurate than a static list")
            : t("No matching rule_set in the configuration; a static domain suffix list will be written")
        }
      >
        {source.text}
      </span>
      <FcButton
        size="small"
        variant={exists ? "text" : "tonal"}
        disabled={props.disabled || exists}
        onClick={() => props.onAdd(generated)}
      >
        {exists ? t("Already in the list") : t("Add")}
      </FcButton>
    </div>
  );
}

export function RouteRulesTab(props: {
  rules: readonly RuleObject[];
  onChange: (rules: RuleObject[]) => void;
  outbounds: readonly string[];
  ruleSetTags: readonly string[];
  finalOutbound: string;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RouteMode>("simple");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [target, setTarget] = useState("");
  const outbound = target || props.finalOutbound || props.outbounds[0] || "";

  const addTemplate = (template: RuleTemplate) => {
    props.onChange([...props.rules, resolveTemplateRule(template, outbound, props.ruleSetTags)]);
  };

  const templateGrid = (templates: readonly RuleTemplate[]) => (
    <>
      {props.outbounds.length > 0 && (
        <FcField
          label={t("Template target outbound")}
          hint={
            outbound !== ""
              ? t("New routing template rules point at this outbound (current: {outbound})", {
                  outbound,
                })
              : t("New routing template rules point at this outbound")
          }
          className={styles.templateTargetField}
        >
          <FcSelect value={outbound} onChange={setTarget} disabled={props.busy}>
            {props.outbounds.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </FcSelect>
        </FcField>
      )}
      <div className={styles.templateGrid}>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            outbound={outbound}
            ruleSetTags={props.ruleSetTags}
            stagedRules={props.rules}
            disabled={props.busy}
            onAdd={() => addTemplate(template)}
          />
        ))}
      </div>
    </>
  );

  return (
    <div className={styles.tabBody}>
      <FcSegmented
        className={styles.modeToggle}
        ariaLabel={t("Rule editing mode")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "simple", label: t("Simple") },
          { value: "advanced", label: t("Advanced") },
        ]}
      />
      {mode === "simple" ? (
        <>
          {templateGrid(RULE_TEMPLATES.slice(0, SIMPLE_TEMPLATE_COUNT))}
          <div className={styles.moreRow}>
            <FcButton size="small" variant="text" disabled={props.busy} onClick={() => setSheetOpen(true)}>
              {t("More templates")}
            </FcButton>
          </div>
          <p className={styles.hint}>
            {t(
              "Templates only generate one rule and stage it; switch to Advanced for finer domain/IP control. Private, multicast, and reserved addresses are better routed directly — use the “Direct private addresses” template and move it to the top. Changes are written to the configuration only after you press Apply.",
            )}
          </p>
          {sheetOpen && (
            <FcSheet
              title={t("Rule templates")}
              subtitle={t("Clicking add stages the rule; apply them together")}
              onClose={() => setSheetOpen(false)}
              wide
            >
              {templateGrid(RULE_TEMPLATES)}
            </FcSheet>
          )}
        </>
      ) : (
        <RuleEditorList
          rules={props.rules}
          onChange={props.onChange}
          targetKey="outbound"
          targetLabel={t("Outbound")}
          targetOptions={props.outbounds}
          busy={props.busy}
          addLabel={t("Add rule")}
          emptyText={t("No rules")}
        />
      )}
    </div>
  );
}
