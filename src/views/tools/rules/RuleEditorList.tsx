import { useMemo, useState } from "react";

import { navigate } from "../../../app/context";
import { useI18n } from "../../../app/i18n";
import { Icon } from "../../../components/Icon";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { FcCard, FcIconButton } from "../../../components/flclash";
import type { RuleObject } from "../../../lib/ruleEditor";
import { emptyDraft, isNestedRule, ruleToDraft } from "../../../lib/ruleEditor";
import { cx } from "../../../lib/cx";
import { RuleEditorDialog } from "../../RuleEditorDialog";
import styles from "../RulesView.module.css";

/** Existing translation key; shared by every logical-rule row. */
const NESTED_RULE_HINT =
  "Combined rules (rules/mode) cannot be edited here; change the JSON under Manage → Config instead." as const;

export function ruleSummary(rule: RuleObject): string {
  const matchers: string[] = [];
  for (const [key, value] of Object.entries(rule)) {
    if (key === "action" || key === "outbound" || key === "server" || key === "rules") {
      continue;
    }
    if (typeof value === "boolean") {
      matchers.push(value ? key : `!${key}`);
    } else if (Array.isArray(value)) {
      matchers.push(`${key}: ${value.length}`);
    } else if (value !== undefined && value !== null) {
      matchers.push(`${key}: ${String(value)}`);
    }
  }
  return matchers.join(" · ") || "（空规则）";
}

export function ruleTarget(rule: RuleObject): string {
  if (typeof rule.outbound === "string") {
    return `→ ${rule.outbound}`;
  }
  if (typeof rule.server === "string") {
    return `→ DNS ${rule.server}`;
  }
  if (typeof rule.action === "string") {
    return `→ ${rule.action}`;
  }
  return "→ 默认";
}

/**
 * Searchable ordered rule list shared by the route and DNS tabs. Edits stay
 * local: every mutation calls `onChange` with the next array, and the shell
 * owns staging + the single "apply" write, so one apply can carry both tabs.
 */
export function RuleEditorList(props: {
  rules: readonly RuleObject[];
  onChange: (rules: RuleObject[]) => void;
  targetKey: "outbound" | "server";
  targetLabel: string;
  /** Tags offered as autocomplete for the target field. */
  targetOptions?: readonly string[];
  busy: boolean;
  addLabel: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return props.rules
      .map((rule, index) => ({ rule, index }))
      .filter(
        ({ rule }) =>
          query === "" ||
          ruleSummary(rule).toLowerCase().includes(query) ||
          ruleTarget(rule).toLowerCase().includes(query),
      );
  }, [props.rules, search]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= props.rules.length) {
      return;
    }
    const next = [...props.rules];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved ?? {});
    props.onChange(next);
  };

  // Logical rules are edited as JSON: ManageView picks its tab from
  // localStorage, so set that before navigating.
  const openConfigEditor = () => {
    try {
      localStorage.setItem("panel_manage_tab", "config");
    } catch {
      // Private mode: the tab falls back to its default.
    }
    navigate("tools/config");
  };

  return (
    <>
      <div className={styles.listToolbar}>
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input
            value={search}
            placeholder="搜索规则"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <FcIconButton
          label={props.addLabel}
          disabled={props.busy}
          onClick={() => {
            setEditIndex(null);
            setEditorOpen(true);
          }}
        >
          <Icon name="add" size={20} />
        </FcIconButton>
      </div>
      {filtered.length === 0 ? (
        <div className={styles.empty}>{props.emptyText}</div>
      ) : (
        <FcCard className={styles.card}>
          {filtered.map(({ rule, index }, position) => {
            // Logical rules nest their conditions; the flat editor would drop
            // `mode`/`rules` and corrupt them, so they open in the JSON editor.
            const nested = isNestedRule(rule);
            return (
              <div key={index} className={styles.row}>
                <span className={styles.order}>{position + 1}</span>
                {nested ? (
                  <div className={cx(styles.rowMain, styles.rowMainStatic)}>
                    <span className={styles.summary}>{ruleSummary(rule)}</span>
                    <span className={styles.nestedNote} title={t(NESTED_RULE_HINT)}>
                      {t(NESTED_RULE_HINT)}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.rowMain}
                    onClick={() => {
                      setEditIndex(index);
                      setEditorOpen(true);
                    }}
                  >
                    <span className={styles.summary}>{ruleSummary(rule)}</span>
                    <span className={styles.target}>{ruleTarget(rule)}</span>
                  </button>
                )}
                <span className={styles.rowActions}>
                  {nested && (
                    <FcIconButton label={t("Edit config")} onClick={openConfigEditor}>
                      <Icon name="code" size={16} />
                    </FcIconButton>
                  )}
                  <FcIconButton
                    label="上移"
                    disabled={props.busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <span className={styles.upIcon}>
                      <Icon name="unfold_more" size={14} />
                    </span>
                  </FcIconButton>
                  <FcIconButton
                    label="下移"
                    disabled={props.busy || index === props.rules.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <span className={styles.downIcon}>
                      <Icon name="unfold_more" size={14} />
                    </span>
                  </FcIconButton>
                  <FcIconButton
                    label="删除规则"
                    danger
                    disabled={props.busy}
                    onClick={() => setDeleteIndex(index)}
                  >
                    <Icon name="delete" size={16} />
                  </FcIconButton>
                </span>
              </div>
            );
          })}
        </FcCard>
      )}

      {editorOpen && (
        <RuleEditorDialog
          title={editIndex === null ? props.addLabel : "编辑规则"}
          targetLabel={props.targetLabel}
          targetKey={props.targetKey}
          targetOptions={props.targetOptions}
          initial={editIndex === null ? emptyDraft() : ruleToDraft(props.rules[editIndex] ?? {})}
          onCancel={() => setEditorOpen(false)}
          onSubmit={(rule) => {
            setEditorOpen(false);
            const next = [...props.rules];
            if (editIndex === null) {
              next.push(rule);
            } else {
              next[editIndex] = rule;
            }
            props.onChange(next);
          }}
        />
      )}
      {deleteIndex !== null && (
        <ConfirmDialog
          title="删除规则"
          message={`删除第 ${deleteIndex + 1} 条规则（${ruleSummary(props.rules[deleteIndex] ?? {})}）？改动先暂存，点「应用」后生效。`}
          confirmLabel="删除"
          danger
          onConfirm={() => {
            props.onChange(props.rules.filter((_, current) => current !== deleteIndex));
            setDeleteIndex(null);
          }}
          onClose={() => setDeleteIndex(null)}
        />
      )}
    </>
  );
}
