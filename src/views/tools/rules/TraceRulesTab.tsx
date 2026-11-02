import { useMemo, useState } from "react";

import { useI18n, type MessageKey } from "../../../app/i18n";
import { FcCard, FcField, FcSelect } from "../../../components/flclash";
import type { RuleObject } from "../../../lib/ruleEditor";
import { ruleSummary } from "./RuleEditorList";
import { traceRules, type TraceVerdict } from "../../../lib/ruleTrace";
import { cx } from "../../../lib/cx";
import styles from "../RulesView.module.css";

const VERDICT_LABEL: Record<TraceVerdict, MessageKey> = {
  match: "Match",
  no_match: "No match",
  unknown: "Requires the kernel",
};

/**
 * Static route-rule simulator. It evaluates the rules as staged on this page
 * (including not-yet-applied changes) against a domain/IP/port/network tuple;
 * see lib/ruleTrace.ts for what can and cannot be decided without the kernel.
 */
export function TraceRulesTab(props: { rules: readonly RuleObject[]; finalTarget: string }) {
  const { t } = useI18n();
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
      ? `${t("Matched rule #{index}: {action}", {
          index: outcome.index + 1,
          action: outcome.action,
        })}${outcome.target !== "" ? ` → ${outcome.target}` : ""}`
      : outcome.kind === "final"
        ? `${t("No rule matched; using the default outbound (final)")}${outcome.target !== "" ? ` → ${outcome.target}` : ""}`
        : t("Stopped at rule #{index}: {reason}", {
            index: outcome.index + 1,
            reason: t(outcome.reason.key, outcome.reason.params),
          });

  return (
    <div className={styles.tabBody}>
      <div className={styles.traceForm}>
        <FcField label={t("Domain")} hint={t("e.g. www.example.com; required by domain-based rules")}>
          <input
            className="input"
            value={domain}
            placeholder="www.example.com"
            onChange={(event) => setDomain(event.target.value)}
          />
        </FcField>
        <FcField label={t("Target IP")} hint={t("Optional; required by ip_cidr / geoip rules")}>
          <input
            className="input"
            value={ip}
            placeholder="1.2.3.4"
            onChange={(event) => setIp(event.target.value)}
          />
        </FcField>
        <FcField label={t("Port")} hint={t("Optional; required by port / port_range rules")}>
          <input
            className="input"
            value={port}
            placeholder="443"
            inputMode="numeric"
            onChange={(event) => setPort(event.target.value)}
          />
        </FcField>
        <FcField label={t("Network type")}>
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
          {outcome.kind === "rule"
            ? t("Result")
            : outcome.kind === "final"
              ? t("Result (default)")
              : t("Cannot fully determine")}
        </span>
        <span className={styles.traceOutcomeText}>{outcomeText}</span>
      </FcCard>

      {result.steps.length > 0 && (
        <FcCard className={styles.card}>
          {result.steps.map((step) => (
            <div key={step.index} className={styles.row}>
              <span className={styles.order}>{step.index + 1}</span>
              <div className={cx(styles.rowMain, styles.rowMainStatic)}>
                <span className={styles.summary}>{ruleSummary(props.rules[step.index] ?? {}, t)}</span>
                {step.reason !== null && (
                  <span className={styles.nestedNote}>{t(step.reason.key, step.reason.params)}</span>
                )}
              </div>
              <span
                className={cx(
                  styles.verdict,
                  step.verdict === "match" && styles.verdictMatch,
                  step.verdict === "unknown" && styles.verdictUnknown,
                )}
              >
                {t(VERDICT_LABEL[step.verdict])}
              </span>
            </div>
          ))}
        </FcCard>
      )}

      <p className={styles.hint}>
        {t(
          "The simulation evaluates rules statically in order and only covers matchers that can be decided directly, such as domain, IP, port, and network; rule_set contents, the geoip database, process rules, and combined logical rules are decided by the kernel, so results may be looser than the kernel's. It uses the rules on this page, including unapplied changes.",
        )}
      </p>
    </div>
  );
}
