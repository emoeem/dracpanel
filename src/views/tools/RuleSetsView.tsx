import { useCallback, useEffect, useState } from "react";

import { getPanelConfig, hasPanelToken, normalizeConfigJson } from "../../api/panel";
import { navigate } from "../../app/context";
import { showError } from "../../app/errorStore";
import { FcCard } from "../../components/flclash";
import { ToolsPageHeader } from "./ToolsView";
import styles from "./RuleSetsView.module.css";

interface RuleSetEntry {
  tag?: string;
  type?: string;
  format?: string;
  url?: string;
  path?: string;
  [key: string]: unknown;
}

interface ConfigShape {
  route?: {
    rule_set?: RuleSetEntry[];
  };
}

export function RuleSetsView() {
  const [sets, setSets] = useState<RuleSetEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!hasPanelToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const config = await getPanelConfig();
      const parsed = JSON.parse(normalizeConfigJson(config.text)) as ConfigShape;
      setSets(parsed.route?.rule_set ?? []);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="fc-page">
      <ToolsPageHeader title="自定义资源" onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        {loading ? (
          <div className={styles.empty}>加载中…</div>
        ) : sets.length === 0 ? (
          <div className={styles.empty}>配置中没有 rule_set 资源</div>
        ) : (
          <FcCard className={styles.card}>
            {sets.map((entry, index) => (
              <div key={entry.tag ?? index} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.tag}>{entry.tag ?? `#${index + 1}`}</span>
                  <span className={styles.meta}>
                    {entry.type ?? "remote"} · {entry.format ?? "source"}
                    {entry.url ? ` · ${entry.url}` : entry.path ? ` · ${entry.path}` : ""}
                  </span>
                </span>
              </div>
            ))}
          </FcCard>
        )}
        <p className={styles.hint}>
          规则集由内核按配置刷新；添加或修改请在配置文件中编辑 route.rule_set。
        </p>
      </div>
    </div>
  );
}
