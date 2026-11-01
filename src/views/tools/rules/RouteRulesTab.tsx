import { useMemo, useState } from "react";

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
  template: RuleTemplate,
  ruleSetTags: readonly string[],
): { viaRuleSet: boolean; text: string } {
  if (template.staticRule !== undefined) {
    return { viaRuleSet: false, text: "固定匹配器" };
  }
  const available = (template.preferredRuleSets ?? []).filter((tag) => ruleSetTags.includes(tag));
  if (available.length > 0) {
    return { viaRuleSet: true, text: `引用规则集 ${available.join("、")}` };
  }
  return { viaRuleSet: false, text: `静态域名后缀 ${template.domainSuffixes.length} 条` };
}

function TemplateCard(props: {
  template: RuleTemplate;
  outbound: string;
  ruleSetTags: readonly string[];
  stagedRules: readonly RuleObject[];
  disabled: boolean;
  onAdd: (rule: RuleObject) => void;
}) {
  const { template } = props;
  const source = templateSource(template, props.ruleSetTags);
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
        <span className={styles.templateName}>{template.name}</span>
        <span
          className={cx(styles.templateAction, template.action === "reject" && styles.templateReject)}
        >
          {template.action === "reject" ? "拒绝" : "路由"}
        </span>
      </div>
      <p className={styles.templateDesc}>{template.description}</p>
      <span
        className={cx(styles.templateSource, source.viaRuleSet && styles.templateSourceSet)}
        title={
          source.viaRuleSet
            ? "优先引用配置中已有的 rule_set，比静态列表更准确"
            : "配置中没有对应 rule_set，写入静态域名后缀列表"
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
        {exists ? "已在列表" : "添加"}
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
          label="模板目标出站"
          hint={`新增「路由」类模板规则指向该出站${outbound !== "" ? `（当前：${outbound}）` : ""}`}
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
        ariaLabel="规则编辑模式"
        value={mode}
        onChange={setMode}
        options={[
          { value: "simple", label: "简易" },
          { value: "advanced", label: "高级" },
        ]}
      />
      {mode === "simple" ? (
        <>
          {templateGrid(RULE_TEMPLATES.slice(0, SIMPLE_TEMPLATE_COUNT))}
          <div className={styles.moreRow}>
            <FcButton size="small" variant="text" disabled={props.busy} onClick={() => setSheetOpen(true)}>
              更多模板
            </FcButton>
          </div>
          <p className={styles.hint}>
            模板只生成一条规则并加入暂存；更细的域名/IP 控制请切到「高级」。私有/多播/保留地址建议直连，可用「私有地址直连」模板并上移到列表前部。所有改动需点顶部「应用」后才写入配置。
          </p>
          {sheetOpen && (
            <FcSheet
              title="规则模板"
              subtitle="点击添加后进入暂存，统一应用"
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
          targetLabel="出站"
          targetOptions={props.outbounds}
          busy={props.busy}
          addLabel="添加规则"
          emptyText="暂无规则"
        />
      )}
    </div>
  );
}
