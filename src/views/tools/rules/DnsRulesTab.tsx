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
  return (
    <div className={styles.tabBody}>
      <p className={styles.hint}>
        DNS 规则按顺序匹配；「服务器」需为 dns.servers 中已定义的 tag，命中后该查询交给对应上游处理。
      </p>
      <RuleEditorList
        rules={props.rules}
        onChange={props.onChange}
        targetKey="server"
        targetLabel="DNS 服务器"
        targetOptions={props.serverTags}
        busy={props.busy}
        addLabel="添加 DNS 规则"
        emptyText="暂无 DNS 规则"
      />
    </div>
  );
}
