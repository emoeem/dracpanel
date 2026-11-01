import { useMemo, useState } from "react";

import { FcCard, FcField, FcSelect } from "../../../components/flclash";
import type { RuleObject } from "../../../lib/ruleEditor";
import { ruleSummary } from "./RuleEditorList";
import { traceRules, type TraceVerdict } from "../../../lib/ruleTrace";
import { cx } from "../../../lib/cx";
import styles from "../RulesView.module.css";

const VERDICT_LABEL: Record<TraceVerdict, string> = {
  match: "命中",
  no_match: "未命中",
  unknown: "需内核判定",
};

/**
 * Static route-rule simulator. It evaluates the rules as staged on this page
 * (including not-yet-applied changes) against a domain/IP/port/network tuple;
 * see lib/ruleTrace.ts for what can and cannot be decided without the kernel.
 */
export function TraceRulesTab(props: { rules: readonly RuleObject[]; finalTarget: string }) {
  const [domain, setDomain] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("");
  const [network, setNetwork] = useState("tcp");

  const result = useMemo(
    () => traceRules(props.rules, { domain, ip, port, network }, props.finalTarget),
    [props.rules, props.finalTarget, domain, ip, port, network],
  );

  const outcome = result.outcome;
  const outcomeText =
    outcome.kind === "rule"
      ? `命中规则 #${outcome.index + 1}：${outcome.action}${outcome.target !== "" ? ` → ${outcome.target}` : ""}`
      : outcome.kind === "final"
        ? `未命中任何规则，走默认出站（final）${outcome.target !== "" ? ` → ${outcome.target}` : ""}`
        : `在规则 #${outcome.index + 1} 处停止：${outcome.reason}`;

  return (
    <div className={styles.tabBody}>
      <div className={styles.traceForm}>
        <FcField label="域名" hint="如 www.example.com；域名类规则需要它">
          <input
            className="input"
            value={domain}
            placeholder="www.example.com"
            onChange={(event) => setDomain(event.target.value)}
          />
        </FcField>
        <FcField label="目标 IP" hint="可选；ip_cidr / geoip 规则需要它">
          <input
            className="input"
            value={ip}
            placeholder="1.2.3.4"
            onChange={(event) => setIp(event.target.value)}
          />
        </FcField>
        <FcField label="端口" hint="可选；port / port_range 规则需要它">
          <input
            className="input"
            value={port}
            placeholder="443"
            inputMode="numeric"
            onChange={(event) => setPort(event.target.value)}
          />
        </FcField>
        <FcField label="网络类型">
          <FcSelect value={network} onChange={setNetwork}>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </FcSelect>
        </FcField>
      </div>

      <FcCard className={styles.traceOutcome}>
        <span
          className={cx(
            styles.traceOutcomeLabel,
            outcome.kind === "rule" && styles.traceOutcomeMatch,
            outcome.kind === "unknown" && styles.traceOutcomeUnknown,
          )}
        >
          {outcome.kind === "rule" ? "结论" : outcome.kind === "final" ? "结论（默认）" : "无法完全判定"}
        </span>
        <span className={styles.traceOutcomeText}>{outcomeText}</span>
      </FcCard>

      {result.steps.length > 0 && (
        <FcCard className={styles.card}>
          {result.steps.map((step) => (
            <div key={step.index} className={styles.row}>
              <span className={styles.order}>{step.index + 1}</span>
              <div className={cx(styles.rowMain, styles.rowMainStatic)}>
                <span className={styles.summary}>{ruleSummary(props.rules[step.index] ?? {})}</span>
                {step.verdict === "unknown" && (
                  <span className={styles.nestedNote}>{step.reason}</span>
                )}
              </div>
              <span
                className={cx(
                  styles.verdict,
                  step.verdict === "match" && styles.verdictMatch,
                  step.verdict === "unknown" && styles.verdictUnknown,
                )}
              >
                {VERDICT_LABEL[step.verdict]}
              </span>
            </div>
          ))}
        </FcCard>
      )}

      <p className={styles.hint}>
        模拟按规则顺序静态求值，只覆盖域名 / IP / 端口 / 网络等可直接判定的匹配器；
        rule_set 内容、geoip 库、进程与逻辑组合规则由内核判定，结果可能比内核宽松。
        模拟基于当前页面（含未应用改动）的规则。
      </p>
    </div>
  );
}
