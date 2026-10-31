import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyPanelConfig,
  getPanelConfig,
  hasPanelToken,
  normalizeConfigJson,
  validatePanelConfig,
} from "../../api/panel";
import { useApi, navigate } from "../../app/context";
import { afterConfigChange } from "../../app/configResync";
import { showError } from "../../app/errorStore";
import { useI18n } from "../../app/i18n";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FcCard, FcIconButton } from "../../components/flclash";
import type { RuleObject } from "../../lib/ruleEditor";
import { emptyDraft, ruleToDraft } from "../../lib/ruleEditor";
import { RuleEditorDialog } from "../RuleEditorDialog";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./RulesView.module.css";

interface ConfigShape {
  route?: {
    rules?: RuleObject[];
  };
}

function ruleSummary(rule: RuleObject): string {
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

function ruleTarget(rule: RuleObject): string {
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

export function RulesView() {
  const api = useApi();
  const { t } = useI18n();
  const [rules, setRules] = useState<RuleObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const config = await getPanelConfig();
      const parsed = JSON.parse(normalizeConfigJson(config.text)) as ConfigShape;
      setRules(parsed.route?.rules ?? []);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const write = useCallback(
    async (nextRules: RuleObject[]) => {
      setBusy(true);
      try {
        const config = await getPanelConfig();
        if (!config.ok) {
          throw new Error("读取配置失败");
        }
        let text = config.text;
        const parsed = JSON.parse(normalizeConfigJson(text)) as ConfigShape;
        parsed.route = { ...(parsed.route ?? {}), rules: nextRules };
        text = JSON.stringify(parsed, null, 2);
        const validation = await validatePanelConfig(text);
        if (!validation.ok) {
          throw new Error(validation.message || "配置校验失败，未应用");
        }
        const result = await applyPanelConfig(text);
        if (!result.ok) {
          throw new Error(result.message || "写入失败");
        }
        await afterConfigChange(api);
        setRules(nextRules);
      } catch (error) {
        showError(error);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [api, load],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === "") {
      return rules.map((rule, index) => ({ rule, index }));
    }
    return rules
      .map((rule, index) => ({ rule, index }))
      .filter(
        ({ rule }) =>
          ruleSummary(rule).toLowerCase().includes(query) ||
          ruleTarget(rule).toLowerCase().includes(query),
      );
  }, [rules, search]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) {
      return;
    }
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    void write(next);
  };

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
      <ToolsPageHeader
        title="附加规则"
        onBack={() => navigate("tools/advanced")}
        actions={
          <FcIconButton
            label="添加规则"
            onClick={() => {
              setEditIndex(null);
              setEditorOpen(true);
            }}
          >
            <Icon name="add" size={20} />
          </FcIconButton>
        }
      />
      <div className="fc-page-body">
        <label className={styles.search}>
          <Icon name="search" size={16} />
          <input
            value={search}
            placeholder="搜索规则"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>暂无规则</div>
        ) : (
          <FcCard className={styles.card}>
            {filtered.map(({ rule, index }, position) => (
              <div key={index} className={styles.row}>
                <span className={styles.order}>{position + 1}</span>
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
                <span className={styles.rowActions}>
                  <FcIconButton label="上移" disabled={busy || index === 0} onClick={() => move(index, -1)}>
                    <span className={styles.upIcon}>
                      <Icon name="unfold_more" size={14} />
                    </span>
                  </FcIconButton>
                  <FcIconButton
                    label="下移"
                    disabled={busy || index === rules.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <span className={styles.downIcon}>
                      <Icon name="unfold_more" size={14} />
                    </span>
                  </FcIconButton>
                  <FcIconButton label="删除规则" disabled={busy} onClick={() => setDeleteIndex(index)}>
                    <Icon name="delete" size={16} />
                  </FcIconButton>
                </span>
              </div>
            ))}
          </FcCard>
        )}
        <p className={styles.hint}>
          规则按顺序匹配；修改会立即写回配置并重启内核，失败时自动回滚。DNS 规则请在配置文件中编辑。
        </p>
      </div>

      {editorOpen && (
        <RuleEditorDialog
          title={editIndex === null ? "添加规则" : "编辑规则"}
          targetLabel={t("Outbound")}
          targetKey="outbound"
          initial={editIndex === null ? emptyDraft() : ruleToDraft(rules[editIndex])}
          onCancel={() => setEditorOpen(false)}
          onSubmit={(rule) => {
            setEditorOpen(false);
            const next = [...rules];
            if (editIndex === null) {
              next.push(rule);
            } else {
              next[editIndex] = rule;
            }
            void write(next);
          }}
        />
      )}
      {deleteIndex !== null && (
        <ConfirmDialog
          title="删除规则"
          message={`删除第 ${deleteIndex + 1} 条规则（${ruleSummary(rules[deleteIndex])}）？`}
          confirmLabel="删除"
          danger
          busy={busy}
          onConfirm={() => {
            const next = rules.filter((_, current) => current !== deleteIndex);
            setDeleteIndex(null);
            void write(next);
          }}
          onClose={() => setDeleteIndex(null)}
        />
      )}
    </div>
  );
}
