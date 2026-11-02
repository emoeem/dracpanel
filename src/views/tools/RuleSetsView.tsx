import { useCallback, useEffect, useState } from "react";

import { getPanelConfig, hasPanelToken, normalizeConfigJson } from "../../api/panel";
import { navigate } from "../../app/context";
import { showError } from "../../app/errorStore";
import { useI18n } from "../../app/i18n";
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
  const { t } = useI18n();
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
      <ToolsPageHeader title={t("Custom Resources")} onBack={() => navigate("tools")} />
      <div className="fc-page-body">
        {loading ? (
          <div className={styles.empty}>{t("Loading...")}</div>
        ) : sets.length === 0 ? (
          <div className={styles.empty}>{t("No rule_set resources in the configuration")}</div>
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
          {t(
            "The kernel refreshes rule sets from the configuration; edit route.rule_set in the configuration file to add or change one.",
          )}
        </p>
      </div>
    </div>
  );
}
