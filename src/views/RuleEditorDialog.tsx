import { useMemo, useState } from "react";

import { Button, Dialog, Field, Select, Switch } from "../components/ui";
import {
  MATCHER_FIELDS,
  RULE_ACTIONS,
  draftIssue,
  draftToRule,
  matcherField,
  type RuleDraft,
  type RuleObject,
} from "../lib/ruleEditor";
import { useI18n } from "../app/i18n";
import styles from "./RuleEditorDialog.module.css";

/**
 * Edits a single sing-box rule as "action + target + matchers".
 *
 * Rules that nest other rules (`rules[]`/`mode`) are not supported here — the
 * dialog refuses to open for them and the caller sends the user to the JSON
 * editor instead.
 */
export function RuleEditorDialog(props: {
  title: string;
  targetLabel: string;
  targetKey: "outbound" | "server";
  initial: RuleDraft;
  onCancel: () => void;
  onSubmit: (rule: RuleObject) => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(props.initial);
  const [error, setError] = useState("");
  const { t } = useI18n();

  // Keep keys that are not in the known list selectable so opening a rule that
  // uses a newer matcher never silently drops it.
  const keyOptions = useMemo(() => {
    const keys = new Set(MATCHER_FIELDS.map((field) => field.key));
    for (const matcher of draft.matchers) {
      keys.add(matcher.key);
    }
    return [...keys].map((key) => ({ value: key, label: key }));
  }, [draft.matchers]);

  const preview = JSON.stringify(draftToRule(draft, props.targetKey), null, 2);

  const submit = () => {
    const issue = draftIssue(draft);
    if (issue !== null) {
      setError(issue);
      return;
    }
    props.onSubmit(draftToRule(draft, props.targetKey));
  };

  const patchMatcher = (index: number, next: { key?: string; value?: string }) => {
    setDraft((current) => ({
      ...current,
      matchers: current.matchers.map((matcher, position) =>
        position === index
          ? { key: next.key ?? matcher.key, value: next.value ?? matcher.value }
          : matcher,
      ),
    }));
  };

  return (
    <Dialog onClose={props.onCancel} className={styles.dialog}>
      <h2 className={styles.title}>{props.title}</h2>
      <div className={styles.form}>
        <Field label={t("Action")}>
          <Select
            options={RULE_ACTIONS.map((action) => ({ value: action, label: action }))}
            value={draft.action}
            onChange={(action) => setDraft((current) => ({ ...current, action }))}
          />
        </Field>
        {draft.action === "route" && (
          <Field label={props.targetLabel}>
            <input
              className="input"
              value={draft.target}
              placeholder={props.targetKey === "server" ? "local" : "proxy"}
              onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))}
            />
          </Field>
        )}
        <div className={styles.invert}>
          <Switch
            label={t("Invert match result (invert)")}
            value={draft.invert}
            onChange={(invert) => setDraft((current) => ({ ...current, invert }))}
          />
          <span>{t("Invert match result (invert)")}</span>
        </div>

        <div className={styles.matchers}>
          <div className={styles.matchersHead}>
            <span>{t("Match conditions")}</span>
            <Button
              size="small"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  matchers: [...current.matchers, { key: "domain_suffix", value: "" }],
                }))
              }
            >
              {t("Add condition")}
            </Button>
          </div>
          {draft.matchers.map((matcher, index) => {
            const field = matcherField(matcher.key);
            return (
              <div key={index} className={styles.matcher}>
                <Select
                  options={keyOptions}
                  value={matcher.key}
                  onChange={(key) => patchMatcher(index, { key })}
                />
                {field?.flag === true ? (
                  <Switch
                    label={matcher.key}
                    value={matcher.value === "true"}
                    onChange={(value) => patchMatcher(index, { value: value ? "true" : "false" })}
                  />
                ) : (
                  <input
                    className="input"
                    value={matcher.value}
                    placeholder={
                      field?.multiple === true ? t("Separate multiple values with commas") : t("Value")
                    }
                    onChange={(event) => patchMatcher(index, { value: event.target.value })}
                  />
                )}
                <Button
                  size="small"
                  aria-label={t("Delete condition")}
                  disabled={draft.matchers.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      matchers: current.matchers.filter((_, position) => position !== index),
                    }))
                  }
                >
                  {t("Delete")}
                </Button>
              </div>
            );
          })}
        </div>

        <div className={styles.preview}>
          <span className={styles.previewLabel}>{t("Preview")}</span>
          <pre className={styles.previewCode}>{preview}</pre>
        </div>
        {error !== "" && <div className={styles.error}>{error}</div>}
      </div>
      <div className={styles.actions}>
        <Button onClick={props.onCancel}>{t("Cancel")}</Button>
        <Button variant="primary" onClick={submit}>
          {t("Save rule")}
        </Button>
      </div>
    </Dialog>
  );
}
