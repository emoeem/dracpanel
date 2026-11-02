import { useI18n } from "../../../app/i18n";
import type { RuleObject } from "../../../lib/ruleEditor";
import { RuleEditorList } from "./RuleEditorList";
import styles from "../RulesView.module.css";

/**
 * DNS rules live under `dns.rules`; the flat editor already supports the
 * `server` target and the `query_type`/`rcode` matchers.
 */
export function DnsRulesTab(props: {
  rules: readonly RuleObject[];
  onChange: (rules: RuleObject[]) => void;
  serverTags: readonly string[];
  busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.tabBody}>
      <p className={styles.hint}>
        {t(
          "DNS rules match in order; the server must be a tag defined in dns.servers, and matching queries are handed to that upstream.",
        )}
      </p>
      <RuleEditorList
        rules={props.rules}
        onChange={props.onChange}
        targetKey="server"
        targetLabel={t("DNS server")}
        targetOptions={props.serverTags}
        busy={props.busy}
        addLabel={t("Add DNS rule")}
        emptyText={t("No DNS rules")}
      />
    </div>
  );
}
